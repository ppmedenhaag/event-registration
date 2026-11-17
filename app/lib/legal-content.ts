/**
 * Public privacy policy and terms of service (served at /privacy and /terms by EVERY Worker: public, admin and check-in,
 * no login). Static text, no env, no database. Indonesian is the default (the audience); English is for Google's OAuth
 * review and non-Indonesian readers (?lang=en). Keep both languages in step: a test checks the structure matches.
 *
 * DRAFT for board (pengurus) review: the factual statements follow how the app really works (see CLAUDE.md), but the
 * wording is not legal advice. Bump LEGAL_UPDATED when the text changes.
 */
export type LegalLang = "id" | "en";
export type LegalDocKey = "privacy" | "terms";

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDoc {
  title: string;
  intro: string;
  sections: LegalSection[];
}

export const LEGAL_UPDATED = "17 November 2026";
export const LEGAL_CONTACT = "event@ppmedenhaag.nl";

export const LEGAL_UI: Record<LegalLang, { updated: string; privacy: string; terms: string; language: string; contact: string; home: string; draftNote: string }> = {
  id: {
    updated: "Terakhir diperbarui",
    privacy: "Kebijakan Privasi",
    terms: "Ketentuan Layanan",
    language: "Bahasa",
    contact: "Pertanyaan? Hubungi",
    home: "Situs PPME Den Haag",
    draftNote: "Ditulis untuk sistem pendaftaran dan check-in Kajian PPME Den Haag.",
  },
  en: {
    updated: "Last updated",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    language: "Language",
    contact: "Questions? Contact",
    home: "PPME Den Haag website",
    draftNote: "Written for the registration and check-in system of the Kajian PPME Den Haag.",
  },
};

