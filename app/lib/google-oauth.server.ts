import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  bytesToBase64Url,
  isSecureRequest,
  randomToken,
  readCookie,
  safeNextPath,
  serializeCookie,
  sha256,
  timingSafeEqual,
} from "./auth.server";

/**
 * Optional "Masuk dengan Google" for /admin (OpenID Connect, authorization-code flow with PKCE + state + nonce).
 * Turned on by setting GOOGLE_CLIENT_ID (var) and GOOGLE_CLIENT_SECRET (secret) on the admin Worker; the login
 * page shows the button only then. Google proves the email; the admins table still decides access, exactly as
 * for the PIN. Authorised redirect URI to register in Google Cloud: <admin origin>/admin/auth/google/callback
 */
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export function googleConfig(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const FLOW_COOKIE = "ppme_oauth";
const FLOW_TTL_S = 600;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const googleKeys = () => (jwks ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")));

/**
 * Who the sign-in is for. Google only proves the email; each realm then checks its own table (admins / approved viewers /
 * active scanners), exactly as its email PIN does. "admin" and "viewer" live on the admin host and share ONE redirect URI
 * (`/admin/auth/google/callback`, the realm travels in the flow cookie); "scanner" lives on the check-in host and has its own.
 */
export type GoogleRealm = "admin" | "viewer" | "scanner";

/** Which host's callback is handling the request: the admin Worker (admin + viewer) or the check-in Worker (scanner). */
export type GoogleHost = "admin" | "scanner";

const CALLBACK_PATH: Record<GoogleHost, string> = {
  admin: "/admin/auth/google/callback",
  scanner: "/scan/auth/google/callback",
};
const FLOW_COOKIE_PATH: Record<GoogleHost, string> = {
  admin: "/admin/auth/google",
  scanner: "/scan/auth/google",
};
const hostOf = (realm: GoogleRealm): GoogleHost => (realm === "scanner" ? "scanner" : "admin");

interface FlowState {
  state: string;
  verifier: string;
  nonce: string;
  next: string;
  realm?: GoogleRealm;
}

export const redirectUri = (request: Request, host: GoogleHost = "admin") => `${new URL(request.url).origin}${CALLBACK_PATH[host]}`;

const flowCookie = (request: Request, value: string, maxAge: number, host: GoogleHost) =>
  serializeCookie(FLOW_COOKIE, value, { maxAge, secure: isSecureRequest(request), path: FLOW_COOKIE_PATH[host] });

/** Redirect to Google's consent screen; the PKCE verifier, state and nonce wait in a 10-minute HttpOnly cookie. */
export async function startGoogleLogin(
  request: Request,
  cfg: GoogleConfig,
  nextRaw: string | null,
  realm: GoogleRealm = "admin",
): Promise<Response> {
  const host = hostOf(realm);
  const flow: FlowState = {
    state: randomToken(16),
    verifier: randomToken(32),
    nonce: randomToken(16),
    // Only the admin realm has a deep link; viewers and scanners always land on their own start page.
    next: realm === "admin" ? safeNextPath(nextRaw) : "/admin",
    realm,
  };
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(request, host),
    response_type: "code",
    scope: "openid email",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: bytesToBase64Url(await sha256(flow.verifier)),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  const headers = new Headers({ Location: url.toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", flowCookie(request, btoa(JSON.stringify(flow)), FLOW_TTL_S, host));
  return new Response(null, { status: 302, headers });
}

export type GoogleResult =
  | { ok: true; email: string; next: string; realm: GoogleRealm }
  // `realm` is set whenever the flow cookie could be read, so the caller can send the person back to their own login page.
  | { ok: false; error: "cancelled" | "state" | "exchange" | "token" | "unverified"; realm?: GoogleRealm };

/** Header that removes the flow cookie (send it with every callback response). */
export const clearFlowCookie = (request: Request, host: GoogleHost = "admin") => flowCookie(request, "", 0, host);

/**
 * Validate the callback: state, code exchange, ID token signature/issuer/audience/expiry, nonce, verified email.
 * `host` is the Worker that received the callback; a flow started for a realm that belongs to the other host is refused
 * (the redirect URI would not match anyway).
 */
export async function finishGoogleLogin(
  request: Request,
  url: URL,
  cfg: GoogleConfig,
  fetcher: typeof fetch = fetch,
  host: GoogleHost = "admin",
): Promise<GoogleResult> {
  let flow: FlowState;
  try {
    flow = JSON.parse(atob(readCookie(request, FLOW_COOKIE) ?? "")) as FlowState;
  } catch {
    return { ok: false, error: "state" };
  }
  const realm: GoogleRealm = flow?.realm === "viewer" || flow?.realm === "scanner" ? flow.realm : "admin";
  const fail = (error: Extract<GoogleResult, { ok: false }>["error"]): GoogleResult => ({
    ok: false,
    error,
    realm: hostOf(realm) === host ? realm : undefined,
  });
  if (url.searchParams.get("error")) return fail("cancelled");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!flow?.state || !code || !timingSafeEqual(state, flow.state)) return fail("state");
  if (hostOf(realm) !== host) return fail("state");

  const res = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(request, host),
      code_verifier: flow.verifier,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) {
    console.error(`google token exchange failed: ${res.status} ${body.error ?? ""}`);
    return fail("exchange");
  }

  try {
    const { payload } = await jwtVerify(body.id_token, googleKeys(), { issuer: ISSUERS, audience: cfg.clientId });
    if (payload.nonce !== flow.nonce) return fail("token");
    if (payload.email_verified !== true || typeof payload.email !== "string") return fail("unverified");
    return { ok: true, email: payload.email.toLowerCase(), next: safeNextPath(flow.next), realm };
  } catch (err) {
    console.error(`google id_token rejected: ${(err as Error)?.message}`);
    return fail("token");
  }
}
