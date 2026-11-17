// Emails to ADMINS about the automatic data deletion (privacy policy: participant data is removed 90 days after the event).
// Same look as the other system emails: table layout, inline styles, no web fonts or remote CSS (privacy rule).
// They carry numbers only: never a name, email address or phone number of a participant.
import { escapeHtml } from "./templates";

const BRAND = "#034EA2";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export type WarningStage = "w30" | "w7" | "w1";

export interface RetentionCounts {
  registrations: number;
  participants: number;
  checkedIn: number;
}

interface Shared {
  eventTitle: string;
  /** Purge date, already formatted for display (Europe/Amsterdam). */
  dueText: string;
  counts: RetentionCounts;
  /** Admin origin for the buttons; the buttons are left out when unset. */
  adminUrl?: string;
  replyTo: string;
}

const STAGE_COPY: Record<WarningStage, { tag: string; subject: (t: string, d: string) => string; lead: string }> = {
  w30: {
    tag: "Pengingat",
    subject: (t, d) => `Pengingat: data peserta ${t} akan dihapus otomatis pada ${d}`,
    lead: "Sekitar 30 hari lagi",
  },
  w7: {
    tag: "Penting",
    subject: (t, d) => `Penting: data peserta ${t} dihapus 7 hari lagi (${d})`,
    lead: "Tinggal sekitar 7 hari",
  },
  w1: {
    tag: "Peringatan terakhir",
    subject: (t, d) => `Peringatan terakhir: data peserta ${t} dihapus pada ${d}`,
    lead: "Tinggal sekitar 1 hari",
  },
};

const p = (html: string, mb = 14) =>
  `<p style="margin:0 0 ${mb}px 0;font-family:${FONT};font-size:15px;line-height:24px;color:#334155;">${html}</p>`;

function button(href: string, label: string, primary: boolean) {
  const bg = primary ? BRAND : "#FFFFFF";
  const fg = primary ? "#FFFFFF" : BRAND;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:0 8px 8px 0;"><tr><td style="background-color:${bg};border:1px solid ${BRAND};">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:700;color:${fg};text-decoration:none;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

function frame(subject: string, tag: string, heading: string, body: string, replyTo: string, origin?: string) {
  const logo = origin
    ? `<img src="${escapeHtml(origin)}/logo-ppme.png" width="77" height="40" alt="PPME Den Haag" style="display:block;height:40px;width:auto;">`
    : `<span style="font-family:${FONT};font-size:16px;font-weight:700;color:${BRAND};">PPME Den Haag</span>`;
  return `<!DOCTYPE html>
<html lang="id" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  @media only screen and (max-width:620px) { .container { width:100% !important; } .px { padding-left:24px !important; padding-right:24px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;">
  <tr>
    <td align="center" style="padding:40px 12px;">
      <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background-color:#FFFFFF;border:1px solid #E2E8F0;border-top:4px solid ${BRAND};">
        <tr><td class="px" style="padding:28px 40px 24px 40px;border-bottom:1px solid #E2E8F0;">${logo}</td></tr>
        <tr>
          <td class="px" style="padding:32px 40px 32px 40px;">
            <p style="margin:0 0 10px 0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${BRAND};">${escapeHtml(tag)}</p>
            <h1 style="margin:0 0 20px 0;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:#0F172A;">${escapeHtml(heading)}</h1>
            ${body}
          </td>
        </tr>
      </table>
      <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">
        <tr>
          <td class="px" style="padding:20px 40px 0 40px;font-family:${FONT};font-size:12px;line-height:19px;color:#64748B;text-align:center;">
            Email otomatis ke semua admin Kajian PPME Den Haag. Pertanyaan: <a href="mailto:${escapeHtml(replyTo)}" style="color:#475569;text-decoration:underline;">${escapeHtml(replyTo)}</a>.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

const origin = (adminUrl?: string) => adminUrl?.replace(/\/$/, "");

/** "Data will be deleted on <date>" for one warning stage (30, 7 or 1 day before). */
export function retentionWarningEmail(args: Shared & { stage: WarningStage }) {
  const copy = STAGE_COPY[args.stage];
  const subject = copy.subject(args.eventTitle, args.dueText);
  const base = origin(args.adminUrl);
  const { registrations, participants } = args.counts;

  const body = [
    p("Assalamu’alaikum warahmatullahi wabarakatuh,", 12),
    p(
      `Sesuai Kebijakan Privasi, data pribadi peserta <strong>${escapeHtml(args.eventTitle)}</strong> dihapus otomatis paling lambat 90 hari setelah acara. ` +
        `${copy.lead}: penghapusan dijadwalkan pada <strong>${escapeHtml(args.dueText)}</strong> (waktu Belanda).`,
    ),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;background-color:#F8FAFC;border:1px solid #E2E8F0;"><tr><td style="padding:14px 18px;font-family:${FONT};font-size:14px;line-height:22px;color:#334155;">
      <strong style="color:#0F172A;">Yang akan dihapus permanen:</strong><br>
      ${registrations} pendaftaran dan ${participants} peserta (nama, email, WhatsApp, kode tiket), log email, serta nama dan email pada catatan aktivitas lama.<br>
      <strong style="color:#0F172A;">Yang tersisa:</strong> hanya angka ringkasan (jumlah per status, kelompok usia, dan sebagainya).<br>
      Penghapusan <strong>tidak dapat dibatalkan</strong>.
    </td></tr></table>`,
    p("<strong>Yang perlu Anda lakukan sebelum tanggal itu</strong>", 6),
    `<ul style="margin:0 0 18px 0;padding-left:20px;font-family:${FONT};font-size:15px;line-height:24px;color:#334155;">
      <li>Unduh ekspor CSV jika datanya masih dibutuhkan untuk laporan atau pembukuan.</li>
      <li>Ada sengketa atau insiden keamanan yang belum selesai? Aktifkan <em>Tunda penghapusan</em> di Pengaturan acara. Jika tidak ada tindakan, data dihapus sesuai jadwal.</li>
    </ul>`,
    base
      ? `<div style="margin:0 0 20px 0;">${button(`${base}/admin/export`, "Unduh ekspor (CSV)", true)}${button(`${base}/admin/settings#retensi`, "Buka pengaturan retensi", false)}</div>`
      : p("Buka /admin/export untuk mengunduh ekspor, dan /admin/settings (bagian Retensi data) untuk menunda penghapusan.", 20),
    p("Wassalamu’alaikum warahmatullahi wabarakatuh,<br><strong style=\"color:#0F172A;\">Sistem Pendaftaran PPME Den Haag</strong>", 0),
  ].join("\n");

  const text = [
    "Assalamu’alaikum warahmatullahi wabarakatuh,",
    "",
    `Sesuai Kebijakan Privasi, data pribadi peserta ${args.eventTitle} dihapus otomatis paling lambat 90 hari setelah acara.`,
    `${copy.lead}: penghapusan dijadwalkan pada ${args.dueText} (waktu Belanda).`,
    "",
    `Yang akan dihapus permanen: ${registrations} pendaftaran dan ${participants} peserta (nama, email, WhatsApp, kode tiket), log email, serta nama dan email pada catatan aktivitas lama.`,
    "Yang tersisa: hanya angka ringkasan. Penghapusan tidak dapat dibatalkan.",
    "",
    "Sebelum tanggal itu:",
    "- Unduh ekspor CSV jika datanya masih dibutuhkan.",
    "- Ada sengketa atau insiden yang belum selesai? Aktifkan Tunda penghapusan di Pengaturan acara.",
    "",
    base ? `Ekspor: ${base}/admin/export` : "Ekspor: /admin/export",
    base ? `Pengaturan retensi: ${base}/admin/settings#retensi` : "Pengaturan retensi: /admin/settings",
    "",
    "Wassalamu’alaikum warahmatullahi wabarakatuh,",
    "Sistem Pendaftaran PPME Den Haag",
  ].join("\n");

  return { subject, html: frame(subject, copy.tag, "Penghapusan data peserta dijadwalkan", body, args.replyTo, base), text };
}

