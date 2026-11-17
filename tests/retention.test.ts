import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addAdmin } from "../app/lib/admins.server";
import { getEventById, type EventRow } from "../app/lib/db.server";
import { retentionDoneEmail, retentionWarningEmail } from "../app/lib/email/retention";
import { LEGAL_DOCS } from "../app/lib/legal-content";
import { runDeadlineJob } from "../app/lib/jobs.server";
import { deleteRegistration } from "../app/lib/payments.server";
import { registerOnline } from "../app/lib/registration.server";
import {
  MAX_FINAL_WARNING_AGE_MS,
  MIN_FINAL_WARNING_MS,
  RETENTION_DAYS,
  decideRetention,
  purgeEvent,
  retentionCounts,
  retentionDue,
  retentionStatus,
  runRetention,
  setRetentionHold,
  type LogRow,
} from "../app/lib/retention.server";
import { emailCfg, input, resetDb, startDb, T0 } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;
let event: EventRow;

const START = "2026-12-05T08:00:00.000Z";
const END = "2026-12-05T13:30:00.000Z";
const DAY = 86_400_000;
const DUE = new Date(new Date(END).getTime() + RETENTION_DAYS * DAY); // 2027-03-05T13:30:00.000Z
const cfg = { ...emailCfg, adminUrl: "https://admin.example" };
/** A moment relative to the purge date (negative = before). */
const rel = (days: number, extraMs = 0) => new Date(DUE.getTime() + days * DAY + extraMs);

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
  // resetDb leaves the events table alone: drop the extra event a test may have added (its rows are gone after resetDb).
  await db.prepare("DELETE FROM events WHERE slug != 'kajian-aisah-dahlan-2026'").run();
  await db
    .prepare("UPDATE events SET status = 'open', registration_closes_at = ?, starts_at = ?, ends_at = ?, price_non_member_cents = 1500")
    .bind("2026-11-27T22:59:00.000Z", START, END)
    .run();
  event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
  await addAdmin(db, "system", "admin1@x.nl", "Admin Satu", T0);
  await addAdmin(db, "system", "admin2@x.nl", "Admin Dua", T0);
});

const count = async (table: string, where = "1=1") =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())!.n;
const outbox = async () =>
  (await db.prepare("SELECT to_address, kind, subject, html FROM dev_outbox ORDER BY id").all<{ to_address: string; kind: string; subject: string; html: string }>()).results;
const logStages = async () =>
  (await db.prepare("SELECT stage FROM retention_log ORDER BY stage").all<{ stage: string }>()).results.map((r) => r.stage);

// Recognisable personal data: none of these strings may survive a purge anywhere in the database.
const SECRETS = {
  names: ["Budi Rahasia Santoso", "Siti Rahasia Anak", "Hapus Aku Rahasia"],
  emails: ["budi.rahasia@example.com", "siti.rahasia@example.org", "hapus.aku@example.net"],
  phone: "+31698765432",
  note: "catatan-rahasia-panitia",
};

