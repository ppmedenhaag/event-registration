import { normalizeEmail } from "./admins.server";
import {
  isSecureRequest,
  randomToken,
  readCookie,
  serializeCookie,
  sha256Hex,
  type RequestMeta,
} from "./auth.server";
import type { ScannerIdentity, ScannerRole } from "./checkin.server";
import { auditStatement } from "./db.server";
import { describeDevice } from "./email/login-code";

/**
 * Scanner sessions (the check-in app on event-checkin.ppmedenhaag.nl). Same design as the admin session
 * (auth.server.ts): a random 256-bit token in an HttpOnly cookie, only its SHA-256 in `scanner_sessions`.
 * Differences: its own cookie and table (a scanner cookie is useless on the admin host and vice versa), 48 hours
 * absolute so volunteers can log in on the evening before, and authorization = an ACTIVE row in `scanners`, joined on
 * every request (deactivating or removing a scanner ends their access at once). Fails closed.
 * Development: APP_ENV=development + DEV_SCANNER_EMAIL skips the login (the email must exist in `scanners`).
 */
export const SCANNER_SESSION_TTL_MS = 48 * 60 * 60 * 1000;

const COOKIE_SECURE = "__Host-ppme_scan";
const COOKIE_INSECURE = "ppme_scan";
const cookieName = (secure: boolean) => (secure ? COOKIE_SECURE : COOKIE_INSECURE);

export interface ScannerAuthEnv {
  APP_ENV?: string;
  DEV_SCANNER_EMAIL?: string;
}

type ScannerJoin = { id: number; email: string; name: string | null; role: ScannerRole; participant_id: string | null };

const toIdentity = (row: ScannerJoin, deviceLabel: string | null, sessionHash?: string): ScannerIdentity => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  participantId: row.participant_id,
  deviceLabel,
  sessionHash,
});

export function scannerSessionCookie(request: Request, token: string) {
  const secure = isSecureRequest(request);
  return serializeCookie(cookieName(secure), token, { maxAge: SCANNER_SESSION_TTL_MS / 1000, secure });
}

export function clearScannerSessionCookie(request: Request) {
  const secure = isSecureRequest(request);
  return serializeCookie(cookieName(secure), "", { maxAge: 0, secure });
}

/** Start a session for an active scanner. Returns null when the email is not (or no longer) an active scanner. */
export async function createScannerSession(
  db: D1Database,
  emailRaw: string,
  meta: Pick<RequestMeta, "ip" | "userAgent">,
  now = new Date(),
  method: "pin" | "google" = "pin",
): Promise<{ token: string; expiresAt: string } | null> {
  const email = normalizeEmail(emailRaw);
  const token = randomToken();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SCANNER_SESSION_TTL_MS).toISOString();

  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO scanner_sessions (token_hash, scanner_id, method, created_at, expires_at, ip, user_agent, device_label)
         SELECT ?, id, ?, ?, ?, ?, ?, ? FROM scanners WHERE email = ? AND active = 1`,
      )
      .bind(await sha256Hex(token), method, nowIso, expiresAt, meta.ip, meta.userAgent, describeDevice(meta.userAgent), email),
    db.prepare("DELETE FROM scanner_sessions WHERE expires_at <= ?").bind(nowIso),
    db.prepare("DELETE FROM scanner_login_codes WHERE created_at <= ?").bind(new Date(now.getTime() - 86_400_000).toISOString()),
    db.prepare("UPDATE scanners SET last_login_at = ? WHERE email = ? AND active = 1").bind(nowIso, email),
  ]);
  if ((insert.meta.changes ?? 0) !== 1) return null;
  await auditStatement(db, email, "scanner.login", null, undefined, nowIso).run();
  return { token, expiresAt };
}

/** The caller as an active scanner with a live session, or null (fail closed). */
export async function identifyScanner(
  request: Request,
  env: ScannerAuthEnv & { DB: D1Database },
  now = new Date(),
): Promise<ScannerIdentity | null> {
  if (env.APP_ENV === "development" && env.DEV_SCANNER_EMAIL) {
    const row = await env.DB.prepare(
      "SELECT id, email, name, role, participant_id FROM scanners WHERE email = ? AND active = 1",
    )
      .bind(normalizeEmail(env.DEV_SCANNER_EMAIL))
      .first<ScannerJoin>();
    return row ? toIdentity(row, "Dev") : null;
  }
  const token = readCookie(request, cookieName(isSecureRequest(request)));
  if (!token || token.length < 32 || token.length > 128) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id, s.email, s.name, s.role, s.participant_id, ss.device_label
     FROM scanner_sessions ss JOIN scanners s ON s.id = ss.scanner_id
     WHERE ss.token_hash = ? AND ss.expires_at > ? AND s.active = 1`,
  )
    .bind(hash, now.toISOString())
    .first<ScannerJoin & { device_label: string | null }>();
  return row ? toIdentity(row, row.device_label, hash) : null;
}

export async function destroyScannerSession(db: D1Database, request: Request) {
  const token = readCookie(request, cookieName(isSecureRequest(request)));
  if (!token || token.length < 32 || token.length > 128) return;
  await db.prepare("DELETE FROM scanner_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}