const PRIVACY_ID: LegalDoc = {
  title: "Kebijakan Privasi",
  intro:
    "Halaman ini menjelaskan data apa yang kami proses saat Anda mendaftar untuk Kajian PPME Den Haag, atau saat anggota panitia dan petugas check-in masuk ke sistem ini, untuk apa data itu dipakai, dan berapa lama disimpan.",
  sections: [
    {
      heading: "1. Siapa kami",
      paragraphs: [
        "Sistem ini dikelola oleh panitia PPME Den Haag (Vereniging PPME) untuk menyelenggarakan Kajian PPME Den Haag. Kami adalah pihak yang menentukan tujuan dan cara pemrosesan data di sistem ini. Kontak: event@ppmedenhaag.nl.",
      ],
    },
    {
      heading: "2. Data yang kami proses",
      paragraphs: ["Pendaftar dan peserta (formulir pendaftaran):"],
      bullets: [
        "Nama pendaftar dan setiap peserta, tahun lahir, jenis kelamin, kelompok usia.",
        "Alamat email dan nomor WhatsApp pendaftar.",
        "Pernyataan keanggotaan (anggota atau bukan) dan hasil validasinya oleh admin.",
        "Status pendaftaran, kode dan status pembayaran, kode tiket (kode acak, tanpa data pribadi), waktu persetujuan privasi, dan waktu check-in.",
      ],
    },
    {
      heading: "",
      paragraphs: [
        "Anggota panitia (admin), pemirsa ringkasan panitia, dan petugas check-in (halaman /admin, /panitia dan /scan):",
      ],
      bullets: [
        "Alamat email dan nama, serta peran Anda di sistem.",
        "Catatan sesi masuk: alamat IP, jenis peramban dan perangkat, serta waktu masuk dan keluar.",
        "Catatan aktivitas (audit log) atas tindakan yang diubah di sistem, dan untuk petugas check-in: pemindaian yang dilakukan dan hasil uji perangkat.",
      ],
    },
    {
      heading: "3. Masuk dengan Google",
      paragraphs: [
        "Anggota panitia dan petugas check-in dapat memilih masuk dengan akun Google, sebagai alternatif kode masuk 6 digit yang dikirim lewat email. Pendaftar biasa tidak memakai Google.",
        "Kami hanya meminta izin dasar (openid dan email). Dari Google kami hanya menerima alamat email Anda yang sudah diverifikasi, dan memakainya untuk satu hal: mencocokkannya dengan daftar admin, pemirsa panitia, atau petugas check-in yang sudah terdaftar. Jika tidak cocok, Anda tidak diberi akses. Kami tidak meminta nama, foto, kontak, kalender, Drive, atau data Google lainnya, tidak menyimpan token Google, dan tidak membaca apa pun dari akun Anda setelah proses masuk selesai.",
        "Data dari Google tidak dijual, tidak dibagikan kepada pihak lain, tidak dipakai untuk iklan, dan tidak dipakai untuk melatih model apa pun. Penggunaan informasi yang diterima dari layanan Google mematuhi Google API Services User Data Policy, termasuk persyaratan Limited Use.",
      ],
    },
    {
      heading: "4. Tujuan dan dasar pemrosesan",
      bullets: [
        "Data pendaftar: untuk pendaftaran, pembayaran, tiket, pengiriman email konfirmasi dan pengingat, serta check-in pada acara ini. Dasarnya adalah persetujuan Anda saat mendaftar. Informasi kegiatan berikutnya hanya kami kirim jika Anda mencentangnya secara opsional.",
        "Data panitia dan petugas: untuk mengamankan akses dan menjalankan acara. Dasarnya adalah kepentingan sah penyelenggara untuk menjaga keamanan data peserta.",
        "Kami tidak menjual data, tidak memakainya untuk iklan, dan tidak membuat profil.",
      ],
    },
    {
      heading: "5. Dengan siapa data dibagikan",
      paragraphs: ["Kami memakai penyedia layanan berikut sebagai pemroses data, hanya untuk menjalankan sistem ini:"],
      bullets: [
        "Cloudflare: hosting aplikasi, basis data, dan pemeriksaan keamanan Turnstile untuk mencegah bot. Data disimpan di layanan Cloudflare di Uni Eropa.",
        "Resend: pengiriman email (konfirmasi, tiket, kode masuk).",
        "Google: hanya bagi anggota panitia atau petugas yang memilih masuk dengan Google (lihat bagian 3).",
        "Panitia PPME Den Haag yang berwenang melihat data sesuai tugasnya. Ringkasan panitia (/panitia) hanya menampilkan jumlah dan statistik, tanpa nama, email, atau nomor telepon.",
      ],
    },
    {
      heading: "6. Cookie",
      paragraphs: [
        "Kami hanya memakai cookie sesi yang diperlukan agar Anda tetap masuk (misalnya untuk halaman Pendaftaran Saya, panitia, dan petugas check-in) dan cookie sementara saat proses masuk dengan Google. Tidak ada cookie pelacak, analitik, atau iklan. Fon dan gambar dimuat dari server kami sendiri.",
      ],
    },
    {
      heading: "7. Berapa lama data disimpan",
      bullets: [
        "Data peserta dihapus atau dianonimkan paling lambat 90 hari setelah acara. Catatan pembayaran disimpan selama diwajibkan oleh ketentuan pembukuan.",
        "Detail check-in (siapa petugasnya dan perangkat yang dipakai) dianonimkan 30 hari setelah acara berakhir; sesi dan hasil uji perangkat petugas dihapus pada saat yang sama.",
        "Akses pemirsa panitia berakhir 7 hari setelah acara dan datanya dihapus.",
        "Sesi masuk berlaku 24 jam (admin), 48 jam (petugas check-in), atau 3 hari (pemirsa panitia). Kode masuk email berlaku 10 menit.",
      ],
    },
    {
      heading: "8. Keamanan",
      bullets: [
        "Kode QR hanya berisi kode tiket acak, tanpa nama atau data pribadi. Hanya admin dan petugas berwenang yang dapat melihat siapa pemilik sebuah kode.",
        "Token sesi disimpan hanya dalam bentuk hash. Akses panitia dan petugas diperiksa pada setiap permintaan dan dapat dicabut kapan saja.",
        "Semua lalu lintas memakai HTTPS. Formulir dilindungi pemeriksaan bot.",
      ],
    },
    {
      heading: "9. Hak Anda",
      paragraphs: [
        "Anda berhak meminta akses, koreksi, atau penghapusan data Anda, menarik persetujuan, dan meminta data Anda dalam format yang dapat dibaca. Kirim permintaan ke event@ppmedenhaag.nl; kami menjawab dalam waktu wajar dan paling lambat satu bulan. Jika Anda merasa data Anda tidak ditangani dengan benar, Anda juga dapat mengajukan keluhan ke Autoriteit Persoonsgegevens (Otoritas Perlindungan Data Belanda).",
      ],
    },
    {
      heading: "10. Perubahan",
      paragraphs: ["Jika kebijakan ini berubah, versi baru dan tanggal pembaruan akan ditampilkan di halaman ini."],
    },
  ],
};

