import type { EmailConfig } from "./email/send.server";

/** Settings read from Worker vars/secrets. Kept in one place so routes, cron and tests agree. */
export interface AppEnv {
  DB: D1Database;
  APP_ENV?: string;
  DEFAULT_EVENT_SLUG?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  EMAIL_MODE?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  RESEND_API_KEY?: string;
  BANK_ACCOUNT_NAME?: string;
  BANK_IBAN?: string;
  /** Origin of the PUBLIC Worker (form + "Pendaftaran saya"), e.g. https://event.ppmedenhaag.nl. Used for links in
   *  emails, which are also sent from the admin Worker and the cron, so it cannot come from the request. */
  PUBLIC_APP_URL?: string;
  /** Origin of the ADMIN Worker (e.g. https://event-admin.ppmedenhaag.nl): links in emails to admins, which the cron also sends. */
  ADMIN_APP_URL?: string;
  /** Seed list for the admins table (first run only). */
  ADMIN_EMAILS?: string;
  /** Optional Google sign-in on /admin/login: both must be set (client id = var, secret = `wrangler secret put`). */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Development only: skip the admin login and act as this admin. */
  DEV_ADMIN_EMAIL?: string;
  /** "false" turns the public registration form off on this Worker (admin-only Worker). */
  ENABLE_PUBLIC?: string;
  /** "false" turns /admin off on this Worker (public-only Worker). */
  ENABLE_ADMIN?: string;
  /** Scanner / check-in app (/scan). Fails closed: only the string "true" turns it on (and local development, unless "false"). */
  ENABLE_CHECKIN?: string;
  /** Development only: skip the scanner login and act as this scanner (must exist in the scanners table). */
  DEV_SCANNER_EMAIL?: string;
  /** Read-only panitia dashboards (/panitia). Fails closed: only "true" turns it on (and local development, unless "false"). */
  ENABLE_VIEWER?: string;
}

/** Which parts of the app this Worker serves. Public and admin: anything other than the string "false" means on. */
export function featureEnabled(env: Pick<AppEnv, "ENABLE_PUBLIC" | "ENABLE_ADMIN">, feature: "public" | "admin") {
  return (feature === "public" ? env.ENABLE_PUBLIC : env.ENABLE_ADMIN)?.trim().toLowerCase() !== "false";
}

/** The scanner app is opt-in (fails closed): only a Worker with ENABLE_CHECKIN="true" serves /scan; local dev serves it unless switched off. */
export function checkinEnabled(env: Pick<AppEnv, "ENABLE_CHECKIN" | "APP_ENV">) {
  const v = env.ENABLE_CHECKIN?.trim().toLowerCase();
  return v === "true" || (env.APP_ENV === "development" && v !== "false");
}

/**
 * The read-only panitia dashboards (/panitia) are opt-in (fails closed) and only ever served by a Worker that also
 * serves /admin: the public and check-in Workers 404 them.
 */
export function viewerEnabled(env: Pick<AppEnv, "ENABLE_VIEWER" | "ENABLE_ADMIN" | "APP_ENV">) {
  const v = env.ENABLE_VIEWER?.trim().toLowerCase();
  const on = v === "true" || (env.APP_ENV === "development" && v !== "false");
  return on && featureEnabled(env, "admin");
}

export function isDev(env: AppEnv) {
  return env.APP_ENV === "development";
}

export function emailConfig(env: AppEnv): EmailConfig {
  return {
    mode: env.EMAIL_MODE === "resend" ? "resend" : "log",
    from: env.EMAIL_FROM ?? "Panitia Kajian PPME Den Haag <event@ppmedenhaag.nl>",
    replyTo: env.EMAIL_REPLY_TO ?? "event@ppmedenhaag.nl",
    resendApiKey: env.RESEND_API_KEY,
    bank: bankInfo(env),
    publicUrl: env.PUBLIC_APP_URL?.trim().replace(/\/$/, "") || undefined,
    adminUrl: env.ADMIN_APP_URL?.trim().replace(/\/$/, "") || undefined,
  };
}

/** True when real bank details are configured (non-empty and not a template placeholder). */
export function bankConfigured(env: AppEnv) {
  const { accountName, iban } = bankInfo(env);
  const placeholder = (v: string) => !v.trim() || /REPLACE_WITH/i.test(v);
  return !placeholder(accountName) && !placeholder(iban);
}

export function bankInfo(env: AppEnv) {
  return { accountName: env.BANK_ACCOUNT_NAME ?? "", iban: env.BANK_IBAN ?? "" };
}
