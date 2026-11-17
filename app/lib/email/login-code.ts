// Admin login code email. Table layout + inline styles so it renders the same in Gmail, Outlook, Apple Mail and
// mobile clients. No web fonts or remote CSS (privacy rule); the only remote asset is our own logo on the app host.
import { formatDateTime, formatTime } from "../format";
import { escapeHtml } from "./templates";

const BRAND = "#034EA2";
const BRAND_DARK = "#023771";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";

export interface LoginCodeEmailArgs {
  code: string;
  email: string;
  requestedAt: string;
  expiresAt: string;
  validMinutes: number;
  /** Absolute origin of the app (e.g. https://event-admin.ppmedenhaag.nl), used for the logo and the link. */
  appOrigin: string;
  /** ISO country code from Cloudflare (request.cf.country), when known. */
  country?: string | null;
  userAgent?: string | null;
  replyTo: string;
  /** "admin" (default): Dashboard Panitia. "registrant": a participant opening their own registration. */
  audience?: "admin" | "registrant" | "viewer";
  /** Registrant only: the event title and the path of the page the code is for (e.g. /e/<slug>/pendaftaran-saya). */
  eventTitle?: string;
  path?: string;
}

function copyFor(args: LoginCodeEmailArgs) {
  if (args.audience === "registrant") {
    const title = args.eventTitle ?? "Kajian PPME Den Haag";
    return {
      subject: `${args.code} adalah kode akses pendaftaran Anda – ${title}`,
      label: "Pendaftaran Saya",
      eyebrow: "Kode akses",
      heading: "Lihat atau ubah pendaftaran",
      intro: `Gunakan kode berikut untuk membuka pendaftaran Anda untuk ${escapeHtml(title)}. Masukkan kode ini di halaman yang sedang Anda buka.`,
      introText: `Gunakan kode berikut untuk membuka pendaftaran Anda untuk ${title}:`,
      codeLabel: "Kode akses Anda",
      usage: "hanya untuk satu kali akses",
      footer: "permintaan akses pendaftaran di",
      path: args.path ?? "/",
      noRequest:
        "Abaikan email ini. Tanpa kode ini tidak ada yang dapat membuka pendaftaran Anda.",
    };
  }
  if (args.audience === "viewer") {
    return {
      subject: `${args.code} adalah kode masuk Ringkasan Panitia PPME Den Haag`,
      label: "Ringkasan Panitia",
      eyebrow: "Kode masuk",
      heading: "Masuk ke Ringkasan Panitia",
      intro:
        "Gunakan kode berikut untuk membuka Ringkasan Panitia (hanya-baca) Kajian PPME Den Haag. Masukkan kode ini di halaman masuk yang sedang Anda buka.",
      introText: "Gunakan kode berikut untuk membuka Ringkasan Panitia Kajian PPME Den Haag:",
      codeLabel: "Kode masuk Anda",
      usage: "hanya untuk satu kali masuk",
      footer: "permintaan masuk ke",
      path: "/panitia",
      noRequest: "Abaikan email ini. Tanpa kode ini tidak ada yang dapat masuk ke akun Anda.",
    };
  }
  return {
    subject: `${args.code} adalah kode masuk Dashboard Panitia PPME Den Haag`,
    label: "Dashboard Panitia",
    eyebrow: "Kode masuk",
    heading: "Masuk ke Dashboard Panitia",
    intro:
      "Gunakan kode berikut untuk masuk ke Dashboard Panitia Kajian PPME Den Haag. Masukkan kode ini di halaman masuk yang sedang Anda buka.",
    introText: "Gunakan kode berikut untuk masuk ke Dashboard Panitia Kajian PPME Den Haag:",
    codeLabel: "Kode masuk Anda",
    usage: "hanya untuk satu kali masuk",
    footer: "permintaan masuk ke",
    path: "/admin",
    noRequest: "Abaikan email ini. Tanpa kode ini tidak ada yang dapat masuk ke akun Anda.",
  };
}