/** A busy event: members, non-members, a family, a checked-in guest, scanners, sessions, audit rows with names. */
async function seed(ev: EventRow = event) {
  const opts = { ignoreWindow: true, now: new Date("2026-11-20T10:00:00.000Z") };
  const a = await registerOnline(
    db,
    ev,
    input({
      registrantName: SECRETS.names[0],
      email: SECRETS.emails[0],
      whatsapp: SECRETS.phone,
      membership: "Tidak",
      participants: [
        { name: SECRETS.names[0], gender: "laki-laki", ageGroup: "dewasa" },
        { name: SECRETS.names[1], gender: "perempuan", ageGroup: "anak" },
      ],
    } as never),
    opts,
  );
  const b = await registerOnline(db, ev, input({ registrantName: "Anggota Satu", email: SECRETS.emails[1], membership: "Ya" }), opts);
  const c = await registerOnline(db, ev, input({ registrantName: SECRETS.names[2], email: SECRETS.emails[2], membership: "Tidak" }), opts);
  if (a.kind !== "pending_payment" && a.kind !== "accepted") throw new Error(`seed a: ${a.kind}`);
  if (b.kind !== "pending_membership") throw new Error(`seed b: ${b.kind}`);
  if (c.kind !== "pending_payment" && c.kind !== "accepted") throw new Error(`seed c: ${c.kind}`);

  // Notes and a checked-in guest.
  await db.prepare("UPDATE registrations SET notes = ? WHERE id = ?").bind(SECRETS.note, a.registrationId).run();
  const p = await db.prepare("SELECT id FROM participants WHERE registration_id = ? ORDER BY position LIMIT 1").bind(a.registrationId).first<{ id: string }>();
  await db.prepare("UPDATE participants SET checked_in_at = ?, checked_in_by = 'scanner:1' WHERE id = ?").bind("2026-12-05T08:30:00.000Z", p!.id).run();
  await db
    .prepare("INSERT INTO checkin_log (at, event_id, participant_id, registration_id, scanner_id, scanner_label, action) VALUES (?, ?, ?, ?, 1, 'scanner-1', 'admit')")
    .bind("2026-12-05T08:30:00.000Z", ev.id, p!.id, a.registrationId)
    .run();
  await db
    .prepare("INSERT INTO scanners (email, name, role, added_by, added_at, participant_id) VALUES ('scan@x.nl', 'Petugas', 'scanner', 'system', ?, ?)")
    .bind(T0.toISOString(), p!.id)
    .run();
  // Self-service sessions and codes (hold the email).
  await db
    .prepare("INSERT INTO registrant_sessions (token_hash, event_id, email, created_at, expires_at) VALUES ('h1', ?, ?, ?, ?)")
    .bind(ev.id, SECRETS.emails[0], T0.toISOString(), T0.toISOString())
    .run();
  await db
    .prepare("INSERT INTO registrant_login_codes (event_id, email, code_hash, salt, created_at, expires_at) VALUES (?, ?, 'x', 'y', ?, ?)")
    .bind(ev.id, SECRETS.emails[0], T0.toISOString(), T0.toISOString())
    .run();
  // An audit row whose detail holds a name and an actor that is an email (deleteRegistration writes both).
  const d = await registerOnline(db, ev, input({ registrantName: "Dihapus Admin", email: "dihapus@example.com", membership: "Tidak" }), opts);
  if (d.kind === "closed" || d.kind === "duplicate_email" || d.kind === "rejected_quota") throw new Error("seed d");
  await deleteRegistration(db, d.registrationId, "admin1@x.nl", new Date("2026-11-22T10:00:00.000Z"));
  await db
    .prepare("INSERT INTO dev_outbox (created_at, registration_id, kind, to_address, subject, html) VALUES (?, ?, 'confirmation', ?, 's', ?)")
    .bind(T0.toISOString(), a.registrationId, SECRETS.emails[0], `<p>${SECRETS.names[0]}</p>`)
    .run();
  return { a: a.registrationId, b: b.registrationId, c: c.registrationId, participantId: p!.id };
}

/** Everything in the database as one string, except the retention emails' own table of contents. */
async function dumpAll() {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()).results;
  let out = "";
  for (const { name } of tables) out += JSON.stringify((await db.prepare(`SELECT * FROM ${name}`).all()).results);
  return out;
}

/** Drive the whole lifecycle the way the cron would: warnings at 30/7/1 days, purge at the date. */
async function walkToPurge() {
  await runRetention(db, cfg, rel(-30, 1000));
  await runRetention(db, cfg, rel(-7, 1000));
  await runRetention(db, cfg, rel(-1, 0));
  return runRetention(db, cfg, rel(0, 0));
}

