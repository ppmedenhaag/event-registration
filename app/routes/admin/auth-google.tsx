import { data } from "react-router";

import type { Route } from "./+types/auth-google";
import { featureEnabled, viewerEnabled } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { googleConfig, startGoogleLogin } from "~/lib/google-oauth.server";

// GET /admin/auth/google?next=/admin/... -> Google consent screen. 404 until GOOGLE_CLIENT_ID/SECRET are set.
// ?realm=viewer starts the same flow for /panitia (same redirect URI; the realm travels in the flow cookie).
export async function loader({ request, url }: Route.LoaderArgs) {
  const env = getAppEnv();
  const cfg = googleConfig(env);
  const realm = url.searchParams.get("realm") === "viewer" ? "viewer" : "admin";
  if (!featureEnabled(env, "admin") || !cfg) throw data("Tidak ditemukan.", { status: 404 });
  if (realm === "viewer" && !viewerEnabled(env)) throw data("Tidak ditemukan.", { status: 404 });
  return startGoogleLogin(request, cfg, url.searchParams.get("next"), realm);
}
