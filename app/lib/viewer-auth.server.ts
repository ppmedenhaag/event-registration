import { normalizeEmail } from "./admins.server";
import {
  identifyUser,
  isSecureRequest,
  randomToken,
  readCookie,
  serializeCookie,
  sha256Hex,
  type AuthEnv,
  type RequestMeta,
} from "./auth.server";
import { auditStatement } from "./db.server";

/**
 * Sessions for the read-only panitia dashboards (/panitia). Same design as the admin and scanner sessions: a random
 * 256-bit token in an HttpOnly cookie, only its SHA-256 in `viewer_sessions`. Own cookie and own table, so a viewer
 * cookie is never recognised by the admin middleware (and the other way round). 24 hours, absolute, and never longer
 * than the viewer's own `expires_at` (event end + 7 days). Authorization = an APPROVED, not expired row in `viewers`,
 * joined on every request: revoking a viewer ends their access on the next request. Fails closed.
 */
export const VIEWER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const COOKIE_SECURE = "__Host-ppme_view";
/** Plain-http development (localhost) cannot use the __Host- prefix, which requires Secure. */
const COOKIE_INSECURE = "ppme_view";
const cookieName = (secure: boolean) => (secure ? COOKIE_SECURE : COOKIE_INSECURE);

export interface ViewerIdentity {
  /** "viewer" = an approved panitia viewer; "admin" = an admin looking at the same pages (preview). */
  kind: "viewer" | "admin";
  email: string;
  name: string | null;
}

export function viewerSessionCookie(request: Request, token: string) {
  const secure = isSecureRequest(request);
  return serializeCookie(cookieName(secure), token, { maxAge: VIEWER_SESSION_TTL_MS / 1000, secure });
}

export function clearViewerSessionCookie(request: Request) {
  const secure = isSecureRequest(request);
  return serializeCookie(cookieName(secure), "", { maxAge: 0, secure });
}

/** Start a session for an approved viewer. Returns null when the email is not (or no longer) an approved, unexpired viewer. */
export async function createViewerSession(
  db: D1Database,
  emailRaw: string,
  meta: Pick<RequestMeta, "ip" | "userAgent">,
  now = new Date(),
): Promise<{ token: string; expiresAt: string } | null> {
  const email = normalizeEmail(emailRaw);
  const token = randomToken();
  const nowIso = now.toISOString();
  const ttlEnd = new Date(now.getTime() + VIEWER_SESSION_TTL_MS).toISOString();

  // The session never outlives the viewer's own expiry: MIN(...) is evaluated in SQL on the joined row.
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO viewer_sessions (token_hash, viewer_id, created_at, expires_at, ip, user_agent)
         SELECT ?, id, ?, MIN(?, expires_at), ?, ? FROM viewers
         WHERE email = ? AND status = 'approved' AND expires_at > ?
         RETURNING expires_at`,
      )
      .bind(await sha256Hex(token), nowIso, ttlEnd, meta.ip, meta.userAgent, email, nowIso),
    db.prepare("DELETE FROM viewer_sessions WHERE expires_at <= ?").bind(nowIso),
    db.prepare("DELETE FROM viewer_login_codes WHERE created_at <= ?").bind(new Date(now.getTime() - 86_400_000).toISOString()),
    db.prepare("UPDATE viewers SET last_login_at = ? WHERE email = ? AND status = 'approved'").bind(nowIso, email),
  ]);
  const created = (insert.results as { expires_at: string }[] | undefined)?.[0];
  if (!created) return null;
  await auditStatement(db, email, "viewer.login", null, undefined, nowIso).run();
  return { token, expiresAt: created.expires_at };
}

/** The caller as an approved viewer with a live session, or null (fail closed). */
export async function identifyViewer(request: Request, db: D1Database, now = new Date()): Promise<ViewerIdentity | null> {
  const token = readCookie(request, cookieName(isSecureRequest(request)));
  if (!token || token.length < 32 || token.length > 128) return null;
  const nowIso = now.toISOString();
  const row = await db
    .prepare(
      `SELECT v.email, v.name FROM viewer_sessions s JOIN viewers v ON v.id = s.viewer_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND v.status = 'approved' AND v.expires_at > ?`,
    )
    .bind(await sha256Hex(token), nowIso, nowIso)
    .first<{ email: string; name: string }>();
  return row ? { kind: "viewer", email: row.email, name: row.name } : null;
}

/**
 * Who may open the /panitia dashboards: an approved viewer, or an admin (so admins can see exactly what viewers see).
 * An admin session does not give a viewer anything the other way round: /admin never looks at viewer sessions.
 */
export async function identifyPanitia(
  request: Request,
  env: AuthEnv & { DB: D1Database },
  now = new Date(),
): Promise<ViewerIdentity | null> {
  const viewer = await identifyViewer(request, env.DB, now);
  if (viewer) return viewer;
  const admin = await identifyUser(request, env, now);
  return admin.ok ? { kind: "admin", email: admin.email, name: null } : null;
}

export async function destroyViewerSession(db: D1Database, request: Request) {
  const token = readCookie(request, cookieName(isSecureRequest(request)));
  if (!token || token.length < 32 || token.length > 128) return;
  await db.prepare("DELETE FROM viewer_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}
