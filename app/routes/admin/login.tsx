import { Field, Input, Label } from "@headlessui/react";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { Form, Link, data, redirect, useActionData, useNavigation } from "react-router";

import type { Route } from "./+types/login";
import { Notice } from "~/components/admin";
import { inputClass, TextField } from "~/components/forms";
import { GoogleSignIn } from "~/components/GoogleSignIn";
import { Turnstile } from "~/components/Turnstile";
import { Backdrop, buttonClass, Callout, Eyebrow, Logo, Spinner } from "~/components/ui";
import { ensureBootstrap, normalizeEmail } from "~/lib/admins.server";
import { createSession, identifyUser, isSameOrigin, requestMeta, safeNextPath, sessionCookie } from "~/lib/auth.server";
import { emailConfig, featureEnabled, isDev } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { googleConfig } from "~/lib/google-oauth.server";
import { CODE_COOLDOWN_MS, CODE_TTL_MS, isValidEmail, requestLoginCode, verifyLoginCode } from "~/lib/login-codes.server";
import { verifyTurnstile } from "~/lib/turnstile.server";

export function meta() {
  return [{ title: "Masuk – Dashboard Panitia PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: "Masuk dengan Google dibatalkan.",
  google_state: "Sesi masuk dengan Google sudah kedaluwarsa. Silakan coba lagi.",
  google_exchange: "Google tidak dapat memverifikasi permintaan ini. Silakan coba lagi.",
  google_token: "Tanda masuk dari Google tidak valid. Silakan coba lagi.",
  google_unverified: "Alamat email akun Google ini belum terverifikasi oleh Google.",
  google_not_admin: "Akun Google ini tidak terdaftar sebagai admin panitia.",
};

function gate() {
  const env = getAppEnv();
  if (!featureEnabled(env, "admin")) throw data("Tidak ditemukan.", { status: 404 });
  return env;
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const env = gate();
  const next = safeNextPath(url.searchParams.get("next"));
  if ((await identifyUser(request, env)).ok) throw redirect(next);
  const error = url.searchParams.get("error");
  return {
    next,
    google: googleConfig(env) !== null,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() ?? "",
    error: error ? (GOOGLE_ERRORS[error] ?? null) : null,
    loggedOut: url.searchParams.has("out"),
    devLog: isDev(env) && env.EMAIL_MODE !== "resend",
    validMinutes: CODE_TTL_MS / 60_000,
    cooldownSeconds: Math.round(CODE_COOLDOWN_MS / 1000),
  };
}

type ActionData =
  | { step: "email"; email: string; error: string }
  | { step: "code"; email: string; sentAt: number; resent?: boolean; error?: string };

export async function action({ request, url }: Route.ActionArgs) {
  const env = gate();
  if (!isSameOrigin(request)) throw data("Permintaan ditolak.", { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const next = safeNextPath(String(form.get("next") ?? ""));

  if (!isValidEmail(email)) {
    return data<ActionData>({ step: "email", email, error: "Masukkan alamat email yang valid." }, { status: 400 });
  }

  if (intent === "request") {
    // Every code request needs a Turnstile pass (email form and "Kirim ulang"): bots cannot make us send mail,
    // which would burn the Resend quota that registration emails depend on. Fails closed without a secret.
    const resend = form.get("resend") === "1";
    const turnstile = await verifyTurnstile(
      env.TURNSTILE_SECRET,
      form.get("cf-turnstile-response")?.toString() ?? null,
      request.headers.get("CF-Connecting-IP"),
    );
    if (!turnstile.success) {
      console.error("login turnstile failed:", turnstile.errorCodes.join(",") || "unknown");
      const error = "Verifikasi keamanan gagal atau kedaluwarsa. Silakan selesaikan verifikasi lalu coba lagi.";
      return data<ActionData>(
        resend
          ? { step: "code", email, sentAt: Number(form.get("sentAt")) || Date.now(), error }
          : { step: "email", email, error },
        { status: 400 },
      );
    }

    await ensureBootstrap(env.DB, env.ADMIN_EMAILS);
    // Same answer whatever happened (sent, not an admin, rate-limited, provider error), so this form cannot be used
    // to find out who is an admin. Failures are logged and audited.
    await requestLoginCode(env.DB, emailConfig(env), email, { ...requestMeta(request), appOrigin: url.origin });
    return data<ActionData>({ step: "code", email, sentAt: Date.now(), resent: resend });
  }

  if (intent === "verify") {
    const sentAt = Number(form.get("sentAt")) || Date.now();
    const result = await verifyLoginCode(env.DB, email, String(form.get("code") ?? ""));
    if (!result.ok) return data<ActionData>({ step: "code", email, sentAt, error: result.message }, { status: 400 });
    const session = await createSession(env.DB, email, "pin", requestMeta(request));
    if (!session) {
      return data<ActionData>(
        { step: "email", email, error: "Email ini tidak lagi terdaftar sebagai admin panitia." },
        { status: 403 },
      );
    }
    throw redirect(next, { headers: { "Set-Cookie": sessionCookie(request, session.token) } });
  }

  throw data("Permintaan tidak dikenal.", { status: 400 });
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<ActionData>();
  const step = actionData?.step === "code" ? actionData : null;

  return (
    <Backdrop>
      <main className="mx-auto flex min-h-screen w-full max-w-[28rem] flex-col justify-center px-4 py-10 sm:py-16">
        <div className="border border-slate-200/80 bg-white/85 shadow-sm shadow-slate-900/5 backdrop-blur-md">
          <div className="h-1 bg-brand" aria-hidden="true" />
          <header className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 pt-7 pb-6 sm:px-8">
            <div className="min-w-0">
              <Eyebrow className="flex items-center gap-2 text-brand">
                <span className="inline-block size-1.5 rounded-full bg-brand" aria-hidden="true" />
                Dashboard Panitia
              </Eyebrow>
              <h1 className="text-gradient-brand mt-2.5 text-[1.75rem] leading-tight font-bold tracking-tight">
                {step ? "Masukkan kode" : "Masuk"}
              </h1>
            </div>
            <Logo className="h-10 w-auto sm:h-12" />
          </header>

          <div className="px-6 py-7 sm:px-8">
            {step ? (
              <CodeStep
                key={step.sentAt}
                email={step.email}
                sentAt={step.sentAt}
                resent={!!step.resent}
                error={step.error}
                next={loaderData.next}
                validMinutes={loaderData.validMinutes}
                cooldown={loaderData.cooldownSeconds}
                siteKey={loaderData.turnstileSiteKey}
              />
            ) : (
              <EmailStep
                next={loaderData.next}
                google={loaderData.google}
                defaultEmail={actionData?.email ?? ""}
                error={actionData?.step === "email" ? actionData.error : loaderData.error}
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
            <p>Khusus panitia Kajian PPME Den Haag. Setelah masuk, sesi Anda berlaku 24 jam di perangkat ini. <span className="mt-1 block"><a href="/privacy" className="underline hover:text-slate-700">Kebijakan Privasi</a> · <a href="/terms" className="underline hover:text-slate-700">Ketentuan Layanan</a></span></p>
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

function EmailStep({
  next,
  google,
  defaultEmail,
  error,
  loggedOut,
  siteKey,
}: {
  next: string;
  google: boolean;
  defaultEmail: string;
  error: string | null;
  loggedOut: boolean;
  siteKey: string;
}) {
  const busy = useBusy("request");
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      {loggedOut ? <Notice result={{ ok: true, message: "Anda telah keluar dari Dashboard Panitia." }} /> : null}
      {error ? <Notice result={{ ok: false, message: error }} /> : null}

      {google ? (
        <GoogleSignIn
          href={`/admin/auth/google${next === "/admin" ? "" : `?next=${encodeURIComponent(next)}`}`}
          label="Masuk dengan Google"
          divider="atau dengan kode email"
        />
      ) : null}

      <p className="text-[15px] leading-relaxed text-slate-600">
        Masukkan email panitia Anda. Kami akan mengirimkan <span className="font-semibold text-slate-900">kode masuk 6 digit</span> ke
        alamat tersebut.
      </p>

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="request" />
        <input type="hidden" name="next" value={next} />
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
        {siteKey ? (
          <Turnstile siteKey={siteKey} resetKey={error ?? undefined} onToken={setToken} />
        ) : (
          <Callout tone="danger" icon={ExclamationTriangleIcon} className="text-[13px]">
            Verifikasi keamanan (Turnstile) belum dikonfigurasi di server ini, sehingga kode masuk tidak dapat dikirim.
          </Callout>
        )}
        <button type="submit" disabled={busy || !token} className={buttonClass("primary", "lg", "w-full")}>
          {busy ? <Spinner /> : null}
          {busy ? "Mengirim kode…" : "Kirim kode masuk"}
          {busy ? null : <ArrowRightIcon className="size-4" aria-hidden="true" />}
        </button>
      </Form>
    </div>
  );
}

function CodeStep({
  email,
  sentAt,
  resent,
  error,
  next,
  validMinutes,
  cooldown,
  siteKey,
}: {
  email: string;
  sentAt: number;
  resent: boolean;
  error?: string;
  next: string;
  validMinutes: number;
  cooldown: number;
  siteKey: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const verifying = useBusy("verify");
  const resending = useBusy("request");
  const formRef = useRef<HTMLFormElement>(null);
  // Starts at the full cooldown on both server and client (deterministic); the timer only runs after hydration.
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
          Jika <span className="font-semibold break-all text-slate-900">{email}</span> terdaftar sebagai admin panitia,
          kode masuk telah dikirim ke alamat tersebut. Kode berlaku {validMinutes} menit.
        </p>
        <p className="text-slate-500">Tidak ada di kotak masuk? Periksa folder spam atau promosi.</p>
      </Callout>

      {resent && !error ? (
        <Notice result={{ ok: true, message: "Kode baru telah diminta. Kode sebelumnya tidak berlaku lagi." }} />
      ) : null}
      {error ? <Notice result={{ ok: false, message: error }} /> : null}

      <Form method="post" ref={formRef} className="space-y-4">
        <input type="hidden" name="intent" value="verify" />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
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
              // Accept pasted "123 456" / "123-456": keep the digits only, then submit once all 6 are in.
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
        <Link
          to={next === "/admin" ? "/admin/login" : `/admin/login?next=${encodeURIComponent(next)}`}
          className={buttonClass("ghost", "sm", "-ml-3")}
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Ganti email
        </Link>
        <Form method="post" className="flex flex-col items-end gap-2">
          <input type="hidden" name="intent" value="request" />
          <input type="hidden" name="resend" value="1" />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="sentAt" value={sentAt} />
          {/* Invisible unless Cloudflare wants a click; a resend is a code request and needs a pass too. */}
          {siteKey ? (
            <Turnstile siteKey={siteKey} appearance="interaction-only" resetKey={error ?? undefined} onToken={setToken} />
          ) : null}
          <button type="submit" disabled={wait > 0 || resending || !token} className={buttonClass("secondary", "sm")}>
            {resending ? <Spinner /> : <ArrowPathIcon className="size-4" aria-hidden="true" />}
            {wait > 0 ? `Kirim ulang (${wait} dtk)` : "Kirim ulang kode"}
          </button>
        </Form>
      </div>
    </div>
  );
}