describe("retentionDue and decideRetention (pure rules)", () => {
  it("is the event end plus 90 days; an unusable end date never purges", () => {
    expect(RETENTION_DAYS).toBe(90);
    expect(retentionDue({ ends_at: END })!.toISOString()).toBe("2027-03-05T13:30:00.000Z");
    expect(retentionDue({ ends_at: "2026-12-05T13:30:00Z" })!.toISOString()).toBe("2027-03-05T13:30:00.000Z");
    expect(retentionDue({ ends_at: "not a date" })).toBeNull();
    expect(retentionDue({ ends_at: "" })).toBeNull();
  });

  const dueIso = DUE.toISOString();
  const warn = (stage: string, at: Date, over: Record<string, unknown> = {}): LogRow => ({
    stage,
    at: at.toISOString(),
    detail: JSON.stringify({ due: dueIso, sent: 2, failed: 0, recipients: 2, ...over }),
  });

  it("does nothing before the first warning window and while on hold", () => {
    expect(decideRetention(rel(-31), DUE, [], false)).toEqual({ action: "none", reason: "too_early" });
    expect(decideRetention(rel(-365), DUE, [], false)).toEqual({ action: "none", reason: "too_early" });
    expect(decideRetention(rel(10), DUE, [warn("w1", rel(-1))], true)).toEqual({ action: "none", reason: "hold" });
    expect(decideRetention(rel(-3), DUE, [], true)).toEqual({ action: "none", reason: "hold" });
  });

  it("warns once per stage as each window is reached", () => {
    expect(decideRetention(rel(-30), DUE, [], false)).toEqual({ action: "warn", stage: "w30" });
    expect(decideRetention(rel(-29), DUE, [warn("w30", rel(-30))], false)).toEqual({ action: "wait", reason: "warned" });
    expect(decideRetention(rel(-7), DUE, [warn("w30", rel(-30))], false)).toEqual({ action: "warn", stage: "w7" });
    expect(decideRetention(rel(-6), DUE, [warn("w30", rel(-30)), warn("w7", rel(-7))], false)).toEqual({ action: "wait", reason: "warned" });
    expect(decideRetention(rel(-1), DUE, [warn("w30", rel(-30)), warn("w7", rel(-7))], false)).toEqual({ action: "warn", stage: "w1" });
    expect(decideRetention(rel(-0.5), DUE, [warn("w1", rel(-1))], false)).toEqual({ action: "wait", reason: "warned" });
  });

  it("a late start sends only the most urgent warning, never a pile of three", () => {
    expect(decideRetention(rel(-20), DUE, [], false)).toEqual({ action: "warn", stage: "w30" });
    expect(decideRetention(rel(-3), DUE, [], false)).toEqual({ action: "warn", stage: "w7" });
    expect(decideRetention(rel(0), DUE, [], false)).toEqual({ action: "warn", stage: "w1" });
    expect(decideRetention(rel(40), DUE, [], false)).toEqual({ action: "warn", stage: "w1" });
  });

  it("purges only with a final warning that is at least 24 h and at most 7 days old", () => {
    const at = (ms: number) => new Date(DUE.getTime() + ms);
    // exactly 24 h old at the due moment: allowed
    expect(decideRetention(at(0), DUE, [warn("w1", at(-MIN_FINAL_WARNING_MS))], false)).toEqual({ action: "purge" });
    // 1 ms short of 24 h: wait
    expect(decideRetention(at(0), DUE, [warn("w1", at(-MIN_FINAL_WARNING_MS + 1))], false)).toEqual({ action: "wait", reason: "final_warning_too_recent" });
    // sent just now after the date: wait
    expect(decideRetention(at(5 * 3600_000), DUE, [warn("w1", at(5 * 3600_000 - 60_000))], false)).toEqual({ action: "wait", reason: "final_warning_too_recent" });
    // 7 days old: still allowed; 1 ms older: warn again first
    expect(decideRetention(at(6 * DAY), DUE, [warn("w1", at(6 * DAY - MAX_FINAL_WARNING_AGE_MS))], false)).toEqual({ action: "purge" });
    expect(decideRetention(at(6 * DAY), DUE, [warn("w1", at(6 * DAY - MAX_FINAL_WARNING_AGE_MS - 1))], false)).toEqual({ action: "warn", stage: "w1" });
  });

  it("ignores warnings that announced another date, reached nobody, or are unreadable", () => {
    const now = rel(0);
    expect(decideRetention(now, DUE, [warn("w1", rel(-1), { due: "2027-03-01T00:00:00.000Z" })], false)).toEqual({ action: "warn", stage: "w1" });
    expect(decideRetention(now, DUE, [warn("w1", rel(-1), { sent: 0 })], false)).toEqual({ action: "warn", stage: "w1" });
    expect(decideRetention(now, DUE, [{ stage: "w1", at: rel(-1).toISOString(), detail: "{broken" }], false)).toEqual({ action: "warn", stage: "w1" });
    expect(decideRetention(now, DUE, [{ stage: "w1", at: rel(-1).toISOString(), detail: null }], false)).toEqual({ action: "warn", stage: "w1" });
    expect(decideRetention(now, DUE, [warn("w30", rel(-31)), warn("w7", rel(-8))], false)).toEqual({ action: "warn", stage: "w1" });
  });
});

describe("a normal day is free and safe", () => {
  it("does nothing, sends nothing and touches nothing months before the date", async () => {
    await seed();
    const before = await dumpAll();
    const report = await runRetention(db, cfg, new Date("2026-12-20T10:00:00.000Z"));
    expect(report).toEqual({ checked: 0, warned: [], purged: [], blocked: [] });
    expect(await dumpAll()).toBe(before);
    expect(await count("retention_log")).toBe(0);
  });

  it("the 5-minute job reports nothing about retention until something happens", async () => {
    const report = await runDeadlineJob(db, cfg, new Date("2026-12-20T10:00:00.000Z"));
    expect(report.retention).toBeUndefined();
  });
});

