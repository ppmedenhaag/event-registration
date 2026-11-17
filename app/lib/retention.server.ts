import { listAdmins } from "./admins.server";
import { auditStatement, getEventById, type EventRow } from "./db.server";
import {
  retentionDoneEmail,
  retentionWarningEmail,
  type RetentionCounts,
  type WarningStage,
} from "./email/retention";
import { sendDirectEmail, type EmailConfig } from "./email/send.server";
import { formatDateTime } from "./format";

/**
 * Data retention (privacy policy: participant data is removed no later than 90 days after the event).
 *
 * *** CURRENT MODE: REMINDERS ONLY (decision 17 Nov 2026). The system deletes NOTHING by itself. ***
 * Admins get an email 30, 7 and 1 day before the date, one at the date ("overdue"), then every 7 days until no
 * registration is left, and delete the data by hand (/admin/registrations -> a registration -> Hapus). The automatic purge
 * described below is DEFERRED: it stays in this file, fully tested, but `AUTO_PURGE_ENABLED` is false so no scheduled
 * code path can reach it. Do not flip it without a new explicit decision from the board.
 *
 * WHAT: for an event whose end + 90 days has passed, ALL personal data of that event is deleted: registrations,
 * participants, the email log, the dev outbox, registrant sessions and codes. Names and emails in the audit log are
 * blanked (action and time stay). Only a numbers-only snapshot remains in `retention_log`. Check-in details are
 * anonymised earlier (checkin.server.ts, +30 days) and viewers are purged at +7 days (viewers.server.ts): not here.
 *
 * SAFETY (this deletes real data, irreversibly):
 *  - Warnings go to EVERY admin at 30, 7 and 1 day before the purge date. A warning only counts if at least one admin
 *    was reached, and only while it announced the CURRENT purge date (moving the event end invalidates it).
 *  - The purge needs a final ('w1') warning that is at least 24 hours old and at most 7 days old. No admin reached
 *    (empty admins table, provider down) means NO purge. A late start (feature deployed after the date, outage, hold
 *    released) means the final warning is sent first and the purge follows 24 hours later: never without notice.
 *  - `events.retention_hold = 1` (admin switch, audited) stops warnings and the purge until switched off.
 *  - The deletion is ONE D1 batch (atomic). Its first statement inserts the 'purged' row and re-checks every condition in
 *    SQL; every other statement is gated on that row, so a concurrent run, a stale decision or a failed statement can
 *    never delete half of the data or delete twice.
 *  - Everything is set-based SQL (a handful of statements however many registrations exist), because a Worker has a
 *    small query budget per invocation. The check on a normal 5-minute run is ONE cheap query.
 */
export const RETENTION_DAYS = 90;
const DAY = 86_400_000;

/**
 * The automatic purge is DEACTIVATED. With false, `runRetention` only sends reminders and `purgeEvent` is never called
 * from the scheduled job. Tests opt in explicitly (`runRetention(..., { autoPurge: true })`) to keep the deferred code
 * verified; production code never passes that option.
 */
export const AUTO_PURGE_ENABLED = false;
/** After the date has passed, the "overdue" reminder repeats this often until nothing is left to delete. */
export const OVERDUE_REMINDER_EVERY_MS = 7 * DAY;

/** Warning schedule: days before the purge date. Only the most urgent stage that has been reached is ever sent (no catch-up spam). */
export const WARNING_STAGES: { stage: WarningStage; days: number }[] = [
  { stage: "w30", days: 30 },
  { stage: "w7", days: 7 },
  { stage: "w1", days: 1 },
];
/** The final warning must be at least this old before the purge runs ... */
export const MIN_FINAL_WARNING_MS = DAY;
/** ... and at most this old; otherwise it is sent again first (e.g. after a hold was released months later). */
export const MAX_FINAL_WARNING_AGE_MS = 7 * DAY;
/** Safety cap on recipients per warning (the admins table is a handful of volunteers). */
const MAX_RECIPIENTS = 25;
/** At most this many events are handled per run. */
const MAX_EVENTS_PER_RUN = 5;

