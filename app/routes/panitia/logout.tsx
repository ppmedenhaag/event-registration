import { data, redirect } from "react-router";

import type { Route } from "./+types/logout";
import { isSameOrigin } from "~/lib/auth.server";
import { viewerEnabled } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { clearViewerSessionCookie, destroyViewerSession } from "~/lib/viewer-auth.server";

export function loader() {
  throw redirect("/panitia/login");
}

export async function action({ request }: Route.ActionArgs) {
  const env = getAppEnv();
  if (!viewerEnabled(env)) throw data("Tidak ditemukan.", { status: 404 });
  if (!isSameOrigin(request)) throw data("Permintaan ditolak.", { status: 403 });
  await destroyViewerSession(env.DB, request);
  throw redirect("/panitia/login?out=1", { headers: { "Set-Cookie": clearViewerSessionCookie(request) } });
}
