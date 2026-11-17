import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import type { Route } from "./+types/admins";
import {
  BriefcaseIcon,
  CheckIcon,
  EnvelopeIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { ActionButton, Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { Spinner, buttonClass } from "~/components/ui";
import { handleAdminIntent } from "~/lib/admin-actions.server";
import { adminEmailContext } from "~/lib/admin-context";
import { listAdmins } from "~/lib/admins.server";
import { emailConfig, viewerEnabled } from "~/lib/config.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";
import { getEventBySlug } from "~/lib/db.server";
import { handleViewerIntent, listViewers, VIEWER_INTENTS, viewerExpiry } from "~/lib/viewers.server";

export function meta() {
  return [{ title: "Kelola Admin – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const env = getAppEnv();
  const showViewers = viewerEnabled(env);
  return {
    admins: await listAdmins(env.DB),
    me: context.get(adminEmailContext),
    showViewers,
    viewers: showViewers ? await listViewers(env.DB) : [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = getAppEnv();
  const actor = context.get(adminEmailContext);
  const form = await request.formData();
  // Panitia viewer requests (read-only dashboards) have their own handler; every other intent is unchanged.
  if ((VIEWER_INTENTS as readonly string[]).includes(String(form.get("intent") ?? ""))) {
    if (!viewerEnabled(env)) return { ok: false, message: "Ringkasan Panitia tidak aktif di server ini." };
    const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
    if (!event) return { ok: false, message: "Acara tidak ditemukan." };
    return handleViewerIntent(env.DB, emailConfig(env), actor, form, new URL(request.url).origin, new Date(), viewerExpiry(event));
  }
  return handleAdminIntent(env, actor, form);
}

export default function Admins({ loaderData }: Route.ComponentProps) {
  const { admins, me, showViewers, viewers } = loaderData;
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) formRef.current?.reset();
  }, [fetcher.data]);

  return (
    <div>
      <PageHeader
        eyebrow="Akses"
        title={
          <>
            Kelola admin <span className="text-slate-400 tabular-nums">({admins.length})</span>
          </>
        }
        description="Hanya orang dalam daftar ini yang dapat membuka dashboard panitia. Perubahan berlaku seketika."
      />

      <div className="space-y-6">
        <Panel title="Tambah admin" icon={UserPlusIcon}>
          <fetcher.Form ref={formRef} method="post" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="intent" value="add-admin" />
            <TextField
              name="email"
              type="email"
              label="Email"
              icon={EnvelopeIcon}
              required
              autoComplete="off"
              placeholder="nama@email.com"
            />
            <TextField
              name="name"
              label="Nama (opsional)"
              icon={UserIcon}
              maxLength={120}
              autoComplete="off"
              placeholder="Nama panitia"
            />
            <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
              {busy ? <Spinner /> : <UserPlusIcon className="size-4" aria-hidden="true" />}
              {busy ? "Menyimpan…" : "Tambah"}
            </button>
          </fetcher.Form>
          <Notice result={fetcher.data} className="mt-4" />
          <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
            <InformationCircleIcon className="size-4 shrink-0" aria-hidden="true" />
            Orang yang ditambahkan masuk dengan kode sekali pakai yang dikirim ke emailnya (atau dengan akun Google bila diaktifkan). Menghapus admin langsung mengakhiri sesinya.
          </p>
        </Panel>

        <Panel title="Daftar admin" icon={ShieldCheckIcon} flush>
          <ul className="divide-y divide-slate-100">
            {admins.map((a) => (
              <li key={a.email} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-sm font-semibold text-brand uppercase"
                  aria-hidden="true"
                >
                  {(a.name || a.email).slice(0, 1)}
                </span>
                <div className="min-w-[200px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold break-all text-slate-900">{a.email}</span>
                    {a.email === me ? (
                      <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand ring-1 ring-brand-200 ring-inset">
                        Anda
                      </span>
                    ) : null}
                  </div>
                  {a.name ? <div className="text-sm text-slate-600">{a.name}</div> : null}
                  <div className="mt-0.5 text-xs text-slate-500">
                    Ditambahkan {formatDateTime(a.added_at)} oleh {a.added_by} · login terakhir{" "}
                    {a.last_login_at ? formatDateTime(a.last_login_at) : "belum pernah"}
                  </div>
                </div>
                {a.email === me ? null : (
                  <ActionButton
                    intent="remove-admin"
                    label="Hapus"
                    tone="neutral"
                    icon={TrashIcon}
                    extra={{ email: a.email }}
                    confirm={{
                      title: "Hapus admin",
                      description: `${a.email} akan dihapus dari daftar admin dan tidak bisa lagi membuka dashboard panitia.`,
                      confirmLabel: "Ya, hapus",
                      tone: "danger",
                      icon: UserMinusIcon,
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
            Anda tidak dapat menghapus diri sendiri, dan admin terakhir tidak dapat dihapus.
          </p>
        </Panel>

        {showViewers ? <ViewersPanel viewers={viewers} /> : null}
      </div>
    </div>
  );
}

const VIEWER_STATUS = {
  pending: { label: "Menunggu persetujuan", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { label: "Disetujui", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  rejected: { label: "Ditolak / dicabut", tone: "bg-slate-100 text-slate-600 ring-slate-200" },
} as const;

/** Panitia who asked for read-only access to /panitia (aggregate dashboards). Approve, revoke or delete here. */
function ViewersPanel({ viewers }: { viewers: Route.ComponentProps["loaderData"]["viewers"] }) {
  const pending = viewers.filter((v) => v.status === "pending").length;
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.data?.ok) formRef.current?.reset();
  }, [fetcher.data]);
  return (
    <Panel title={<>Akses Ringkasan Panitia (hanya-baca){pending ? <span className="ml-2 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200 ring-inset">{pending} menunggu</span> : null}</>} icon={UsersIcon} flush>
      <p className="border-b border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5">
        Panitia meminta akses lewat halaman <code>/panitia</code>. Yang disetujui hanya melihat jumlah dan komposisi peserta (perencanaan dan hari-H), tanpa nama,
        kontak, pembayaran, atau tindakan apa pun. Akses berakhir otomatis sekitar seminggu setelah acara.
      </p>
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <UserPlusIcon className="size-4 text-brand" aria-hidden="true" />
          Tambah panitia (langsung disetujui)
        </h3>
        <fetcher.Form ref={formRef} method="post" className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
          <input type="hidden" name="intent" value="add-viewer" />
          <TextField
            name="email"
            type="text"
            inputMode="email"
            label="Email (satu atau beberapa, pisahkan dengan koma)"
            icon={EnvelopeIcon}
            required
            autoComplete="off"
            placeholder="nama@email.com, nama2@email.com"
          />
          <TextField name="name" label="Nama (opsional, 1 email)" icon={UserIcon} maxLength={80} autoComplete="off" placeholder="Nama panitia" />
          <TextField name="section" label="Seksi (opsional)" icon={BriefcaseIcon} maxLength={60} autoComplete="off" placeholder="mis. Konsumsi" />
          <button type="submit" disabled={busy} className={buttonClass("primary", "md")}>
            {busy ? <Spinner /> : <UserPlusIcon className="size-4" aria-hidden="true" />}
            {busy ? "Menyimpan…" : "Tambah"}
          </button>
        </fetcher.Form>
        <Notice result={fetcher.data} className="mt-3" />
        <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
          <InformationCircleIcon className="size-4 shrink-0" aria-hidden="true" />
          Mereka tidak perlu meminta akses: setelah ditambahkan, cukup buka <code>/panitia</code> dan masuk dengan kode email. Pemberitahuan dikirim ke emailnya.
        </p>
      </div>
      {viewers.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500 sm:px-5">Belum ada permintaan akses.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {viewers.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
              <div className="min-w-[200px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{v.name}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${VIEWER_STATUS[v.status].tone}`}>{VIEWER_STATUS[v.status].label}</span>
                </div>
                <div className="text-sm break-all text-slate-600">{v.email}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {v.section ? `${v.section} · ` : ""}diminta {formatDateTime(v.requested_at)}
                  {v.decided_by ? ` · diputuskan oleh ${v.decided_by}` : ""}
                  {v.status === "approved" ? ` · login terakhir ${v.last_login_at ? formatDateTime(v.last_login_at) : "belum pernah"}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {v.status !== "approved" ? (
                  <ActionButton intent="approve-viewer" label="Setujui" tone="primary" icon={CheckIcon} extra={{ viewerId: String(v.id) }} />
                ) : null}
                {v.status !== "rejected" ? (
                  <ActionButton
                    intent="reject-viewer"
                    label={v.status === "approved" ? "Cabut akses" : "Tolak"}
                    tone="neutral"
                    icon={XMarkIcon}
                    extra={{ viewerId: String(v.id) }}
                    confirm={{
                      title: v.status === "approved" ? "Cabut akses" : "Tolak permintaan",
                      description: `${v.email} ${v.status === "approved" ? "tidak bisa lagi membuka Ringkasan Panitia dan sesinya berakhir sekarang." : "tidak akan mendapat akses."}`,
                      confirmLabel: v.status === "approved" ? "Ya, cabut" : "Ya, tolak",
                      tone: "danger",
                      icon: UserMinusIcon,
                    }}
                  />
                ) : null}
                <ActionButton
                  intent="delete-viewer"
                  label="Hapus"
                  tone="neutral"
                  icon={TrashIcon}
                  extra={{ viewerId: String(v.id) }}
                  confirm={{
                    title: "Hapus dari daftar",
                    description: `Data ${v.email} dihapus dari daftar. Orang ini dapat meminta akses lagi.`,
                    confirmLabel: "Ya, hapus",
                    tone: "danger",
                    icon: TrashIcon,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
