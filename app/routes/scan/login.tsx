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
import { LangProvider, LangSwitch, useT } from "~/components/scanner/lang";
import { Turnstile } from "~/components/Turnstile";
import { Backdrop, buttonClass, Callout, Eyebrow, Logo, Spinner } from "~/components/ui";
import { normalizeEmail } from "~/lib/admins.server";
import { isSameOrigin, requestMeta } from "~/lib/auth.server";
import { emailConfig, isDev } from "~/lib/config.server";
import { googleConfig } from "~/lib/google-oauth.server";
import { CODE_COOLDOWN_MS, CODE_TTL_MS, isValidEmail, requestLoginCode, verifyLoginCode } from "~/lib/login-codes.server";
import { createScannerSession, identifyScanner, scannerSessionCookie } from "~/lib/scanner-auth.server";
import { scannerEnv } from "~/lib/scanner-guard.server";
import { detectLang, type TextKey } from "~/lib/scanner-i18n";
import { verifyTurnstile } from "~/lib/turnstile.server";

export function meta() {
  return [
    { title: "Check-in – PPME Den Haag" },
    { name: "robots", content: "noindex, nofollow" },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-title", content: "Check-in" },
  ];
}

export function links() {
  return [
    { rel: "manifest", href: "/scan/manifest.webmanifest" },
    { rel: "apple-touch-icon", href: "/scan-icons/apple-touch-icon.png" },
  ];
}

const GOOGLE_ERRORS: Record<string, TextKey> = {
  google_cancelled: "errGoogleCancelled",
  google_state: "errGoogleFailed",
  google_exchange: "errGoogleFailed",
  google_token: "errGoogleFailed",
  google_unverified: "errGoogleUnverified",
  google_not_scanner: "errNotScanner",
};

export async function loader({ request, url }: Route.LoaderArgs) {
  const env = scannerEnv();
  if (await identifyScanner(request, env)) throw redirect("/scan");
  return {
    lang: detectLang(request.headers.get("Cookie"), request.headers.get("Accept-Language")),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() ?? "",
    google: googleConfig(env) !== null,
    googleError: GOOGLE_ERRORS[url.searchParams.get("error") ?? ""] ?? null,
    loggedOut: url.searchParams.has("out"),
    devLog: isDev(env) && env.EMAIL_MODE !== "resend",
    validMinutes: CODE_TTL_MS / 60_000,
    cooldownSeconds: Math.round(CODE_COOLDOWN_MS / 1000),
  };
}

type ActionData =
  | { step: "email"; email: string; error: TextKey }
  | { step: "code"; email: string; sentAt: number; resent?: boolean; error?: TextKey };