/** "The deletion ran" notice with the numbers (best effort, sent after the purge). */
export function retentionDoneEmail(args: Omit<Shared, "dueText"> & { purgedAtText: string }) {
  const subject = `Data peserta ${args.eventTitle} sudah dihapus`;
  const base = origin(args.adminUrl);
  const { registrations, participants, checkedIn } = args.counts;
  const body = [
    p("Assalamu’alaikum warahmatullahi wabarakatuh,", 12),
    p(
      `Sesuai jadwal, data pribadi peserta <strong>${escapeHtml(args.eventTitle)}</strong> telah dihapus permanen pada <strong>${escapeHtml(args.purgedAtText)}</strong> (waktu Belanda).`,
    ),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;background-color:#F8FAFC;border:1px solid #E2E8F0;"><tr><td style="padding:14px 18px;font-family:${FONT};font-size:14px;line-height:22px;color:#334155;">
      Dihapus: ${registrations} pendaftaran, ${participants} peserta (${checkedIn} di antaranya pernah check-in), log email, dan nama serta email pada catatan aktivitas lama.<br>
      Tersisa: hanya angka ringkasan di catatan retensi.
    </td></tr></table>`,
    p("Tidak ada tindakan yang perlu dilakukan. Catatan keuangan di bank dan pembukuan perkumpulan tidak termasuk dan mengikuti kewajiban pembukuan.", 18),
    p("Wassalamu’alaikum warahmatullahi wabarakatuh,<br><strong style=\"color:#0F172A;\">Sistem Pendaftaran PPME Den Haag</strong>", 0),
  ].join("\n");
  const text = [
    "Assalamu’alaikum warahmatullahi wabarakatuh,",
    "",
    `Data pribadi peserta ${args.eventTitle} telah dihapus permanen pada ${args.purgedAtText} (waktu Belanda).`,
    `Dihapus: ${registrations} pendaftaran, ${participants} peserta (${checkedIn} pernah check-in), log email, dan nama serta email pada catatan aktivitas lama.`,
    "Tersisa: hanya angka ringkasan. Tidak ada tindakan yang perlu dilakukan.",
    "",
    "Wassalamu’alaikum warahmatullahi wabarakatuh,",
    "Sistem Pendaftaran PPME Den Haag",
  ].join("\n");
  return { subject, html: frame(subject, "Selesai", "Data peserta sudah dihapus", body, args.replyTo, base), text };
}