const PRIVACY_EN: LegalDoc = {
  title: "Privacy Policy",
  intro:
    "This page explains what data we process when you register for a Kajian PPME Den Haag event, or when committee members and check-in staff sign in to this system, what we use it for, and how long we keep it.",
  sections: [
    {
      heading: "1. Who we are",
      paragraphs: [
        "This system is run by the PPME Den Haag committee (Vereniging PPME) to organise the Kajian PPME Den Haag. We decide why and how data in this system is processed. Contact: event@ppmedenhaag.nl.",
      ],
    },
    {
      heading: "2. Data we process",
      paragraphs: ["Registrants and participants (the registration form):"],
      bullets: [
        "Name of the registrant and of each participant, birth year, gender, age group.",
        "The registrant's email address and WhatsApp number.",
        "The membership claim (member or not) and the admin's validation of it.",
        "Registration status, payment code and status, ticket codes (random codes with no personal data), the time of the privacy consent, and the check-in time.",
      ],
    },
    {
      heading: "",
      paragraphs: [
        "Committee members (admins), committee dashboard viewers and check-in staff (the /admin, /panitia and /scan pages):",
      ],
      bullets: [
        "Your email address and name, and your role in the system.",
        "Sign-in records: IP address, browser and device type, and sign-in and sign-out times.",
        "An activity log (audit log) of changes made in the system and, for check-in staff, the scans performed and device self-test results.",
      ],
    },
    {
      heading: "3. Sign in with Google",
      paragraphs: [
        "Committee members and check-in staff can choose to sign in with their Google account, as an alternative to the 6-digit login code sent by email. Regular registrants do not use Google.",
        "We request only the basic scopes (openid and email). From Google we receive only your verified email address, and we use it for one thing: to match it against the list of registered admins, committee viewers or check-in staff. If there is no match, you are not given access. We do not request your name, photo, contacts, calendar, Drive or any other Google data, we do not store Google tokens, and we read nothing from your account after sign-in completes.",
        "Data from Google is not sold, not shared with third parties, not used for advertising, and not used to train any model. Our use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
      ],
    },
    {
      heading: "4. Purposes and legal basis",
      bullets: [
        "Registrant data: to handle registration, payment, tickets, confirmation and reminder emails, and check-in at this event. The basis is your consent when you register. We only send information about future events if you tick the optional box.",
        "Committee and staff data: to secure access and run the event. The basis is the organiser's legitimate interest in protecting participants' data.",
        "We do not sell data, use it for advertising, or build profiles.",
      ],
    },
    {
      heading: "5. Who receives the data",
      paragraphs: ["We use these service providers as processors, only to run this system:"],
      bullets: [
        "Cloudflare: application hosting, the database, and the Turnstile bot check. Data is stored in Cloudflare services in the European Union.",
        "Resend: sending email (confirmations, tickets, login codes).",
        "Google: only for committee members or staff who choose to sign in with Google (see section 3).",
        "PPME Den Haag committee members who are authorised to see data for their task. The committee summary (/panitia) shows only counts and statistics, with no names, emails or phone numbers.",
      ],
    },
    {
      heading: "6. Cookies",
      paragraphs: [
        "We only use the session cookies needed to keep you signed in (for example for My Registration, the committee pages and the check-in app) and a short-lived cookie during Google sign-in. There are no tracking, analytics or advertising cookies. Fonts and images are loaded from our own server.",
      ],
    },
    {
      heading: "7. How long we keep data",
      bullets: [
        "Participant data is deleted or anonymised no later than 90 days after the event. Payment records are kept for as long as bookkeeping rules require.",
        "Check-in details (which staff member and which device) are anonymised 30 days after the event ends; staff sessions and device self-test results are deleted at the same time.",
        "Committee viewer access ends 7 days after the event and its data is deleted.",
        "Sign-in sessions last 24 hours (admins), 48 hours (check-in staff) or 3 days (committee viewers). Email login codes are valid for 10 minutes.",
      ],
    },
    {
      heading: "8. Security",
      bullets: [
        "The QR code contains only a random ticket code, never a name or personal data. Only admins and authorised staff can see who owns a code.",
        "Session tokens are stored only as hashes. Committee and staff access is checked on every request and can be revoked at any time.",
        "All traffic uses HTTPS. The form is protected by a bot check.",
      ],
    },
    {
      heading: "9. Your rights",
      paragraphs: [
        "You can ask for access to, correction or deletion of your data, withdraw your consent, and ask for your data in a readable format. Send your request to event@ppmedenhaag.nl; we reply within a reasonable time and at most one month. If you feel your data is not handled properly you can also complain to the Autoriteit Persoonsgegevens (the Dutch Data Protection Authority).",
      ],
    },
    {
      heading: "10. Changes",
      paragraphs: ["If this policy changes, the new version and its date will be shown on this page."],
    },
  ],
};

