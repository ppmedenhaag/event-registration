import { Field, Input, Label } from "@headlessui/react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  UserIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { Form, data, redirect, useActionData, useNavigation } from "react-router";

import type { Route } from "./+types/login";
import { Notice } from "~/components/admin";
import { inputClass, TextField } from "~/components/forms";
import { GoogleSignIn } from "~/components/GoogleSignIn";
import { Turnstile } from "~/components/Turnstile";
import { Backdrop, buttonClass, Callout, Eyebrow, Logo, Spinner } from "~/components/ui";
import { normalizeEmail } from "~/lib/admins.server";
import { isSameOrigin, requestMeta } from "~/lib/auth.server";
import { emailConfig, isDev, viewerEnabled } from "~/lib/config.server";
import { getEventBySlug } from "~/lib/db.server";
import { getAppEnv } from "~/lib/env.server";
import { googleConfig } from "~/lib/google-oauth.server";
import { CODE_COOLDOWN_MS, CODE_TTL_MS, isValidEmail, requestLoginCode, verifyLoginCode } from "~/lib/login-codes.server";
import { verifyTurnstile } from "~/lib/turnstile.server";
import { createViewerSession, identifyPanitia, viewerSessionCookie } from "~/lib/viewer-auth.server";
import { requestViewerAccess, validateAccessRequest, viewerExpiry } from "~/lib/viewers.server";

