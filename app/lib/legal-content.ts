/**
 * Public privacy policy and terms of service (served at /privacy and /terms by EVERY Worker: public, admin and check-in,
 * no login). Static text, no env, no database. Indonesian is the default (the audience); English is for Google's OAuth
 * review and non-Indonesian readers (?lang=en). Keep both languages in step: a test checks the structure matches.
 *
 * DRAFT for board (pengurus) review. The app is run by volunteers without a legal team, so the text is plain-language and
 * promises only what the app and the committee can actually do. Factual statements follow how the app really works (see
 * CLAUDE.md); retention promises (90 days) need the retention job (FR-PRIV-5). Not legal advice. Bump LEGAL_UPDATED when
 * the text changes.
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
    "Halaman ini menjelaskan, dengan bahasa sederhana, data apa yang kami proses saat Anda mendaftar untuk Kajian PPME Den Haag, atau saat anggota panitia dan petugas check-in masuk ke sistem ini, untuk apa data itu dipakai, dan berapa lama disimpan. Kami memperlakukan data Anda sesuai prinsip GDPR (AVG).",
  sections: [
    {
      heading: "1. Siapa kami",
      paragraphs: [
        "Sistem ini dikelola oleh panitia PPME Den Haag (Vereniging PPME) untuk menyelenggarakan Kajian PPME Den Haag. Seluruh admin, panitia, dan petugas check-in adalah relawan. Kami adalah pihak yang menentukan tujuan dan cara pemrosesan data di sistem ini. Kami tidak memiliki tim hukum maupun petugas perlindungan data (DPO) khusus; pertanyaan dan keluhan ditangani langsung oleh pengurus. Kontak: event@ppmedenhaag.nl.",
      ],
    },
    {
      heading: "2. Data yang kami proses",
      paragraphs: ["Pendaftar dan peserta (formulir pendaftaran):"],
      bullets: [
        "Nama pendaftar dan setiap peserta, jenis kelamin, dan kelompok usia (balita, anak, remaja, atau dewasa). Kami tidak meminta tanggal atau tahun lahir.",
        "Alamat email dan nomor WhatsApp pendaftar.",
        "Pernyataan keanggotaan (anggota atau bukan) dan hasil validasinya oleh admin.",
        "Status pendaftaran, kode tiket (kode acak, tanpa data pribadi), waktu persetujuan privasi, dan waktu check-in. Jika acara berbayar: juga kode dan status pembayaran.",
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
      heading: "3. Data sensitif dan data anak",
      paragraphs: [
        "Kehadiran di kajian keagamaan dapat menunjukkan keyakinan agama seseorang. Karena itu kami memperlakukan seluruh data pendaftar sebagai data sensitif.",
      ],
      bullets: [
        "Data dipakai hanya untuk acara ini, tidak dipublikasikan, dan tidak dibagikan di luar panitia dan penyedia layanan pada bagian 6.",
        "Petugas check-in hanya melihat nama singkat dan kelompok usia, tanpa email atau nomor telepon. Ringkasan panitia hanya menampilkan jumlah, tanpa nama.",
        "Anak-anak didaftarkan oleh pendaftar dewasa, yang menyatakan berwenang sebagai orang tua atau wali. Untuk anak kami hanya mencatat nama dan kelompok usia, dan kami tidak menghubungi anak secara langsung.",
      ],
    },
    {
      heading: "4. Masuk dengan Google",
      paragraphs: [
        "Anggota panitia dan petugas check-in dapat memilih masuk dengan akun Google, sebagai alternatif kode masuk 6 digit yang dikirim lewat email. Pendaftar biasa tidak memakai Google.",
        "Kami hanya meminta izin dasar (openid dan email). Dari Google kami hanya menerima alamat email Anda yang sudah diverifikasi, dan memakainya untuk satu hal: mencocokkannya dengan daftar admin, pemirsa panitia, atau petugas check-in yang sudah terdaftar. Jika tidak cocok, Anda tidak diberi akses. Kami tidak meminta nama, foto, kontak, kalender, Drive, atau data Google lainnya, tidak menyimpan token Google, dan tidak membaca apa pun dari akun Anda setelah proses masuk selesai.",
        "Data dari Google tidak dijual, tidak dibagikan kepada pihak lain, tidak dipakai untuk iklan, dan tidak dipakai untuk melatih model apa pun. Penggunaan informasi yang diterima dari layanan Google mematuhi Google API Services User Data Policy, termasuk persyaratan Limited Use.",
      ],
    },
    {
      heading: "5. Tujuan dan dasar pemrosesan",
      bullets: [
        "Data pendaftar dipakai untuk pendaftaran, pembayaran, tiket, email konfirmasi dan pengingat, serta check-in pada acara ini. Dasarnya adalah persetujuan eksplisit Anda lewat kotak centang di formulir (GDPR Pasal 6(1)(a) dan 9(2)(a)). Anda dapat menarik persetujuan kapan saja; pendaftaran Anda kemudian dibatalkan atau datanya dihapus, dan pemrosesan sebelumnya tetap sah.",
        "Informasi kegiatan berikutnya hanya kami kirim jika Anda mencentang kotak opsionalnya, dan Anda dapat berhenti kapan saja dengan menghubungi kami.",
        "Data panitia dan petugas dipakai untuk mengamankan akses dan menjalankan acara, atas dasar kepentingan sah penyelenggara untuk menjaga keamanan data peserta (Pasal 6(1)(f)).",
        "Jika acara berbayar, catatan keuangan perkumpulan disimpan karena kewajiban hukum pembukuan (Pasal 6(1)(c)). Kami tidak menjual data, tidak memakainya untuk iklan, dan tidak membuat profil.",
      ],
    },
    {
      heading: "6. Dengan siapa data dibagikan",
      paragraphs: ["Kami memakai penyedia layanan berikut sebagai pemroses data, hanya untuk menjalankan sistem ini:"],
      bullets: [
        "Cloudflare: hosting aplikasi, basis data (disimpan di Uni Eropa), dan pemeriksaan keamanan Turnstile untuk mencegah bot.",
        "Resend: pengiriman email (konfirmasi, tiket, kode masuk).",
        "Google: hanya bagi anggota panitia atau petugas yang memilih masuk dengan Google (lihat bagian 4).",
        "Relawan PPME Den Haag yang berwenang melihat data sesuai tugasnya, dan hanya sebatas itu.",
        "Sebagian layanan di atas dapat memproses data di luar Uni Eropa (misalnya di Amerika Serikat). Penyedia tersebut memakai mekanisme perlindungan yang diakui GDPR, seperti Standard Contractual Clauses atau EU-US Data Privacy Framework.",
      ],
    },
    {
      heading: "7. Cookie",
      paragraphs: [
        "Kami hanya memakai cookie sesi yang diperlukan agar Anda tetap masuk (misalnya untuk halaman Pendaftaran Saya, panitia, dan petugas check-in) dan cookie sementara saat proses masuk dengan Google. Tidak ada cookie pelacak, analitik, atau iklan. Fon dan gambar dimuat dari server kami sendiri.",
      ],
    },
    {
      heading: "8. Berapa lama data disimpan",
      bullets: [
        "Data peserta (nama, email, WhatsApp, jenis kelamin, kelompok usia, status, kode tiket), log email, dan catatan aktivitas dihapus atau dianonimkan paling lambat 90 hari setelah acara.",
        "Jika acara berbayar, catatan keuangan di rekening bank dan pembukuan perkumpulan, yang berada di luar sistem ini, disimpan sesuai kewajiban hukum Belanda (umumnya 7 tahun).",
        "Detail check-in (siapa petugasnya dan perangkat yang dipakai) dianonimkan 30 hari setelah acara berakhir; sesi dan hasil uji perangkat petugas dihapus pada saat yang sama.",
        "Akses pemirsa panitia berakhir 7 hari setelah acara dan datanya dihapus. Sesi masuk berlaku 24 jam (admin), 48 jam (petugas check-in), atau 3 hari (pemirsa panitia); kode masuk email berlaku 10 menit.",
        "Jika ada insiden keamanan atau sengketa, data yang terkait dapat disimpan lebih lama, hanya sepanjang diperlukan untuk menyelesaikannya.",
      ],
    },
    {
      heading: "9. Keamanan",
      bullets: [
        "Kode QR hanya berisi kode tiket acak, tanpa nama atau data pribadi. Hanya admin dan petugas berwenang yang dapat melihat siapa pemilik sebuah kode.",
        "Akses relawan diberikan oleh admin sesuai tugas, diperiksa pada setiap permintaan, dan dapat dicabut kapan saja. Setiap relawan wajib menjaga kerahasiaan data (lihat Ketentuan Layanan bagian 5). Tindakan admin tercatat di catatan aktivitas.",
        "Token sesi disimpan hanya dalam bentuk hash. Semua lalu lintas memakai HTTPS dan formulir dilindungi pemeriksaan bot.",
      ],
    },
    {
      heading: "10. Hak Anda dan cara mengajukan keluhan",
      paragraphs: [
        "Anda berhak meminta akses, koreksi, atau penghapusan data Anda, membatasi atau menolak pemrosesan, menarik persetujuan, dan meminta data Anda dalam format yang dapat dibaca.",
        "Kami adalah relawan tanpa tim hukum. Keluhan ditangani langsung oleh pengurus PPME Den Haag: kirim email ke event@ppmedenhaag.nl dengan subjek \"Privasi\". Kami mengonfirmasi penerimaan dan menjawab paling lambat satu bulan. Jika Anda tetap merasa data Anda tidak ditangani dengan benar, Anda berhak mengajukan keluhan ke Autoriteit Persoonsgegevens (Otoritas Perlindungan Data Belanda, autoriteitpersoonsgegevens.nl).",
      ],
      bullets: [
        "Selama pendaftaran masih terbuka, Anda dapat melihat, mengubah, dan membatalkan pendaftaran sendiri di halaman Pendaftaran Saya.",
        "Untuk permintaan lain, kirim email dari alamat yang Anda pakai saat mendaftar agar kami dapat memastikan identitas Anda. Kami dapat menanyakan informasi singkat untuk verifikasi.",
        "Permintaan Anda kami tangani tanpa biaya.",
      ],
    },
    {
      heading: "11. Kebocoran data",
      paragraphs: [
        "Jika terjadi pelanggaran keamanan yang berisiko bagi data Anda, kami melaporkannya ke Autoriteit Persoonsgegevens dalam 72 jam sejak diketahui bila diwajibkan. Jika risikonya tinggi bagi Anda, kami juga memberi tahu Anda lewat email tentang apa yang terjadi dan langkah yang kami ambil.",
      ],
    },
    {
      heading: "12. Perubahan",
      paragraphs: ["Jika kebijakan ini berubah, versi baru dan tanggal pembaruan akan ditampilkan di halaman ini."],
    },
  ],
};

const PRIVACY_EN: LegalDoc = {
  title: "Privacy Policy",
  intro:
    "This page explains, in plain language, what data we process when you register for a Kajian PPME Den Haag event, or when committee members and check-in staff sign in to this system, what we use it for, and how long we keep it. We treat your data according to the principles of the GDPR.",
  sections: [
    {
      heading: "1. Who we are",
      paragraphs: [
        "This system is run by the PPME Den Haag committee (Vereniging PPME) to organise the Kajian PPME Den Haag. All admins, committee members and check-in staff are volunteers. We decide why and how data in this system is processed. We have no legal team and no dedicated data protection officer (DPO); questions and complaints are handled directly by the board. Contact: event@ppmedenhaag.nl.",
      ],
    },
    {
      heading: "2. Data we process",
      paragraphs: ["Registrants and participants (the registration form):"],
      bullets: [
        "Name of the registrant and of each participant, gender, and age group (toddler, child, teenager or adult). We do not ask for a date or year of birth.",
        "The registrant's email address and WhatsApp number.",
        "The membership claim (member or not) and the admin's validation of it.",
        "Registration status, ticket codes (random codes with no personal data), the time of the privacy consent, and the check-in time. If the event has a fee: also the payment code and status.",
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
      heading: "3. Sensitive data and children",
      paragraphs: [
        "Attending a religious study event can reveal a person's religious beliefs. For that reason we treat all registrant data as sensitive.",
      ],
      bullets: [
        "The data is used only for this event, is not published, and is not shared outside the committee and the service providers in section 6.",
        "Check-in staff see only a short name and the age group, never an email or phone number. The committee summary shows counts only, with no names.",
        "Children are registered by an adult registrant, who declares to be authorised as a parent or guardian. For a child we record only the name and age group, and we do not contact children directly.",
      ],
    },
    {
      heading: "4. Sign in with Google",
      paragraphs: [
        "Committee members and check-in staff can choose to sign in with their Google account, as an alternative to the 6-digit login code sent by email. Regular registrants do not use Google.",
        "We request only the basic scopes (openid and email). From Google we receive only your verified email address, and we use it for one thing: to match it against the list of registered admins, committee viewers or check-in staff. If there is no match, you are not given access. We do not request your name, photo, contacts, calendar, Drive or any other Google data, we do not store Google tokens, and we read nothing from your account after sign-in completes.",
        "Data from Google is not sold, not shared with third parties, not used for advertising, and not used to train any model. Our use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
      ],
    },
    {
      heading: "5. Purposes and legal basis",
      bullets: [
        "Registrant data is used to handle registration, payment, tickets, confirmation and reminder emails, and check-in at this event. The basis is your explicit consent through the checkbox on the form (GDPR Articles 6(1)(a) and 9(2)(a)). You can withdraw consent at any time; your registration is then cancelled or your data deleted, and earlier processing remains lawful.",
        "We only send information about future events if you tick the optional box, and you can stop at any time by contacting us.",
        "Committee and staff data is used to secure access and run the event, based on the organiser's legitimate interest in protecting participants' data (Article 6(1)(f)).",
        "If the event has a fee, the association's financial records are kept because of the legal bookkeeping obligation (Article 6(1)(c)). We do not sell data, use it for advertising, or build profiles.",
      ],
    },
    {
      heading: "6. Who receives the data",
      paragraphs: ["We use these service providers as processors, only to run this system:"],
      bullets: [
        "Cloudflare: application hosting, the database (stored in the European Union), and the Turnstile bot check.",
        "Resend: sending email (confirmations, tickets, login codes).",
        "Google: only for committee members or staff who choose to sign in with Google (see section 4).",
        "PPME Den Haag volunteers who are authorised to see data for their task, and only to that extent.",
        "Some of the services above may process data outside the European Union (for example in the United States). These providers rely on GDPR-recognised safeguards such as Standard Contractual Clauses or the EU-US Data Privacy Framework.",
      ],
    },
    {
      heading: "7. Cookies",
      paragraphs: [
        "We only use the session cookies needed to keep you signed in (for example for My Registration, the committee pages and the check-in app) and a short-lived cookie during Google sign-in. There are no tracking, analytics or advertising cookies. Fonts and images are loaded from our own server.",
      ],
    },
    {
      heading: "8. How long we keep data",
      bullets: [
        "Participant data (name, email, WhatsApp, gender, age group, status, ticket codes), email logs and the activity log are deleted or anonymised no later than 90 days after the event.",
        "If the event has a fee, financial records at the bank and in the association's books, which are outside this system, are kept as Dutch law requires (generally 7 years).",
        "Check-in details (which staff member and which device) are anonymised 30 days after the event ends; staff sessions and device self-test results are deleted at the same time.",
        "Committee viewer access ends 7 days after the event and its data is deleted. Sign-in sessions last 24 hours (admins), 48 hours (check-in staff) or 3 days (committee viewers); email login codes are valid for 10 minutes.",
        "If there is a security incident or a dispute, related data may be kept longer, only as long as needed to resolve it.",
      ],
    },
    {
      heading: "9. Security",
      bullets: [
        "The QR code contains only a random ticket code, never a name or personal data. Only admins and authorised staff can see who owns a code.",
        "Volunteer access is granted by an admin according to their task, checked on every request, and can be revoked at any time. Every volunteer must keep data confidential (see Terms of Service section 5). Admin actions are recorded in the activity log.",
        "Session tokens are stored only as hashes. All traffic uses HTTPS and the form is protected by a bot check.",
      ],
    },
    {
      heading: "10. Your rights and how to complain",
      paragraphs: [
        "You can ask for access to, correction or deletion of your data, restrict or object to processing, withdraw your consent, and ask for your data in a readable format.",
        "We are volunteers without a legal team. Complaints are handled directly by the PPME Den Haag board: email event@ppmedenhaag.nl with the subject \"Privacy\". We confirm receipt and reply within one month at the latest. If you still feel your data is not handled properly, you have the right to complain to the Autoriteit Persoonsgegevens (the Dutch Data Protection Authority, autoriteitpersoonsgegevens.nl).",
      ],
      bullets: [
        "While registration is open you can view, change and cancel your registration yourself on the My Registration page.",
        "For any other request, email us from the address you registered with so we can confirm your identity. We may ask for brief information to verify it.",
        "We handle your requests free of charge.",
      ],
    },
    {
      heading: "11. Data breaches",
      paragraphs: [
        "If a security breach puts your data at risk, we report it to the Autoriteit Persoonsgegevens within 72 hours of becoming aware of it where required. If the risk to you is high, we also tell you by email what happened and what we are doing about it.",
      ],
    },
    {
      heading: "12. Changes",
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
        "Sistem ini dipakai untuk pendaftaran, pelacakan pembayaran, tiket QR, dan check-in Kajian PPME Den Haag. Ada tiga kelompok pengguna: pendaftar (publik), anggota panitia dan pemirsa ringkasan, serta petugas check-in. Layanan dikelola oleh panitia PPME Den Haag, seluruhnya relawan, dengan upaya terbaik tetapi tanpa tim profesional.",
      ],
    },
    {
      heading: "2. Pendaftaran dan tiket",
      bullets: [
        "Isilah data dengan benar dan lengkap. Pendaftar harus berusia 18 tahun ke atas dan berwenang mendaftarkan peserta lain yang ia sertakan, termasuk anak-anak, yang tetap menjadi tanggung jawabnya selama acara.",
        "Kuota terbatas. Tempat ditahan sesuai status pendaftaran dan, jika acara berbayar, batas waktu pembayaran yang tertera pada email Anda; pendaftaran yang tidak dibayar sebelum batas waktu dapat dibatalkan otomatis dan tempatnya dilepas.",
        "Keanggotaan PPME Den Haag divalidasi oleh admin. Panitia dapat menolak klaim keanggotaan yang tidak dapat diverifikasi.",
        "Kode QR bersifat pribadi. Jangan membagikannya di tempat umum. Satu kode hanya dapat dipakai untuk masuk satu kali per peserta.",
        "Perubahan atau pembatalan oleh pendaftar hanya dapat dilakukan selama jendela pendaftaran masih terbuka dan sesuai aturan di halaman Pendaftaran Saya. Setelah itu hubungi panitia lewat email.",
      ],
    },
    {
      heading: "3. Pembayaran dan infaq",
      paragraphs: [
        "Acara dapat gratis atau berbayar, sesuai pengaturan panitia untuk setiap acara. Jika ada biaya, pembayaran dilakukan sesuai petunjuk pada email dan halaman pendaftaran, dengan kode pembayaran yang diberikan. Infaq tambahan bersifat sukarela. Jika panitia membatalkan acara berbayar, pembayaran yang sudah diterima dikembalikan. Permintaan pengembalian dana lainnya ditinjau panitia secara adil kasus per kasus; hubungi event@ppmedenhaag.nl.",
      ],
    },
    {
      heading: "4. Perubahan acara dan tata tertib",
      bullets: [
        "Jadwal, pembicara, atau lokasi dapat berubah karena keadaan di luar kendali kami. Panitia akan memberi tahu lewat email dan halaman pendaftaran.",
        "Peserta diharapkan menjaga adab dan ketertiban selama acara dan mengikuti arahan petugas. Orang tua atau wali mengawasi anak yang dibawanya.",
        "Panitia dapat menolak masuk atau meminta keluar peserta yang mengganggu jalannya acara.",
      ],
    },
    {
      heading: "5. Akun panitia, pemirsa, dan petugas check-in",
      bullets: [
        "Akses hanya untuk orang yang didaftarkan oleh admin. Masuk memakai kode 6 digit lewat email atau, bila tersedia, akun Google yang emailnya terdaftar.",
        "Jaga kerahasiaan akses Anda. Jangan membagikan kode masuk atau meminjamkan perangkat yang sedang masuk.",
        "Data peserta yang Anda lihat hanya boleh dipakai untuk tugas Anda pada acara ini, dan wajib dirahasiakan. Dilarang menyalin, menyimpan di luar sistem, atau membagikannya. Karena data ini dapat menunjukkan keyakinan agama, kerahasiaannya sangat penting.",
        "Laporkan segera ke admin jika perangkat atau akses Anda hilang atau disalahgunakan. Panitia dapat mencabut akses kapan saja.",
      ],
    },
    {
      heading: "6. Penggunaan yang wajar",
      paragraphs: [
        "Dilarang mendaftar dengan data palsu, mendaftar berulang untuk menahan kuota, memakai skrip atau bot, mencoba menembus atau mengganggu keamanan sistem, atau memakai kode tiket orang lain. Pelanggaran dapat berakibat pembatalan pendaftaran atau pencabutan akses.",
      ],
    },
    {
      heading: "7. Dokumentasi acara",
      paragraphs: [
        "Acara ini dapat didokumentasikan (foto/video) dan disiarkan langsung, dan dokumentasi dapat dipublikasikan di kanal PPME Den Haag. Jika Anda tidak ingin tampil, beri tahu panitia di lokasi atau lewat email.",
      ],
    },
    {
      heading: "8. Privasi",
      paragraphs: ["Cara kami memproses data pribadi dijelaskan dalam Kebijakan Privasi, yang menjadi bagian dari ketentuan ini."],
    },
    {
      heading: "9. Ketersediaan dan batas tanggung jawab",
      paragraphs: [
        "Kami berusaha menjaga sistem tetap berjalan, tetapi layanan disediakan apa adanya dan dapat terganggu atau diubah, misalnya karena pemeliharaan atau gangguan penyedia layanan. Sejauh diizinkan hukum, panitia tidak bertanggung jawab atas kerugian tidak langsung akibat gangguan tersebut. Ketentuan ini tidak membatasi hak Anda yang tidak dapat dikesampingkan menurut hukum.",
      ],
    },
    {
      heading: "10. Pertanyaan, keluhan, dan hukum yang berlaku",
      paragraphs: [
        "Jika ada pertanyaan atau keberatan, hubungi kami di event@ppmedenhaag.nl. Kami mengutamakan penyelesaian secara musyawarah. Ketentuan ini dapat diperbarui; versi terbaru selalu ada di halaman ini. Hukum Belanda berlaku.",
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
        "This system is used for registration, payment tracking, QR tickets and check-in for the Kajian PPME Den Haag. There are three groups of users: registrants (public), committee members and dashboard viewers, and check-in staff. The service is run by the PPME Den Haag committee, all volunteers, on a best-effort basis without a professional team.",
      ],
    },
    {
      heading: "2. Registration and tickets",
      bullets: [
        "Enter correct and complete information. The registrant must be 18 or older and authorised to register the other participants they include, including children, who remain their responsibility during the event.",
        "Places are limited. A place is held according to your registration status and, if the event has a fee, the payment deadline shown in your email; a registration that is not paid before the deadline can be cancelled automatically and the place released.",
        "Membership of PPME Den Haag is validated by an admin. The committee may reject a membership claim that cannot be verified.",
        "The QR code is personal. Do not share it publicly. One code can be used to enter once per participant.",
        "Changes or cancellations by the registrant are only possible while the registration window is open and within the rules on the My Registration page. After that, contact the committee by email.",
      ],
    },
    {
      heading: "3. Payment and infaq",
      paragraphs: [
        "An event can be free or paid, as set by the committee for each event. If there is a fee, payment is made as described in the email and on the registration page, using the payment code you are given. Additional infaq is voluntary. If the committee cancels a paid event, payments already received are refunded. Other refund requests are reviewed fairly by the committee case by case; contact event@ppmedenhaag.nl.",
      ],
    },
    {
      heading: "4. Event changes and conduct",
      bullets: [
        "The schedule, speaker or venue may change due to circumstances beyond our control. The committee will tell you by email and on the registration page.",
        "Participants are expected to behave respectfully and orderly during the event and follow the instructions of the staff. Parents or guardians supervise the children they bring.",
        "The committee may refuse entry to, or ask to leave, a participant who disrupts the event.",
      ],
    },
    {
      heading: "5. Committee, viewer and check-in staff accounts",
      bullets: [
        "Access is only for people registered by an admin. You sign in with a 6-digit email code or, where available, a Google account whose email is registered.",
        "Keep your access confidential. Do not share login codes or lend a device that is signed in.",
        "Participant data you can see may only be used for your task at this event and must be kept confidential. Do not copy it, store it outside the system, or share it. Because this data can reveal religious beliefs, confidentiality is essential.",
        "Report to an admin at once if your device or access is lost or misused. The committee can revoke access at any time.",
      ],
    },
    {
      heading: "6. Acceptable use",
      paragraphs: [
        "Do not register with false information, register repeatedly to hold places, use scripts or bots, try to break into or disrupt the system, or use someone else's ticket code. Violations can lead to cancellation of the registration or removal of access.",
      ],
    },
    {
      heading: "7. Event documentation",
      paragraphs: [
        "The event may be photographed, filmed and live-streamed, and the material may be published on PPME Den Haag channels. If you do not wish to appear, tell the committee at the venue or by email.",
      ],
    },
    {
      heading: "8. Privacy",
      paragraphs: ["How we process personal data is described in the Privacy Policy, which is part of these terms."],
    },
    {
      heading: "9. Availability and limitation of liability",
      paragraphs: [
        "We try to keep the system running, but the service is provided as is and may be interrupted or changed, for example because of maintenance or a provider outage. To the extent the law allows, the committee is not liable for indirect loss caused by such interruptions. These terms do not limit any rights you have that cannot be waived by law.",
      ],
    },
    {
      heading: "10. Questions, complaints and governing law",
      paragraphs: [
        "If you have a question or an objection, contact us at event@ppmedenhaag.nl. We prefer to resolve matters by mutual consultation (musyawarah). These terms may be updated; the latest version is always on this page. Dutch law applies.",
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
