import { normalizeEmail, parseEmailList } from "./admins.server";
import { auditStatement } from "./db.server";
import { viewerApprovedEmail } from "./email/viewer-access";
import { sendDirectEmail, type EmailConfig } from "./email/send.server";

/**
 * Panitia viewers: committee members with READ-ONLY access to the aggregate dashboards (/panitia).
 * Flow: the person asks for access at /panitia/login (email + name + section, Turnstile) -> a `pending` row ->
 * an admin approves or rejects it at /admin/admins -> an approved viewer logs in with an email PIN (login-codes.server.ts,
 * realm "viewer"). Access ends by itself at `expires_at` (event end + 7 days) and the 5-minute job deletes the row.
 */
export type ViewerStatus = "pending" | "approved" | "rejected";

export interface ViewerRow {
  id: number;
  email: string;
  name: string;
  section: string | null;
  status: ViewerStatus;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  last_login_at: string | null;
  expires_at: string;
}

export type ViewerResult = { ok: true; message: string } | { ok: false; message: string };

/** Access stays open this long after the event ends (then the row is deleted). */
export const VIEWER_GRACE_MS = 7 * 86_400_000;
/** Safety valve: more open requests than this are silently dropped (bots, a leaked link). */
export const MAX_PENDING_REQUESTS = 100;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const viewerExpiry = (event: { ends_at: string }) =>
  new Date(Date.parse(event.ends_at) + VIEWER_GRACE_MS).toISOString();

const clean = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

export type AccessRequestInput = { email: string; name: string; section: string };

/** Field problems are shown to the visitor (they say nothing about who already has access). */
export function validateAccessRequest(input: AccessRequestInput): { ok: true; value: AccessRequestInput } | { ok: false; message: string } {
  const email = normalizeEmail(input.email);
  const name = clean(input.name, 80);
  const section = clean(input.section, 60);
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, message: "Masukkan alamat email yang valid." };
  if (name.length < 2) return { ok: false, message: "Masukkan nama Anda (minimal 2 huruf)." };
  if (section.length < 2) return { ok: false, message: "Sebutkan seksi atau tugas Anda di panitia." };
  return { ok: true, value: { email, name, section } };
}

/**
 * Record a request for access. The caller shows the SAME answer whatever happens here (new request, already pending,
 * already approved, rejected, cap reached), so the form cannot be used to find out who has access.
 * One row per email (UNIQUE), so repeating a request changes nothing.
 */
export async function requestViewerAccess(
  db: D1Database,
  input: AccessRequestInput,
  expiresAt: string,
  now = new Date(),
): Promise<"created" | "skipped"> {
  const nowIso = now.toISOString();
  const res = await db
    .prepare(
      `INSERT INTO viewers (email, name, section, status, requested_at, expires_at)
       SELECT ?1, ?2, ?3, 'pending', ?4, ?5
       WHERE NOT EXISTS (SELECT 1 FROM admins WHERE email = ?1)
         AND (SELECT COUNT(*) FROM viewers WHERE status = 'pending') < ?6
       ON CONFLICT (email) DO NOTHING`,
    )
    .bind(input.email, input.name, input.section, nowIso, expiresAt, MAX_PENDING_REQUESTS)
    .run();
  if ((res.meta.changes ?? 0) !== 1) return "skipped";
  await auditStatement(db, input.email, "viewer.request", input.email, { section: input.section }, nowIso).run();
  return "created";
}