describe("warnings to admins", () => {
  it("emails every admin at 30 days, records it, and does not repeat it", async () => {
    const ids = await seed();
    const t = rel(-30, 60_000);
    const report = await runRetention(db, cfg, t);
    expect(report.warned).toEqual([{ eventId: event.id, stage: "w30", sent: 2, failed: 0 }]);
    const mails = (await outbox()).filter((m) => m.kind === "retention_w30");
    expect(mails.map((m) => m.to_address).sort()).toEqual(["admin1@x.nl", "admin2@x.nl"]);
    expect(await logStages()).toEqual(["w30"]);
    const row = await db.prepare("SELECT detail FROM retention_log WHERE stage = 'w30'").first<{ detail: string }>();
    expect(JSON.parse(row!.detail)).toMatchObject({ due: DUE.toISOString(), sent: 2, failed: 0, recipients: 2 });
    expect(await count("audit_log", "action = 'retention.warning'")).toBe(1);

    // the same and the next runs stay quiet; nothing was deleted
    for (const later of [rel(-30, 5 * 60_000), rel(-20), rel(-10)]) {
      const again = await runRetention(db, cfg, later);
      expect(again.warned).toEqual([]);
    }
    expect((await outbox()).filter((m) => m.kind === "retention_w30")).toHaveLength(2);
    expect(await count("registrations", `id = '${ids.a}'`)).toBe(1);
  });

  it("the email says what is deleted, when, and links to the export and the hold switch, with no personal data", async () => {
    await seed();
    await runRetention(db, cfg, rel(-7, 60_000));
    const mail = (await outbox()).find((m) => m.kind === "retention_w7")!;
    expect(mail.subject).toContain("7 hari");
    expect(mail.subject).toContain(event.title);
    expect(mail.html).toContain("05-03-2027 14:30");
    expect(mail.html).toMatch(/3 pendaftaran dan 4 peserta/);
    expect(mail.html).toContain("https://admin.example/admin/export");
    expect(mail.html).toContain("https://admin.example/admin/settings#retensi");
    for (const secret of [...SECRETS.names, ...SECRETS.emails, SECRETS.phone, SECRETS.note]) expect(mail.html).not.toContain(secret);
  });

  it("without ADMIN_APP_URL the email still works (plain paths instead of buttons)", () => {
    const mail = retentionWarningEmail({
      stage: "w1",
      eventTitle: "Kajian",
      dueText: "05-03-2027 14:30",
      counts: { registrations: 1, participants: 2, checkedIn: 0 },
      replyTo: "r@x.nl",
    });
    expect(mail.html).not.toContain("href=\"undefined");
    expect(mail.text).toContain("/admin/export");
    expect(mail.subject).toContain("Peringatan terakhir");
    const done = retentionDoneEmail({ eventTitle: "Kajian", purgedAtText: "x", counts: { registrations: 1, participants: 2, checkedIn: 1 }, replyTo: "r@x.nl" });
    expect(done.html).toContain("1 pendaftaran, 2 peserta");
  });

  it("when nobody can be reached nothing is recorded, the warning is retried, and the purge stays blocked", async () => {
    await seed();
    await db.prepare("DELETE FROM admins").run();
    const r1 = await runRetention(db, cfg, rel(-1, 0));
    expect(r1.warned).toEqual([]);
    expect(r1.blocked[0]).toContain("tidak sampai");
    expect(await count("retention_log")).toBe(0);

    // days pass with no admin: still no purge, however late
    for (const t of [rel(0), rel(3), rel(30)]) {
      const r = await runRetention(db, cfg, t);
      expect(r.purged).toEqual([]);
    }
    expect(await count("registrations")).toBe(4 - 1); // seeded 4, one deleted by the admin delete
    expect(await count("participants")).toBeGreaterThan(0);

    // an admin is added again: the final warning goes out first, the purge 24 h later
    await addAdmin(db, "system", "admin3@x.nl", "Admin Tiga", rel(31));
    expect((await runRetention(db, cfg, rel(31))).warned).toHaveLength(1);
    expect((await runRetention(db, cfg, rel(31, 3600_000))).purged).toEqual([]);
    expect((await runRetention(db, cfg, rel(32, 1000))).purged).toHaveLength(1);
  });

  it("when the email provider is down the warning is not recorded as sent and the purge stays blocked", async () => {
    await seed();
    const down = { ...cfg, mode: "resend" as const, resendApiKey: undefined }; // sending throws for everybody
    const r = await runRetention(db, down, rel(-1, 0));
    expect(r.warned).toEqual([]);
    expect(r.blocked).toHaveLength(1);
    expect(await count("retention_log")).toBe(0);
    for (const t of [rel(0), rel(2)]) expect((await runRetention(db, down, t)).purged).toEqual([]);
    expect(await count("registrations")).toBe(3);
    // the provider is back: warning first, purge 24 h later
    expect((await runRetention(db, cfg, rel(2, 5000))).warned).toHaveLength(1);
    expect((await runRetention(db, cfg, rel(3, 6000))).purged).toHaveLength(1);
  });
});