export interface LogRow {
  stage: string;
  at: string;
  detail: string | null;
}

/** The date after which the event's personal data is deleted: event end + 90 days. null = unusable end date (never purge). */
export function retentionDue(event: Pick<EventRow, "ends_at">): Date | null {
  const end = new Date(event.ends_at);
  if (Number.isNaN(end.getTime())) return null;
  return new Date(end.getTime() + RETENTION_DAYS * DAY);
}

function validWarning(rows: LogRow[], stage: WarningStage, dueIso: string): { at: string } | null {
  const row = rows.find((r) => r.stage === stage);
  if (!row) return null;
  try {
    const d = JSON.parse(row.detail ?? "{}") as { due?: string; sent?: number };
    if (d.due === dueIso && Number(d.sent) >= 1) return { at: row.at };
  } catch {
    /* unreadable detail = not a valid warning */
  }
  return null;
}

export type RetentionDecision =
  | { action: "none"; reason: "hold" | "too_early" }
  | { action: "warn"; stage: WarningStage }
  | { action: "wait"; reason: "warned" | "final_warning_too_recent" }
  | { action: "purge" };

/** Pure decision: what should happen to this event right now? (Unit-tested; `runRetention` only executes it.) */
export function decideRetention(
  now: Date,
  due: Date,
  rows: LogRow[],
  hold: boolean,
  autoPurge: boolean = AUTO_PURGE_ENABLED,
): RetentionDecision {
  if (hold) return { action: "none", reason: "hold" };
  const t = now.getTime();
  const d = due.getTime();
  const dueIso = due.toISOString();
  const final = validWarning(rows, "w1", dueIso);

  if (t >= d) {
    if (autoPurge) {
      if (final) {
        const age = t - new Date(final.at).getTime();
        if (age >= MIN_FINAL_WARNING_MS && age <= MAX_FINAL_WARNING_AGE_MS) return { action: "purge" };
        if (age < MIN_FINAL_WARNING_MS) return { action: "wait", reason: "final_warning_too_recent" };
      }
      return { action: "warn", stage: "w1" };
    }
    // Reminder-only: remind AT the date (the 'w1' row from the day before is older than the date, so it does not count),
    // then once every 7 days. The caller stops when no registration is left.
    if (final) {
      const sentAt = new Date(final.at).getTime();
      if (sentAt >= d && t - sentAt < OVERDUE_REMINDER_EVERY_MS) return { action: "wait", reason: "warned" };
    }
    return { action: "warn", stage: "w1" };
  }
  if (t >= d - 1 * DAY) return final ? { action: "wait", reason: "warned" } : { action: "warn", stage: "w1" };
  if (t >= d - 7 * DAY) return validWarning(rows, "w7", dueIso) ? { action: "wait", reason: "warned" } : { action: "warn", stage: "w7" };
  if (t >= d - 30 * DAY) return validWarning(rows, "w30", dueIso) ? { action: "wait", reason: "warned" } : { action: "warn", stage: "w30" };
  return { action: "none", reason: "too_early" };
}

const REGS = "(SELECT id FROM registrations WHERE event_id = ?1)";

