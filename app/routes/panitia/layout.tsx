import { Form, NavLink, Outlet, data, isRouteErrorResponse, redirect } from "react-router";
import {
  ArrowRightStartOnRectangleIcon,
  CalendarDaysIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  UserCircleIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/layout";
import { Backdrop } from "~/components/ui";
import { isSameOrigin } from "~/lib/auth.server";
import { viewerEnabled } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { panitiaContext } from "~/lib/panitia-context";
import { identifyPanitia } from "~/lib/viewer-auth.server";

// Every /panitia page passes through this check (fails closed): the Worker must serve the viewer dashboards at all
// (ENABLE_VIEWER), and the caller must be an approved panitia viewer (own session cookie) or an admin.
// The pages behind it are loaders only: there is nothing to write, and nothing but counts to read.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    const env = getAppEnv();
    if (!viewerEnabled(env)) throw data("Tidak ditemukan.", { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD") {
      // No page here accepts a write. (React Router would answer 405 anyway.)
      if (!isSameOrigin(request)) throw data("Permintaan ditolak.", { status: 403 });
      throw data("Metode tidak diizinkan.", { status: 405 });
    }
    const who = await identifyPanitia(request, env);
    if (!who) throw redirect("/panitia/login");
    context.set(panitiaContext, who);
    const response = await next();
    if (response instanceof Response) {
      try {
        response.headers.set("Cache-Control", "private, no-store");
        response.headers.set("X-Robots-Tag", "noindex");
      } catch {
        // immutable headers (e.g. Response.redirect): nothing to cache anyway
      }
    }
    return response;
  },
];

export function meta() {
  return [{ title: "Ringkasan Panitia – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

export function loader({ context }: Route.LoaderArgs) {
  const who = context.get(panitiaContext);
  return { email: who.email, name: who.name, isAdmin: who.kind === "admin" };
}

const TABS = [
  { to: "/panitia", label: "Perencanaan", icon: UsersIcon, end: true },
  { to: "/panitia/hari-h", label: "Hari-H", icon: CalendarDaysIcon, end: false },
];

export default function PanitiaLayout({ loaderData }: Route.ComponentProps) {
  return (
    <Backdrop>
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <img src="/logo-ppme.png" alt="PPME Den Haag" width={135} height={70} className="h-8 w-auto sm:h-9" />
          <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden="true" />
          <span className="hidden text-sm font-semibold whitespace-nowrap text-slate-900 sm:inline">Ringkasan Panitia</span>
          <nav aria-label="Navigasi ringkasan" className="ml-1 flex h-full items-stretch gap-1 sm:ml-4">
            {TABS.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `-mb-px inline-flex items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset ${
                    isActive ? "border-brand text-brand-dark" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                  }`
                }
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span
              className="hidden min-w-0 items-center gap-2 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-1.5 text-xs text-slate-600 md:flex"
              title={loaderData.email}
            >
              <UserCircleIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="max-w-48 truncate">{loaderData.name ?? loaderData.email}</span>
            </span>
            {loaderData.isAdmin ? (
              <a href="/admin" className="text-xs font-medium text-brand hover:text-brand-dark">
                Dashboard admin
              </a>
            ) : (
              <Form method="post" action="/panitia/logout">
                <button
                  type="submit"
                  title="Keluar"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-white/80 text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
                >
                  <ArrowRightStartOnRectangleIcon className="size-4" aria-hidden="true" />
                  <span className="sr-only">Keluar</span>
                </button>
              </Form>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
        <p className="mt-10 flex items-start gap-2 text-xs text-slate-400">
          <LockClosedIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Halaman hanya-baca. Hanya jumlah dan komposisi; tidak ada nama, kontak, atau data pembayaran peserta.
        </p>
      </main>
    </Backdrop>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : null;
  const message = isRouteErrorResponse(error)
    ? typeof error.data === "string"
      ? error.data
      : error.statusText
    : error instanceof Error
      ? error.message
      : "Terjadi kesalahan.";
  return (
    <Backdrop>
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">{status ? `Kode ${status}` : "Kesalahan"}</p>
            <h1 className="text-gradient-brand mt-1 text-2xl font-bold tracking-tight">Ringkasan Panitia</h1>
          </div>
          <img src="/logo-ppme.png" alt="PPME Den Haag" width={135} height={70} className="h-10 w-auto" />
        </div>
        <div className="mt-6 flex gap-3 border-l-2 border-red-600 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          <ExclamationTriangleIcon className="mt-px size-5 shrink-0 text-red-600" aria-hidden="true" />
          <p>{message}</p>
        </div>
      </main>
    </Backdrop>
  );
}
