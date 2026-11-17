import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("e/:slug", "routes/register.tsx"),

  // Public legal pages: served by EVERY Worker (public, admin and check-in), no login, no data.
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),
  route("e/:slug/pendaftaran-saya", "routes/my-registration.tsx"),

  // Check-in app for the scanning team (served only by the check-in Worker, ENABLE_CHECKIN="true"; everything else 404s).
  ...prefix("scan", [
    index("routes/scan/app.tsx"),
    route("login", "routes/scan/login.tsx"),
    route("logout", "routes/scan/logout.tsx"),
    route("auth/google", "routes/scan/auth-google.tsx"),
    route("auth/google/callback", "routes/scan/auth-google-callback.tsx"),
    route("offline", "routes/scan/offline.tsx"),
    route("manifest.webmanifest", "routes/scan/manifest.ts"),
    route("sw.js", "routes/scan/sw.ts"),
    route("api/:op", "routes/scan/api.ts"),
  ]),

  // Read-only aggregate dashboards for panitia viewers (served only by Workers with ENABLE_VIEWER="true"; own login, own cookie).
  ...prefix("panitia", [
    route("login", "routes/panitia/login.tsx"),
    route("logout", "routes/panitia/logout.tsx"),
    layout("routes/panitia/layout.tsx", [
      index("routes/panitia/planning.tsx"),
      route("hari-h", "routes/panitia/hari-h.tsx"),
    ]),
  ]),

  ...prefix("admin", [
    // Login/logout and the Google callback sit outside the protected layout.
    route("login", "routes/admin/login.tsx"),
    route("logout", "routes/admin/logout.tsx"),
    route("auth/google", "routes/admin/auth-google.tsx"),
    route("auth/google/callback", "routes/admin/auth-google-callback.tsx"),
    layout("routes/admin/layout.tsx", [
      index("routes/admin/dashboard.tsx"),
      route("registrations", "routes/admin/registrations.tsx"),
      route("registrations/:id", "routes/admin/registration-detail.tsx"),
      route("admins", "routes/admin/admins.tsx"),
      route("checkin", "routes/admin/checkin.tsx"),
      route("scanners", "routes/admin/scanners.tsx"),
      route("briefing", "routes/admin/briefing.tsx"),
      route("settings", "routes/admin/settings.tsx"),
      route("export", "routes/admin/export.tsx"),
      route("outbox", "routes/admin/outbox.tsx"),
      route("outbox/:id/html", "routes/admin/outbox-html.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