/** What a purge would remove for this event (also shown in /admin/settings and in the warning email). */
export async function retentionCounts(db: D1Database, eventId: number): Promise<RetentionCounts> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM registrations WHERE event_id = ?1) AS registrations,
         (SELECT COUNT(*) FROM participants WHERE registration_id IN ${REGS}) AS participants,
         (SELECT COUNT(*) FROM participants WHERE checked_in_at IS NOT NULL AND registration_id IN ${REGS}) AS checkedIn`,
    )
    .bind(eventId)
    .first<RetentionCounts>();
  return { registrations: row?.registrations ?? 0, participants: row?.participants ?? 0, checkedIn: row?.checkedIn ?? 0 };
}

async function logRows(db: D1Database, eventId: number): Promise<LogRow[]> {
  const { results } = await db
    .prepare("SELECT stage, at, detail FROM retention_log WHERE event_id = ? AND stage != 'purged'")
    .bind(eventId)
    .all<LogRow>();
  return results;
}

async function adminEmails(db: D1Database): Promise<string[]> {
  return (await listAdmins(db)).map((a) => a.email).slice(0, MAX_RECIPIENTS);
}

/**
 * Email every admin about the coming deletion. Recorded as a valid warning only if at least ONE admin was reached
 * (otherwise nothing is recorded and the next run tries again, and the purge stays blocked).
 */
async function sendWarning(
  db: D1Database,
  cfg: EmailConfig,
  event: EventRow,
  due: Date,
  stage: WarningStage,
  now: Date,
  autoPurge: boolean,
): Promise<{ sent: number; failed: number }> {
  const recipients = await adminEmails(db);
  const counts = await retentionCounts(db, event.id);
  const dueIso = due.toISOString();
  const dayKey = now.toISOString().slice(0, 10);
  let sent = 0;
  let failed = 0;
  for (const to of recipients) {
    try {
      const mail = retentionWarningEmail({
        stage,
        mode: autoPurge ? "purge" : "remind",
        overdue: now.getTime() >= due.getTime(),
        eventTitle: event.title,
        dueText: formatDateTime(dueIso),
        counts,
        adminUrl: cfg.adminUrl,
        replyTo: cfg.replyTo,
      });
      await sendDirectEmail(db, cfg, { to, ...mail, attachments: [] }, {
        kind: `retention_${stage}`,
        // Same-day retries of one send are de-duplicated by the provider; a later re-warning is a new send.
        idempotencyKey: `retention:${event.id}:${stage}:${dueIso}:${dayKey}:${to}`,
      });
      sent++;
    } catch (err) {
      failed++;
      console.error(`retention warning ${stage} to an admin failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    }
  }
  if (sent >= 1) {
    const nowIso = now.toISOString();
    const detail = JSON.stringify({ due: dueIso, sent, failed, recipients: recipients.length });
    await db.batch([
      db
        .prepare(
          `INSERT INTO retention_log (event_id, stage, at, detail) VALUES (?, ?, ?, ?)
           ON CONFLICT (event_id, stage) DO UPDATE SET at = excluded.at, detail = excluded.detail`,
        )
        .bind(event.id, stage, nowIso, detail),
      auditStatement(db, "system", "retention.warning", event.slug, { stage, sent, failed, due: dueIso }, nowIso),
    ]);
  }
  return { sent, failed };
}

export interface PurgeSnapshot extends RetentionCounts {
  /** Random token of the run that deleted (internal: the gate of the batch). */
  run?: string;
  byStatus: Record<string, number>;
  byAgeGroup: Record<string, number>;
  members: number;
  due: string;
}

/**
 * Delete the personal data of one event. ONE atomic batch; see the header comment. Returns the snapshot of what was
 * removed, or null when nothing was deleted (a condition no longer holds, or another run already did it).
 */