export function meta() {
  return [{ title: "Masuk – Ringkasan Panitia PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

function gate() {
  const env = getAppEnv();
  if (!viewerEnabled(env)) throw data("Tidak ditemukan.", { status: 404 });
  return env;
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: "Masuk dengan Google dibatalkan.",
  google_state: "Sesi masuk dengan Google sudah kedaluwarsa. Silakan coba lagi.",
  google_exchange: "Google tidak dapat memverifikasi permintaan ini. Silakan coba lagi.",
  google_token: "Tanda masuk dari Google tidak valid. Silakan coba lagi.",
  google_unverified: "Alamat email akun Google ini belum terverifikasi oleh Google.",
  google_not_viewer: "Akun Google ini belum disetujui untuk Ringkasan Panitia. Gunakan tab \"Minta akses\" jika belum mengajukan.",
};

export async function loader({ request, url }: Route.LoaderArgs) {
  const env = gate();
  if (await identifyPanitia(request, env)) throw redirect("/panitia");
  return {
    turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() ?? "",
    google: googleConfig(env) !== null,
    googleError: GOOGLE_ERRORS[url.searchParams.get("error") ?? ""] ?? null,
    loggedOut: url.searchParams.has("out"),
    startInAccess: url.searchParams.get("mode") === "access",
    devLog: isDev(env) && env.EMAIL_MODE !== "resend",
    validMinutes: CODE_TTL_MS / 60_000,
    cooldownSeconds: Math.round(CODE_COOLDOWN_MS / 1000),
  };
}

type ActionData =
  | { step: "email"; mode: "login" | "access"; email: string; error: string }
  | { step: "code"; email: string; sentAt: number; resent?: boolean; error?: string }
  | { step: "access_done"; email: string };

const TURNSTILE_ERROR = "Verifikasi keamanan gagal atau kedaluwarsa. Silakan selesaikan verifikasi lalu coba lagi.";

export async function action({ request, url }: Route.ActionArgs) {
  const env = gate();
  if (!isSameOrigin(request)) throw data("Permintaan ditolak.", { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const turnstile = () =>
    verifyTurnstile(env.TURNSTILE_SECRET, form.get("cf-turnstile-response")?.toString() ?? null, request.headers.get("CF-Connecting-IP"));

  // 1) Ask for a login code. The answer is the same whether or not the email is approved (no enumeration).
  if (intent === "request") {
    const resend = form.get("resend") === "1";
    if (!isValidEmail(email)) {
      return data<ActionData>({ step: "email", mode: "login", email, error: "Masukkan alamat email yang valid." }, { status: 400 });
    }
    const pass = await turnstile();
    if (!pass.success) {
      console.error("viewer login turnstile failed:", pass.errorCodes.join(",") || "unknown");
      return data<ActionData>(
        resend ? { step: "code", email, sentAt: Number(form.get("sentAt")) || Date.now(), error: TURNSTILE_ERROR } : { step: "email", mode: "login", email, error: TURNSTILE_ERROR },
        { status: 400 },
      );
    }
    await requestLoginCode(env.DB, emailConfig(env), email, { ...requestMeta(request), appOrigin: url.origin }, new Date(), "viewer");
    return data<ActionData>({ step: "code", email, sentAt: Date.now(), resent: resend });
  }

  // 2) Check the code and start a session.
  if (intent === "verify") {
    const sentAt = Number(form.get("sentAt")) || Date.now();
    const result = await verifyLoginCode(env.DB, email, String(form.get("code") ?? ""), new Date(), "viewer");
    if (!result.ok) return data<ActionData>({ step: "code", email, sentAt, error: result.message }, { status: 400 });
    const session = await createViewerSession(env.DB, email, requestMeta(request));
    if (!session) {
      return data<ActionData>({ step: "email", mode: "login", email, error: "Akses untuk email ini tidak lagi aktif." }, { status: 403 });
    }
    throw redirect("/panitia", { headers: { "Set-Cookie": viewerSessionCookie(request, session.token) } });
  }

  // 3) Ask an admin for access. Same neutral answer for a new request, a repeat, an existing viewer or a full queue.
  if (intent === "access") {
    const checked = validateAccessRequest({
      email,
      name: String(form.get("name") ?? ""),
      section: String(form.get("section") ?? ""),
    });
    if (!checked.ok) return data<ActionData>({ step: "email", mode: "access", email, error: checked.message }, { status: 400 });
    const pass = await turnstile();
    if (!pass.success) {
      console.error("viewer access turnstile failed:", pass.errorCodes.join(",") || "unknown");
      return data<ActionData>({ step: "email", mode: "access", email, error: TURNSTILE_ERROR }, { status: 400 });
    }
    const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
    if (event) await requestViewerAccess(env.DB, checked.value, viewerExpiry(event));
    // Someone who is already approved and clicked "Minta akses" by mistake gets a login code instead. For everybody else
    // this sends nothing (the viewer realm only mails approved, unexpired viewers), and the screen is identical either way.
    await requestLoginCode(env.DB, emailConfig(env), checked.value.email, { ...requestMeta(request), appOrigin: url.origin }, new Date(), "viewer");
    return data<ActionData>({ step: "access_done", email: checked.value.email });
  }

  throw data("Permintaan tidak dikenal.", { status: 400 });
}

export default function PanitiaLogin({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<ActionData>();
  const [mode, setMode] = useState<"login" | "access">(loaderData.startInAccess ? "access" : "login");
  const [haveCode, setHaveCode] = useState<number | null>(null);
  const accessDone = actionData?.step === "access_done" ? actionData : null;
  // After "Minta akses" the visitor may already hold a code (approved people get one): offer the code box without revealing anything.
  const code = actionData?.step === "code" ? actionData : accessDone && haveCode ? { email: accessDone.email, sentAt: haveCode, resent: false, error: undefined } : null;
  const done = !!accessDone && !haveCode;
  const emailErr = actionData?.step === "email" ? actionData : null;
  const activeMode = emailErr ? emailErr.mode : mode;

  return (
    <Backdrop>
      <main className="mx-auto flex min-h-screen w-full max-w-[28rem] flex-col justify-center px-4 py-10 sm:py-16">
        <div className="border border-slate-200/80 bg-white/85 shadow-sm shadow-slate-900/5 backdrop-blur-md">
          <div className="h-1 bg-brand" aria-hidden="true" />
          <header className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 pt-7 pb-6 sm:px-8">
            <div className="min-w-0">
              <Eyebrow className="flex items-center gap-2 text-brand">
                <span className="inline-block size-1.5 rounded-full bg-brand" aria-hidden="true" />
                Ringkasan Panitia
              </Eyebrow>
              <h1 className="text-gradient-brand mt-2.5 text-[1.75rem] leading-tight font-bold tracking-tight">
                {code ? "Masukkan kode" : done ? "Permintaan terkirim" : activeMode === "access" ? "Minta akses" : "Masuk"}
              </h1>
            </div>
            <Logo className="h-10 w-auto sm:h-12" />
          </header>

          <div className="px-6 py-7 sm:px-8">
            {code ? (
              <CodeStep
                key={code.sentAt}
                email={code.email}
                sentAt={code.sentAt}
                resent={!!code.resent}
                error={code.error}
                validMinutes={loaderData.validMinutes}
                cooldown={loaderData.cooldownSeconds}
                siteKey={loaderData.turnstileSiteKey}
              />
            ) : done ? (
              <div className="space-y-5">
                <Notice
                  result={{
                    ok: true,
                    message:
                      "Permintaan diterima. Admin akan meninjaunya dan Anda akan diberi tahu lewat email setelah disetujui.",
                  }}
                />
                <p className="text-sm text-slate-500">
                  Anda tidak perlu mengirim permintaan lagi. Jika email ini ternyata sudah disetujui, kode masuk dikirim ke emailnya sekarang.
                </p>
                <button type="button" onClick={() => setHaveCode(Date.now())} className={buttonClass("secondary", "md", "w-full")}>
                  Sudah menerima kode? Masukkan di sini
                </button>
              </div>
            ) : (
              <EmailStep
                key={activeMode}
                mode={activeMode}
                onMode={setMode}
                defaultEmail={emailErr?.email ?? ""}
                error={emailErr?.error ?? loaderData.googleError}
                google={loaderData.google}
                loggedOut={loaderData.loggedOut && !actionData}
                siteKey={loaderData.turnstileSiteKey}
              />
            )}
            {loaderData.devLog ? (
              <Callout tone="warning" icon={WrenchScrewdriverIcon} className="mt-6 text-[13px]">
                Mode lokal: email tidak dikirim. Kode masuk tampil di terminal <code>npm run dev</code>.
              </Callout>
            ) : null}
          </div>

          <footer className="flex items-start gap-2.5 border-t border-slate-200/80 bg-slate-50/70 px-6 py-4 text-xs leading-relaxed text-slate-500 sm:px-8">
            <LockClosedIcon className="mt-px size-4 shrink-0 text-slate-400" aria-hidden="true" />
            <p>Khusus panitia Kajian PPME Den Haag. Halaman ini hanya-baca dan hanya menampilkan jumlah peserta, tanpa data pribadi. Setelah masuk, sesi berlaku 3 hari di perangkat ini. <span className="mt-1 block"><a href="/privacy" className="underline hover:text-slate-700">Kebijakan Privasi</a> · <a href="/terms" className="underline hover:text-slate-700">Ketentuan Layanan</a></span></p>
          </footer>
        </div>
      </main>
    </Backdrop>
  );
}

function useBusy(intent: string) {
  const nav = useNavigation();
  return nav.state !== "idle" && nav.formData?.get("intent") === intent;
}

function TurnstileBlock({ siteKey, error, onToken }: { siteKey: string; error: string | null; onToken: (t: string | null) => void }) {
  return siteKey ? (
    <Turnstile siteKey={siteKey} resetKey={error ?? undefined} onToken={onToken} />
  ) : (
    <Callout tone="danger" icon={ExclamationTriangleIcon} className="text-[13px]">
      Verifikasi keamanan (Turnstile) belum dikonfigurasi di server ini, sehingga formulir tidak dapat dikirim.
    </Callout>
  );
}

function EmailStep({
  mode,
  onMode,
  defaultEmail,
  error,
  google,
  loggedOut,
  siteKey,
}: {
  mode: "login" | "access";
  onMode: (m: "login" | "access") => void;
  defaultEmail: string;
  error: string | null;
  google: boolean;
  loggedOut: boolean;
  siteKey: string;
}) {
  const busy = useBusy(mode === "access" ? "access" : "request");
  const [token, setToken] = useState<string | null>(null);
  const access = mode === "access";
  return (
    <div className="space-y-6">
      {loggedOut ? <Notice result={{ ok: true, message: "Anda telah keluar dari Ringkasan Panitia." }} /> : null}
      {error ? <Notice result={{ ok: false, message: error }} /> : null}

      <p className="text-[15px] leading-relaxed text-slate-600">
        {access ? (
          <>
            Belum punya akses? Isi data berikut. Seorang <span className="font-semibold text-slate-900">admin akan menyetujui</span> permintaan Anda.
          </>
        ) : (
          <>
            Masukkan email panitia Anda yang sudah disetujui. Kami akan mengirim <span className="font-semibold text-slate-900">kode masuk 6 digit</span>.
          </>
        )}
      </p>

      {google && !access ? (
        <GoogleSignIn href="/admin/auth/google?realm=viewer" label="Masuk dengan Google" divider="atau dengan kode email" />
      ) : null}

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value={access ? "access" : "request"} />
        <TextField
          label="Email"
          name="email"
          type="email"
          icon={EnvelopeIcon}
          autoComplete="email"
          inputMode="email"
          placeholder="nama@contoh.com"
          defaultValue={defaultEmail}
          required
          autoFocus
        />
        {access ? (
          <>
            <TextField label="Nama" name="name" icon={UserIcon} maxLength={80} autoComplete="name" placeholder="Nama lengkap" required />
            <TextField label="Seksi / tugas di panitia" name="section" icon={BriefcaseIcon} maxLength={60} autoComplete="off" placeholder="mis. Konsumsi, Anak-anak, Acara" required />
          </>
        ) : null}
        <TurnstileBlock siteKey={siteKey} error={error} onToken={setToken} />
        <button type="submit" disabled={busy || !token} className={buttonClass("primary", "lg", "w-full")}>
          {busy ? <Spinner /> : null}
          {busy ? "Mengirim…" : access ? "Kirim permintaan akses" : "Kirim kode masuk"}
          {busy ? null : <ArrowRightIcon className="size-4" aria-hidden="true" />}
        </button>
      </Form>

      <div className="border-t border-slate-200/80 pt-5 text-sm text-slate-500">
        {access ? (
          <button type="button" onClick={() => onMode("login")} className="font-medium text-brand hover:text-brand-dark">
            Sudah disetujui? Masuk
          </button>
        ) : (
          <button type="button" onClick={() => onMode("access")} className="font-medium text-brand hover:text-brand-dark">
            Belum punya akses? Minta akses
          </button>
        )}
      </div>
    </div>
  );
}

function CodeStep({
  email,
  sentAt,
  resent,
  error,
  validMinutes,
  cooldown,
  siteKey,
}: {
  email: string;
  sentAt: number;
  resent: boolean;
  error?: string;
  validMinutes: number;
  cooldown: number;
  siteKey: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const verifying = useBusy("verify");
  const resending = useBusy("request");
  const formRef = useRef<HTMLFormElement>(null);
  const [wait, setWait] = useState(cooldown);
  useEffect(() => {
    const tick = () => setWait(Math.max(0, cooldown - Math.floor((Date.now() - sentAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sentAt, cooldown]);

  return (
    <div className="space-y-6">
      <Callout tone="info" icon={EnvelopeIcon}>
        <p>
          Jika <span className="font-semibold break-all text-slate-900">{email}</span> sudah disetujui, kode masuk telah dikirim ke alamat tersebut.
          Kode berlaku {validMinutes} menit.
        </p>
        <p className="text-slate-500">Tidak ada di kotak masuk? Periksa folder spam atau promosi.</p>
        <p className="font-medium text-slate-700">
          Tidak ada email dalam 1 menit? Kemungkinan besar email Anda belum disetujui.{" "}
          <a href="/panitia/login?mode=access" className="text-brand underline hover:text-brand-dark">
            Minta akses dulu
          </a>
          .
        </p>
      </Callout>

      {resent && !error ? <Notice result={{ ok: true, message: "Kode baru telah diminta. Kode sebelumnya tidak berlaku lagi." }} /> : null}
      {error ? <Notice result={{ ok: false, message: error }} /> : null}

      <Form method="post" ref={formRef} className="space-y-4">
        <input type="hidden" name="intent" value="verify" />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="sentAt" value={sentAt} />
        <Field>
          <Label className="mb-1.5 block text-sm font-medium text-slate-700">Kode masuk</Label>
          <Input
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            placeholder="000000"
            onChange={(e) => {
              const digits = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
              if (e.currentTarget.value !== digits) e.currentTarget.value = digits;
              if (digits.length === 6 && !verifying) formRef.current?.requestSubmit();
            }}
            className={`${inputClass} min-h-14 text-center font-mono text-2xl font-semibold tracking-[0.5em] text-slate-900 tabular-nums placeholder:tracking-[0.5em] placeholder:text-slate-300`}
          />
        </Field>
        <button type="submit" disabled={verifying} className={buttonClass("primary", "lg", "w-full")}>
          {verifying ? <Spinner /> : null}
          {verifying ? "Memeriksa kode…" : "Masuk"}
          {verifying ? null : <ArrowRightIcon className="size-4" aria-hidden="true" />}
        </button>
      </Form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-5">
        <a href="/panitia/login" className={buttonClass("ghost", "sm", "-ml-3")}>
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Ganti email
        </a>
        <Form method="post" className="flex flex-col items-end gap-2">
          <input type="hidden" name="intent" value="request" />
          <input type="hidden" name="resend" value="1" />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="sentAt" value={sentAt} />
          {siteKey ? <Turnstile siteKey={siteKey} appearance="interaction-only" resetKey={error ?? undefined} onToken={setToken} /> : null}
          <button type="submit" disabled={wait > 0 || resending || !token} className={buttonClass("secondary", "sm")}>
            {resending ? <Spinner /> : <ArrowPathIcon className="size-4" aria-hidden="true" />}
            {wait > 0 ? `Kirim ulang (${wait} dtk)` : "Kirim ulang kode"}
          </button>
        </Form>
      </div>
    </div>
  );
}
