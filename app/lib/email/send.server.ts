import { AGE_GROUP_SHORT } from "../format";
import { getEventById, getParticipants, getRegistration } from "../db.server";
import { bytesToBase64 } from "../png";
import { calendarLinks, icsAttachment } from "./calendar";
import { qrPng } from "../qr";
import { selfEditState } from "../self-service.server";
import {
  confirmationEmail,
  membershipPendingEmail,
  type ManageInfo,
  expiredEmail,
  paymentInstructionsEmail,
  reminderEmail,
  type BankInfo,
} from "./templates";

export type EmailKind = "confirmation" | "payment_instructions" | "reminder" | "expired" | "membership_pending";

export interface EmailConfig {
  mode: "log" | "resend";
  from: string;
  replyTo: string;
  resendApiKey?: string;
  bank: BankInfo;
  /** Public origin for links in emails ("Pendaftaran saya"); links are left out when unset. */
  publicUrl?: string;
  /** Admin origin for buttons in emails to admins (retention warnings); the buttons are left out when unset. */
  adminUrl?: string;
}

export interface Attachment {
  filename: string;
  contentBase64: string;
  /** Set for images referenced from the HTML (cid:); left out for ordinary attachments such as the .ics file. */
  contentId?: string;
  contentType: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative (better deliverability and accessibility). */
  text?: string;
  attachments: Attachment[];
}

export const MAX_EMAIL_ATTEMPTS = 5;

async function buildEmail(db: D1Database, cfg: EmailConfig, registrationId: string, kind: EmailKind, now = new Date()) {
  const reg = await getRegistration(db, registrationId);
  if (!reg) throw new Error("Pendaftaran tidak ditemukan.");
  if (!reg.email) throw new Error("Pendaftaran tidak memiliki alamat email.");
  const event = await getEventById(db, reg.event_id);
  if (!event) throw new Error("Acara tidak ditemukan.");
  const state = selfEditState(reg, event, now);
  const manage: ManageInfo = {
    url: cfg.publicUrl ? `${cfg.publicUrl}/e/${event.slug}/pendaftaran-saya` : null,
    editable: state.editable,
    until: state.editable ? state.until : null,
    paid: !state.editable && state.reason === "paid",
    contact: cfg.replyTo,
    // Shown when the email went out because of a self-service edit (edits always happen before a payment).
    // (a payment confirmation or a membership validation after the last edit makes the email "new", not "updated")
    updated:
      !!reg.updated_at &&
      (!reg.paid_at || reg.updated_at > reg.paid_at) &&
      (!reg.membership_verified_at || reg.updated_at > reg.membership_verified_at),
  };
  const rev = reg.edit_rev;

  if (kind === "membership_pending") {
    if (reg.status !== "pending_membership") throw new Error("Pendaftaran ini tidak sedang menunggu validasi anggota.");
    const people = (await getParticipants(db, registrationId)).length;
    const { subject, html } = membershipPendingEmail({
      event,
      registrantName: reg.registrant_name,
      people,
      manage,
      contact: cfg.replyTo,
      origin: cfg.publicUrl,
    });
    return { to: reg.email, subject, html, attachments: [], rev };
  }

  if (kind === "confirmation") {
    if (reg.status !== "accepted") throw new Error("Pendaftaran ini belum diterima.");
    const participants = (await getParticipants(db, registrationId)).filter(
      (p) => p.status === "accepted" && p.qr_token,
    );
    if (participants.length === 0) throw new Error("Tidak ada peserta dengan QR code.");
    const category = reg.is_member ? "Anggota PPME Den Haag" : "Non-anggota";
    const attachments: Attachment[] = [];
    for (const [i, p] of participants.entries()) {
      const png = await qrPng(p.qr_token!);
      attachments.push({
        filename: `qr-peserta-${i + 1}.png`,
        contentBase64: bytesToBase64(png),
        contentId: `qr${i + 1}`,
        contentType: "image/png",
      });
    }
    const { subject, html } = confirmationEmail({
      event,
      registrantName: reg.registrant_name,
      participants: participants.map((p, i) => ({
        name: p.full_name,
        ageGroup: AGE_GROUP_SHORT[p.age_group] ?? p.age_group,
        category,
        cid: `qr${i + 1}`,
      })),
      calendar: calendarLinks(event),
      member: reg.is_member === 1,
      manage,
      contact: cfg.replyTo,
      origin: cfg.publicUrl,
    });
    attachments.push(icsAttachment(event, now)); // "add to calendar" for Apple/Outlook/Thunderbird (and Google via import)
    return { to: reg.email, subject, html, attachments, rev };
  }

  if (!reg.payment_code || !reg.pay_deadline) throw new Error("Pendaftaran ini tidak memiliki data pembayaran.");

  if (kind === "payment_instructions") {
    const { subject, html } = paymentInstructionsEmail({
      event,
      registrantName: reg.registrant_name,
      people: reg.people,
      amountCents: reg.amount_cents,
      paymentCode: reg.payment_code,
      payDeadline: reg.pay_deadline,
      bank: cfg.bank,
      manage,
      contact: cfg.replyTo,
      origin: cfg.publicUrl,
    });
    return { to: reg.email, subject, html, attachments: [], rev };
  }
  if (kind === "reminder") {
    const { subject, html } = reminderEmail({
      event,
      registrantName: reg.registrant_name,
      amountCents: reg.amount_cents,
      paymentCode: reg.payment_code,
      payDeadline: reg.pay_deadline,
      bank: cfg.bank,
      manage,
      contact: cfg.replyTo,
      origin: cfg.publicUrl,
    });
    return { to: reg.email, subject, html, attachments: [], rev };
  }
  const { subject, html } = expiredEmail({
    event,
    registrantName: reg.registrant_name,
    paymentCode: reg.payment_code,
    contact: cfg.replyTo,
    origin: cfg.publicUrl,
  });
  return { to: reg.email, subject, html, attachments: [], rev };
}