export async function action({ request, url }: Route.ActionArgs) {
  const env = scannerEnv();
  if (!isSameOrigin(request)) throw data("Forbidden.", { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const email = normalizeEmail(String(form.get("email") ?? ""));

  if (!isValidEmail(email)) return data<ActionData>({ step: "email", email, error: "errEmail" }, { status: 400 });

  if (intent === "request") {
    // Every code request needs a Turnstile pass (also "send again"), and fails closed without a secret: bots must not make
    // us send mail (it would burn the Resend quota that registration emails depend on).
    const resend = form.get("resend") === "1";
    const turnstile = await verifyTurnstile(env.TURNSTILE_SECRET, form.get("cf-turnstile-response")?.toString() ?? null, request.headers.get("CF-Connecting-IP"));
    if (!turnstile.success) {
      console.error("scanner login turnstile failed:", turnstile.errorCodes.join(",") || "unknown");
      return data<ActionData>(
        resend ? { step: "code", email, sentAt: Number(form.get("sentAt")) || Date.now(), error: "errTurnstile" } : { step: "email", email, error: "errTurnstile" },
        { status: 400 },
      );
    }
    // Same answer whatever happened (sent, not a scanner, rate-limited, provider error): no scanner enumeration.
    await requestLoginCode(env.DB, emailConfig(env), email, { ...requestMeta(request), appOrigin: url.origin }, new Date(), "scanner");
    return data<ActionData>({ step: "code", email, sentAt: Date.now(), resent: resend });
  }

  if (intent === "verify") {
    const sentAt = Number(form.get("sentAt")) || Date.now();
    const result = await verifyLoginCode(env.DB, email, String(form.get("code") ?? ""), new Date(), "scanner");
    if (!result.ok) {
      const error: TextKey = result.code === "format" ? "errCodeFormat" : result.code === "locked" ? "errCodeLocked" : "errCodeInvalid";
      return data<ActionData>({ step: "code", email, sentAt, error }, { status: 400 });
    }
    const session = await createScannerSession(env.DB, email, requestMeta(request));
    if (!session) return data<ActionData>({ step: "email", email, error: "errNotScanner" }, { status: 403 });
    throw redirect("/scan", { headers: { "Set-Cookie": scannerSessionCookie(request, session.token) } });
  }

  throw data("Bad request.", { status: 400 });
}

export default function ScanLogin({ loaderData }: Route.ComponentProps) {
  return (
    <LangProvider lang={loaderData.lang}>
      <LoginScreen loaderData={loaderData} />
    </LangProvider>
  );
}

function useBusy(intent: string) {
  const nav = useNavigation();
  return nav.state !== "idle" && nav.formData?.get("intent") === intent;
}

function LoginScreen({ loaderData }: { loaderData: Route.ComponentProps["loaderData"] }) {
  const T = useT();
  const actionData = useActionData<ActionData>();
  const step = actionData?.step === "code" ? actionData : null;

  useEffect(() => {
    document.documentElement.lang = loaderData.lang;
  }, [loaderData.lang]);

  return (
    <Backdrop>
      <main className="mx-auto flex min-h-dvh w-full max-w-[28rem] flex-col justify-center px-4 py-10 sm:py-16">
        <div className="mb-3 flex justify-end">
          <LangSwitch />
        </div>
        <div className="border border-slate-200/80 bg-white/85 shadow-sm shadow-slate-900/5 backdrop-blur-md">
          <div className="h-1 bg-brand" aria-hidden="true" />
          <header className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 pt-7 pb-6 sm:px-8">
            <div className="min-w-0">
              <Eyebrow className="flex items-center gap-2 text-brand">
                <span className="inline-block size-1.5 rounded-full bg-brand" aria-hidden="true" />
                {T("loginEyebrow")}
              </Eyebrow>
              <h1 className="text-gradient-brand mt-2.5 text-[1.75rem] leading-tight font-bold tracking-tight">{step ? T("codeTitle") : T("loginTitle")}</h1>
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
                validMinutes={loaderData.validMinutes}
                cooldown={loaderData.cooldownSeconds}
                siteKey={loaderData.turnstileSiteKey}
              />
            ) : (
              <EmailStep
                defaultEmail={actionData?.email ?? ""}
                error={actionData?.step === "email" ? actionData.error : loaderData.googleError}
                google={loaderData.google}
                loggedOut={loaderData.loggedOut && !actionData}
                siteKey={loaderData.turnstileSiteKey}
              />
            )}
            {loaderData.devLog ? (
              <Callout tone="warning" icon={WrenchScrewdriverIcon} className="mt-6 text-[13px]">
                {T("devMode")}
              </Callout>
            ) : null}
          </div>

          <footer className="flex items-start gap-2.5 border-t border-slate-200/80 bg-slate-50/70 px-6 py-4 text-xs leading-relaxed text-slate-500 sm:px-8">
            <LockClosedIcon className="mt-px size-4 shrink-0 text-slate-400" aria-hidden="true" />
            <p>
              {T("loginFooter")}{" "}
              <span className="mt-1 block"><a href="/privacy" className="underline hover:text-slate-700">{T("privacyLink")}</a> · <a href="/terms" className="underline hover:text-slate-700">{T("termsLink")}</a></span>
            </p>
          </footer>
        </div>
      </main>
    </Backdrop>
  );
}

