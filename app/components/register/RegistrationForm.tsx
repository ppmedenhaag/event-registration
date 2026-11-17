import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ClipboardDocumentCheckIcon,
  EnvelopeIcon,
  ExclamationCircleIcon,
  IdentificationIcon,
  LockClosedIcon,
  PhoneIcon,
  UserGroupIcon,
  UserIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { Form, Link } from "react-router";

import { Callout, buttonClass } from "~/components/ui";
import { formatDateTime, formatEuro } from "~/lib/format";
import { validateRegistrationDraft, type FieldErrors } from "~/lib/validation";
import { CheckField, ChoiceField, CountCombobox, TextInputField } from "./controls";
import type { PublicEvent } from "./HeaderSection";
import { ReviewDialog, type ReviewSummary } from "./ReviewDialog";

const FORM_ID = "registration-form";

interface ParticipantDraft {
  name: string;
  gender: string;
  ageGroup: string;
}

const emptyParticipant = (): ParticipantDraft => ({ name: "", gender: "", ageGroup: "" });

export interface FormFailure {
  ok: false;
  errors: FieldErrors;
  message: string;
  /** Duplicate email: offer the "Pendaftaran Saya" page. */
  manageLink?: boolean;
}

export function RegistrationForm({
  event,
  siteKey,
  quotaFull,
  nonMemberOpen: initiallyNonMemberOpen,
  serverNow,
  failure,
  submitting,
}: {
  event: PublicEvent;
  siteKey: string;
  quotaFull: { member: boolean; nonMember: boolean };
  nonMemberOpen: boolean;
  serverNow: string;
  failure?: FormFailure;
  submitting: boolean;
}) {
  const [registrantName, setRegistrantName] = useState("");
  const [membership, setMembership] = useState("");
  const [consent, setConsent] = useState(false);
  const [mediaConsent, setMediaConsent] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [nonMemberOpen, setNonMemberOpen] = useState(initiallyNonMemberOpen);
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [submitted, setSubmitted] = useState(false);
  /** Fields the visitor has left at least once (live errors); `edited:<field>` hides a stale server error. */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const touch = (key: string) => setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  const [count, setCount] = useState(1);
  const [participants, setParticipants] = useState<ParticipantDraft[]>([{ ...emptyParticipant(), ageGroup: "dewasa" }]);

  useEffect(() => {
    setNonMemberOpen(initiallyNonMemberOpen);
    if (initiallyNonMemberOpen || !event.nonMemberOpensAt) return;

    const opensAt = Date.parse(event.nonMemberOpensAt);
    if (Number.isNaN(opensAt)) return;
    // Use the server's clock (offset measured at load), so a wrong phone clock cannot open the option early or late.
    const offset = Date.parse(serverNow) - Date.now();
    const now = () => Date.now() + (Number.isNaN(offset) ? 0 : offset);

    let timer: number | undefined;
    const updateOpenState = () => {
      const delay = opensAt - now();
      if (delay <= 0) {
        setNonMemberOpen(true);
        return;
      }
      timer = window.setTimeout(updateOpenState, Math.min(delay, 2_147_000_000));
    };
    updateOpenState();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [event.nonMemberOpensAt, initiallyNonMemberOpen, serverNow]);
  const [firstNameTouched, setFirstNameTouched] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  // A server-side failure (Turnstile, quota, duplicate email, validation) closes the review and shows the error.
  useEffect(() => {
    if (failure) setReviewOpen(false);
  }, [failure]);

  // A fresh key per filled-in form: a double submit returns the same registration.
  useEffect(() => setIdempotencyKey(crypto.randomUUID()), []);

  useEffect(() => {
    setParticipants((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push(emptyParticipant());
      return next;
    });
  }, [count]);

  useEffect(() => {
    if (!firstNameTouched) {
      setParticipants((prev) => prev.map((p, i) => (i === 0 ? { ...p, name: registrantName } : p)));
    }
  }, [registrantName, firstNameTouched]);

  // Front-end validation (same rules as the server, Indonesian messages). Shown per field after blur / first submit try;
  // a server error (duplicate email, ...) stays until the visitor edits that field.
  const clientErrors = useMemo(
    () =>
      validateRegistrationDraft(
        { registrantName, membership, email, whatsapp, participants, consent, mediaConsent, marketingOptIn, idempotencyKey: undefined },
        event.maxFamily,
      ),
    [registrantName, membership, email, whatsapp, participants, consent, mediaConsent, marketingOptIn, event.maxFamily],
  );
  const errors: FieldErrors = {};
  for (const [key, msg] of Object.entries(failure?.errors ?? {})) if (!touched.has(`edited:${key}`)) errors[key] = msg;
  for (const [key, msg] of Object.entries(clientErrors)) if (submitted || touched.has(key)) errors[key] = msg;
  const blur = (key: string) => () => touch(key);
  const change = (key: string) => touch(`edited:${key}`);

  const update = (i: number, patch: Partial<ParticipantDraft>) =>
    setParticipants((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  return (
    <Form
      method="post"
      id={FORM_ID}
      noValidate
      onSubmit={(e) => {
        setSubmitted(true);
        if (Object.keys(clientErrors).length > 0) {
          e.preventDefault();
          setReviewOpen(false);
          const form = e.currentTarget;
          // After the error lines have rendered: jump to the first invalid field.
          requestAnimationFrame(() => {
            const first = form.querySelector<HTMLElement>('[aria-invalid="true"]');
            first?.scrollIntoView({ block: "center", behavior: "smooth" });
            first?.focus({ preventScroll: true });
          });
          return;
        }
        // First submit opens the review; only the review's "Ya, kirim pendaftaran" button really sends the form.
        if (!reviewOpen) {
          e.preventDefault();
          setReview({
            registrantName: registrantName.trim(),
            membership,
            email: email.trim(),
            whatsapp: whatsapp.trim(),
            participants: participants.map((p) => ({ ...p, name: p.name.trim() })),
            marketingOptIn,
          });
          setReviewOpen(true);
        }
      }}
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="participantCount" value={count} />

      <div className="divide-y divide-slate-200/80 border-t border-slate-200/80">
        <FormSection icon={IdentificationIcon} title="Data pendaftar" description="Orang yang mengisi formulir dan menerima email konfirmasi.">
          <div className="grid gap-5 md:grid-cols-2">
            <TextInputField
              label="Nama lengkap pendaftar"
              icon={UserIcon}
              name="registrantName"
              maxLength={120}
              autoComplete="name"
              value={registrantName}
              onChange={(e) => {
                change("registrantName");
                setRegistrantName(e.target.value);
              }}
              onBlur={blur("registrantName")}
              placeholder="Masukkan nama lengkap"
              error={errors.registrantName}
            />
            <ChoiceField
              label="Apakah Anda anggota PPME Den Haag?"
              name="membership"
              value={membership}
              onChange={(v) => {
                change("membership");
                setMembership(v);
              }}
              error={errors.membership}
              options={[
                {
                  value: "Ya",
                  label: "Ya, anggota",
                  hint: quotaFull.member ? "Kuota penuh" : "Gratis",
                  disabled: quotaFull.member,
                },
                {
                  value: "Tidak",
                  label: "Bukan anggota",
                  hint: quotaFull.nonMember
                    ? "Kuota penuh"
                    : !nonMemberOpen
                      ? `Dibuka ${formatDateTime(event.nonMemberOpensAt)} waktu Belanda`
                      : event.priceCents === 0
                        ? "Gratis"
                        : `${formatEuro(event.priceCents)} per orang (remaja & dewasa)`,
                  disabled: quotaFull.nonMember || !nonMemberOpen,
                },
              ]}
            />
            <TextInputField
              label="Alamat email aktif"
              icon={EnvelopeIcon}
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                change("email");
                setEmail(e.target.value);
              }}
              onBlur={blur("email")}
              placeholder="nama@email.com"
              hint="Konfirmasi dikirim ke alamat ini. QR Code menyusul setelah pembayaran dikonfirmasi atau keanggotaan divalidasi."
              error={errors.email}
            />
            <TextInputField
              label="Nomor WhatsApp"
              icon={PhoneIcon}
              name="whatsapp"
              type="tel"
              autoComplete="tel"
              value={whatsapp}
              onChange={(e) => {
                change("whatsapp");
                setWhatsapp(e.target.value);
              }}
              onBlur={blur("whatsapp")}
              placeholder="+31 6 ..."
              hint="Hanya untuk menghubungi Anda terkait acara ini."
              error={errors.whatsapp}
            />
          </div>
        </FormSection>

        <FormSection
          icon={UsersIcon}
          title="Jumlah peserta"
          description={`Perorangan atau keluarga, maksimal ${event.maxFamily} orang termasuk Anda.`}
        >
          <div className="md:max-w-sm">
            <CountCombobox
              label="Berapa jumlah seluruh peserta (termasuk Anda)?"
              value={count}
              max={event.maxFamily}
              onChange={setCount}
              error={errors.participants}
            />
          </div>
        </FormSection>

        <FormSection
          icon={UserGroupIcon}
          title="Data seluruh peserta"
          description="Kelompok usia dan jenis kelamin diperlukan untuk pengaturan tempat dan kategori usia."
        >
          <div className="divide-y divide-slate-200/80">
            {participants.map((p, i) => (
              <fieldset key={i} className="min-w-0 py-6 first:pt-0 last:pb-0">
                <legend className="float-left mb-4 flex w-full items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-md border border-brand-200 bg-brand-50 font-mono text-xs font-semibold text-brand">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">Peserta {i + 1}</span>
                  {i === 0 ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Pendaftar</span>
                  ) : null}
                </legend>
                <div className="clear-left grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
                  <TextInputField
                    label="Nama lengkap"
                    icon={UserIcon}
                    name={`p${i}_name`}
                    maxLength={120}
                    value={p.name}
                    onChange={(e) => {
                      if (i === 0) setFirstNameTouched(true);
                      change(`participants.${i}.name`);
                      update(i, { name: e.target.value });
                    }}
                    onBlur={blur(`participants.${i}.name`)}
                    error={errors[`participants.${i}.name`]}
                    className="sm:col-span-2"
                  />
                  <ChoiceField
                    label="Jenis kelamin"
                    name={`p${i}_gender`}
                    value={p.gender}
                    onChange={(v) => {
                      change(`participants.${i}.gender`);
                      update(i, { gender: v });
                    }}
                    error={errors[`participants.${i}.gender`]}
                    options={[
                      { value: "laki-laki", label: "Laki-laki" },
                      { value: "perempuan", label: "Perempuan" },
                    ]}
                    className="sm:col-span-2"
                  />
                  {i === 0 ? (
                    <>
                      <input type="hidden" name={`p${i}_ageGroup`} value="dewasa" />
                      <p className="text-[13px] text-slate-500 sm:col-span-2">
                        Pendaftar harus berusia dewasa (18 tahun ke atas).
                      </p>
                    </>
                  ) : (
                  <ChoiceField
                    label="Kelompok usia"
                    name={`p${i}_ageGroup`}
                    value={p.ageGroup}
                    onChange={(v) => {
                      change(`participants.${i}.ageGroup`);
                      update(i, { ageGroup: v });
                    }}
                    error={errors[`participants.${i}.ageGroup`]}
                    options={[
                      { value: "balita", label: "Balita", hint: "di bawah 5 tahun" },
                      { value: "anak", label: "Anak", hint: "5 – di bawah 12 tahun" },
                      { value: "remaja", label: "Remaja", hint: "12 – di bawah 18 tahun" },
                      { value: "dewasa", label: "Dewasa", hint: "18 tahun ke atas" },
                    ]}
                    className="sm:col-span-2"
                  />
                  )}
                </div>
              </fieldset>
            ))}
          </div>
        </FormSection>

        <FormSection icon={LockClosedIcon} title="Privasi" description="Bagaimana data Anda digunakan dan disimpan.">
          <p className="text-sm leading-relaxed text-slate-600">
            PPME Den Haag memproses data di formulir ini hanya untuk pendaftaran, pembayaran, tiket, dan check-in acara
            ini. Data disimpan di layanan Cloudflare (Uni Eropa) dan email dikirim melalui Resend. Data peserta dihapus
            atau dianonimkan paling lambat 90 hari setelah acara; catatan pembayaran disimpan sesuai kewajiban
            pembukuan. Anda dapat meminta akses, koreksi, atau penghapusan data melalui email panitia.{" "}
            <a href="/privacy" target="_blank" rel="noopener" className="font-medium text-brand underline hover:text-brand-dark">
              Baca Kebijakan Privasi
            </a>{" "}
            dan{" "}
            <a href="/terms" target="_blank" rel="noopener" className="font-medium text-brand underline hover:text-brand-dark">
              Ketentuan Layanan
            </a>
            .
          </p>
          <div className="mt-5 space-y-4 border-t border-slate-200/80 pt-5">
            <div>
              <CheckField
                name="consent"
                checked={consent}
                onChange={(v) => {
                  change("consent");
                  setConsent(v);
                }} invalid={!!errors.consent} required>
                Saya menyetujui pemrosesan data saya dan seluruh peserta yang saya daftarkan untuk keperluan kajian
                keagamaan ini, saya berwenang mendaftarkan mereka, dan saya menyatakan bahwa saya sebagai pendaftar berusia 18 tahun ke atas (dewasa).
              </CheckField>
              {errors.consent ? (
                <p className="mt-1.5 flex items-center gap-1.5 pl-8 text-[13px] font-medium text-red-600">
                  <ExclamationCircleIcon className="size-4 shrink-0" aria-hidden="true" />
                  {errors.consent}
                </p>
              ) : null}
            </div>
            <div>
              <CheckField
                name="mediaConsent"
                checked={mediaConsent}
                onChange={(v) => {
                  change("mediaConsent");
                  setMediaConsent(v);
                }}
                invalid={!!errors.mediaConsent}
                required
              >
                Saya memahami bahwa acara ini akan didokumentasikan (foto/video) dan disiarkan langsung (live
                streaming), dan dokumentasi dapat dipublikasikan di kanal PPME Den Haag. Jika saya tidak ingin tampil,
                saya akan memberi tahu panitia di lokasi atau melalui email. Saya juga menyampaikan hal ini kepada
                peserta lain yang saya daftarkan, termasuk anak-anak.
              </CheckField>
              {errors.mediaConsent ? (
                <p className="mt-1.5 flex items-center gap-1.5 pl-8 text-[13px] font-medium text-red-600">
                  <ExclamationCircleIcon className="size-4 shrink-0" aria-hidden="true" />
                  {errors.mediaConsent}
                </p>
              ) : null}
            </div>
            <CheckField name="marketingOptIn" checked={marketingOptIn} onChange={setMarketingOptIn}>
              <span className="text-slate-500">(Opsional)</span> Saya bersedia menerima informasi kegiatan PPME Den
              Haag berikutnya.
            </CheckField>
          </div>
        </FormSection>
      </div>

      <div className="border-t border-slate-200/80 bg-slate-50/70 px-5 py-6 sm:px-8 lg:px-10">
        {failure ? (
          <Callout tone="danger" role="alert" icon={ExclamationCircleIcon} className="mb-5">
            <p>{failure.message}</p>
            {failure.manageLink ? (
              <p>
                <Link to={`/e/${event.slug}/pendaftaran-saya`} className="font-semibold underline">
                  Buka Pendaftaran Saya
                </Link>
              </p>
            ) : null}
          </Callout>
        ) : null}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-slate-600">Anda dapat memeriksa kembali seluruh data sebelum pendaftaran dikirim.</p>
          <button type="submit" className={buttonClass("primary", "lg", "w-full md:w-auto md:min-w-72")}>
            Kirim pendaftaran
            <ClipboardDocumentCheckIcon className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <ReviewDialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        formId={FORM_ID}
        siteKey={siteKey}
        summary={review}
        priceCents={event.priceCents}
        payWindowHours={event.payWindowHours}
        submitting={submitting}
      />
    </Form>
  );
}

/** Two-column form section: icon, heading and description on the left, fields on the right. */
function FormSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof UserIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-x-10 gap-y-5 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:px-10 lg:py-10">
      <div>
        <div className="flex items-center gap-3 lg:flex-col lg:items-start">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-white shadow-sm shadow-brand/20">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">{title}</h2>
        </div>
        {description ? <p className="mt-2 text-sm leading-relaxed text-slate-500">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