describe("the purge", () => {
  it("runs the full lifecycle: 3 warnings, then one atomic deletion with a numbers-only snapshot", async () => {
    const ids = await seed();
    const report = await walkToPurge();
    expect(report.purged).toEqual([{ eventId: event.id, registrations: 3, participants: 4 }]);
    expect(await logStages()).toEqual(["purged", "w1", "w30", "w7"]);

    // the personal data is gone
    expect(await count("registrations")).toBe(0);
    expect(await count("participants")).toBe(0);
    expect(await count("email_log")).toBe(0);
    expect(await count("registrant_sessions")).toBe(0);
    expect(await count("registrant_login_codes")).toBe(0);
    expect(await count("dev_outbox", "registration_id IS NOT NULL")).toBe(0);

    // loose references are cleared
    expect(await count("scanners")).toBe(1); // the scanner (volunteer) stays, only the link to the participant goes
    expect((await db.prepare("SELECT participant_id FROM scanners").first<{ participant_id: string | null }>())!.participant_id).toBeNull();
    const cl = await db.prepare("SELECT participant_id, registration_id, action FROM checkin_log").first<{ participant_id: string | null; registration_id: string | null; action: string }>();
    expect(cl).toEqual({ participant_id: null, registration_id: null, action: "admit" });

    // the snapshot has numbers and labels only
    const snap = JSON.parse((await db.prepare("SELECT detail FROM retention_log WHERE stage = 'purged'").first<{ detail: string }>())!.detail);
    expect(snap).toMatchObject({ registrations: 3, participants: 4, checkedIn: 1, members: 1, due: DUE.toISOString() });
    expect(snap.byStatus).toEqual(expect.objectContaining({ pending_membership: 1 }));
    expect(snap.byAgeGroup).toEqual(expect.objectContaining({ dewasa: expect.any(Number) }));

    // the audit log lost names and emails but kept the actions
    expect(await count("audit_log", "action = 'registration.delete'")).toBe(1);
    const del = await db.prepare("SELECT actor, target, detail FROM audit_log WHERE action = 'registration.delete'").first<{ actor: string; target: string | null; detail: string | null }>();
    expect(del).toMatchObject({ actor: "anonim", detail: null }); // the target is an opaque id of a row that no longer exists
    expect(await count("audit_log", "action = 'retention.purge'")).toBe(1);
    expect(await count("audit_log", "action = 'retention.warning'")).toBe(3);
    const purgeAudit = await db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'retention.purge'").first<{ actor: string; detail: string }>();
    expect(purgeAudit!.actor).toBe("system");
    expect(JSON.parse(purgeAudit!.detail)).toMatchObject({ registrations: 3, participants: 4 });

    // admins, scanners, the event and the settings are untouched
    expect(await count("admins")).toBe(2);
    expect(await count("events")).toBe(1);
    expect((await getEventById(db, event.id))!.title).toBe(event.title);
    expect(ids.a).toBeTruthy();
  });

  it("leaves no trace of any person anywhere in the database (every table searched)", async () => {
    await seed();
    const before = await dumpAll();
    for (const secret of [...SECRETS.names, ...SECRETS.emails, SECRETS.phone, SECRETS.note, "Dihapus Admin"]) {
      expect(before, `seed should contain ${secret}`).toContain(secret);
    }
    await walkToPurge();
    const after = await dumpAll();
    for (const secret of [...SECRETS.names, ...SECRETS.emails, SECRETS.phone, SECRETS.note, "Dihapus Admin", "Anggota Satu"]) {
      expect(after, `${secret} must be gone`).not.toContain(secret);
    }
  });

  it("sends the admins a completion notice with numbers only", async () => {
    await seed();
    await walkToPurge();
    const done = (await outbox()).filter((m) => m.kind === "retention_done");
    expect(done.map((m) => m.to_address).sort()).toEqual(["admin1@x.nl", "admin2@x.nl"]);
    expect(done[0].html).toContain("3 pendaftaran, 4 peserta (1 di antaranya pernah check-in)");
    for (const secret of [...SECRETS.names, ...SECRETS.emails]) expect(done[0].html).not.toContain(secret);
  });

  it("is idempotent: a second purge and later runs delete and send nothing more", async () => {
    await seed();
    await walkToPurge();
    const mails = (await outbox()).length;
    expect(await purgeEvent(db, event, DUE, rel(0, 1000))).toBeNull();
    const again = await runRetention(db, cfg, rel(5));
    expect(again).toEqual({ checked: 0, warned: [], purged: [], blocked: [] });
    expect((await outbox()).length).toBe(mails);
    expect(await count("retention_log", "stage = 'purged'")).toBe(1);
  });

  it("leaves another event completely alone", async () => {
    await seed();
    await db
      .prepare(
        `INSERT INTO events (slug, title, starts_at, ends_at, registration_opens_at, quota_member, quota_non_member, price_non_member_cents, payment_prefix, status)
         VALUES ('event-lain', 'Acara Lain', '2027-06-05T08:00:00.000Z', '2027-06-05T13:30:00.000Z', '2027-01-01T00:00:00.000Z', 100, 100, 0, 'LAIN', 'open')`,
      )
      .run();
    const other = (await db.prepare("SELECT * FROM events WHERE slug = 'event-lain'").first<EventRow>())!;
    const r = await registerOnline(db, other, input({ registrantName: "Peserta Acara Lain", email: "lain@example.com", membership: "Tidak" }), { ignoreWindow: true, now: new Date("2027-02-01T10:00:00.000Z") });
    expect(r.kind).not.toBe("closed");
    await db.prepare("INSERT INTO registrant_sessions (token_hash, event_id, email, created_at, expires_at) VALUES ('h2', ?, 'lain@example.com', ?, ?)").bind(other.id, T0.toISOString(), T0.toISOString()).run();

    await walkToPurge();
    expect(await count("registrations", `event_id = ${event.id}`)).toBe(0);
    expect(await count("registrations", `event_id = ${other.id}`)).toBe(1);
    expect(await count("participants")).toBe(1);
    expect(await count("registrant_sessions")).toBe(1);
    expect(await count("retention_log", `event_id = ${other.id}`)).toBe(0);
  });

  it("deletes a large event completely in one pass (set-based SQL, not one query per person)", async () => {
    await db
      .prepare(
        `INSERT INTO registrations (id, event_id, created_at, registrant_name, is_member, email, whatsapp, people, source, status, payment_status, amount_cents, seats, notes)
         WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600)
         SELECT 'bulk-' || i, ?, '2026-11-20T10:00:00.000Z', 'Nama Massal ' || i, i % 2, 'massal' || i || '@example.com', '+31600000000', 2, 'online', 'accepted', 'free', 0, 2, 'rahasia-massal'
         FROM n`,
      )
      .bind(event.id)
      .run();
    await db
      .prepare(
        `INSERT INTO participants (id, registration_id, position, full_name, gender, status, qr_token, age_group)
         WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600)
         SELECT 'bp-' || i || '-' || k, 'bulk-' || i, k, 'Peserta Massal ' || i || '-' || k, 'laki-laki', 'accepted', 'QR' || i || 'X' || k, 'dewasa'
         FROM n, (SELECT 1 AS k UNION ALL SELECT 2)`,
      )
      .run();
    await db
      .prepare("INSERT INTO email_log (registration_id, kind, status, attempts, updated_at) SELECT id, 'confirmation', 'sent', 1, '2026-11-20T10:00:00.000Z' FROM registrations")
      .run();
    expect(await retentionCounts(db, event.id)).toEqual({ registrations: 600, participants: 1200, checkedIn: 0 });

    const started = Date.now();
    await runRetention(db, cfg, rel(-30, 1000));
    await runRetention(db, cfg, rel(-7, 1000));
    await runRetention(db, cfg, rel(-1, 0));
    const report = await runRetention(db, cfg, rel(0, 0));
    expect(report.purged).toEqual([{ eventId: event.id, registrations: 600, participants: 1200 }]);
    expect(await count("registrations")).toBe(0);
    expect(await count("participants")).toBe(0);
    expect(await count("email_log")).toBe(0);
    const dump = await dumpAll();
    expect(dump).not.toContain("Nama Massal");
    expect(dump).not.toContain("massal1@example.com");
    expect(dump).not.toContain("rahasia-massal");
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  it("two overlapping cron runs delete exactly once", async () => {
    await seed();
    await runRetention(db, cfg, rel(-30, 1000));
    await runRetention(db, cfg, rel(-7, 1000));
    await runRetention(db, cfg, rel(-1, 0));
    const [r1, r2] = await Promise.all([runRetention(db, cfg, rel(0, 0)), runRetention(db, cfg, rel(0, 0))]);
    expect(r1.purged.length + r2.purged.length).toBe(1);
    expect(await count("retention_log", "stage = 'purged'")).toBe(1);
    expect(await count("registrations")).toBe(0);
    expect(await count("audit_log", "action = 'retention.purge'")).toBe(1);
  });

  it("is atomic: if any statement fails nothing is deleted and nothing is recorded as purged", async () => {
    await seed();
    await runRetention(db, cfg, rel(-30, 1000));
    await runRetention(db, cfg, rel(-7, 1000));
    await runRetention(db, cfg, rel(-1, 0));
    const before = await dumpAll();
    await db.prepare("ALTER TABLE registrant_login_codes RENAME TO registrant_login_codes_x").run();
    try {
      await expect(runRetention(db, cfg, rel(0, 0))).rejects.toThrow();
    } finally {
      await db.prepare("ALTER TABLE registrant_login_codes_x RENAME TO registrant_login_codes").run();
    }
    expect(await count("retention_log", "stage = 'purged'")).toBe(0);
    expect(await dumpAll()).toBe(before);
    // and once the fault is gone the purge succeeds
    expect((await runRetention(db, cfg, rel(0, 60_000))).purged).toHaveLength(1);
  });

  it("a failing retention run never breaks the 5-minute job (registrations still expire, emails still go)", async () => {
    await seed();
    await db.prepare("ALTER TABLE retention_log RENAME TO retention_log_x").run();
    try {
      // the regular work (expiring unpaid registrations) must still happen and the job must not throw
      const report = await runDeadlineJob(db, cfg, new Date("2026-12-20T10:00:00.000Z"));
      expect(report.expired).toBeGreaterThan(0);
      const late = await runDeadlineJob(db, cfg, rel(0, 1000));
      expect(late.expired).toBe(0);
    } finally {
      await db.prepare("ALTER TABLE retention_log_x RENAME TO retention_log").run();
    }
    expect(await count("registrations")).toBeGreaterThan(0);
  });
});

describe("the SQL re-checks every condition (a wrong caller cannot delete)", () => {
  async function warned(due = DUE, at = rel(-1, 0), over: Record<string, unknown> = {}) {
    await db
      .prepare("INSERT INTO retention_log (event_id, stage, at, detail) VALUES (?, 'w1', ?, ?)")
      .bind(event.id, at.toISOString(), JSON.stringify({ due: due.toISOString(), sent: 2, failed: 0, recipients: 2, ...over }))
      .run();
  }
  const intact = async () => (await count("registrations")) > 0 && (await count("participants")) > 0 && (await count("retention_log", "stage = 'purged'")) === 0;

  it("no final warning: nothing happens", async () => {
    await seed();
    expect(await purgeEvent(db, event, DUE, rel(0, 0))).toBeNull();
    expect(await intact()).toBe(true);
  });

  it("before the date, even with a valid warning: nothing happens", async () => {
    await seed();
    await warned(DUE, rel(-3, 0));
    expect(await purgeEvent(db, event, DUE, rel(-1, 0))).toBeNull();
    expect(await purgeEvent(db, event, DUE, new Date(DUE.getTime() - 1))).toBeNull();
    expect(await intact()).toBe(true);
  });

  it("warning younger than 24 h, older than 7 days, for another date, or reaching nobody: nothing happens", async () => {
    await seed();
    await warned(DUE, new Date(DUE.getTime() - MIN_FINAL_WARNING_MS + 1000));
    expect(await purgeEvent(db, event, DUE, rel(0, 0))).toBeNull();
    await db.prepare("DELETE FROM retention_log").run();
    await warned(DUE, new Date(DUE.getTime() + 3 * DAY - MAX_FINAL_WARNING_AGE_MS - 1000));
    expect(await purgeEvent(db, event, DUE, rel(3, 0))).toBeNull();
    await db.prepare("DELETE FROM retention_log").run();
    await warned(new Date(DUE.getTime() - DAY));
    expect(await purgeEvent(db, event, DUE, rel(0, 1000))).toBeNull();
    await db.prepare("DELETE FROM retention_log").run();
    await warned(DUE, rel(-1, 0), { sent: 0 });
    expect(await purgeEvent(db, event, DUE, rel(0, 1000))).toBeNull();
    expect(await intact()).toBe(true);
  });

  it("on hold: nothing happens, even with a perfect warning", async () => {
    await seed();
    await warned();
    await db.prepare("UPDATE events SET retention_hold = 1").run();
    expect(await purgeEvent(db, event, DUE, rel(0, 0))).toBeNull();
    expect(await intact()).toBe(true);
  });

  it("an event whose end moved later is not purged on the old date, even if someone passes the old date in", async () => {
    await seed();
    await warned();
    await db.prepare("UPDATE events SET ends_at = ?").bind("2026-12-15T13:30:00.000Z").run();
    expect(await purgeEvent(db, event, DUE, rel(0, 0))).toBeNull();
    expect(await intact()).toBe(true);
  });

  it("with everything right it deletes (the control case)", async () => {
    await seed();
    await warned();
    const snap = await purgeEvent(db, event, DUE, rel(0, 0));
    expect(snap).toMatchObject({ registrations: 3, participants: 4 });
    expect(await count("registrations")).toBe(0);
  });
});

describe("an unexpected start never deletes without notice", () => {
  it("deployed after the date: the final warning goes first, the purge follows 24 h later", async () => {
    await seed();
    const t0 = rel(5, 0);
    expect((await runRetention(db, cfg, t0)).warned.map((w) => w.stage)).toEqual(["w1"]);
    expect(await count("registrations")).toBe(3);
    expect((await runRetention(db, cfg, new Date(t0.getTime() + 3600_000))).purged).toEqual([]);
    expect((await runRetention(db, cfg, new Date(t0.getTime() + MIN_FINAL_WARNING_MS - 1000))).purged).toEqual([]);
    expect(await count("registrations")).toBe(3);
    const done = await runRetention(db, cfg, new Date(t0.getTime() + MIN_FINAL_WARNING_MS));
    expect(done.purged).toHaveLength(1);
    expect(await count("registrations")).toBe(0);
  });

  it("a final warning that went stale (outage) is repeated before the purge", async () => {
    await seed();
    await runRetention(db, cfg, rel(-1, 0));
    const late = rel(0, MAX_FINAL_WARNING_AGE_MS + DAY); // cron was down for over a week
    const r = await runRetention(db, cfg, late);
    expect(r.purged).toEqual([]);
    expect(r.warned.map((w) => w.stage)).toEqual(["w1"]);
    expect(await count("registrations")).toBe(3);
    expect((await runRetention(db, cfg, new Date(late.getTime() + MIN_FINAL_WARNING_MS))).purged).toHaveLength(1);
  });

  it("moving the event end later cancels what was announced: new warnings, no purge on the old date", async () => {
    await seed();
    await runRetention(db, cfg, rel(-1, 0));
    await db.prepare("UPDATE events SET ends_at = ?").bind("2026-12-15T13:30:00.000Z").run(); // +10 days
    const r = await runRetention(db, cfg, rel(0, 0));
    expect(r.purged).toEqual([]);
    expect(r.warned).toHaveLength(1); // new date: a new warning (w30 window) instead of a purge
    expect(await count("registrations")).toBe(3);
    const row = await db.prepare("SELECT detail FROM retention_log WHERE stage = 'w30'").first<{ detail: string }>();
    expect(JSON.parse(row!.detail).due).toBe("2027-03-15T13:30:00.000Z");
  });

  it("an unusable end date is reported and never purges", async () => {
    await seed();
    await db.prepare("UPDATE events SET ends_at = 'garbage'").run();
    // julianday('garbage') is NULL, so the event is not even selected: no purge, no crash
    const r = await runRetention(db, cfg, rel(100));
    expect(r.purged).toEqual([]);
    expect(await count("registrations")).toBe(3);
  });
});

describe("the admin hold switch", () => {
  it("pauses everything, is audited, and releasing it warns first", async () => {
    await seed();
    const on = await setRetentionHold(db, "admin1@x.nl", event.id, true, rel(-40));
    expect(on.ok).toBe(true);
    expect((await getEventById(db, event.id))!.retention_hold).toBe(1);
    expect(await count("audit_log", "action = 'event.retention_hold'")).toBe(1);

    for (const t of [rel(-30), rel(-1), rel(0), rel(40)]) {
      const r = await runRetention(db, cfg, t);
      expect(r).toMatchObject({ warned: [], purged: [] });
    }
    expect(await count("registrations")).toBe(3);
    expect((await outbox()).filter((m) => m.kind.startsWith("retention_"))).toHaveLength(0);

    // switching it on again changes nothing; off warns, then purges 24 h later
    expect((await setRetentionHold(db, "admin1@x.nl", event.id, true)).ok).toBe(true);
    expect(await count("audit_log", "action = 'event.retention_hold'")).toBe(1);
    await setRetentionHold(db, "admin1@x.nl", event.id, false, rel(40));
    const w = await runRetention(db, cfg, rel(40, 1000));
    expect(w.warned.map((x) => x.stage)).toEqual(["w1"]);
    expect(await count("registrations")).toBe(3);
    expect((await runRetention(db, cfg, rel(41, 2000))).purged).toHaveLength(1);
  });

  it("is refused once the data is gone, and for an unknown event", async () => {
    await seed();
    await walkToPurge();
    const r = await setRetentionHold(db, "admin1@x.nl", event.id, true);
    expect(r.ok).toBe(false);
    expect((await setRetentionHold(db, "admin1@x.nl", 9999, true)).ok).toBe(false);
  });
});

describe("status for the admin page and the policy", () => {
  it("describes where the event stands, from scheduled to purged", async () => {
    await seed();
    let s = await retentionStatus(db, event, new Date("2026-12-20T10:00:00.000Z"));
    expect(s).toMatchObject({ dueIso: DUE.toISOString(), hold: false, purged: null, warnings: [], counts: { registrations: 3, participants: 4, checkedIn: 1 } });
    expect(s.decision).toEqual({ action: "none", reason: "too_early" });

    await runRetention(db, cfg, rel(-30, 1000));
    s = await retentionStatus(db, event, rel(-29));
    expect(s.warnings.map((w) => w.stage)).toEqual(["w30"]);
    expect(s.warnings[0].sent).toBe(2);
    expect(s.decision).toEqual({ action: "wait", reason: "warned" });

    await runRetention(db, cfg, rel(-7, 1000));
    await runRetention(db, cfg, rel(-1, 0));
    await runRetention(db, cfg, rel(0, 0));
    s = await retentionStatus(db, (await getEventById(db, event.id))!, rel(1));
    expect(s.purged?.snapshot).toMatchObject({ registrations: 3, participants: 4 });
    expect(s.decision).toBeNull();
    expect(s.counts).toEqual({ registrations: 0, participants: 0, checkedIn: 0 });
  });

  it("counts a registration and its people", async () => {
    await seed();
    expect(await retentionCounts(db, event.id)).toEqual({ registrations: 3, participants: 4, checkedIn: 1 });
    expect(await retentionCounts(db, 9999)).toEqual({ registrations: 0, participants: 0, checkedIn: 0 });
  });

  it("the privacy policy promises what the code does (90 days, both languages)", () => {
    for (const lang of ["id", "en"] as const) {
      const text = JSON.stringify(LEGAL_DOCS[lang].privacy);
      expect(text).toContain(`${RETENTION_DAYS} hari`.replace("hari", lang === "id" ? "hari" : "days"));
    }
  });
});
