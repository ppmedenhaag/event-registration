import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addAdmin } from "../app/lib/admins.server";
import { createSession, identifyUser, sessionCookie } from "../app/lib/auth.server";
import { viewerEnabled } from "../app/lib/config.server";
import { attendanceStats, planningStats } from "../app/lib/demography.server";
import { getParticipants, type EventRow } from "../app/lib/db.server";
import { requestLoginCode, verifyLoginCode } from "../app/lib/login-codes.server";
import { setMembershipVerified } from "../app/lib/payments.server";
import { registerOnline } from "../app/lib/registration.server";
import { runDeadlineJob } from "../app/lib/jobs.server";
import {
  createViewerSession,
  identifyPanitia,
  identifyViewer,
  VIEWER_SESSION_TTL_MS,
  viewerSessionCookie,
} from "../app/lib/viewer-auth.server";
import {
  addViewers,
  approveViewer,
  deleteViewer,
  handleViewerIntent,
  listViewers,
  MAX_ADD_BATCH,
  MAX_PENDING_REQUESTS,
  purgeExpiredViewers,
  rejectViewer,
  requestViewerAccess,
  validateAccessRequest,
  VIEWER_GRACE_MS,
  viewerExpiry,
} from "../app/lib/viewers.server";
import { emailCfg, input, resetDb, startDb, T0 } from "./helpers";

let db: D1Database;
let dispose: () => Promise<void>;
let event: EventRow;

