import { describe, expect, it } from "vitest";

import {
  clearSessionCookie,
  isSameOrigin,
  loginPath,
  readCookie,
  safeNextPath,
  sessionCookie,
} from "../app/lib/auth.server";
import { countryName, describeDevice } from "../app/lib/email/login-code";
import { finishGoogleLogin, googleConfig, startGoogleLogin } from "../app/lib/google-oauth.server";
import { generateCode, normalizeCode } from "../app/lib/login-codes.server";
import { bankConfigured, featureEnabled } from "../app/lib/config.server";
import { buildTimeline } from "../app/lib/admin.server";
import { daysUntil, exportRowsToIndonesian, formatHijriDate, seatCount } from "../app/lib/format";
import { buildIcs, calendarLinks } from "../app/lib/email/calendar";
import { toCsv } from "../app/lib/csv";
import { verifyTurnstile } from "../app/lib/turnstile.server";
import { formToRegistrationDraft, normalizeWhatsapp, registrationSchema, validateRegistrationDraft } from "../app/lib/validation";

describe("validation", () => {
  it("normalises WhatsApp numbers", () => {
    expect(normalizeWhatsapp("06 1234 5678")).toBe("+31612345678");
    expect(normalizeWhatsapp("0031-6-12345678")).toBe("+31612345678");
    expect(normalizeWhatsapp("+62 812 3456 7890")).toBe("+6281234567890");
  });

  function form(extra: Record<string, string> = {}) {
    const f = new FormData();
    const base: Record<string, string> = {
      registrantName: "  Budi  ",
      membership: "Ya",
      email: "Budi@Example.COM",
      whatsapp: "0612345678",
      participantCount: "2",
      p0_name: "Budi",
      p0_gender: "laki-laki",
      p0_ageGroup: "dewasa",
      p1_name: "Ani",
      p1_gender: "perempuan",
      p1_ageGroup: "anak",
      consent: "on",
      mediaConsent: "on",
      ...extra,
    };
    for (const [k, v] of Object.entries(base)) f.append(k, v);
    return f;
  }

  it("accepts a valid family and normalises fields", () => {
    const r = registrationSchema(8).safeParse(formToRegistrationDraft(form()));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({ registrantName: "Budi", email: "budi@example.com", whatsapp: "+31612345678" });
    expect(r.data.participants[1]).toEqual({ name: "Ani", gender: "perempuan", ageGroup: "anak" });
  });

  it("requires privacy consent, valid gender and age group", () => {
    const f = form({ p1_gender: "x", p1_ageGroup: "bayi" });
    f.delete("consent");
    f.delete("mediaConsent");
    const r = registrationSchema(8).safeParse(formToRegistrationDraft(f));
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["consent", "mediaConsent", "participants.1.gender", "participants.1.ageGroup"]));
  });

  it("enforces the maximum family size", () => {
    const r = registrationSchema(1).safeParse(formToRegistrationDraft(form()));
    expect(r.success).toBe(false);
  });
});

