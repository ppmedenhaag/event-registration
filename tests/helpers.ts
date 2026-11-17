import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { getPlatformProxy } from "wrangler";

import type { EventRow } from "../app/lib/db.server";
import type { EmailConfig } from "../app/lib/email/send.server";
import type { RegistrationInput } from "../app/lib/validation";

export async function startDb() {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: "wrangler.jsonc", persist: false });
  const db = proxy.env.DB;
  const dir = join(process.cwd(), "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const stmt of sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(stmt).run();
    }
  }
  return { db, dispose: () => proxy.dispose() };
}

export async function resetDb(db: D1Database, quotas: { member?: number; nonMember?: number } = {}) {
  await db.batch([
    db.prepare("DELETE FROM email_log"),
    db.prepare("DELETE FROM audit_log"),
    db.prepare("DELETE FROM dev_outbox"),
    db.prepare("DELETE FROM admin_sessions"),
    db.prepare("DELETE FROM admin_login_codes"),
    db.prepare("DELETE FROM registrant_sessions"),
    db.prepare("DELETE FROM registrant_login_codes"),
    db.prepare("DELETE FROM admins"),
    db.prepare("DELETE FROM scanners"),
    db.prepare("DELETE FROM scanner_sessions"),
    db.prepare("DELETE FROM scanner_login_codes"),
    db.prepare("DELETE FROM scanner_selftests"),
    db.prepare("DELETE FROM viewers"),
    db.prepare("DELETE FROM viewer_sessions"),
    db.prepare("DELETE FROM viewer_login_codes"),
    db.prepare("DELETE FROM checkin_log"),
    db.prepare("DELETE FROM revoked_tickets"),
    db.prepare("DELETE FROM escalation_contacts"),
    db.prepare("DELETE FROM participants"),
    db.prepare("DELETE FROM registrations"),
    db
      .prepare("UPDATE events SET payment_counter = 0, quota_member = ?, quota_non_member = ?, checkin_enabled = 1, checkin_opens_at = NULL, checkin_closes_at = NULL")
      .bind(quotas.member ?? 200, quotas.nonMember ?? 150),
  ]);
  return (await db.prepare("SELECT * FROM events LIMIT 1").first<EventRow>())!;
}

let seq = 0;
export function input(overrides: Partial<RegistrationInput> & { people?: number } = {}): RegistrationInput {
  const people = overrides.people ?? 1;
  seq++;
  return {
    registrantName: `Peserta Uji ${seq}`,
    membership: "Ya",
    email: `uji${seq}@example.com`,
    whatsapp: "+31612345678",
    participants: Array.from({ length: people }, (_, i) => ({
      name: i === 0 ? `Peserta Uji ${seq}` : `Anak ${i} Uji ${seq}`,
      gender: i % 2 ? "perempuan" : "laki-laki",
      ageGroup: ["dewasa", "remaja"][i % 2],
    })),
    consent: true,
    mediaConsent: true,
    marketingOptIn: false,
    ...overrides,
  } as RegistrationInput;
}

export const emailCfg: EmailConfig = {
  mode: "log",
  from: "Test <test@ppmedenhaag.nl>",
  replyTo: "test@ppmedenhaag.nl",
  bank: { accountName: "PPME Test", iban: "NL00TEST0000000000" },
};

/** Decode a PNG (bytes) and read the QR code in it. */
export function decodeQrPng(png: Uint8Array): string | null {
  const img = PNG.sync.read(Buffer.from(png));
  const result = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  return result?.data ?? null;
}

export const T0 = new Date("2026-11-20T10:00:00.000Z");
export const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);