export async function listViewers(db: D1Database): Promise<ViewerRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, email, name, section, status, requested_at, decided_by, decided_at, last_login_at, expires_at
       FROM viewers ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, requested_at, email`,
    )
    .all<ViewerRow>();
  return results;
}

export async function countPendingViewers(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM viewers WHERE status = 'pending'").first<{ n: number }>();
  return row?.n ?? 0;
}

async function viewerById(db: D1Database, id: number) {
  return db.prepare("SELECT email, name FROM viewers WHERE id = ?").bind(id).first<{ email: string; name: string }>();
}

/** pending or rejected -> approved. Conditional UPDATE, so two admins clicking at once cannot both win. */
export async function approveViewer(db: D1Database, actor: string, id: number, now = new Date()): Promise<ViewerResult & { email?: string }> {
  const nowIso = now.toISOString();
  const row = await viewerById(db, id);
  if (!row) return { ok: false, message: "Permintaan tidak ditemukan." };
  const res = await db
    .prepare(
      `UPDATE viewers SET status = 'approved', decided_by = ?, decided_at = ?
       WHERE id = ? AND status IN ('pending', 'rejected') AND expires_at > ?`,
    )
    .bind(normalizeEmail(actor), nowIso, id, nowIso)
    .run();
  if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: `${row.email} sudah disetujui atau sudah kedaluwarsa.` };
  await auditStatement(db, actor, "viewer.approve", row.email, undefined, nowIso).run();
  return { ok: true, message: `${row.email} disetujui sebagai pengakses Ringkasan Panitia (hanya-baca).`, email: row.email };
}

/** pending or approved -> rejected, and the viewer's sessions end now. A rejected row blocks repeated requests. */
export async function rejectViewer(db: D1Database, actor: string, id: number, now = new Date()): Promise<ViewerResult> {
  const nowIso = now.toISOString();
  const row = await viewerById(db, id);
  if (!row) return { ok: false, message: "Permintaan tidak ditemukan." };
  const res = await db
    .prepare(
      `UPDATE viewers SET status = 'rejected', decided_by = ?, decided_at = ?
       WHERE id = ? AND status IN ('pending', 'approved')`,
    )
    .bind(normalizeEmail(actor), nowIso, id)
    .run();
  if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: `${row.email} sudah ditolak.` };
  await db.batch([
    db.prepare("DELETE FROM viewer_sessions WHERE viewer_id = ?").bind(id),
    auditStatement(db, actor, "viewer.reject", row.email, undefined, nowIso),
  ]);
  return { ok: true, message: `Akses ${row.email} dicabut / ditolak.` };
}

/** Remove the row entirely (any status): the person may ask again. */
export async function deleteViewer(db: D1Database, actor: string, id: number, now = new Date()): Promise<ViewerResult> {
  const row = await viewerById(db, id);
  if (!row) return { ok: false, message: "Permintaan tidak ditemukan." };
  await db.batch([
    db.prepare("DELETE FROM viewer_sessions WHERE viewer_id = ?").bind(id),
    db.prepare("DELETE FROM viewer_login_codes WHERE email = ?").bind(row.email),
    db.prepare("DELETE FROM viewers WHERE id = ?").bind(id),
    auditStatement(db, actor, "viewer.delete", row.email, undefined, now.toISOString()),
  ]);
  return { ok: true, message: `${row.email} dihapus dari daftar.` };
}

/** Retention (run by the 5-minute job): access ended at `expires_at`, so the person's row, sessions and codes go. */
export async function purgeExpiredViewers(db: D1Database, now = new Date()): Promise<number> {
  const nowIso = now.toISOString();
  const [, , , res] = await db.batch([
    db.prepare("DELETE FROM viewer_sessions WHERE viewer_id IN (SELECT id FROM viewers WHERE expires_at <= ?)").bind(nowIso),
    db.prepare("DELETE FROM viewer_login_codes WHERE email IN (SELECT email FROM viewers WHERE expires_at <= ?)").bind(nowIso),
    db.prepare("DELETE FROM viewer_sessions WHERE expires_at <= ?").bind(nowIso),
    db.prepare("DELETE FROM viewers WHERE expires_at <= ?").bind(nowIso),
  ]);
  return res.meta.changes ?? 0;
}

/** Admin intents of the viewer section (kept out of handleAdminIntent so the live admin actions stay untouched). */
export const VIEWER_INTENTS = ["add-viewer", "approve-viewer", "reject-viewer", "delete-viewer"] as const;

/** At most this many emails per "add" click (a pasted list of the committee; keeps one request small). */
export const MAX_ADD_BATCH = 30;

/**
 * An admin adds panitia emails up front: they are approved at once, no request needed. Existing pending or rejected rows
 * become approved; people who are already approved, and admins (who already have the pages), are left alone.
 * `name` and `section` are optional; without a name the part before the @ is used. Returns who is newly approved.
 */
export async function addViewers(
  db: D1Database,
  actor: string,
  emailsRaw: string,
  nameRaw: string,
  sectionRaw: string,
  expiresAt: string,
  now = new Date(),
): Promise<ViewerResult & { added: string[] }> {
  const emails = parseEmailList(emailsRaw);
  if (emails.length === 0) return { ok: false, message: "Masukkan minimal satu alamat email yang valid.", added: [] };
  if (emails.length > MAX_ADD_BATCH) return { ok: false, message: `Maksimal ${MAX_ADD_BATCH} email sekali tambah.`, added: [] };
  const nowIso = now.toISOString();
  const name = clean(nameRaw, 80);
  const section = clean(sectionRaw, 60) || null;
  const who = normalizeEmail(actor);

  const added: string[] = [];
  let already = 0;
  for (const email of emails) {
    const res = await db
      .prepare(
        `INSERT INTO viewers (email, name, section, status, requested_at, decided_by, decided_at, expires_at)
         SELECT ?1, ?2, ?3, 'approved', ?4, ?5, ?4, ?6 WHERE NOT EXISTS (SELECT 1 FROM admins WHERE email = ?1)
         ON CONFLICT (email) DO UPDATE SET status = 'approved', decided_by = excluded.decided_by, decided_at = excluded.decided_at
         WHERE viewers.status <> 'approved' AND viewers.expires_at > ?4`,
      )
      .bind(email, (emails.length === 1 && name) || email.split("@")[0].slice(0, 80), section, nowIso, who, expiresAt)
      .run();
    if ((res.meta.changes ?? 0) === 1) added.push(email);
    else already++;
  }
  if (added.length) await auditStatement(db, actor, "viewer.add", null, { count: added.length, emails: added }, nowIso).run();
  if (added.length === 0) return { ok: false, message: "Semua email itu sudah punya akses (atau sudah admin).", added };
  const skipped = already ? ` ${already} lainnya sudah punya akses.` : "";
  return { ok: true, message: `${added.length} email ditambahkan dan disetujui.${skipped}`, added };
}

export async function handleViewerIntent(
  db: D1Database,
  cfg: EmailConfig,
  actor: string,
  form: FormData,
  appOrigin: string,
  now = new Date(),
  expiresAt = new Date(now.getTime() + 60 * 86_400_000).toISOString(),
): Promise<ViewerResult> {
  const intent = String(form.get("intent") ?? "");
  if (intent === "add-viewer") {
    const res = await addViewers(db, actor, String(form.get("email") ?? ""), String(form.get("name") ?? ""), String(form.get("section") ?? ""), expiresAt, now);
    if (!res.ok) return res;
    let failed = 0;
    for (const to of res.added) {
      // Best effort, like a single approval: the access is already saved.
      try {
        const mail = viewerApprovedEmail({ appOrigin, replyTo: cfg.replyTo });
        await sendDirectEmail(db, cfg, { to, ...mail, attachments: [] }, { kind: "viewer_approved", idempotencyKey: `viewer-added:${to}:${now.getTime()}` });
      } catch (err) {
        failed++;
        console.error(`viewer added email for ${to} failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
      }
    }
    return { ok: true, message: failed ? `${res.message} ${failed} email pemberitahuan gagal terkirim; beri tahu orangnya langsung.` : `${res.message} Pemberitahuan dikirim.` };
  }
  const id = Number(form.get("viewerId"));
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "Permintaan tidak ditemukan." };
  switch (intent) {
    case "approve-viewer": {
      const res = await approveViewer(db, actor, id, now);
      if (!res.ok || !res.email) return res;
      // Best effort: the approval itself is already saved. A failed mail is reported, never rolled back.
      try {
        const mail = viewerApprovedEmail({ appOrigin, replyTo: cfg.replyTo });
        await sendDirectEmail(db, cfg, { to: res.email, ...mail, attachments: [] }, {
          kind: "viewer_approved",
          idempotencyKey: `viewer-approved:${id}:${now.getTime()}`,
        });
        return { ok: true, message: `${res.message} Pemberitahuan dikirim ke emailnya.` };
      } catch (err) {
        console.error(`viewer approval email for ${res.email} failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
        return { ok: true, message: `${res.message} Email pemberitahuan gagal terkirim; beri tahu orangnya secara langsung.` };
      }
    }
    case "reject-viewer":
      return rejectViewer(db, actor, id, now);
    case "delete-viewer":
      return deleteViewer(db, actor, id, now);
    default:
      return { ok: false, message: "Permintaan tidak dikenal." };
  }
}