describe("CSV export", () => {
  it("adds a BOM, quotes, and neutralises spreadsheet formulas", () => {
    const csv = toCsv([{ name: 'Ani "A", B', phone: "+31612345678", note: "=HYPERLINK(1)" }]);
    expect(csv.startsWith("﻿name,phone,note\r\n")).toBe(true);
    expect(csv).toContain('"Ani ""A"", B"');
    expect(csv).toContain("'+31612345678");
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});

describe("Turnstile verification", () => {
  const fake = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

  it("passes only when Cloudflare says success", async () => {
    expect((await verifyTurnstile("s", "tok", null, fake({ success: true }))).success).toBe(true);
    expect((await verifyTurnstile("s", "tok", null, fake({ success: false, "error-codes": ["timeout-or-duplicate"] }))).errorCodes).toEqual(["timeout-or-duplicate"]);
  });

  it("trims whitespace/line breaks around the secret and the token before sending them", async () => {
    let sent: FormData | undefined;
    const spy = (async (_url: string, init: { body: FormData }) => {
      sent = init.body;
      return new Response(JSON.stringify({ success: true }));
    }) as unknown as typeof fetch;
    expect((await verifyTurnstile("  secret-value\r\n", "\ttoken-value \n", null, spy)).success).toBe(true);
    expect(sent?.get("secret")).toBe("secret-value");
    expect(sent?.get("response")).toBe("token-value");
    expect((await verifyTurnstile("  \r\n", "tok", null, spy)).errorCodes).toEqual(["missing-secret"]);
  });

  it("fails closed without token or secret", async () => {
    expect((await verifyTurnstile("s", null, null, fake({ success: true }))).success).toBe(false);
    expect((await verifyTurnstile(undefined, "tok", null, fake({ success: true }))).success).toBe(false);
  });
});

describe("admin login helpers", () => {
  it("only allows relative /admin destinations after login", () => {
    expect(safeNextPath("/admin/registrations?status=accepted")).toBe("/admin/registrations?status=accepted");
    expect(safeNextPath("/admin")).toBe("/admin");
    for (const bad of [
      null,
      "",
      "https://evil.example/admin",
      "//evil.example/admin",
      "/\\evil.example",
      "/e/kajian",
      "/administrator",
      "/admin/login",
      "/admin/logout",
      "/admin/auth/google/callback",
      "javascript:alert(1)",
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe("/admin");
    }
    expect(loginPath("/admin")).toBe("/admin/login");
    expect(loginPath("/admin/export")).toBe("/admin/login?next=%2Fadmin%2Fexport");
  });

  it("normalises codes and generates uniform 6-digit codes", () => {
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    expect(normalizeCode("12345")).toBeNull();
    expect(normalizeCode("12345a")).toBeNull();
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("reads cookies and rejects cross-site posts", () => {
    const req = new Request("https://admin.example/admin", {
      method: "POST",
      headers: { Cookie: "a=1; __Host-ppme_admin=tok%2Ben; b=2", Origin: "https://evil.example" },
    });
    expect(readCookie(req, "__Host-ppme_admin")).toBe("tok+en");
    expect(readCookie(req, "missing")).toBeNull();
    expect(isSameOrigin(req)).toBe(false);
    expect(isSameOrigin(new Request("https://admin.example/admin", { headers: { Origin: "https://admin.example" } }))).toBe(true);
    expect(isSameOrigin(new Request("https://admin.example/admin"))).toBe(true);
  });

  it("issues host-only secure cookies on https and plain ones on http", () => {
    const https = sessionCookie(new Request("https://admin.example/admin"), "abc");
    expect(https).toMatch(/^__Host-ppme_admin=abc; Path=\/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure$/);
    const http = sessionCookie(new Request("http://localhost:5173/admin"), "abc");
    expect(http).toBe("ppme_admin=abc; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax");
    expect(clearSessionCookie(new Request("https://admin.example/"))).toContain("Max-Age=0");
  });

  it("enables Google sign-in only with both client id and secret", () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: "id" })).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: " id ", GOOGLE_CLIENT_SECRET: "s" })).toEqual({ clientId: "id", clientSecret: "s" });
  });

  describe("Google sign-in realms", () => {
    const cfg = { clientId: "id", clientSecret: "s" };
    const start = async (origin: string, realm: "admin" | "viewer" | "scanner") => {
      const res = await startGoogleLogin(new Request(`${origin}/x`), cfg, "/admin/registrations", realm);
      const cookie = res.headers.get("Set-Cookie") ?? "";
      const loc = new URL(res.headers.get("Location") ?? "");
      return { cookie, loc, state: loc.searchParams.get("state") ?? "" };
    };
    const callback = (origin: string, path: string, cookie: string, state: string) =>
      new Request(`${origin}${path}?code=c&state=${state}`, { headers: { Cookie: cookie.split(";")[0] } });

    it("sends admin and panitia through the admin callback, scanners through their own", async () => {
      const admin = await start("https://admin.example", "admin");
      const viewer = await start("https://admin.example", "viewer");
      const scanner = await start("https://scan.example", "scanner");
      expect(admin.loc.searchParams.get("redirect_uri")).toBe("https://admin.example/admin/auth/google/callback");
      expect(viewer.loc.searchParams.get("redirect_uri")).toBe("https://admin.example/admin/auth/google/callback");
      expect(scanner.loc.searchParams.get("redirect_uri")).toBe("https://scan.example/scan/auth/google/callback");
      expect(viewer.cookie).toContain("Path=/admin/auth/google");
      expect(scanner.cookie).toContain("Path=/scan/auth/google");
    });

    it("refuses a flow that belongs to the other host (no token exchange attempted)", async () => {
      const fetcher = (() => {
        throw new Error("must not call Google");
      }) as unknown as typeof fetch;
      const scanner = await start("https://scan.example", "scanner");
      const onAdmin = await finishGoogleLogin(
        callback("https://scan.example", "/admin/auth/google/callback", scanner.cookie, scanner.state),
        new URL(`https://scan.example/admin/auth/google/callback?code=c&state=${scanner.state}`),
        cfg,
        fetcher,
        "admin",
      );
      expect(onAdmin).toMatchObject({ ok: false, error: "state" });
      expect(onAdmin.ok === false && onAdmin.realm).toBeUndefined();

      const viewer = await start("https://admin.example", "viewer");
      const onScanner = await finishGoogleLogin(
        callback("https://admin.example", "/scan/auth/google/callback", viewer.cookie, viewer.state),
        new URL(`https://admin.example/scan/auth/google/callback?code=c&state=${viewer.state}`),
        cfg,
        fetcher,
        "scanner",
      );
      expect(onScanner).toMatchObject({ ok: false, error: "state" });
    });

    it("reports the realm on a cancelled flow so the person returns to their own login page", async () => {
      const viewer = await start("https://admin.example", "viewer");
      const res = await finishGoogleLogin(
        new Request("https://admin.example/admin/auth/google/callback?error=access_denied", { headers: { Cookie: viewer.cookie.split(";")[0] } }),
        new URL("https://admin.example/admin/auth/google/callback?error=access_denied"),
        cfg,
      );
      expect(res).toEqual({ ok: false, error: "cancelled", realm: "viewer" });
    });
  });

  it("describes the requesting device and country for the email", () => {
    const chromeWin =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    expect(describeDevice(chromeWin)).toBe("Chrome di Windows");
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Safari/604.1")).toBe(
      "Safari di iOS",
    );
    expect(describeDevice(null)).toBeNull();
    expect(countryName("NL")).toBe("Belanda");
    expect(countryName("XX")).toBeNull();
  });
});