const TERMS_ID: LegalDoc = {
  title: "Ketentuan Layanan",
  intro:
    "Dengan memakai sistem pendaftaran dan check-in Kajian PPME Den Haag, Anda menyetujui ketentuan berikut. Jika tidak setuju, mohon jangan memakai sistem ini dan hubungi panitia.",
  sections: [
    {
      heading: "1. Tentang layanan",
      paragraphs: [
        "Sistem ini dipakai untuk pendaftaran, pelacakan pembayaran, tiket QR, dan check-in Kajian PPME Den Haag. Ada tiga kelompok pengguna: pendaftar (publik), anggota panitia dan pemirsa ringkasan, serta petugas check-in. Layanan disediakan oleh panitia PPME Den Haag.",
      ],
    },
    {
      heading: "2. Pendaftaran dan tiket",
      bullets: [
        "Isilah data dengan benar dan lengkap. Pendaftar harus berusia 18 tahun ke atas dan berwenang mendaftarkan peserta lain yang ia sertakan, termasuk anak-anak.",
        "Kuota terbatas. Tempat ditahan sesuai status pendaftaran dan batas waktu pembayaran yang tertera pada email Anda; pendaftaran yang tidak dibayar sebelum batas waktu dapat dibatalkan otomatis dan tempatnya dilepas.",
        "Keanggotaan PPME Den Haag divalidasi oleh admin. Panitia dapat menolak klaim keanggotaan yang tidak dapat diverifikasi.",
        "Kode QR bersifat pribadi. Jangan membagikannya di tempat umum. Satu kode hanya dapat dipakai untuk masuk satu kali per peserta.",
        "Perubahan atau pembatalan oleh pendaftar hanya dapat dilakukan selama jendela pendaftaran masih terbuka dan sesuai aturan di halaman Pendaftaran Saya. Setelah itu hubungi panitia lewat email.",
      ],
    },
    {
      heading: "3. Pembayaran dan infaq",
      paragraphs: [
        "Pembayaran dilakukan sesuai petunjuk pada email dan halaman pendaftaran, dengan kode pembayaran yang diberikan. Infaq tambahan bersifat sukarela. Pertanyaan tentang pembayaran atau pengembalian dana ditujukan kepada panitia di event@ppmedenhaag.nl.",
      ],
    },
    {
      heading: "4. Akun panitia, pemirsa, dan petugas check-in",
      bullets: [
        "Akses hanya untuk orang yang didaftarkan oleh admin. Masuk memakai kode 6 digit lewat email atau, bila tersedia, akun Google yang emailnya terdaftar.",
        "Jaga kerahasiaan akses Anda. Jangan membagikan kode masuk atau meminjamkan perangkat yang sedang masuk.",
        "Data peserta yang Anda lihat hanya boleh dipakai untuk tugas Anda pada acara ini, dan wajib dirahasiakan. Dilarang menyalin, menyimpan di luar sistem, atau membagikannya.",
        "Panitia dapat mencabut akses kapan saja.",
      ],
    },
    {
      heading: "5. Penggunaan yang wajar",
      paragraphs: [
        "Dilarang mendaftar dengan data palsu, mendaftar berulang untuk menahan kuota, memakai skrip atau bot, mencoba menembus atau mengganggu keamanan sistem, atau memakai kode tiket orang lain. Pelanggaran dapat berakibat pembatalan pendaftaran atau pencabutan akses.",
      ],
    },
    {
      heading: "6. Dokumentasi acara",
      paragraphs: [
        "Acara ini dapat didokumentasikan (foto/video) dan disiarkan langsung, dan dokumentasi dapat dipublikasikan di kanal PPME Den Haag. Jika Anda tidak ingin tampil, beri tahu panitia di lokasi atau lewat email.",
      ],
    },
    {
      heading: "7. Privasi",
      paragraphs: ["Cara kami memproses data pribadi dijelaskan dalam Kebijakan Privasi, yang menjadi bagian dari ketentuan ini."],
    },
    {
      heading: "8. Ketersediaan dan batas tanggung jawab",
      paragraphs: [
        "Kami berusaha menjaga sistem tetap berjalan, tetapi layanan disediakan apa adanya dan dapat terganggu atau diubah, misalnya karena pemeliharaan atau gangguan penyedia layanan. Sejauh diizinkan hukum, panitia tidak bertanggung jawab atas kerugian tidak langsung akibat gangguan tersebut. Ketentuan ini tidak membatasi hak Anda yang tidak dapat dikesampingkan menurut hukum.",
      ],
    },
    {
      heading: "9. Perubahan dan hukum yang berlaku",
      paragraphs: [
        "Ketentuan ini dapat diperbarui; versi terbaru selalu ada di halaman ini. Hukum Belanda berlaku. Hubungi kami di event@ppmedenhaag.nl untuk pertanyaan apa pun.",
      ],
    },
  ],
};