export async function purgeEvent(db: D1Database, event: EventRow, due: Date, now = new Date()): Promise<PurgeSnapshot | null> {
  const nowIso = now.toISOString();
  const dueIso = due.toISOString();
  const minFinal = new Date(now.getTime() - MIN_FINAL_WARNING_MS).toISOString();
  const maxFinal = new Date(now.getTime() - MAX_FINAL_WARNING_AGE_MS).toISOString();
  const id = event.id;
  // The gate is unique to THIS run (random token stored in the purged row), so a concurrent run that lost the insert can never pass it.
  const run = crypto.randomUUID();
  const gate = `EXISTS (SELECT 1 FROM retention_log WHERE event_id = ${id} AND stage = 'purged' AND json_extract(detail, '$.run') = '${run}')`;
  const regs = `(SELECT id FROM registrations WHERE event_id = ${id})`;
  const parts = `(SELECT id FROM participants WHERE registration_id IN ${regs})`;

  const res = await db.batch([
    // 1. The decision, re-checked in SQL, plus the numbers-only snapshot. Nothing below runs unless this inserts the row.
    db
      .prepare(
        `INSERT INTO retention_log (event_id, stage, at, detail)
         SELECT e.id, 'purged', ?1, json_object(
           'registrations', (SELECT COUNT(*) FROM registrations WHERE event_id = e.id),
           'participants', (SELECT COUNT(*) FROM participants WHERE registration_id IN (SELECT id FROM registrations WHERE event_id = e.id)),
           'checkedIn', (SELECT COUNT(*) FROM participants WHERE checked_in_at IS NOT NULL AND registration_id IN (SELECT id FROM registrations WHERE event_id = e.id)),
           'members', (SELECT COUNT(*) FROM registrations WHERE event_id = e.id AND is_member = 1),
           'byStatus', json((SELECT json_group_object(status, n) FROM (SELECT status, COUNT(*) AS n FROM registrations WHERE event_id = e.id GROUP BY status))),
           'byAgeGroup', json((SELECT json_group_object(age_group, n) FROM (SELECT age_group, COUNT(*) AS n FROM participants WHERE registration_id IN (SELECT id FROM registrations WHERE event_id = e.id) GROUP BY age_group))),
           'due', ?2,
           'run', ?6)
         FROM events e
         WHERE e.id = ?3 AND e.retention_hold = 0
           AND julianday(e.ends_at) + ${RETENTION_DAYS} <= julianday(?1)
           AND NOT EXISTS (SELECT 1 FROM retention_log WHERE event_id = e.id AND stage = 'purged')
           AND EXISTS (SELECT 1 FROM retention_log w
                       WHERE w.event_id = e.id AND w.stage = 'w1' AND w.at <= ?4 AND w.at >= ?5
                         AND json_extract(w.detail, '$.due') = ?2 AND json_extract(w.detail, '$.sent') >= 1)`,
      )
      .bind(nowIso, dueIso, id, minFinal, maxFinal, run),
    // 2. Loose references to the rows about to go.
    db.prepare(`UPDATE scanners SET participant_id = NULL WHERE participant_id IN ${parts} AND ${gate}`),
    db.prepare(`UPDATE checkin_log SET participant_id = NULL, registration_id = NULL WHERE event_id = ${id} AND ${gate}`),
    // 3. Names and emails out of the audit log (the rows themselves, with action and time, stay; so do the retention rows).
    db.prepare(
      `UPDATE audit_log SET
         actor = CASE WHEN actor LIKE '%@%' THEN 'anonim' ELSE actor END,
         target = CASE WHEN target LIKE '%@%' OR target IN ${regs} THEN NULL ELSE target END,
         detail = NULL
       WHERE (at <= '${dueIso}' OR target IN ${regs}) AND action NOT LIKE 'retention.%' AND ${gate}`,
    ),
    // 4. The personal data itself, children before parents.
    db.prepare(`DELETE FROM participants WHERE registration_id IN ${regs} AND ${gate}`),
    db.prepare(`DELETE FROM email_log WHERE registration_id IN ${regs} AND ${gate}`),
    db.prepare(
      `DELETE FROM dev_outbox WHERE (registration_id IN ${regs} OR (registration_id IS NULL AND created_at <= '${dueIso}')) AND ${gate}`,
    ),
    db.prepare(`DELETE FROM registrant_sessions WHERE event_id = ${id} AND ${gate}`),
    db.prepare(`DELETE FROM registrant_login_codes WHERE event_id = ${id} AND ${gate}`),
    db.prepare(`DELETE FROM registrations WHERE event_id = ${id} AND ${gate}`),
    // 5. The record of what happened (numbers only).
    db.prepare(
      `INSERT INTO audit_log (at, actor, action, target, detail)
       SELECT '${nowIso}', 'system', 'retention.purge', e.slug, (SELECT detail FROM retention_log WHERE event_id = e.id AND stage = 'purged')
       FROM events e WHERE e.id = ${id} AND ${gate}`,
    ),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) return null;
  const row = await db
    .prepare("SELECT detail FROM retention_log WHERE event_id = ? AND stage = 'purged'")
    .bind(id)
    .first<{ detail: string }>();
  return row ? (JSON.parse(row.detail) as PurgeSnapshot) : null;
}

export interface RetentionReport {
  /** Events examined this run. */
  checked: number;
  warned: { eventId: number; stage: WarningStage; sent: number; failed: number }[];
  purged: { eventId: number; registrations: number; participants: number }[];
  /** Reasons a due step could not run (no admin reached, ...). */
  blocked: string[];
  /** Events whose reminders stopped because no registration is left to delete (reminder-only mode). */
  nothingLeft: number[];
}

/**
 * Called from the 5-minute job. Normally ONE query returning nothing. Never throws for one bad event: the caller also
 * wraps it, so a retention problem can never stop registrations from being processed.
 */
export async function runRetention(
  db: D1Database,
  cfg: EmailConfig,
  now = new Date(),
  opts: { autoPurge?: boolean } = {},
): Promise<RetentionReport> {
  const autoPurge = opts.autoPurge ?? AUTO_PURGE_ENABLED;
  const report: RetentionReport = { checked: 0, warned: [], purged: [], blocked: [], nothingLeft: [] };
  const { results: events } = await db
    .prepare(
      `SELECT * FROM events e
       WHERE NOT EXISTS (SELECT 1 FROM retention_log l WHERE l.event_id = e.id AND l.stage = 'purged')
         AND julianday(e.ends_at) + ? <= julianday(?)
       ORDER BY e.id LIMIT ?`,
    )
    .bind(RETENTION_DAYS - WARNING_STAGES[0].days, now.toISOString(), MAX_EVENTS_PER_RUN)
    .all<EventRow>();

  for (const event of events) {
    report.checked++;
    const due = retentionDue(event);
    if (!due) {
      report.blocked.push(`event ${event.id}: tanggal selesai tidak valid`);
      continue;
    }
    const decision = decideRetention(now, due, await logRows(db, event.id), event.retention_hold === 1, autoPurge);
    if (decision.action === "warn") {
      // Reminder-only: once the admins have deleted everything there is nothing left to remind about.
      if (!autoPurge && (await retentionCounts(db, event.id)).registrations === 0) {
        report.nothingLeft.push(event.id);
        continue;
      }
      const r = await sendWarning(db, cfg, event, due, decision.stage, now, autoPurge);
      if (r.sent >= 1) report.warned.push({ eventId: event.id, stage: decision.stage, ...r });
      else report.blocked.push(`event ${event.id}: peringatan ${decision.stage} tidak sampai ke admin mana pun`);
    } else if (decision.action === "purge" && autoPurge) {
      const snap = await purgeEvent(db, event, due, now);
      if (snap) {
        report.purged.push({ eventId: event.id, registrations: snap.registrations, participants: snap.participants });
        await notifyPurged(db, cfg, event, snap, now);
      }
    }
  }
  return report;
}

/** Best effort: the deletion already happened and is recorded; a failed notice changes nothing. */
async function notifyPurged(db: D1Database, cfg: EmailConfig, event: EventRow, snap: PurgeSnapshot, now: Date) {
  try {
    const mail = retentionDoneEmail({
      eventTitle: event.title,
      purgedAtText: formatDateTime(now.toISOString()),
      counts: { registrations: snap.registrations, participants: snap.participants, checkedIn: snap.checkedIn },
      adminUrl: cfg.adminUrl,
      replyTo: cfg.replyTo,
    });
    for (const to of await adminEmails(db)) {
      await sendDirectEmail(db, cfg, { to, ...mail, attachments: [] }, {
        kind: "retention_done",
        idempotencyKey: `retention:${event.id}:done:${to}`,
      }).catch((err) => console.error(`retention done notice failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`));
    }
  } catch (err) {
    console.error(`retention done notice failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }
}

export type RetentionResult = { ok: boolean; message: string };

/** Admin: pause or resume the automatic deletion (e.g. an open dispute or incident). Audited. Not possible after the purge. */
export async function setRetentionHold(
  db: D1Database,
  actor: string,
  eventId: number,
  hold: boolean,
  now = new Date(),
): Promise<RetentionResult> {
  const event = await getEventById(db, eventId);
  if (!event) return { ok: false, message: "Acara tidak ditemukan." };
  const purged = await db
    .prepare("SELECT 1 AS ok FROM retention_log WHERE event_id = ? AND stage = 'purged'")
    .bind(eventId)
    .first();
  if (purged) return { ok: false, message: "Data acara ini sudah dihapus; tidak ada lagi yang bisa dijeda." };
  const text = hold
    ? "Pengingat penghapusan dijeda. Tidak ada email pengingat sampai Anda mematikan jeda ini."
    : "Jeda dimatikan. Pengingat penghapusan dilanjutkan pada pengecekan otomatis berikutnya.";
  const value = hold ? 1 : 0;
  if (event.retention_hold === value) return { ok: true, message: text };
  await db.batch([
    db.prepare("UPDATE events SET retention_hold = ? WHERE id = ?").bind(value, eventId),
    auditStatement(db, actor, "event.retention_hold", event.slug, { from: event.retention_hold, to: value }, now.toISOString()),
  ]);
  return { ok: true, message: text };
}

export interface RetentionStatus {
  /** true only if the deferred automatic purge were switched on; false = reminders only. */
  autoPurge: boolean;
  /** The purge date has passed (reminder-only mode: the data should be deleted by hand now). */
  overdue: boolean;
  dueIso: string | null;
  hold: boolean;
  purged: { at: string; snapshot: PurgeSnapshot } | null;
  warnings: { stage: WarningStage; at: string; sent: number }[];
  decision: RetentionDecision | null;
  counts: RetentionCounts;
}

/** Everything the settings panel shows. */
export async function retentionStatus(db: D1Database, event: EventRow, now = new Date()): Promise<RetentionStatus> {
  const due = retentionDue(event);
  const { results } = await db
    .prepare("SELECT stage, at, detail FROM retention_log WHERE event_id = ?")
    .bind(event.id)
    .all<LogRow>();
  const purgedRow = results.find((r) => r.stage === "purged");
  const rows = results.filter((r) => r.stage !== "purged");
  const dueIso = due?.toISOString() ?? null;
  const warnings = WARNING_STAGES.flatMap(({ stage }) => {
    const w = dueIso ? validWarning(rows, stage, dueIso) : null;
    const row = rows.find((r) => r.stage === stage);
    return w && row ? [{ stage, at: w.at, sent: Number((JSON.parse(row.detail ?? "{}") as { sent?: number }).sent ?? 0) }] : [];
  });
  return {
    autoPurge: AUTO_PURGE_ENABLED,
    overdue: !!due && now.getTime() >= due.getTime(),
    dueIso,
    hold: event.retention_hold === 1,
    purged: purgedRow ? { at: purgedRow.at, snapshot: JSON.parse(purgedRow.detail ?? "{}") as PurgeSnapshot } : null,
    warnings,
    decision: purgedRow || !due ? null : decideRetention(now, due, rows, event.retention_hold === 1),
    counts: await retentionCounts(db, event.id),
  };
}