describe("bank details configuration", () => {
  const env = (accountName?: string, iban?: string) =>
    ({ BANK_ACCOUNT_NAME: accountName, BANK_IBAN: iban }) as Parameters<typeof bankConfigured>[0];

  it("is configured only when both values are real", () => {
    expect(bankConfigured(env("Stichting PPME", "NL91 ABNA 0417 1643 00"))).toBe(true);
    expect(bankConfigured(env("Stichting PPME", ""))).toBe(false);
    expect(bankConfigured(env(undefined, "NL91 ABNA 0417 1643 00"))).toBe(false);
    expect(bankConfigured(env(undefined, undefined))).toBe(false);
  });

  it("treats the template placeholders as not configured", () => {
    expect(bankConfigured(env("REPLACE_WITH_ACCOUNT_NAME", "NL91 ABNA 0417 1643 00"))).toBe(false);
    expect(bankConfigured(env("Stichting PPME", "REPLACE_WITH_IBAN"))).toBe(false);
  });
});

describe("feature switches (public form / admin)", () => {
  it("both are on by default and only the string \"false\" turns one off", () => {
    expect(featureEnabled({}, "public")).toBe(true);
    expect(featureEnabled({}, "admin")).toBe(true);
    expect(featureEnabled({ ENABLE_ADMIN: "false" }, "admin")).toBe(false);
    expect(featureEnabled({ ENABLE_ADMIN: " FALSE " }, "admin")).toBe(false);
    expect(featureEnabled({ ENABLE_PUBLIC: "false" }, "public")).toBe(false);
    for (const v of ["true", "", "0", "no", "off"]) {
      expect(featureEnabled({ ENABLE_ADMIN: v, ENABLE_PUBLIC: v }, "admin")).toBe(true);
    }
  });

  it("the two switches are independent", () => {
    const publicOnly = { ENABLE_ADMIN: "false" };
    const adminOnly = { ENABLE_PUBLIC: "false" };
    expect([featureEnabled(publicOnly, "public"), featureEnabled(publicOnly, "admin")]).toEqual([true, false]);
    expect([featureEnabled(adminOnly, "public"), featureEnabled(adminOnly, "admin")]).toEqual([false, true]);
  });
});