const START = "2026-12-05T08:00:00.000Z";
const END = "2026-12-05T13:30:00.000Z";
const DOOR = new Date("2026-12-05T08:10:00.000Z");
const meta = { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", country: "NL", appOrigin: "https://admin.example" };
const at = (ms: number, base = T0) => new Date(base.getTime() + ms);

beforeAll(async () => {
  ({ db, dispose } = await startDb());
});
afterAll(async () => dispose?.());
beforeEach(async () => {
  await resetDb(db);
  await db
    .prepare("UPDATE events SET status = 'open', registration_closes_at = ?, starts_at = ?, ends_at = ?, price_non_member_cents = 1500")
    .bind("2026-11-27T22:59:00.000Z", START, END)
    .run();
  event = (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
  await addAdmin(db, "system", "admin@x.nl", "Admin", T0);
});

const EXPIRES = () => viewerExpiry(event);

async function approvedViewer(email = "panitia@x.nl", name = "Siti Panitia") {
  await requestViewerAccess(db, { email, name, section: "Konsumsi" }, EXPIRES(), T0);
  const row = await db.prepare("SELECT id FROM viewers WHERE email = ?").bind(email).first<{ id: number }>();
  await approveViewer(db, "admin@x.nl", row!.id, T0);
  return row!.id;
}

async function lastMail(to: string) {
  return db
    .prepare("SELECT subject, html, kind FROM dev_outbox WHERE to_address = ? ORDER BY id DESC LIMIT 1")
    .bind(to)
    .first<{ subject: string; html: string; kind: string }>();
}
const outboxCount = async () => (await db.prepare("SELECT COUNT(*) AS n FROM dev_outbox").first<{ n: number }>())!.n;

const cookieHeader = (name: string, token: string) => ({ headers: { Cookie: `${name}=${token}` } });
const url = "https://admin.example/panitia";

describe("feature switch (fails closed)", () => {
  it("is off unless ENABLE_VIEWER is exactly true; local development is on unless switched off", () => {
    expect(viewerEnabled({})).toBe(false);
    expect(viewerEnabled({ ENABLE_VIEWER: "yes" })).toBe(false);
    expect(viewerEnabled({ ENABLE_VIEWER: "false", APP_ENV: "development" })).toBe(false);
    expect(viewerEnabled({ ENABLE_VIEWER: "true" })).toBe(true);
    expect(viewerEnabled({ APP_ENV: "development" })).toBe(true);
    expect(viewerEnabled({ APP_ENV: "production" })).toBe(false);
  });

  it("is never served by a Worker that has /admin switched off (public and check-in Workers)", () => {
    expect(viewerEnabled({ ENABLE_VIEWER: "true", ENABLE_ADMIN: "false" })).toBe(false);
    expect(viewerEnabled({ APP_ENV: "development", ENABLE_ADMIN: "false" })).toBe(false);
  });
});

describe("access request", () => {
  it("validates the fields and normalises them", () => {
    expect(validateAccessRequest({ email: "bad", name: "Siti", section: "Acara" }).ok).toBe(false);
    expect(validateAccessRequest({ email: "a@x.nl", name: "S", section: "Acara" }).ok).toBe(false);
    expect(validateAccessRequest({ email: "a@x.nl", name: "Siti", section: "" }).ok).toBe(false);
    const ok = validateAccessRequest({ email: "  Siti@X.NL ", name: "  Siti   Aminah ", section: " Acara " });
    expect(ok.ok && ok.value).toEqual({ email: "siti@x.nl", name: "Siti Aminah", section: "Acara" });
  });

  it("creates one pending row per email; a repeat changes nothing", async () => {
    const r = { email: "siti@x.nl", name: "Siti", section: "Acara" };
    expect(await requestViewerAccess(db, r, EXPIRES(), T0)).toBe("created");
    expect(await requestViewerAccess(db, { ...r, name: "Someone else" }, EXPIRES(), at(1000))).toBe("skipped");
    const rows = await listViewers(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "siti@x.nl", name: "Siti", status: "pending" });
    expect(rows[0].expires_at).toBe(new Date(Date.parse(END) + VIEWER_GRACE_MS).toISOString());
  });

  it("ignores a request from an admin (they already have the pages) and caps the open queue", async () => {
    expect(await requestViewerAccess(db, { email: "admin@x.nl", name: "Admin", section: "x1" }, EXPIRES(), T0)).toBe("skipped");
    for (let i = 0; i < MAX_PENDING_REQUESTS; i++) {
      expect(await requestViewerAccess(db, { email: `p${i}@x.nl`, name: `P ${i}`, section: "x1" }, EXPIRES(), T0)).toBe("created");
    }
    expect(await requestViewerAccess(db, { email: "late@x.nl", name: "Late", section: "x1" }, EXPIRES(), T0)).toBe("skipped");
  });

  it("is audited with the section only (no free text beyond the form)", async () => {
    await requestViewerAccess(db, { email: "siti@x.nl", name: "Siti", section: "Anak-anak" }, EXPIRES(), T0);
    const row = await db.prepare("SELECT actor, action, detail FROM audit_log WHERE action = 'viewer.request'").first<{ actor: string; action: string; detail: string }>();
    expect(row?.actor).toBe("siti@x.nl");
    expect(JSON.parse(row!.detail)).toEqual({ section: "Anak-anak" });
  });
});

describe("approval workflow", () => {
  it("only an approved viewer gets a login code; pending and rejected people get nothing and no email", async () => {
    await requestViewerAccess(db, { email: "wait@x.nl", name: "Wait", section: "Acara" }, EXPIRES(), T0);
    expect((await requestLoginCode(db, emailCfg, "wait@x.nl", meta, T0, "viewer")).status).toBe("skipped");
    expect((await requestLoginCode(db, emailCfg, "stranger@x.nl", meta, T0, "viewer")).status).toBe("skipped");
    expect(await outboxCount()).toBe(0);

    const id = await approvedViewer("ok@x.nl");
    expect((await requestLoginCode(db, emailCfg, "ok@x.nl", meta, T0, "viewer")).status).toBe("sent");
    const mail = await lastMail("ok@x.nl");
    expect(mail?.kind).toBe("viewer_login_code");
    expect(mail?.subject).toContain("Ringkasan Panitia");
    expect(mail?.html).toContain("/panitia");
    expect(mail?.html).not.toContain("example/admin"); // the link points at /panitia, never at /admin

    await rejectViewer(db, "admin@x.nl", id, at(1000));
    expect((await requestLoginCode(db, emailCfg, "ok@x.nl", meta, at(120_000), "viewer")).status).toBe("skipped");
  });

  it("a viewer can never get an ADMIN login code, and an admin does not need the viewer realm", async () => {
    await approvedViewer("ok@x.nl");
    expect((await requestLoginCode(db, emailCfg, "ok@x.nl", meta, T0, "admin")).status).toBe("skipped");
    expect((await requestLoginCode(db, emailCfg, "ok@x.nl", meta, T0, "scanner")).status).toBe("skipped");
    expect((await requestLoginCode(db, emailCfg, "admin@x.nl", meta, T0, "viewer")).status).toBe("skipped");
  });

  it("approval is conditional: a second click, an unknown id and an expired row do nothing", async () => {
    await requestViewerAccess(db, { email: "siti@x.nl", name: "Siti", section: "Acara" }, EXPIRES(), T0);
    const id = (await db.prepare("SELECT id FROM viewers").first<{ id: number }>())!.id;
    const [a, b] = await Promise.all([approveViewer(db, "admin@x.nl", id, T0), approveViewer(db, "admin@x.nl", id, T0)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect((await approveViewer(db, "admin@x.nl", 9999, T0)).ok).toBe(false);

    await db.prepare("UPDATE viewers SET status = 'pending', expires_at = ?").bind(at(-1000).toISOString()).run();
    expect((await approveViewer(db, "admin@x.nl", id, T0)).ok).toBe(false);
  });

  it("a rejected person cannot request again until an admin deletes the row or approves it", async () => {
    await requestViewerAccess(db, { email: "siti@x.nl", name: "Siti", section: "Acara" }, EXPIRES(), T0);
    const id = (await db.prepare("SELECT id FROM viewers").first<{ id: number }>())!.id;
    await rejectViewer(db, "admin@x.nl", id, T0);
    expect(await requestViewerAccess(db, { email: "siti@x.nl", name: "Siti", section: "Acara" }, EXPIRES(), at(5000))).toBe("skipped");
    expect((await listViewers(db))[0].status).toBe("rejected");
    await deleteViewer(db, "admin@x.nl", id, at(6000));
    expect(await requestViewerAccess(db, { email: "siti@x.nl", name: "Siti", section: "Acara" }, EXPIRES(), at(7000))).toBe("created");
  });

  it("every decision is audited with the acting admin", async () => {
    const id = await approvedViewer("siti@x.nl");
    await rejectViewer(db, "admin@x.nl", id, at(1000));
    await deleteViewer(db, "admin@x.nl", id, at(2000));
    const actions = (await db.prepare("SELECT actor, action FROM audit_log WHERE action LIKE 'viewer.%' ORDER BY id").all<{ actor: string; action: string }>()).results;
    expect(actions.map((a) => a.action)).toEqual(["viewer.request", "viewer.approve", "viewer.reject", "viewer.delete"]);
    expect(actions[1].actor).toBe("admin@x.nl");
  });

  it("the approval email carries no code and no personal data, and a mail failure does not undo the approval", async () => {
    await requestViewerAccess(db, { email: "siti@x.nl", name: "Siti Rahasia", section: "Konsumsi" }, EXPIRES(), T0);
    const id = (await db.prepare("SELECT id FROM viewers").first<{ id: number }>())!.id;
    const form = new FormData();
    form.set("intent", "approve-viewer");
    form.set("viewerId", String(id));
    const res = await handleViewerIntent(db, emailCfg, "admin@x.nl", form, "https://admin.example", T0);
    expect(res.ok).toBe(true);
    const mail = await lastMail("siti@x.nl");
    expect(mail?.kind).toBe("viewer_approved");
    expect(mail?.html).toContain("https://admin.example/panitia");
    expect(mail?.html).not.toContain("Siti Rahasia");
    expect(mail?.html).not.toMatch(/(?<![#\w])\d{6}(?!\w)/); // colours like #334155 are fine, a code is not

    await db.prepare("UPDATE viewers SET status = 'pending'").run();
    const broken = { ...emailCfg, mode: "resend" as const, resendApiKey: undefined };
    const failed = await handleViewerIntent(db, broken, "admin@x.nl", form, "https://admin.example", at(1000));
    expect(failed.ok).toBe(true);
    expect(failed.message).toContain("gagal");
    expect((await listViewers(db))[0].status).toBe("approved");
  });

  it("rejects bad input to the admin handler", async () => {
    const form = new FormData();
    form.set("intent", "approve-viewer");
    form.set("viewerId", "abc");
    expect((await handleViewerIntent(db, emailCfg, "admin@x.nl", form, "https://admin.example")).ok).toBe(false);
    form.set("viewerId", "1");
    form.set("intent", "something-else");
    expect((await handleViewerIntent(db, emailCfg, "admin@x.nl", form, "https://admin.example")).ok).toBe(false);
  });
});

describe("admin pre-populates panitia emails", () => {
  const add = (emails: string, name = "", section = "", when = T0) => addViewers(db, "admin@x.nl", emails, name, section, EXPIRES(), when);

  it("approves a pasted list at once (commas, spaces, newlines), lowercases, de-duplicates, names from the email", async () => {
    const res = await add("Siti@X.nl, budi@x.nl;\nsiti@x.nl  rina@x.nl", "Ignored for a list", "Acara");
    expect(res).toMatchObject({ ok: true });
    expect(res.added.sort()).toEqual(["budi@x.nl", "rina@x.nl", "siti@x.nl"]);
    const rows = await listViewers(db);
    expect(rows.map((r) => [r.email, r.name, r.status, r.section, r.decided_by])).toEqual([
      ["budi@x.nl", "budi", "approved", "Acara", "admin@x.nl"],
      ["rina@x.nl", "rina", "approved", "Acara", "admin@x.nl"],
      ["siti@x.nl", "siti", "approved", "Acara", "admin@x.nl"],
    ]);
    expect(rows.every((r) => r.expires_at === EXPIRES())).toBe(true);
  });

  it("uses the given name for a single email", async () => {
    await add("siti@x.nl", "Siti Aminah", "Konsumsi");
    expect((await listViewers(db))[0]).toMatchObject({ name: "Siti Aminah", section: "Konsumsi", status: "approved" });
  });

  it("an added viewer can log in straight away, without ever requesting access", async () => {
    await add("siti@x.nl");
    expect((await requestLoginCode(db, emailCfg, "siti@x.nl", meta, T0, "viewer")).status).toBe("sent");
    const code = (await lastMail("siti@x.nl"))!.subject.split(" ")[0];
    expect((await verifyLoginCode(db, "siti@x.nl", code, T0, "viewer")).ok).toBe(true);
    expect(await createViewerSession(db, "siti@x.nl", meta, T0)).not.toBeNull();
  });

  it("turns a pending or rejected request into an approval, leaves approved people and admins alone", async () => {
    await requestViewerAccess(db, { email: "wait@x.nl", name: "Wait Person", section: "Acara" }, EXPIRES(), T0);
    await requestViewerAccess(db, { email: "no@x.nl", name: "No Person", section: "Acara" }, EXPIRES(), T0);
    await db.prepare("UPDATE viewers SET status = 'rejected' WHERE email = 'no@x.nl'").run();
    await approvedViewer("yes@x.nl", "Yes Person");

    const res = await add("wait@x.nl, no@x.nl, yes@x.nl, admin@x.nl, new@x.nl");
    expect(res.added.sort()).toEqual(["new@x.nl", "no@x.nl", "wait@x.nl"]);
    expect(res.message).toContain("2 lainnya");
    const by = Object.fromEntries((await listViewers(db)).map((r) => [r.email, r]));
    expect(by["wait@x.nl"]).toMatchObject({ status: "approved", name: "Wait Person" }); // keeps the name they gave
    expect(by["no@x.nl"].status).toBe("approved");
    expect(by["admin@x.nl"]).toBeUndefined(); // an admin already has the pages
  });

  it("refuses an empty or invalid list, an oversized batch, and an all-known list", async () => {
    expect((await add("")).ok).toBe(false);
    expect((await add("not an email, also-bad")).ok).toBe(false);
    const many = Array.from({ length: MAX_ADD_BATCH + 1 }, (_, i) => `p${i}@x.nl`).join(",");
    expect((await add(many)).ok).toBe(false);
    expect(await listViewers(db)).toHaveLength(0);
    await add("siti@x.nl");
    const again = await add("siti@x.nl");
    expect(again.ok).toBe(false);
    expect(again.added).toEqual([]);
  });

  it("does not revive a row whose access has already expired", async () => {
    await add("siti@x.nl");
    await db.prepare("UPDATE viewers SET status = 'rejected', expires_at = ?").bind(at(-1000).toISOString()).run();
    expect((await add("siti@x.nl")).ok).toBe(false);
    expect((await listViewers(db))[0].status).toBe("rejected");
  });

  it("is audited once per click with the emails", async () => {
    await add("a@x.nl, b@x.nl");
    const row = await db.prepare("SELECT actor, detail FROM audit_log WHERE action = 'viewer.add'").first<{ actor: string; detail: string }>();
    expect(row?.actor).toBe("admin@x.nl");
    expect(JSON.parse(row!.detail)).toEqual({ count: 2, emails: ["a@x.nl", "b@x.nl"] });
  });

  it("the admin intent sends one notification per new person (no code, no name) and reports a mail failure without undoing the access", async () => {
    const form = new FormData();
    form.set("intent", "add-viewer");
    form.set("email", "a@x.nl, b@x.nl");
    const res = await handleViewerIntent(db, emailCfg, "admin@x.nl", form, "https://admin.example", T0, EXPIRES());
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Pemberitahuan dikirim");
    for (const to of ["a@x.nl", "b@x.nl"]) {
      const mail = await lastMail(to);
      expect(mail?.kind).toBe("viewer_approved");
      expect(mail?.html).toContain("https://admin.example/panitia");
    }

    const form2 = new FormData();
    form2.set("intent", "add-viewer");
    form2.set("email", "c@x.nl");
    const broken = { ...emailCfg, mode: "resend" as const, resendApiKey: undefined };
    const failed = await handleViewerIntent(db, broken, "admin@x.nl", form2, "https://admin.example", T0, EXPIRES());
    expect(failed.ok).toBe(true);
    expect(failed.message).toContain("gagal");
    expect((await listViewers(db)).find((r) => r.email === "c@x.nl")?.status).toBe("approved");
  });
});

describe("viewer login and session", () => {
  async function login(email = "panitia@x.nl", when = T0) {
    await requestLoginCode(db, emailCfg, email, meta, when, "viewer");
    const code = (await lastMail(email))!.subject.split(" ")[0];
    expect((await verifyLoginCode(db, email, code, when, "viewer")).ok).toBe(true);
    return (await createViewerSession(db, email, meta, when))!;
  }

  it("PIN login -> session cookie -> identity; only a hash is stored", async () => {
    await approvedViewer();
    const s = await login();
    expect(s.token.length).toBeGreaterThanOrEqual(32);
    const row = await db.prepare("SELECT * FROM viewer_sessions").first<Record<string, string>>();
    expect(JSON.stringify(row)).not.toContain(s.token);
    const req = new Request(url, cookieHeader("__Host-ppme_view", s.token));
    expect(await identifyViewer(req, db, T0)).toEqual({ kind: "viewer", email: "panitia@x.nl", name: "Siti Panitia" });
    const setCookie = viewerSessionCookie(new Request("https://admin.example/panitia"), s.token);
    expect(setCookie).toContain("__Host-ppme_view=");
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
  });

  it("codes of the viewer realm are separate: a viewer code does not verify as an admin or scanner code", async () => {
    await approvedViewer();
    await requestLoginCode(db, emailCfg, "panitia@x.nl", meta, T0, "viewer");
    const code = (await lastMail("panitia@x.nl"))!.subject.split(" ")[0];
    expect((await verifyLoginCode(db, "panitia@x.nl", code, T0, "admin")).ok).toBe(false);
    expect((await verifyLoginCode(db, "panitia@x.nl", code, T0, "scanner")).ok).toBe(false);
    expect((await verifyLoginCode(db, "panitia@x.nl", code, T0, "viewer")).ok).toBe(true);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM admin_login_codes").first<{ n: number }>())!.n).toBe(0);
  });

  it("a session only exists for an approved viewer", async () => {
    await requestViewerAccess(db, { email: "wait@x.nl", name: "Wait", section: "Acara" }, EXPIRES(), T0);
    expect(await createViewerSession(db, "wait@x.nl", meta, T0)).toBeNull();
    expect(await createViewerSession(db, "stranger@x.nl", meta, T0)).toBeNull();
  });

  it("a viewer session is NOT an admin session, in either direction", async () => {
    await approvedViewer();
    const s = await login();
    // viewer token presented as the admin cookie (any name) -> not an admin
    for (const name of ["__Host-ppme_admin", "ppme_admin"]) {
      const res = await identifyUser(new Request("https://admin.example/admin", cookieHeader(name, s.token)), { APP_ENV: "production", DB: db }, T0);
      expect(res.ok).toBe(false);
    }
    // the same email is not an admin
    expect((await db.prepare("SELECT 1 AS ok FROM admins WHERE email = 'panitia@x.nl'").first())).toBeNull();

    // an admin session presented as the viewer cookie is not a viewer; the admin's own cookie opens /panitia (preview)
    const admin = (await createSession(db, "admin@x.nl", "pin", meta, T0))!;
    expect(await identifyViewer(new Request(url, cookieHeader("__Host-ppme_view", admin.token)), db, T0)).toBeNull();
    const adminReq = new Request(url, { headers: { Cookie: sessionCookie(new Request("https://admin.example/admin"), admin.token).split(";")[0] } });
    expect(await identifyPanitia(adminReq, { APP_ENV: "production", DB: db }, T0)).toMatchObject({ kind: "admin", email: "admin@x.nl" });
  });

  it("no cookie, garbage or a too-short token means no access", async () => {
    await approvedViewer();
    await login();
    for (const t of ["", "short", "x".repeat(200), "A".repeat(43)]) {
      const req = new Request(url, t ? cookieHeader("__Host-ppme_view", t) : undefined);
      expect(await identifyViewer(req, db, T0)).toBeNull();
      expect(await identifyPanitia(req, { APP_ENV: "production", DB: db }, T0)).toBeNull();
    }
  });

  it("revoking access ends the session on the very next request", async () => {
    const id = await approvedViewer();
    const s = await login();
    const req = new Request(url, cookieHeader("__Host-ppme_view", s.token));
    expect(await identifyViewer(req, db, at(1000))).not.toBeNull();
    await rejectViewer(db, "admin@x.nl", id, at(2000));
    expect(await identifyViewer(req, db, at(2001))).toBeNull();
    expect((await db.prepare("SELECT COUNT(*) AS n FROM viewer_sessions").first<{ n: number }>())!.n).toBe(0);
  });

  it("deleting a viewer also removes sessions and codes", async () => {
    const id = await approvedViewer();
    await login();
    await requestLoginCode(db, emailCfg, "panitia@x.nl", meta, at(120_000), "viewer");
    await deleteViewer(db, "admin@x.nl", id, at(130_000));
    for (const t of ["viewers", "viewer_sessions", "viewer_login_codes"]) {
      expect((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n).toBe(0);
    }
  });

  it("the session lasts 24 hours, never longer than the viewer's own expiry", async () => {
    await approvedViewer();
    const s = await login();
    expect(Date.parse(s.expiresAt) - T0.getTime()).toBe(VIEWER_SESSION_TTL_MS);
    const req = new Request(url, cookieHeader("__Host-ppme_view", s.token));
    expect(await identifyViewer(req, db, at(VIEWER_SESSION_TTL_MS - 1000))).not.toBeNull();
    expect(await identifyViewer(req, db, at(VIEWER_SESSION_TTL_MS + 1000))).toBeNull();

    // a viewer that expires in 1 hour gets a 1 hour session
    await db.prepare("UPDATE viewers SET expires_at = ?").bind(at(3_600_000).toISOString()).run();
    const short = await createViewerSession(db, "panitia@x.nl", meta, T0);
    expect(Date.parse(short!.expiresAt) - T0.getTime()).toBe(3_600_000);
    const shortReq = new Request(url, cookieHeader("__Host-ppme_view", short!.token));
    expect(await identifyViewer(shortReq, db, at(3_000_000))).not.toBeNull();
    expect(await identifyViewer(shortReq, db, at(3_700_000))).toBeNull();
  });

  it("access ends at the viewer's expiry and the 5-minute job then deletes the row, sessions and codes", async () => {
    await approvedViewer();
    const s = await login();
    const after = new Date(Date.parse(EXPIRES()) + 1000);
    const req = new Request(url, cookieHeader("__Host-ppme_view", s.token));
    expect(await identifyViewer(req, db, after)).toBeNull();
    expect(await createViewerSession(db, "panitia@x.nl", meta, after)).toBeNull();
    await runDeadlineJob(db, emailCfg, after);
    for (const t of ["viewers", "viewer_sessions"]) {
      expect((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n).toBe(0);
    }
  });

  it("purge keeps people whose access is still running", async () => {
    await approvedViewer("keep@x.nl");
    expect(await purgeExpiredViewers(db, T0)).toBe(0);
    expect(await listViewers(db)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------ the numbers

const PII = {
  names: ["Rahasia Budiman", "Anak Rahasia", "Balita Rahasia", "Dewi Pribadi", "Pasangan Pribadi", "Remaja Pribadi", "Tunggu Bayar"],
  emails: ["budiman.pii@example.com", "dewi.pii@example.com", "tunggu.pii@example.com"],
  phones: ["+31687654321", "+31611223344", "+31699887766"],
};

async function seed() {
  // R1: member family of four (dewasa M, dewasa F, anak M, balita F)
  const r1 = await registerOnline(
    db,
    event,
    input({
      registrantName: PII.names[0],
      email: PII.emails[0],
      whatsapp: PII.phones[0],
      participants: [
        { name: PII.names[0], gender: "laki-laki", ageGroup: "dewasa" },
        { name: PII.names[3], gender: "perempuan", ageGroup: "dewasa" },
        { name: PII.names[1], gender: "laki-laki", ageGroup: "anak" },
        { name: PII.names[2], gender: "perempuan", ageGroup: "balita" },
      ],
    }),
    { now: T0, ignoreWindow: true },
  );
  // R2: member trio (dewasa F, dewasa M, remaja F)
  const r2 = await registerOnline(
    db,
    event,
    input({
      registrantName: PII.names[3],
      email: PII.emails[1],
      whatsapp: PII.phones[1],
      participants: [
        { name: PII.names[3] + " 2", gender: "perempuan", ageGroup: "dewasa" },
        { name: PII.names[4], gender: "laki-laki", ageGroup: "dewasa" },
        { name: PII.names[5], gender: "perempuan", ageGroup: "remaja" },
      ],
    }),
    { now: at(86_400_000), ignoreWindow: true },
  );
  // R3: non-member alone, still has to pay
  const r3 = await registerOnline(
    db,
    event,
    input({
      membership: "Tidak",
      registrantName: PII.names[6],
      email: PII.emails[2],
      whatsapp: PII.phones[2],
      participants: [{ name: PII.names[6], gender: "perempuan", ageGroup: "dewasa" }],
    }),
    { now: at(2 * 86_400_000), ignoreWindow: true },
  );
  if (r1.kind !== "pending_membership" || r2.kind !== "pending_membership") throw new Error(`${r1.kind} ${r2.kind}`);
  await setMembershipVerified(db, r1.registrationId, "admin@test", true, T0);
  await setMembershipVerified(db, r2.registrationId, "admin@test", true, T0);
  return { r1: r1.registrationId, r2: r2.registrationId, r3: (r3 as { registrationId: string }).registrationId };
}

describe("planning numbers (everyone registered)", () => {
  it("counts people by status, age, gender, membership, party size and children", async () => {
    await seed();
    const now = at(2 * 86_400_000 + 600_000); // the non-member registered 10 minutes ago and has not paid yet
    const s = await planningStats(db, event, now);
    expect(s.totals).toEqual({ confirmedPeople: 7, pendingPeople: 1, confirmedFamilies: 2, pendingFamilies: 1 });
    const age = Object.fromEntries(s.ageGroups.map((a) => [a.group, a]));
    expect(age.balita).toMatchObject({ confirmed: 1, pending: 0 });
    expect(age.anak).toMatchObject({ confirmed: 1, pending: 0 });
    expect(age.remaja).toMatchObject({ confirmed: 1, pending: 0 });
    expect(age.dewasa).toMatchObject({ confirmed: 4, pending: 1, member: 4, nonMember: 1 });
    expect(s.membership).toEqual({ member: 7, nonMember: 1 });
    expect(s.source).toEqual({ online: 8, manual: 0 });
    expect(s.gender).toEqual({ lakiLaki: 3, perempuan: 5, unknown: 0 });
    expect(s.genderByAge.find((g) => g.group === "dewasa")).toMatchObject({ lakiLaki: 2, perempuan: 3 });
    expect(s.children).toMatchObject({
      balita: { confirmed: 1, pending: 0 },
      anak: { confirmed: 1, pending: 0 },
      familiesWithBalita: 1,
      familiesWithAnak: 1,
      familiesWithChildren: 1,
    });
    expect(s.partySizes.map((p) => p.families)).toEqual([1, 0, 1, 1, 0]);
    expect(s.timeline.length).toBeGreaterThan(0);
    expect(s.quota.member.used).toBeGreaterThan(0);
  });

  it("drops a payment that missed its deadline (same rule as the quota) and reports an empty event cleanly", async () => {
    await seed();
    const late = at(30 * 86_400_000);
    const s = await planningStats(db, event, late);
    expect(s.totals.pendingPeople).toBe(0);
    expect(s.totals.confirmedPeople).toBe(7);

    await resetDb(db);
    const empty = await planningStats(db, event, T0);
    expect(empty.totals).toEqual({ confirmedPeople: 0, pendingPeople: 0, confirmedFamilies: 0, pendingFamilies: 0 });
    expect(empty.timeline).toEqual([]);
  });
});

describe("event-day numbers (who actually checked in)", () => {
  it("counts only accepted people who were scanned, with arrivals per 15 minutes in Netherlands time", async () => {
    const ids = await seed();
    const parts = await getParticipants(db, ids.r1);
    const by = (g: string) => parts.find((p) => p.age_group === g && (g !== "dewasa" || p.gender === "laki-laki"))!;
    const stamp = (id: string, d: Date) => db.prepare("UPDATE participants SET checked_in_at = ?, checked_in_by = 'scanner:1' WHERE id = ?").bind(d.toISOString(), id).run();
    await stamp(by("balita").id, DOOR); // 09.10 NL -> bucket 09.00
    await stamp(by("anak").id, new Date(DOOR.getTime() + 60_000)); // bucket 09.00
    await stamp(by("dewasa").id, new Date(DOOR.getTime() + 120_000)); // bucket 09.00
    const r2parts = await getParticipants(db, ids.r2);
    await stamp(r2parts.find((p) => p.age_group === "remaja")!.id, new Date(DOOR.getTime() + 20 * 60_000)); // 09.30

    const s = await attendanceStats(db, event, new Date(DOOR.getTime() + 25 * 60_000));
    expect(s).toMatchObject({ expected: 7, checkedIn: 4, remaining: 3, eventDay: true, gate: "open" });
    expect(s.byAge.find((a) => a.group === "balita")).toEqual({ group: "balita", expected: 1, checkedIn: 1, remaining: 0 });
    expect(s.byAge.find((a) => a.group === "dewasa")).toEqual({ group: "dewasa", expected: 4, checkedIn: 1, remaining: 3 });
    expect(s.childrenIn).toEqual({ balita: 1, anak: 1, total: 2 });
    expect(s.membership).toEqual({ member: 4, nonMember: 0 });
    expect(s.gender).toEqual({ lakiLaki: 2, perempuan: 2, unknown: 0 });
    expect(s.arrivals).toEqual([
      { time: "09.00", n: 3, total: 3 },
      { time: "09.30", n: 1, total: 4 },
    ]);
    expect(s.peak).toEqual({ time: "09.00", n: 3 });
    expect(s.lastCheckinAt).toBe(new Date(DOOR.getTime() + 20 * 60_000).toISOString());
  });

  it("an undone check-in is not counted, and the pending non-member is not 'expected'", async () => {
    const ids = await seed();
    const p = (await getParticipants(db, ids.r1))[0];
    await db.prepare("UPDATE participants SET checked_in_at = ? WHERE id = ?").bind(DOOR.toISOString(), p.id).run();
    expect((await attendanceStats(db, event, DOOR)).checkedIn).toBe(1);
    await db.prepare("UPDATE participants SET checked_in_at = NULL WHERE id = ?").bind(p.id).run();
    const s = await attendanceStats(db, event, DOOR);
    expect(s.checkedIn).toBe(0);
    expect(s.expected).toBe(7);
    expect(s.peak).toBeNull();
    expect(s.arrivals).toEqual([]);
    expect(s.lastCheckinAt).toBeNull();
  });

  it("knows when it is not event day and when the gate is closed or off", async () => {
    await seed();
    expect((await attendanceStats(db, event, T0)).eventDay).toBe(false);
    expect((await attendanceStats(db, event, T0)).gate).toBe("before");
    expect((await attendanceStats(db, { ...event, checkin_enabled: 0 }, DOOR)).gate).toBe("off");
    expect((await attendanceStats(db, event, new Date("2026-12-06T12:00:00Z"))).gate).toBe("after");
  });
});

describe("privacy: the dashboards never expose personal data", () => {
  const FORBIDDEN_KEY = /name|email|mail|phone|whatsapp|token|ticket|qr|registrant|address|payment|iban|note/i;

  function keysOf(value: unknown, path = ""): string[] {
    if (Array.isArray(value)) return value.flatMap((v) => keysOf(v, path));
    if (value && typeof value === "object") {
      return Object.entries(value).flatMap(([k, v]) => [`${path}${k}`, ...keysOf(v, `${path}${k}.`)]);
    }
    return [];
  }

  it("no recognisable name, email, phone, ticket code or id appears anywhere in the payloads", async () => {
    const ids = await seed();
    const tokens = (await db.prepare("SELECT qr_token FROM participants WHERE qr_token IS NOT NULL").all<{ qr_token: string }>()).results.map((r) => r.qr_token);
    expect(tokens.length).toBeGreaterThan(0);
    await db.prepare("UPDATE participants SET checked_in_at = ? WHERE status = 'accepted'").bind(DOOR.toISOString()).run();

    const planning = JSON.stringify(await planningStats(db, event, at(2 * 86_400_000 + 600_000)));
    const attendance = JSON.stringify(await attendanceStats(db, event, DOOR));
    for (const payload of [planning, attendance]) {
      for (const secret of [...PII.names, ...PII.emails, ...PII.phones, ...tokens, ids.r1, ids.r2, ids.r3, "admin@test", "scanner:1"]) {
        expect(payload).not.toContain(secret);
      }
      expect(payload).not.toMatch(/@/);
      expect(payload).not.toMatch(/\+31\d/);
    }
  });

  it("no field in the payloads is named like personal data (guards future additions)", async () => {
    await seed();
    const keys = [...keysOf(await planningStats(db, event, at(2 * 86_400_000 + 600_000))), ...keysOf(await attendanceStats(db, event, DOOR))];
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
  });

  it("the viewer list shown to admins is the only place viewer emails appear, and aggregates never mention viewers", async () => {
    await approvedViewer("panitia@x.nl", "Siti Panitia");
    await seed();
    const all = JSON.stringify([await planningStats(db, event, DOOR), await attendanceStats(db, event, DOOR)]);
    expect(all).not.toContain("panitia@x.nl");
    expect(all).not.toContain("Siti Panitia");
  });
});
