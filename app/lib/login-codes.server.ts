import { normalizeEmail } from "./admins.server";
import { sha256Hex, timingSafeEqual, type RequestMeta } from "./auth.server";
import { auditStatement } from "./db.server";
import { loginCodeEmail } from "./email/login-code";
import { scannerLoginCodeEmail } from "./email/scanner-login";
import { sendDirectEmail, type EmailConfig } from "./email/send.server";

/**
 * One-time login PINs for /admin.
 *  - 6 digits, valid 10 minutes, 5 wrong attempts and it is dead, usable once.
 *  - Only the newest code of an email counts; asking for a new one silently supersedes the old one.
 *  - At most one code per minute and 5 per hour per email; enforced inside the INSERT so concurrent requests cannot
 *    bypass it (same pattern as the quota check).
 *  - Unknown emails get the same answer as admins and no email (no admin enumeration).
 */
/**
 * Two logins share this mechanism with separate tables: the admin dashboard (`admins`) and the scanner app
 * (`scanners`, active only). The table names below are constants, never user input.
 */
export type LoginRealm = "admin" | "scanner" | "viewer";
const REALM_SQL: Record<LoginRealm, { codes: string; member: string }> = {
  admin: { codes: "admin_login_codes", member: "SELECT 1 FROM admins WHERE email = ?1" },
  scanner: { codes: "scanner_login_codes", member: "SELECT 1 FROM scanners WHERE email = ?1 AND active = 1" },
  // Panitia viewers (read-only dashboards): approved by an admin and not expired. Anyone else gets no code and no email.
  viewer: {
    codes: "viewer_login_codes",
    member: "SELECT 1 FROM viewers WHERE email = ?1 AND status = 'approved' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  },
};

export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_COOLDOWN_MS = 60_000;
export const CODE_MAX_PER_HOUR = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (value: string) => EMAIL_RE.test(normalizeEmail(value)) && value.length <= 254;

/** Uniform 6-digit code (rejection sampling avoids modulo bias). */
export function generateCode(): string {
  const limit = 4_294_000_000; // largest multiple of 1e6 below 2^32
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

/** Accepts "123 456" / "123-456"; returns the 6 digits or null. */
export function normalizeCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export const hashCode = (salt: string, code: string) => sha256Hex(`${salt}:${code}`);

export type RequestCodeResult =
  | { status: "sent"; codeId: number }
  /** Not an admin, or rate-limited. The UI shows the same neutral message as for "sent". */
  | { status: "skipped" }
  | { status: "failed"; error: string };

export async function requestLoginCode(
  db: D1Database,
  cfg: EmailConfig,
  emailRaw: string,
  meta: RequestMeta & { appOrigin: string },
  now = new Date(),
  realm: LoginRealm = "admin",
): Promise<RequestCodeResult> {
  const tables = REALM_SQL[realm];
  const email = normalizeEmail(emailRaw);
  if (!isValidEmail(email)) return { status: "skipped" };

  const code = generateCode();
  const salt = crypto.randomUUID();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();

  const row = await db
    .prepare(
      `INSERT INTO ${tables.codes} (email, code_hash, salt, created_at, expires_at, ip)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE EXISTS (${tables.member})
         AND NOT EXISTS (SELECT 1 FROM ${tables.codes} WHERE email = ?1 AND created_at > ?7)
         AND (SELECT COUNT(*) FROM ${tables.codes} WHERE email = ?1 AND created_at > ?8) < ?9
       RETURNING id`,
    )
    .bind(
      email,
      await hashCode(salt, code),
      salt,
      nowIso,
      expiresAt,
      meta.ip,
      new Date(now.getTime() - CODE_COOLDOWN_MS).toISOString(),
      new Date(now.getTime() - 3_600_000).toISOString(),
      CODE_MAX_PER_HOUR,
    )
    .first<{ id: number }>();
  if (!row) return { status: "skipped" };

  const { subject, html, text } =
    realm === "scanner"
      ? scannerLoginCodeEmail({
          code,
          email,
          requestedAt: nowIso,
          expiresAt,
          validMinutes: CODE_TTL_MS / 60_000,
          appOrigin: meta.appOrigin,
          userAgent: meta.userAgent,
        })
      : loginCodeEmail({
    code,
    email,
    requestedAt: nowIso,
    expiresAt,
    validMinutes: CODE_TTL_MS / 60_000,
    appOrigin: meta.appOrigin,
    country: meta.country,
    userAgent: meta.userAgent,
    replyTo: cfg.replyTo,
    audience: realm === "viewer" ? "viewer" : "admin",
  });

  try {
    await sendDirectEmail(db, cfg, { to: email, subject, html, text, attachments: [] }, {
      kind: realm === "scanner" ? "scanner_login_code" : realm === "viewer" ? "viewer_login_code" : "login_code",
      idempotencyKey: `login-code:${row.id}:${salt}`,
    });
  } catch (err) {
    const error = String((err as Error)?.message ?? err).slice(0, 300);
    // Drop the undelivered code so the cooldown does not block an immediate retry.
    await db.batch([
      db.prepare(`DELETE FROM ${tables.codes} WHERE id = ?`).bind(row.id),
      auditStatement(db, email, "auth.code_failed", null, { error }, nowIso),
    ]);
    console.error(`login code for ${email} failed: ${error}`);
    return { status: "failed", error };
  }

  if (cfg.mode === "log") console.log(`[dev] login code for ${email}: ${code} (also in /admin/outbox)`);
  await auditStatement(db, email, "auth.code_sent", null, { ip: meta.ip }, nowIso).run();
  return { status: "sent", codeId: row.id };
}

/** `code` is a stable machine-readable reason (the scanner app shows its own Indonesian/Dutch texts for it). */
export type VerifyCodeResult = { ok: true } | { ok: false; message: string; code?: "format" | "invalid" | "locked" };

const INVALID = "Kode salah atau sudah kedaluwarsa. Periksa kembali, atau minta kode baru.";

/**
 * Check a code. Every check of the live code costs one attempt (counted before comparing, in one conditional
 * UPDATE, so parallel guesses cannot exceed the limit). Marking it used is conditional too: only one login wins.
 */
export async function verifyLoginCode(
  db: D1Database,
  emailRaw: string,
  codeRaw: string,
  now = new Date(),
  realm: LoginRealm = "admin",
): Promise<VerifyCodeResult> {
  const table = REALM_SQL[realm].codes;
  const email = normalizeEmail(emailRaw);
  const code = normalizeCode(codeRaw);
  if (!code) return { ok: false, message: "Masukkan 6 digit kode dari email.", code: "format" };
  const nowIso = now.toISOString();

  const row = await db
    .prepare(
      `UPDATE ${table} SET attempts = attempts + 1
       WHERE id = (SELECT id FROM ${table} WHERE email = ? ORDER BY id DESC LIMIT 1)
         AND used_at IS NULL AND expires_at > ? AND attempts < ?
       RETURNING id, code_hash, salt, attempts`,
    )
    .bind(email, nowIso, CODE_MAX_ATTEMPTS)
    .first<{ id: number; code_hash: string; salt: string; attempts: number }>();
  if (!row) return { ok: false, message: INVALID, code: "invalid" };

  if (!timingSafeEqual(await hashCode(row.salt, code), row.code_hash)) {
    if (row.attempts >= CODE_MAX_ATTEMPTS) {
      await auditStatement(db, email, "auth.code_locked", null, undefined, nowIso).run();
      return { ok: false, message: "Terlalu banyak percobaan. Minta kode baru untuk masuk.", code: "locked" };
    }
    return { ok: false, message: INVALID, code: "invalid" };
  }

  const used = await db
    .prepare(`UPDATE ${table} SET used_at = ? WHERE id = ? AND used_at IS NULL`)
    .bind(nowIso, row.id)
    .run();
  if ((used.meta.changes ?? 0) !== 1) return { ok: false, message: INVALID, code: "invalid" };
  return { ok: true };
}