describe("front-end validation messages", () => {
  const ok = {
    registrantName: "Budi",
    membership: "Ya",
    email: "budi@example.com",
    whatsapp: "+31612345678",
    participants: [{ name: "Budi", gender: "laki-laki", ageGroup: "dewasa" }],
    consent: true,
    mediaConsent: true,
    marketingOptIn: false,
    idempotencyKey: undefined,
  };

  it("accepts a valid draft", () => {
    expect(validateRegistrationDraft(ok, 8)).toEqual({});
  });

  it("gives Indonesian messages for empty and malformed fields", () => {
    const errors = validateRegistrationDraft(
      { ...ok, registrantName: " ", membership: "", email: "x", whatsapp: "", consent: false, mediaConsent: false,
        participants: [{ name: "", gender: "", ageGroup: "" }] },
      8,
    );
    expect(errors).toMatchObject({
      registrantName: "Nama pendaftar wajib diisi.",
      membership: "Pilih status keanggotaan.",
      email: "Format email tidak valid. Contoh: nama@email.com.",
      whatsapp: "Nomor WhatsApp wajib diisi.",
      consent: "Persetujuan privasi wajib dicentang.",
      mediaConsent: "Pemberitahuan dokumentasi dan siaran langsung wajib dicentang.",
      "participants.0.name": "Nama peserta wajib diisi.",
      "participants.0.gender": "Jenis kelamin wajib dipilih.",
      "participants.0.ageGroup": "Kelompok usia wajib dipilih.",
    });
  });
});

describe("CSV export in Indonesian", () => {
  it("translates codes, times and amounts", () => {
    const { rows, columns } = exportRowsToIndonesian([
      { registration_id: "r1", created_at: "2026-11-11T22:14:00.000Z", category: "member", source: "online",
        registration_status: "accepted", payment_status: "free", amount_cents: 1250, gender: "perempuan",
        participant_status: "accepted", age_group: "anak" },
    ]);
    expect(columns[0]).toBe("ID Pendaftaran");
    expect(rows[0]).toMatchObject({
      "Waktu Daftar": "11-11-2026 23:14", Keanggotaan: "anggota", "Status Pendaftaran": "diterima",
      "Status Pembayaran": "gratis", "Jumlah (€)": "12,50", "Jenis Kelamin": "perempuan", "Status Peserta": "diterima",
    });
    expect(exportRowsToIndonesian([]).columns.length).toBe(columns.length);
  });
});

describe("dashboard chart data", () => {
  it("daysUntil counts Netherlands calendar days", () => {
    const start = "2026-12-05T08:00:00.000Z";
    expect(daysUntil(start, new Date("2026-11-13T10:00:00.000Z"))).toBe(22);
    expect(daysUntil(start, new Date("2026-12-05T06:00:00.000Z"))).toBe(0);
    expect(daysUntil(start, new Date("2026-12-06T10:00:00.000Z"))).toBe(-1);
    // 23:30 UTC on 4 Dec is already 5 Dec in the Netherlands
    expect(daysUntil(start, new Date("2026-12-04T23:30:00.000Z"))).toBe(0);
  });

  it("buildTimeline groups people per local day and fills gaps up to today", () => {
    const t = buildTimeline(
      [
        { created_at: "2026-11-10T10:00:00.000Z", is_member: 1, people: 2 },
        { created_at: "2026-11-10T23:30:00.000Z", is_member: 0, people: 3 }, // 11 Nov in the Netherlands
        { created_at: "2026-11-12T09:00:00.000Z", is_member: 0, people: 1 },
      ],
      new Date("2026-11-13T10:00:00.000Z"),
    );
    expect(t).toEqual([
      { date: "2026-11-10", member: 2, nonMember: 0 },
      { date: "2026-11-11", member: 0, nonMember: 3 },
      { date: "2026-11-12", member: 0, nonMember: 1 },
      { date: "2026-11-13", member: 0, nonMember: 0 },
    ]);
    expect(buildTimeline([], new Date())).toEqual([]);
  });
});

