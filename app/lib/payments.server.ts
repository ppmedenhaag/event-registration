import { auditStatement, getParticipants, getRegistration } from "./db.server";
import { newTicketToken } from "./ids";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * FR-PAY-3: admin confirms a bank transfer for a pending non-member registration.
 * Every write is conditional on the registration still being pending and inside its deadline,
 * so a concurrent expiry run and a confirmation can never both win.
 */
export async function confirmPayment(
  db: D1Database,
  registrationId: string,
  actor: string,
  now = new Date(),
): Promise<ActionResult> {
  const nowIso = now.toISOString();
  const reg = await getRegistration(db, registrationId);
  if (!reg) return { ok: false, message: "Pendaftaran tidak ditemukan." };
  if (reg.status !== "pending_payment" || reg.payment_status !== "pending") {
    return { ok: false, message: "Pendaftaran ini tidak sedang menunggu pembayaran." };
  }
  if (!reg.pay_deadline || reg.pay_deadline <= nowIso) {
    return { ok: false, message: "Batas pembayaran sudah lewat. Pendaftaran tidak dapat diaktifkan." };
  }
  const participants = await getParticipants(db, registrationId);
  if (participants.length !== reg.people || participants.some((p) => p.status !== "pending_payment")) {
    return { ok: false, message: "Data peserta tidak sesuai. Periksa data terlebih dahulu." };
  }

  const confirmed = `EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'accepted' AND paid_at = ? AND confirmed_by = ?)`;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE registrations SET status = 'accepted', payment_status = 'paid', paid_at = ?, confirmed_by = ?
         WHERE id = ? AND status = 'pending_payment' AND payment_status = 'pending' AND pay_deadline > ?
           AND edit_rev IS ?`, // a self-service edit since the participants were read makes this a no-op (reload)
      )
      .bind(nowIso, actor, registrationId, nowIso, reg.edit_rev),
    ...participants.map((p) =>
      db
        .prepare(
          `UPDATE participants SET status = 'accepted', qr_token = ?
           WHERE id = ? AND status = 'pending_payment' AND ${confirmed}`,
        )
        .bind(newTicketToken(), p.id, registrationId, nowIso, actor),
    ),
    db
      .prepare(
        `INSERT INTO email_log (registration_id, kind, status, attempts, updated_at)
         SELECT ?, 'confirmation', 'pending', 0, ? WHERE ${confirmed}
         ON CONFLICT (registration_id, kind) DO NOTHING`,
      )
      .bind(registrationId, nowIso, registrationId, nowIso, actor),
    auditStatement(db, actor, "payment.confirm", registrationId, { code: reg.payment_code }, nowIso),
  ]);

  if ((results[0].meta.changes ?? 0) !== 1) {
    return { ok: false, message: "Status pendaftaran berubah. Muat ulang halaman dan coba lagi." };
  }
  return { ok: true, message: "Pembayaran berhasil dikonfirmasi." };
}

/**
 * Admin validates a member: the registration becomes accepted, the participants get their ticket codes and the
 * confirmation (QR) email is queued, all in ONE batch. Two starting points:
 *  - 'pending_membership' (normal flow): the member registered and waits for validation. The seats are already held,
 *    so the quota is untouched; conditional on `edit_rev` so a self-service edit made since the admin loaded the
 *    participants cannot leave a participant without a ticket.
 *  - 'rejected_membership' (admin changed their mind): participants were 'rejected', the seat was released and the
 *    email may have been taken meanwhile. Not re-checked against quota: it is an explicit admin decision.
 * Creating the tickets here is cheap SQL; generating the QR images and sending is the outbox's job (deliverEmail, or
 * the cron sweeper), so validating many members in a row never touches the Worker CPU limit.
 */
async function activateMember(
  db: D1Database,
  registrationId: string,
  actor: string,
  nowIso: string,
): Promise<ActionResult & { activated?: true }> {
  const reg = await getRegistration(db, registrationId);
  const from = reg?.status;
  if (!reg || !reg.is_member || (from !== "pending_membership" && from !== "rejected_membership")) {
    return { ok: false, message: "Pendaftaran tidak ditemukan atau statusnya sudah berubah." };
  }
  if (from === "rejected_membership" && reg.email) {
    const clash = await db
      .prepare(
        `SELECT 1 AS x FROM registrations WHERE event_id = ? AND lower(email) = lower(?) AND id != ?
           AND status IN ('accepted', 'pending_payment', 'pending_membership')`,
      )
      .bind(reg.event_id, reg.email, registrationId)
      .first();
    if (clash) return { ok: false, message: "Email ini sudah dipakai pendaftaran aktif lain; tidak dapat diaktifkan kembali." };
  }
  const participants = await getParticipants(db, registrationId);
  const fromParticipant = from === "pending_membership" ? "pending_membership" : "rejected";
  if (participants.length !== reg.people || participants.some((p) => p.status !== fromParticipant)) {
    return { ok: false, message: "Data peserta tidak sesuai. Muat ulang halaman dan periksa data terlebih dahulu." };
  }
  const active = `EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'accepted' AND membership_verified_at = ? AND membership_verified_by = ?)`;
  try {
    const res = await db.batch([
      db
        .prepare(
          `UPDATE registrations SET status = 'accepted', payment_status = 'free', membership_verified_at = ?,
             membership_verified_by = ?, updated_at = ?
           WHERE id = ? AND is_member = 1 AND status = ? AND edit_rev IS ?`,
        )
        .bind(nowIso, actor, nowIso, registrationId, from, reg.edit_rev),
      ...participants.map((p) =>
        db
          .prepare(`UPDATE participants SET status = 'accepted', qr_token = ? WHERE id = ? AND status = ? AND ${active}`)
          .bind(newTicketToken(), p.id, fromParticipant, registrationId, nowIso, actor),
      ),
      db
        .prepare(
          `INSERT INTO email_log (registration_id, kind, status, attempts, updated_at)
           SELECT ?, 'confirmation', 'pending', 0, ? WHERE ${active}
           ON CONFLICT (registration_id, kind) DO UPDATE SET status = 'pending', attempts = 0, sent_at = NULL,
             last_error = NULL, provider_id = NULL, updated_at = excluded.updated_at`,
        )
        .bind(registrationId, nowIso, registrationId, nowIso, actor),
      db
        .prepare(
          `INSERT INTO audit_log (at, actor, action, target, detail)
           SELECT ?, ?, 'membership.verify', ?, ? WHERE ${active}`,
        )
        .bind(nowIso, actor, registrationId, JSON.stringify({ from }), registrationId, nowIso, actor),
    ]);
    if ((res[0].meta.changes ?? 0) !== 1) {
      return { ok: false, message: "Status pendaftaran berubah. Muat ulang halaman dan coba lagi." };
    }
  } catch {
    return { ok: false, message: "Gagal mengaktifkan pendaftaran (email sudah dipakai pendaftaran lain?)." };
  }
  return {
    ok: true,
    activated: true,
    message:
      from === "rejected_membership"
        ? "Keanggotaan valid; pendaftaran diaktifkan kembali dan QR Code baru dikirim."
        : "Keanggotaan divalidasi; pendaftaran diterima dan QR Code dikirim.",
  };
}

/**
 * FR-ADM-18 / N6: admin validates the member claim. For a member waiting for validation (and for a rejected one) this
 * accepts the registration and queues the QR email (`activated`). For a legacy accepted member (registered before
 * validation came first) it only records that the claim was checked.
 */
export async function setMembershipVerified(
  db: D1Database,
  registrationId: string,
  actor: string,
  verified: boolean,
  now = new Date(),
): Promise<ActionResult & { activated?: true }> {
  const nowIso = now.toISOString();
  if (verified) {
    const current = await getRegistration(db, registrationId);
    if (current?.status === "pending_membership" || current?.status === "rejected_membership") {
      return activateMember(db, registrationId, actor, nowIso);
    }
  }
  const res = await db.batch([
    db
      .prepare(
        `UPDATE registrations SET membership_verified_at = ?, membership_verified_by = ?
         WHERE id = ? AND is_member = 1 AND status = 'accepted'`,
      )
      .bind(verified ? nowIso : null, verified ? actor : null, registrationId),
    auditStatement(db, actor, verified ? "membership.verify" : "membership.unverify", registrationId, undefined, nowIso),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) return { ok: false, message: "Bukan pendaftaran anggota yang sudah diterima." };
  return { ok: true, message: verified ? "Keanggotaan ditandai terverifikasi." : "Tanda verifikasi dihapus." };
}

/**
 * Admin could not validate the member claim: the registration becomes 'rejected_membership' (no email for now).
 * Works on a member waiting for validation (normal flow) and on a legacy accepted, unverified member.
 * Participants are rejected and their QR codes removed, the email is released (the unique index only covers active
 * statuses) and the seat is freed. Conditional on the registration still being an unverified, accepted member
 * with nobody checked in, so a concurrent verify / check-in wins cleanly.
 */
export async function rejectMembership(
  db: D1Database,
  registrationId: string,
  actor: string,
  now = new Date(),
): Promise<ActionResult> {
  const nowIso = now.toISOString();
  const rejected = `EXISTS (SELECT 1 FROM registrations WHERE id = ? AND status = 'rejected_membership' AND updated_at = ?)`;
  const res = await db.batch([
    db
      .prepare(
        `UPDATE registrations SET status = 'rejected_membership', payment_status = 'not_processed', updated_at = ?
         WHERE id = ? AND is_member = 1 AND status IN ('accepted', 'pending_membership') AND membership_verified_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.registration_id = registrations.id AND p.checked_in_at IS NOT NULL)`,
      )
      .bind(nowIso, registrationId),
    db
      .prepare(
        `INSERT OR IGNORE INTO revoked_tickets (code, event_id, reason, revoked_at)
         SELECT p.qr_token, r.event_id, 'membership_rejected', ? FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE p.registration_id = ? AND p.qr_token IS NOT NULL AND ${rejected}`,
      )
      .bind(nowIso, registrationId, registrationId, nowIso),
    db
      .prepare(`UPDATE participants SET status = 'rejected', qr_token = NULL WHERE registration_id = ? AND ${rejected}`)
      .bind(registrationId, registrationId, nowIso),
    db
      .prepare(
        `INSERT INTO audit_log (at, actor, action, target, detail)
         SELECT ?, ?, 'membership.reject', ?, NULL WHERE ${rejected}`,
      )
      .bind(nowIso, actor, registrationId, registrationId, nowIso),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) {
    return { ok: false, message: "Tidak dapat ditolak: bukan anggota yang belum diverifikasi, sudah check-in, atau status sudah berubah." };
  }
  return { ok: true, message: "Pendaftaran ditolak (keanggotaan tidak valid)." };
}

/**
 * Permanently deletes a registration with its participants and email log (admin only). The deletion is written to the
 * audit log first, and every delete is gated on that audit row, so it is all-or-nothing. Refused once anyone checked in.
 */
export async function deleteRegistration(
  db: D1Database,
  registrationId: string,
  actor: string,
  now = new Date(),
): Promise<ActionResult> {
  const nowIso = now.toISOString();
  const reg = await getRegistration(db, registrationId);
  if (!reg) return { ok: false, message: "Pendaftaran tidak ditemukan." };
  const logged = `EXISTS (SELECT 1 FROM audit_log WHERE at = ? AND actor = ? AND action = 'registration.delete' AND target = ?)`;
  // No name here on purpose (data minimisation): the audit log must not keep the personal data this delete removes.
  const detail = JSON.stringify({
    status: reg.status,
    people: reg.people,
    member: !!reg.is_member,
    source: reg.source,
  });
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO audit_log (at, actor, action, target, detail)
         SELECT ?, ?, 'registration.delete', ?, ? WHERE EXISTS (SELECT 1 FROM registrations WHERE id = ?)
           AND NOT EXISTS (SELECT 1 FROM participants WHERE registration_id = ? AND checked_in_at IS NOT NULL)`,
      )
      .bind(nowIso, actor, registrationId, detail, registrationId, registrationId),
    // Remember the ticket codes (scanners then see "ticket cancelled" instead of "unknown"); same batch, gated on the audit row.
    db
      .prepare(
        `INSERT OR IGNORE INTO revoked_tickets (code, event_id, reason, revoked_at)
         SELECT p.qr_token, ?, 'admin_deleted', ? FROM participants p WHERE p.registration_id = ? AND p.qr_token IS NOT NULL AND ${logged}`,
      )
      .bind(reg.event_id, nowIso, registrationId, nowIso, actor, registrationId),
    db.prepare(`DELETE FROM participants WHERE registration_id = ? AND ${logged}`).bind(registrationId, nowIso, actor, registrationId),
    db.prepare(`DELETE FROM email_log WHERE registration_id = ? AND ${logged}`).bind(registrationId, nowIso, actor, registrationId),
    db.prepare(`DELETE FROM dev_outbox WHERE registration_id = ? AND ${logged}`).bind(registrationId, nowIso, actor, registrationId),
    db.prepare(`DELETE FROM registrations WHERE id = ? AND ${logged}`).bind(registrationId, nowIso, actor, registrationId),
  ]);
  if ((res[0].meta.changes ?? 0) !== 1) {
    return { ok: false, message: "Tidak dapat dihapus: sudah ada peserta yang check-in atau data sudah berubah." };
  }
  return { ok: true, message: "Pendaftaran dihapus." };
}