/** "Belanda" for NL. Falls back to the raw code. */
export function countryName(code: string | null | undefined): string | null {
  if (!code || !/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  try {
    return new Intl.DisplayNames(["id"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Rough "Chrome di Windows" from a User-Agent string; null when unknown. */
export function describeDevice(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} di ${os}`;
  return browser ?? os;
}

function detailRow(label: string, value: string, last = false) {
  const border = last ? "" : "border-bottom:1px solid #E2E8F0;";
  return (
    `<tr>` +
    `<td style="padding:10px 0;${border}font-family:${FONT};font-size:13px;line-height:20px;color:#64748B;width:42%;vertical-align:top;">${escapeHtml(label)}</td>` +
    `<td style="padding:10px 0;${border}font-family:${FONT};font-size:13px;line-height:20px;color:#0F172A;font-weight:600;vertical-align:top;">${escapeHtml(value)}</td>` +
    `</tr>`
  );
}

export function loginCodeEmail(args: LoginCodeEmailArgs) {
  const { code, email, validMinutes, appOrigin, replyTo } = args;
  const until = formatTime(args.expiresAt);
  const requested = formatDateTime(args.requestedAt);
  const location = countryName(args.country);
  const device = describeDevice(args.userAgent);
  const origin = appOrigin.replace(/\/$/, "");
  const host = origin.replace(/^https?:\/\//, "");

  const copy = copyFor(args);
  const subject = copy.subject;
  const preheader = `Kode berlaku ${validMinutes} menit (sampai ${until} waktu Belanda). Jangan bagikan kode ini kepada siapa pun.`;

  const details = [
    ["Akun", email],
    ["Waktu permintaan", `${requested} (waktu Belanda)`],
    ...(device ? [["Perangkat", device]] : []),
    ...(location ? [["Perkiraan lokasi", location]] : []),
  ];

  const html = `<!DOCTYPE html>
<html lang="id" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${BRAND}; }
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .px { padding-left:24px !important; padding-right:24px !important; }
    .code { font-size:34px !important; letter-spacing:8px !important; }
    .hide-sm { display:none !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F1F5F9;">
  <tr>
    <td align="center" style="padding:40px 12px;">
      <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background-color:#FFFFFF;border:1px solid #E2E8F0;border-top:4px solid ${BRAND};">
        <!-- header -->
        <tr>
          <td class="px" style="padding:28px 40px 24px 40px;border-bottom:1px solid #E2E8F0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;">
                  <img src="${escapeHtml(origin)}/logo-ppme.png" width="77" height="40" alt="PPME Den Haag" style="display:block;height:40px;width:auto;">
                </td>
                <td class="hide-sm" align="right" style="vertical-align:middle;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#64748B;">
                  ${escapeHtml(copy.label)}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- body -->
        <tr>
          <td class="px" style="padding:36px 40px 8px 40px;">
            <p style="margin:0 0 10px 0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${BRAND};">${escapeHtml(copy.eyebrow)}</p>
            <h1 style="margin:0 0 20px 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;color:#0F172A;">${escapeHtml(copy.heading)}</h1>
            <p style="margin:0 0 12px 0;font-family:${FONT};font-size:15px;line-height:24px;color:#334155;">Assalamu’alaikum warahmatullahi wabarakatuh,</p>
            <p style="margin:0 0 28px 0;font-family:${FONT};font-size:15px;line-height:24px;color:#334155;">${copy.intro}</p>
          </td>
        </tr>
        <!-- code -->
        <tr>
          <td class="px" style="padding:0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F0F5FC;border:1px solid #C7D8F0;">
              <tr>
                <td align="center" style="padding:26px 16px 22px 16px;">
                  <p style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:#475569;">${escapeHtml(copy.codeLabel)}</p>
                  <p class="code" style="margin:0;padding-left:12px;font-family:${MONO};font-size:40px;line-height:48px;font-weight:700;letter-spacing:12px;color:${BRAND_DARK};">${escapeHtml(code)}</p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:12px 16px;border-top:1px solid #C7D8F0;background-color:#E6EEFA;font-family:${FONT};font-size:13px;line-height:20px;color:#334155;">
                  Berlaku <strong style="color:#0F172A;">${validMinutes} menit</strong>, sampai pukul <strong style="color:#0F172A;">${escapeHtml(until)}</strong> waktu Belanda &middot; ${escapeHtml(copy.usage)}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- details -->
        <tr>
          <td class="px" style="padding:32px 40px 0 40px;">
            <p style="margin:0 0 4px 0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#64748B;">Detail permintaan</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${details.map(([label, value], i) => detailRow(label, value, i === details.length - 1)).join("")}
            </table>
          </td>
        </tr>
        <!-- security notice -->
        <tr>
          <td class="px" style="padding:28px 40px 0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFBEB;border-left:3px solid #D97706;">
              <tr>
                <td style="padding:14px 18px;font-family:${FONT};font-size:13px;line-height:21px;color:#78350F;">
                  <strong style="color:#451A03;">Tidak merasa meminta kode ini?</strong> ${escapeHtml(copy.noRequest)}
                  Jangan pernah membagikan kode ini; panitia tidak akan memintanya melalui WhatsApp, telepon, maupun email.
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- sign-off -->
        <tr>
          <td class="px" style="padding:28px 40px 36px 40px;">
            <p style="margin:0 0 4px 0;font-family:${FONT};font-size:15px;line-height:24px;color:#334155;">Wassalamu’alaikum warahmatullahi wabarakatuh,</p>
            <p style="margin:0;font-family:${FONT};font-size:15px;line-height:24px;font-weight:700;color:#0F172A;">Panitia Kajian PPME Den Haag</p>
          </td>
        </tr>
      </table>
      <!-- footer -->
      <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">
        <tr>
          <td class="px" style="padding:20px 40px 0 40px;font-family:${FONT};font-size:12px;line-height:19px;color:#64748B;text-align:center;">
            Email ini dikirim otomatis karena ada ${escapeHtml(copy.footer)}
            <a href="${escapeHtml(origin)}${escapeHtml(copy.path)}" style="color:#475569;text-decoration:underline;">${escapeHtml(host)}</a>
            untuk alamat ${escapeHtml(email)}.<br>
            Pertanyaan? Hubungi <a href="mailto:${escapeHtml(replyTo)}" style="color:#475569;text-decoration:underline;">${escapeHtml(replyTo)}</a>.
          </td>
        </tr>
        <tr>
          <td style="padding:12px 40px 0 40px;font-family:${FONT};font-size:12px;line-height:19px;color:#94A3B8;text-align:center;">
            PPME Den Haag &middot; <a href="https://www.ppmedenhaag.nl/" style="color:#94A3B8;text-decoration:none;">ppmedenhaag.nl</a>
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
    copy.introText,
    "",
    `    ${code}`,
    "",
    `Kode berlaku ${validMinutes} menit (sampai pukul ${until} waktu Belanda), ${copy.usage}.`,
    "",
    "Detail permintaan",
    ...details.map(([label, value]) => `- ${label}: ${value}`),
    "",
    `Tidak merasa meminta kode ini? ${copy.noRequest}`,
    "Jangan pernah membagikan kode ini; panitia tidak akan memintanya melalui WhatsApp, telepon, maupun email.",
    "",
    "Wassalamu’alaikum warahmatullahi wabarakatuh,",
    "Panitia Kajian PPME Den Haag",
    "",
    `--`,
    `Email otomatis dari ${host}. Pertanyaan? ${replyTo}`,
  ].join("\n");

  return { subject, html, text };
}
