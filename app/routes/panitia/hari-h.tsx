import { ClockIcon, HomeModernIcon, QrCodeIcon, UsersIcon } from "@heroicons/react/24/outline";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useState } from "react";
import { data } from "react-router";

import type { Route } from "./+types/hari-h";
import { EmptyState, PageHeader, Panel, Stat, StatGroup } from "~/components/admin";
import { AsOf, ageLabel, BarList, CountTable, Progress, useAutoRefresh } from "~/components/panitia";
import { getEventBySlug } from "~/lib/db.server";
import { attendanceStats } from "~/lib/demography.server";
import { getAppEnv } from "~/lib/env.server";
import { formatDateTime, formatTime } from "~/lib/format";

export function meta() {
  return [{ title: "Hari-H – Ringkasan Panitia PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

// Counts only (see demography.server.ts): who is in the room, never who they are.
export async function loader() {
  const env = getAppEnv();
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
  if (!event) throw data("Acara tidak ditemukan.", { status: 404 });
  return {
    event: { title: event.title, startsAt: event.starts_at },
    stats: await attendanceStats(env.DB, event),
  };
}

const GATE_LABEL = { off: "Check-in dimatikan", before: "Check-in belum dibuka", open: "Check-in terbuka", after: "Check-in sudah ditutup" } as const;
const GATE_TONE = {
  off: "bg-red-50 text-red-700 ring-red-200",
  before: "bg-amber-50 text-amber-800 ring-amber-200",
  open: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  after: "bg-slate-100 text-slate-600 ring-slate-200",
} as const;

const REFRESH_MS = 30_000;

export default function HariH({ loaderData }: Route.ComponentProps) {
  const { event, stats } = loaderData;
  // Refresh while the gate is open or about to open; otherwise a manual button is enough.
  const live = stats.gate === "open" || stats.gate === "before";
  const { refreshing, refresh } = useAutoRefresh(REFRESH_MS, live);
  const pct = stats.expected ? Math.round((stats.checkedIn / stats.expected) * 100) : 0;
  const genderRows = stats.genderByAge.map((g) => ({ label: ageLabel(g.group), values: { l: g.lakiLaki, p: g.perempuan, u: g.unknown } }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Hari-H"
        title="Peserta yang sudah hadir"
        description={
          <span className="flex flex-col gap-1">
            <span>
              {event.title} · {formatDateTime(event.startsAt)}
            </span>
            <AsOf asOf={stats.asOf} refreshing={refreshing} onRefresh={refresh} auto={live ? "diperbarui otomatis tiap 30 detik" : undefined} />
          </span>
        }
        actions={
          <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${GATE_TONE[stats.gate]}`}>
            <QrCodeIcon className="size-4" aria-hidden="true" />
            {GATE_LABEL[stats.gate]}
          </span>
        }
      />

      <StatGroup>
        <Stat icon={UsersIcon} label="Sudah hadir" value={stats.checkedIn} sub={`dari ${stats.expected} peserta terdaftar (${pct}%)`} />
        <Stat icon={ClockIcon} label="Belum hadir" value={stats.remaining} sub="terdaftar diterima, belum dipindai" />
        <Stat
          icon={HomeModernIcon}
          label="Anak di ruangan"
          value={stats.childrenIn.total}
          sub={`${stats.childrenIn.balita} balita · ${stats.childrenIn.anak} anak`}
        />
        <Stat
          icon={QrCodeIcon}
          label="Puncak kedatangan"
          value={stats.peak ? stats.peak.time : "–"}
          sub={stats.peak ? `${stats.peak.n} orang dalam 15 menit` : "belum ada yang hadir"}
        />
      </StatGroup>

      <Panel>
        <Progress value={stats.checkedIn} total={stats.expected} label="Kehadiran dibanding peserta terdaftar" />
        {stats.lastCheckinAt ? <p className="mt-2 text-xs text-slate-500">Check-in terakhir pukul {formatTime(stats.lastCheckinAt)}.</p> : null}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Hadir per kelompok usia" icon={UsersIcon}>
          <CountTable
            columns={[
              { key: "in", label: "Hadir" },
              { key: "left", label: "Belum" },
              { key: "exp", label: "Terdaftar" },
            ]}
            rows={stats.byAge.map((a) => ({ label: ageLabel(a.group), values: { in: a.checkedIn, left: a.remaining, exp: a.expected } }))}
          />
        </Panel>

        <Panel title="Hadir: jenis kelamin per kelompok usia" icon={UsersIcon}>
          <CountTable
            columns={[
              { key: "l", label: "Laki-laki" },
              { key: "p", label: "Perempuan" },
              ...(stats.gender.unknown > 0 ? [{ key: "u", label: "Tidak diisi" }] : []),
            ]}
            rows={genderRows}
          />
        </Panel>

        <Panel title="Kedatangan per 15 menit" icon={ClockIcon} className="lg:col-span-2">
          {stats.arrivals.length ? <ArrivalChart data={stats.arrivals} /> : <EmptyState icon={QrCodeIcon}>Belum ada peserta yang dipindai.</EmptyState>}
        </Panel>

        <Panel title="Hadir: anggota &amp; non-anggota" icon={UsersIcon}>
          <BarList
            rows={[
              { label: "Anggota PPME", value: stats.membership.member },
              { label: "Non-anggota", value: stats.membership.nonMember },
            ]}
            unit=" orang"
          />
        </Panel>
      </div>
    </div>
  );
}

function ArrivalChart({ data }: { data: { time: string; n: number; total: number }[] }) {
  // Recharts measures the browser, so it renders after mount (SSR shows the fixed-height box).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const total = data[data.length - 1]?.total ?? 0;
  return (
    <div role="img" aria-label={`Kedatangan per 15 menit, total ${total} orang`} style={{ height: 240 }} className="w-full">
      {mounted ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              contentStyle={{ borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 13, boxShadow: "none" }}
              formatter={(value, name) => [String(value), name === "n" ? "Datang (15 menit)" : "Total hadir"]}
            />
            <Area type="monotone" dataKey="total" stroke="#034EA2" fill="#C9DBF1" strokeWidth={2} isAnimationActive={false} />
            <Area type="monotone" dataKey="n" stroke="#D97706" fill="#F8DDB4" strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
