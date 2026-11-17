import { data, redirect } from "react-router";

import type { Route } from "./+types/auth-google-callback";
import { requestMeta } from "~/lib/auth.server";
import { auditStatement } from "~/lib/db.server";
import { clearFlowCookie, finishGoogleLogin, googleConfig } from "~/lib/google-oauth.server";
import { createScannerSession, scannerSessionCookie } from "~/lib/scanner-auth.server";
import { scannerEnv } from "~/lib/scanner-guard.server";

// Google redirects here. A verified Google email still needs an ACTIVE row in `scanners`, same as the email PIN login.
export async function loader({ request, url }: Route.LoaderArgs) {
  const env = scannerEnv();
  const cfg = googleConfig(env);
  if (!cfg) throw data("Not found.", { status: 404 });

  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearFlowCookie(request, "scanner"));

  const result = await finishGoogleLogin(request, url, cfg, fetch, "scanner");
  if (!result.ok) return redirect(`/scan/login?error=google_${result.error}`, { headers });

  const session = await createScannerSession(env.DB, result.email, requestMeta(request), new Date(), "google");
  if (!session) {
    await auditStatement(env.DB, result.email, "auth.google_denied", "scanner", undefined, new Date().toISOString()).run();
    return redirect("/scan/login?error=google_not_scanner", { headers });
  }
  headers.append("Set-Cookie", scannerSessionCookie(request, session.token));
  return redirect("/scan", { headers });
}