function EmailStep({
  defaultEmail,
  error,
  google,
  loggedOut,
  siteKey,
}: {
  defaultEmail: string;
  error: TextKey | null;
  google: boolean;
  loggedOut: boolean;
  siteKey: string;
}) {
  const T = useT();
  const busy = useBusy("request");
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      {loggedOut ? <Notice result={{ ok: true, message: T("loggedOut") }} /> : null}
      {error ? <Notice result={{ ok: false, message: T(error) }} /> : null}
      {google ? <GoogleSignIn href="/scan/auth/google" label={T("googleButton")} divider={T("orViaEmail")} /> : null}
      <p className="text-[15px] leading-relaxed text-slate-600">{T("loginIntro")}</p>
      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="request" />
        <TextField
          label={T("emailLabel")}
          name="email"
          type="email"
          icon={EnvelopeIcon}
          autoComplete="email"
          inputMode="email"
          placeholder={T("emailPlaceholder")}
          defaultValue={defaultEmail}
          required
          autoFocus
        />
        {siteKey ? (
          <Turnstile siteKey={siteKey} resetKey={error ?? undefined} onToken={setToken} />
        ) : (
          <Callout tone="danger" icon={ExclamationTriangleIcon} className="text-[13px]">
            {T("turnstileMissing")}
          </Callout>
        )}
        <button type="submit" disabled={busy || !token} className={buttonClass("primary", "lg", "w-full")}>
          {busy ? <Spinner /> : null}
          {busy ? T("sendingCode") : T("sendCode")}
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
  validMinutes,
  cooldown,
  siteKey,
}: {
  email: string;
  sentAt: number;
  resent: boolean;
  error?: TextKey;
  validMinutes: number;
  cooldown: number;
  siteKey: string;
}) {
  const T = useT();
  const [token, setToken] = useState<string | null>(null);
  const verifying = useBusy("verify");
  const resending = useBusy("request");
  const formRef = useRef<HTMLFormElement>(null);
  // Starts at the full cooldown on server and client (deterministic); the timer only runs after hydration.
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
        <p>{T("codeSent", { email, minutes: validMinutes })}</p>
        <p className="text-slate-500">{T("codeSpam")}</p>
      </Callout>
      {resent && !error ? <Notice result={{ ok: true, message: T("resent") }} /> : null}
      {error ? <Notice result={{ ok: false, message: T(error) }} /> : null}

      <Form method="post" ref={formRef} className="space-y-4">
        <input type="hidden" name="intent" value="verify" />
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="sentAt" value={sentAt} />
        <Field>
          <Label className="mb-1.5 block text-sm font-medium text-slate-700">{T("codeLabel")}</Label>
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
          {verifying ? T("signingIn") : T("signIn")}
          {verifying ? null : <ArrowRightIcon className="size-4" aria-hidden="true" />}
        </button>
      </Form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-5">
        <Link to="/scan/login" className={buttonClass("ghost", "sm", "-ml-3")}>
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {T("changeEmail")}
        </Link>
        <Form method="post" className="flex flex-col items-end gap-2">
          <input type="hidden" name="intent" value="request" />
          <input type="hidden" name="resend" value="1" />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="sentAt" value={sentAt} />
          {siteKey ? <Turnstile siteKey={siteKey} appearance="interaction-only" resetKey={error ?? undefined} onToken={setToken} /> : null}
          <button type="submit" disabled={wait > 0 || resending || !token} className={buttonClass("secondary", "sm")}>
            {resending ? <Spinner /> : <ArrowPathIcon className="size-4" aria-hidden="true" />}
            {wait > 0 ? T("resendIn", { seconds: wait }) : T("resend")}
          </button>
        </Form>
      </div>
    </div>
  );
}