async function transport(
  db: D1Database,
  cfg: EmailConfig,
  msg: OutgoingEmail,
  meta: { registrationId: string | null; kind: string; idempotencyKey: string },
): Promise<string> {
  if (cfg.mode === "log") {
    const res = await db
      .prepare(
        `INSERT INTO dev_outbox (created_at, registration_id, kind, to_address, subject, html, attachments_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        new Date().toISOString(),
        meta.registrationId,
        meta.kind,
        msg.to,
        msg.subject,
        msg.html,
        JSON.stringify(msg.attachments),
      )
      .run();
    return `outbox:${res.meta.last_row_id}`;
  }

  if (!cfg.resendApiKey) throw new Error("RESEND_API_KEY belum diatur.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": meta.idempotencyKey,
    },
    body: JSON.stringify({
      from: cfg.from,
      to: [msg.to],
      reply_to: cfg.replyTo,
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
      attachments: msg.attachments.map((a) => ({
        filename: a.filename,
        content: a.contentBase64,
        ...(a.contentId ? { content_id: a.contentId } : {}),
        content_type: a.contentType,
      })),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) throw new Error(`Resend ${response.status}: ${body.message ?? "unknown error"}`);
  return body.id ?? "";
}

/**
 * Send an email that belongs to no registration (admin login codes). Deliberately NOT part of the outbox: a login code
 * is short-lived and worthless after 10 minutes, so on failure the caller drops it and the user asks for a new one.
 * EMAIL_MODE=log stores it in dev_outbox like every other email.
 */
export async function sendDirectEmail(
  db: D1Database,
  cfg: EmailConfig,
  msg: OutgoingEmail,
  meta: { kind: string; idempotencyKey: string },
): Promise<string> {
  return transport(db, cfg, msg, { registrationId: null, ...meta });
}

/** Another sender (fast path, cron, admin) that claimed a row less than this long ago owns it. */
export const EMAIL_LEASE_MS = 60_000;

/**
 * Send one email with at-least-once delivery.
 *
 * The email_log row is the outbox: it is created as 'pending' in the same transaction as the change that needs the
 * email (registration, payment approval, expiry), so it can never be lost. This function then
 *  1. CLAIMS the row first. The claim counts the attempt and sets a 60 s lease, so a send that kills the Worker
 *     (CPU limit, eviction) still consumes an attempt and cannot be retried forever, and two senders cannot send the
 *     same email at once (the loser gets skipped:true);
 *  2. builds and sends;
 *  3. marks the row 'sent' or 'failed'. Anything left 'pending'/'failed' is picked up by the 5-minute cron job.
 * `force` (admin "resend") ignores sent status, lease and attempt cap.
 */
export async function deliverEmail(
  db: D1Database,
  cfg: EmailConfig,
  registrationId: string,
  kind: EmailKind,
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const force = opts.force ? 1 : 0;

  const claim = await db
    .prepare(
      `INSERT INTO email_log (registration_id, kind, status, attempts, updated_at)
       VALUES (?, ?, 'pending', 1, ?)
       ON CONFLICT (registration_id, kind) DO UPDATE SET
         status = 'pending',
         attempts = CASE WHEN ? = 1 THEN 1 ELSE email_log.attempts + 1 END,
         updated_at = excluded.updated_at
       WHERE ? = 1 OR (
         email_log.status != 'sent' AND email_log.attempts < ?
         AND (email_log.attempts = 0 OR email_log.updated_at <= ?))`,
    )
    .bind(
      registrationId,
      kind,
      nowIso,
      force,
      force,
      MAX_EMAIL_ATTEMPTS,
      new Date(now.getTime() - EMAIL_LEASE_MS).toISOString(),
    )
    .run();
  if ((claim.meta.changes ?? 0) === 0) return { ok: true, skipped: true };

  try {
    const { rev, ...msg } = await buildEmail(db, cfg, registrationId, kind, now);
    // The edit revision is part of the key: after a self-service edit the re-queued email has new content and must not
    // be de-duplicated by the provider against the original send (never edited = "v1", as before).
    const providerId = await transport(db, cfg, msg, {
      registrationId,
      kind,
      idempotencyKey: `${registrationId}:${kind}:${opts.force ? nowIso : (rev ?? "v1")}`,
    });
    await db
      .prepare(
        `UPDATE email_log SET status = 'sent', provider_id = ?, sent_at = ?, last_error = NULL, updated_at = ?
         WHERE registration_id = ? AND kind = ?`,
      )
      .bind(providerId, nowIso, nowIso, registrationId, kind)
      .run();
    return { ok: true };
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 500);
    await db
      .prepare(
        `UPDATE email_log SET status = 'failed', last_error = ?, updated_at = ?
         WHERE registration_id = ? AND kind = ?`,
      )
      .bind(message, nowIso, registrationId, kind)
      .run();
    console.error(`email ${kind} for ${registrationId} failed: ${message}`);
    return { ok: false, error: message };
  }
}

/** Statement for a db.batch(): record a pending email for the registration (idempotent). Part of the outbox. */
export function outboxStatement(db: D1Database, registrationId: string, kind: EmailKind, nowIso: string) {
  return db
    .prepare(
      `INSERT INTO email_log (registration_id, kind, status, attempts, updated_at)
       SELECT ?, ?, 'pending', 0, ? WHERE EXISTS (SELECT 1 FROM registrations WHERE id = ?)
       ON CONFLICT (registration_id, kind) DO NOTHING`,
    )
    .bind(registrationId, kind, nowIso, registrationId);
}
