import { CalendarDaysIcon, ChartBarIcon, ClockIcon, HomeModernIcon, TicketIcon, UsersIcon } from "@heroicons/react/24/outline";
import { data } from "react-router";

import type { Route } from "./+types/planning";
import { AgeGroupChart, RegistrationTimeline } from "~/components/admin-charts";
import { PageHeader, Panel, Stat, StatGroup } from "~/components/admin";
import { AsOf, ageLabel, BarList, CountTable } from "~/components/panitia";
import { getEventBySlug } from "~/lib/db.server";
import { planningStats } from "~/lib/demography.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime } from "~/lib/format";

export function meta() {
  return [{ title: "Perencanaan – Ringkasan Panitia PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

// Counts only (see demography.server.ts). The layout middleware has already checked who is asking.
export async function loader() {
  const env = getAppEnv();
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
  if (!event) throw data("Acara tidak ditemukan.", { status: 404 });
  return {
    event: { title: event.title, startsAt: event.starts_at },
    stats: await planningStats(env.DB, event),
  };
}

export default function Planning({ loaderData }: Route.ComponentProps) {
  const { event, stats } = loaderData;
  const t = stats.totals;
  const all = t.confirmedPeople + t.pendingPeople;
  const c = stats.children;
  const kidsConfirmed = c.balita.confirmed + c.anak.confirmed;
  const kidsPending = c.balita.pending + c.anak.pending;
  const genderRows = stats.genderByAge.map((g) => ({
    label: ageLabel(g.group),
    values: { l: g.lakiLaki, p: g.perempuan, u: g.unknown },
  }));
  const showUnknown = stats.gender.unknown > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Perencanaan"
        title={event.title}
        description={
          <span className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDaysIcon className="size-4 text-slate-400" aria-hidden="true" />
              {formatDateTime(event.startsAt)}
            </span>
            <AsOf asOf={stats.asOf} />
          </span>
        }
      />

      <StatGroup>
        <Stat icon={UsersIcon} label="Peserta pasti" value={t.confirmedPeople} sub={`${t.confirmedFamilies} pendaftaran diterima`} />
        <Stat icon={ClockIcon} label="Menunggu" value={t.pendingPeople} sub={`${t.pendingFamilies} pendaftaran (bayar / validasi anggota)`} />
        <Stat icon={ChartBarIcon} label="Perkiraan maksimum" value={all} sub="pasti + menunggu" />
        <Stat
          icon={TicketIcon}
          label="Kursi kuota terpakai"
          value={`${stats.quota.member.used + stats.quota.nonMember.used} / ${stats.quota.member.quota + stats.quota.nonMember.quota}`}
          sub={`anggota ${stats.quota.member.used}/${stats.quota.member.quota} · non-anggota ${stats.quota.nonMember.used}/${stats.quota.nonMember.quota}`}
        />
      </StatGroup>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Ruang balita &amp; anak" icon={HomeModernIcon}>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200/80 bg-slate-200/80">
            <Mini label="Balita" value={c.balita.confirmed + c.balita.pending} sub={`${c.balita.confirmed} pasti · ${c.balita.pending} menunggu`} />
            <Mini label="Anak" value={c.anak.confirmed + c.anak.pending} sub={`${c.anak.confirmed} pasti · ${c.anak.pending} menunggu`} />
            <Mini label="Keluarga dengan balita" value={c.familiesWithBalita} sub="kebutuhan ruang menyusui / kereta bayi" />
            <Mini label="Keluarga dengan anak" value={c.familiesWithAnak} sub="usia sekolah dasar" />
          </dl>
          <p className="mt-4 text-sm text-slate-600">
            Total anak (balita + anak): <strong className="text-slate-900">{kidsConfirmed + kidsPending}</strong>
            {kidsPending > 0 ? ` (${kidsConfirmed} pasti, ${kidsPending} menunggu)` : ""}
            {" · "}
            {c.familiesWithChildren} keluarga membawa anak
            {c.childrenPerAdult !== null ? <> · rata-rata {String(c.childrenPerAdult).replace(".", ",")} anak per remaja/dewasa</> : null}.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Balita dan anak tidak memakai kuota kursi. Gunakan angka &quot;pasti + menunggu&quot; sebagai batas atas perencanaan.
          </p>
        </Panel>

        <Panel title="Kelompok usia" icon={UsersIcon}>
          <AgeGroupChart data={stats.ageGroups} />
          <p className="mt-2 text-xs text-slate-500">Pasti + menunggu, dipisah anggota dan non-anggota.</p>
        </Panel>

        <Panel title="Jenis kelamin per kelompok usia" icon={UsersIcon}>
          <CountTable
            columns={[
              { key: "l", label: "Laki-laki" },
              { key: "p", label: "Perempuan" },
              ...(showUnknown ? [{ key: "u", label: "Tidak diisi" }] : []),
            ]}
            rows={genderRows}
          />
          <p className="mt-2 text-xs text-slate-500">Pasti + menunggu.</p>
        </Panel>

        <Panel title="Ukuran rombongan (per pendaftaran)" icon={UsersIcon}>
          <BarList rows={stats.partySizes.map((s) => ({ label: `${s.label} orang`, value: s.families, note: undefined }))} unit=" pendaftaran" />
          <p className="mt-3 text-xs text-slate-500">Membantu menata kursi berdampingan untuk keluarga.</p>
        </Panel>

        <Panel title="Anggota &amp; sumber pendaftaran" icon={TicketIcon}>
          <BarList
            rows={[
              { label: "Anggota PPME", value: stats.membership.member },
              { label: "Non-anggota", value: stats.membership.nonMember },
            ]}
            unit=" orang"
          />
          <div className="mt-5">
            <BarList
              tone="amber"
              rows={[
                { label: "Daftar online", value: stats.source.online },
                { label: "Didaftarkan panitia (manual)", value: stats.source.manual },
              ]}
              unit=" orang"
            />
          </div>
        </Panel>

        <Panel title="Pendaftaran per hari" icon={ChartBarIcon}>
          {stats.timeline.length ? <RegistrationTimeline data={stats.timeline} /> : <p className="text-sm text-slate-500">Belum ada pendaftaran.</p>}
        </Panel>
      </div>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-white/90 px-4 py-3.5">
      <dt className="text-[13px] font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</dd>
      {sub ? <dd className="mt-0.5 text-xs text-slate-500">{sub}</dd> : null}
    </div>
  );
}
