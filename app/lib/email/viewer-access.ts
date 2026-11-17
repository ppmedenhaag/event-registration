// "Your access was approved" email for panitia viewers. Same look as the login-code email: table layout, inline styles,
// no web fonts or remote CSS (privacy rule). It carries no personal data and no code: the person still logs in with a PIN.
import { escapeHtml } from "./templates";

const BRAND = "#034EA2";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export function viewerApprovedEmail(args: { appOrigin: string; replyTo: string }) {
  const origin = args.appOrigin.replace(/\/$/, "");
  const link = `${origin}/panitia`;
  const subject = "Akses Ringkasan Panitia PPME Den Haag disetujui";
  const p = (html: string, mb = 14) =>
    `<p style="margin:0 0 ${mb}px 0;font-family:${FONT};font-size:15px;line-height:24px;color:#334155;">${html}</p>`;

  const html = `<!DOCTYPE html>
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
        <tr>
          <td class="px" style="padding:28px 40px 24px 40px;border-bottom:1px solid #E2E8F0;">
            <img src="${escapeHtml(origin)}/logo-ppme.png" width="77" height="40" alt="PPME Den Haag" style="display:block;height:40px;width:auto;">
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:32px 40px 8px 40px;">
            <p style="margin:0 0 10px 0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${BRAND};">Akses disetujui</p>
            <h1 style="margin:0 0 20px 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;color:#0F172A;">Ringkasan Panitia</h1>
            ${p("Assalamu’alaikum warahmatullahi wabarakatuh,", 12)}
            ${p("Permintaan akses Anda ke <strong>Ringkasan Panitia</strong> Kajian PPME Den Haag telah disetujui. Halaman ini hanya-baca: berisi jumlah dan komposisi peserta untuk perencanaan dan hari-H, tanpa nama atau data pribadi peserta.")}
            ${p("Buka halaman berikut, masukkan email ini, lalu masukkan kode 6 digit yang kami kirim ke email Anda setiap kali masuk.", 20)}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:${BRAND};">
              <a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">Buka Ringkasan Panitia</a>
            </td></tr></table>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:28px 40px 36px 40px;">
            ${p("Akses ini berakhir otomatis beberapa hari setelah acara. Jika tombol tidak berfungsi, salin alamat ini ke browser: " + escapeHtml(link), 20)}
            ${p("Wassalamu’alaikum warahmatullahi wabarakatuh,<br><strong style=\"color:#0F172A;\">Panitia Kajian PPME Den Haag</strong>", 0)}
          </td>
        </tr>
      </table>
      <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">
        <tr>
          <td class="px" style="padding:20px 40px 0 40px;font-family:${FONT};font-size:12px;line-height:19px;color:#64748B;text-align:center;">
            Tidak merasa meminta akses? Abaikan email ini atau hubungi <a href="mailto:${escapeHtml(args.replyTo)}" style="color:#475569;text-decoration:underline;">${escapeHtml(args.replyTo)}</a>.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    "Assalamu’alaikum warahmatullahi wabarakatuh,",
    "",
    "Permintaan akses Anda ke Ringkasan Panitia Kajian PPME Den Haag telah disetujui.",
    "Halaman ini hanya-baca: jumlah dan komposisi peserta, tanpa nama atau data pribadi peserta.",
    "",
    `Buka: ${link}`,
    "Masukkan email ini, lalu kode 6 digit yang dikirim ke email Anda setiap kali masuk.",
    "Akses berakhir otomatis beberapa hari setelah acara.",
    "",
    "Wassalamu’alaikum warahmatullahi wabarakatuh,",
    "Panitia Kajian PPME Den Haag",
    "",
    `Tidak merasa meminta akses? Abaikan email ini atau hubungi ${args.replyTo}.`,
  ].join("\n");

  return { subject, html, text };
}