const TERMS_EN: LegalDoc = {
  title: "Terms of Service",
  intro:
    "By using the registration and check-in system of the Kajian PPME Den Haag you agree to the terms below. If you do not agree, please do not use the system and contact the committee.",
  sections: [
    {
      heading: "1. About the service",
      paragraphs: [
        "This system is used for registration, payment tracking, QR tickets and check-in for the Kajian PPME Den Haag. There are three groups of users: registrants (public), committee members and dashboard viewers, and check-in staff. The service is provided by the PPME Den Haag committee.",
      ],
    },
    {
      heading: "2. Registration and tickets",
      bullets: [
        "Enter correct and complete information. The registrant must be 18 or older and authorised to register the other participants they include, including children.",
        "Places are limited. A place is held according to your registration status and the payment deadline shown in your email; a registration that is not paid before the deadline can be cancelled automatically and the place released.",
        "Membership of PPME Den Haag is validated by an admin. The committee may reject a membership claim that cannot be verified.",
        "The QR code is personal. Do not share it publicly. One code can be used to enter once per participant.",
        "Changes or cancellations by the registrant are only possible while the registration window is open and within the rules on the My Registration page. After that, contact the committee by email.",
      ],
    },
    {
      heading: "3. Payment and infaq",
      paragraphs: [
        "Payment is made as described in the email and on the registration page, using the payment code you are given. Additional infaq is voluntary. Questions about payments or refunds go to the committee at event@ppmedenhaag.nl.",
      ],
    },
    {
      heading: "4. Committee, viewer and check-in staff accounts",
      bullets: [
        "Access is only for people registered by an admin. You sign in with a 6-digit email code or, where available, a Google account whose email is registered.",
        "Keep your access confidential. Do not share login codes or lend a device that is signed in.",
        "Participant data you can see may only be used for your task at this event and must be kept confidential. Do not copy it, store it outside the system, or share it.",
        "The committee can revoke access at any time.",
      ],
    },
    {
      heading: "5. Acceptable use",
      paragraphs: [
        "Do not register with false information, register repeatedly to hold places, use scripts or bots, try to break into or disrupt the system, or use someone else's ticket code. Violations can lead to cancellation of the registration or removal of access.",
      ],
    },
    {
      heading: "6. Event documentation",
      paragraphs: [
        "The event may be photographed, filmed and live-streamed, and the material may be published on PPME Den Haag channels. If you do not wish to appear, tell the committee at the venue or by email.",
      ],
    },
    {
      heading: "7. Privacy",
      paragraphs: ["How we process personal data is described in the Privacy Policy, which is part of these terms."],
    },
    {
      heading: "8. Availability and limitation of liability",
      paragraphs: [
        "We try to keep the system running, but the service is provided as is and may be interrupted or changed, for example because of maintenance or a provider outage. To the extent the law allows, the committee is not liable for indirect loss caused by such interruptions. These terms do not limit any rights you have that cannot be waived by law.",
      ],
    },
    {
      heading: "9. Changes and governing law",
      paragraphs: [
        "These terms may be updated; the latest version is always on this page. Dutch law applies. Contact us at event@ppmedenhaag.nl with any question.",
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalLang, Record<LegalDocKey, LegalDoc>> = {
  id: { privacy: PRIVACY_ID, terms: TERMS_ID },
  en: { privacy: PRIVACY_EN, terms: TERMS_EN },
};

export function parseLegalLang(raw: string | null | undefined): LegalLang {
  return raw === "en" ? "en" : "id";
}
