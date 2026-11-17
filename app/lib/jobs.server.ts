import { anonymiseCheckinData } from "./checkin.server";
import { purgeExpiredViewers } from "./viewers.server";
import { runRetention, type RetentionReport } from "./retention.server";
import { auditStatement } from "./db.server";
import { MAX_EMAIL_ATTEMPTS, deliverEmail, type EmailConfig, type EmailKind } from "./email/send.server";

export interface JobReport {
  expired: number;
  reminders: number;
  retried: number;
  /** QR emails left for the next run because this run reached its QR budget. */
  deferred: number;
  /** Check-in log rows anonymised (event end + 30 days); only present when something happened. */
  anonymised?: number;
  /** Automatic data deletion (event end + 90 days): warnings sent / data purged; only present when something happened. */
  retention?: RetentionReport;
}

/**
 * QR images are generated inside the Worker (~2.7 ms CPU each, measured), and the Free plan allows ~10 ms CPU per
 * invocation (gap N3). The sweeper therefore sends QR (confirmation) emails in BATCHES: at most this many QR codes
 * per run, oldest first, so one run never has to render dozens of tickets. The rest waits for the next 5-minute
 * run (it stays 'pending' in the outbox), and the first email of a run is always sent, so a big family cannot starve.
 * Raise it on Workers Paid (no 10 ms limit).
 */
export const QR_BUDGET_PER_RUN = 8;

/**
 * FR-JOB-*: runs every 5 minutes from the Cron Trigger (and on demand from the admin page).
 * 1. Expire unpaid registrations whose deadline has passed and release their seats.
 * 2. Send the payment reminder once, `reminder_after_min` after registration.
 * 3. Sweep the outbox: send emails still 'pending' or 'failed' (max 5 attempts, 60 s lease).
 */
/**
 * Expire unpaid registrations whose deadline has passed and release their seats. Each expiry also records its
 * pending "expired" email in the same transaction. Returns the ids expired by THIS call.
 */
export async function expireDue(db: D1Database, now = new Date()): Promise<string[]> {
  const nowIso = now.toISOString();
  const { results: due } = await db
    .prepare(
      `SELECT id FROM registrations
       WHERE status = 'pending_payment' AND pay_deadline IS NOT NULL AND pay_deadline <= ?`,
    )
    .bind(nowIso)
    .all<{ id: string }>();

  const expired: string[] = [];
  for (const { id } of due) {
    const res = await db.batch([
      db
        .prepare(
          `UPDATE registrations SET status = 'expired', payment_status = 'expired'
           WHERE id = ? AND status = 'pending_payment' AND pay_deadline <= ?`,
        )
        .bind(id, nowIso),
      db
        .prepare(
          `UPDATE participants SET status = 'expired'
           WHERE registration_id = ? AND status = 'pending_payment'
             AND EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'expired')`,
        )
        .bind(id, id),
      db
        .prepare(
          `INSERT INTO email_log (registration_id, kind, status, attempts, updated_at)
           SELECT ?, 'expired', 'pending', 0, ?
           WHERE EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'expired')
           ON CONFLICT (registration_id, kind) DO NOTHING`,
        )
        .bind(id, nowIso, id),
      auditStatement(db, "system", "registration.expire", id, undefined, nowIso),
    ]);
    if ((res[0].meta.changes ?? 0) === 1) expired.push(id);
  }
  return expired;
}

export async function runDeadlineJob(db: D1Database, cfg: EmailConfig, now = new Date()): Promise<JobReport> {
  const nowIso = now.toISOString();
  const report: JobReport = { expired: 0, reminders: 0, retried: 0, deferred: 0 };

  for (const id of await expireDue(db, now)) {
    report.expired++;
    await deliverEmail(db, cfg, id, "expired", { now });
  }

  const { results: needReminder } = await db
    .prepare(
      `SELECT r.id FROM registrations r JOIN events e ON e.id = r.event_id
       WHERE r.status = 'pending_payment' AND r.pay_deadline > ?
         AND strftime('%Y-%m-%dT%H:%M:%fZ', r.created_at, '+' || e.reminder_after_min || ' minutes') <= ?
         AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.registration_id = r.id AND l.kind = 'reminder')`,
    )
    .bind(nowIso, nowIso)
    .all<{ id: string }>();

  for (const { id } of needReminder) {
    const r = await deliverEmail(db, cfg, id, "reminder", { now });
    if (r.ok && !r.skipped) report.reminders++;
  }

  const { results: failed } = await db
    .prepare(
      `SELECT registration_id, kind FROM email_log
       WHERE status IN ('failed', 'pending') AND attempts < ? AND updated_at <= ?
       ORDER BY updated_at ASC`,
    )
    .bind(MAX_EMAIL_ATTEMPTS, new Date(now.getTime() - 60_000).toISOString())
    .all<{ registration_id: string; kind: EmailKind }>();

  let qrUsed = 0;
  for (const row of failed) {
    // A reminder for a registration that is no longer pending is pointless.
    if (row.kind === "reminder" || row.kind === "payment_instructions") {
      const still = await db
        .prepare("SELECT 1 AS ok FROM registrations WHERE id = ? AND status = 'pending_payment'")
        .bind(row.registration_id)
        .first();
      if (!still) continue;
    }
    // Same for the "waiting for validation" notice once the member has been validated or rejected.
    if (row.kind === "membership_pending") {
      const still = await db
        .prepare("SELECT 1 AS ok FROM registrations WHERE id = ? AND status = 'pending_membership'")
        .bind(row.registration_id)
        .first();
      if (!still) continue;
    }
    if (row.kind === "confirmation") {
      const tickets = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM participants WHERE registration_id = ? AND status = 'accepted' AND qr_token IS NOT NULL",
        )
        .bind(row.registration_id)
        .first<{ n: number }>();
      const n = tickets?.n ?? 0;
      if (qrUsed > 0 && qrUsed + n > QR_BUDGET_PER_RUN) {
        report.deferred++;
        continue;
      }
      qrUsed += n;
    }
    const r = await deliverEmail(db, cfg, row.registration_id, row.kind, { now });
    if (r.ok && !r.skipped) report.retried++;
  }

  // Retention: the check-in log loses who/where 30 days after the event (idempotent, one cheap query otherwise).
  const anonymised = await anonymiseCheckinData(db, now);
  if (anonymised > 0) report.anonymised = anonymised;

  // Retention: panitia viewer access ends at event end + 7 days; their rows, sessions and codes are deleted then.
  await purgeExpiredViewers(db, now);

  // Retention: warn admins, then delete the personal data of an event 90 days after it ended (see retention.server.ts).
  // Isolated on purpose: a problem here must never stop registrations, payments or emails from being processed.
  try {
    const retention = await runRetention(db, cfg, now);
    if (retention.warned.length || retention.purged.length || retention.blocked.length) report.retention = retention;
    for (const b of retention.blocked) console.error("retention blocked:", b);
  } catch (err) {
    console.error("retention run failed:", String((err as Error)?.message ?? err).slice(0, 300));
  }

  return report;
}
