import { data } from "react-router";

import type { Route } from "./+types/auth-google";
import { googleConfig, startGoogleLogin } from "~/lib/google-oauth.server";
import { scannerEnv } from "~/lib/scanner-guard.server";

// GET /scan/auth/google -> Google consent screen. 404 until GOOGLE_CLIENT_ID/SECRET are set on the check-in Worker.
export async function loader({ request }: Route.LoaderArgs) {
  const env = scannerEnv();
  const cfg = googleConfig(env);
  if (!cfg) throw data("Not found.", { status: 404 });
  return startGoogleLogin(request, cfg, null, "scanner");
}