describe("Hijri date", () => {
  it("5 Dec 2026 is 25 Jumadil Akhir 1448 H (Umm al-Qura), in Amsterdam time", () => {
    expect(formatHijriDate("2026-12-05T08:00:00.000Z")).toBe("25 Jumadil Akhir 1448");
    expect(formatHijriDate("2026-12-04T08:00:00.000Z")).toBe("24 Jumadil Akhir 1448");
    expect(formatHijriDate("not a date")).toBe("");
  });
});

describe("quota seats", () => {
  it("only remaja and dewasa count", () => {
    expect(seatCount([{ ageGroup: "dewasa" }, { ageGroup: "remaja" }, { ageGroup: "anak" }, { ageGroup: "balita" }])).toBe(2);
    expect(seatCount([{ ageGroup: "anak" }, { ageGroup: "balita" }])).toBe(0);
  });
});

describe("add to calendar", () => {
  const ev = {
    slug: "kajian-aisah-dahlan-2026",
    title: "Kajian PPME Den Haag 2026",
    speaker: "dr. Aisah Dahlan",
    theme: "Perbedaan otak laki-laki dan perempuan, tes; koma",
    starts_at: "2026-12-05T08:00:00.000Z",
    ends_at: "2026-12-05T13:30:00.000Z",
    info_url: null,
    location_name: "Masjid Al Hikmah",
    location_address: "Medlerstraat 4, 2531 HA Den Haag",
    location_map_url: "https://maps.app.goo.gl/7nLnjw15QhfiC6tA7",
  };

  it("puts the location in the .ics (escaped), the description and both web links", () => {
    const ics = buildIcs(ev, new Date("2026-11-20T10:00:00.000Z")).replace(/\r\n /g, "");
    expect(ics).toContain(String.raw`LOCATION:Masjid Al Hikmah\, Medlerstraat 4\, 2531 HA Den Haag`);
    expect(ics).toContain("Peta: https://maps.app.goo.gl/7nLnjw15QhfiC6tA7");
    const { google, outlook } = calendarLinks(ev);
    expect(new URL(google).searchParams.get("location")).toBe("Masjid Al Hikmah, Medlerstraat 4, 2531 HA Den Haag");
    expect(new URL(outlook).searchParams.get("location")).toBe("Masjid Al Hikmah, Medlerstraat 4, 2531 HA Den Haag");
    // no location set: no LOCATION line, no location parameter
    const none = { ...ev, location_name: null, location_address: null, location_map_url: null };
    expect(buildIcs(none)).not.toContain("LOCATION:");
    expect(new URL(calendarLinks(none).google).searchParams.has("location")).toBe(false);
  });

  it("builds a valid, escaped, folded .ics with UTC times and a stable UID", () => {
    const ics = buildIcs(ev, new Date("2026-11-20T10:00:00.000Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:kajian-aisah-dahlan-2026@event.ppmedenhaag.nl");
    expect(ics).toContain("DTSTART:20261205T080000Z");
    expect(ics).toContain("DTEND:20261205T133000Z");
    expect(ics).toContain("DTSTAMP:20261120T100000Z");
    expect(ics).toContain("SUMMARY:Kajian PPME Den Haag 2026 bersama dr. Aisah Dahlan");
    expect(ics.replace(/\r\n /g, "")).toContain(String.raw`otak laki-laki dan perempuan\, tes\; koma`); // , and ; escaped
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).not.toMatch(/[^\r]\n/); // CRLF only
    expect(ics).toContain("TRIGGER:-P1D");
  });

  it("links prefill Google Calendar and Outlook.com with the event time in UTC and carry no personal data", () => {
    const { google, outlook } = calendarLinks(ev);
    const g = new URL(google);
    expect(g.origin + g.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(g.searchParams.get("dates")).toBe("20261205T080000Z/20261205T133000Z");
    expect(g.searchParams.get("text")).toContain("Kajian PPME Den Haag 2026");
    const o = new URL(outlook);
    expect(o.origin).toBe("https://outlook.live.com");
    expect(o.searchParams.get("startdt")).toBe("2026-12-05T08:00:00.000Z");
    expect(o.searchParams.get("enddt")).toBe("2026-12-05T13:30:00.000Z");
  });
});
