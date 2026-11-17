import { useEffect, useState, type ReactElement } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AGE_GROUP_SHORT } from "~/lib/format";

// Recharts measures its container in the browser, so charts render after mount (a fixed-height placeholder is
// shown during SSR / first paint; no layout shift). Every chart is width 100% and works from ~320px up.

export const MEMBER_COLOR = "#034EA2"; // brand blue
export const NON_MEMBER_COLOR = "#D97706"; // amber: distinguishable from blue for colour-blind viewers
const MEMBER_TINT = "#C9DBF1";
const NON_MEMBER_TINT = "#F8DDB4";
const AXIS = { fontSize: 12, fill: "#64748b" };

function ChartBox({ height, label, children }: { height: number; label: string; children: ReactElement }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      {mounted ? (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}

const tooltipStyle = { borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 13, boxShadow: "none" };
const legendStyle = { fontSize: 13, paddingTop: 8 };

const shortDay = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", day: "numeric", month: "short" });
const longDay = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", weekday: "short", day: "numeric", month: "long" });
const dayOf = (key: string) => new Date(key + "T12:00:00Z");

export function RegistrationTimeline({ data }: { data: { date: string; member: number; nonMember: number }[] }) {
  const total = data.reduce((n, d) => n + d.member + d.nonMember, 0);
  return (
    <ChartBox height={260} label={`Pendaftaran harian: ${total} peserta dalam ${data.length} hari`}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(k) => shortDay.format(dayOf(String(k)))}
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: "#cbd5e1" }}
          minTickGap={24}
        />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={36} />
        <Tooltip labelFormatter={(k) => longDay.format(dayOf(String(k)))} contentStyle={tooltipStyle} />
        <Legend wrapperStyle={legendStyle} iconType="circle" />
        <Area
          type="monotone"
          dataKey="member"
          name="Anggota"
          stroke={MEMBER_COLOR}
          fill={MEMBER_COLOR}
          fillOpacity={0.15}
          strokeWidth={2}
          dot={data.length <= 14}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="nonMember"
          name="Non-anggota"
          stroke={NON_MEMBER_COLOR}
          fill={NON_MEMBER_COLOR}
          fillOpacity={0.15}
          strokeWidth={2}
          dot={data.length <= 14}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartBox>
  );
}

type QuotaPart = { used: number; quota: number };

/** Donut: filled slice = seats taken, light slice = seats still free, per group. Centre = total taken / total quota. */
export function QuotaDonut({ member, nonMember }: { member: QuotaPart; nonMember: QuotaPart }) {
  const free = (q: QuotaPart) => Math.max(0, q.quota - q.used);
  const slices = [
    { name: "Anggota terisi", value: member.used, color: MEMBER_COLOR },
    { name: "Anggota sisa", value: free(member), color: MEMBER_TINT },
    { name: "Non-anggota terisi", value: nonMember.used, color: NON_MEMBER_COLOR },
    { name: "Non-anggota sisa", value: free(nonMember), color: NON_MEMBER_TINT },
  ];
  const used = member.used + nonMember.used;
  const quota = member.quota + nonMember.quota;
  return (
    <div>
      <div className="relative">
        <ChartBox height={200} label={`Kuota: ${used} dari ${quota} kursi terisi`}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={slices.filter((s) => s.value > 0).length > 1 ? 1 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ChartBox>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{used}</span>
          <span className="text-xs text-slate-500 tabular-nums">dari {quota} kursi</span>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 text-sm">
        {(
          [
            ["Anggota", member, MEMBER_COLOR],
            ["Non-anggota", nonMember, NON_MEMBER_COLOR],
          ] as const
        ).map(([label, q, color]) => (
          <li key={label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
            <span className="flex-1 text-slate-700">{label}</span>
            <span className="text-slate-500 tabular-nums">
              <span className="font-semibold text-slate-900">{q.used}</span> / {q.quota} kursi
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgeGroupChart({ data }: { data: { group: string; member: number; nonMember: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: AGE_GROUP_SHORT[d.group] ?? d.group }));
  const total = rows.reduce((n, d) => n + d.member + d.nonMember, 0);
  return (
    <ChartBox height={240} label={`Kelompok usia peserta: ${total} peserta`}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={36} />
        <Tooltip cursor={{ fill: "#f1f5f9" }} contentStyle={tooltipStyle} />
        <Legend wrapperStyle={legendStyle} iconType="circle" />
        <Bar dataKey="member" name="Anggota" stackId="a" fill={MEMBER_COLOR} maxBarSize={56} isAnimationActive={false} />
        <Bar
          dataKey="nonMember"
          name="Non-anggota"
          stackId="a"
          fill={NON_MEMBER_COLOR}
          maxBarSize={56}
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartBox>
  );
}
