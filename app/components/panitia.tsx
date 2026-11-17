import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useEffect, useState, type ReactNode } from "react";
import { useRevalidator } from "react-router";

import { AGE_GROUP_LABEL, AGE_GROUP_SHORT, formatTime } from "~/lib/format";

/** Presentational pieces of the read-only panitia dashboards. They only ever receive counts (see demography.server.ts). */

/** Horizontal bars with a label and a number: easy to read on a phone, no chart library needed. */
export function BarList({
  rows,
  tone = "brand",
  unit = "",
}: {
  rows: { label: ReactNode; value: number; note?: ReactNode }[];
  tone?: "brand" | "amber" | "emerald";
  unit?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fill = tone === "amber" ? "bg-amber-500" : tone === "emerald" ? "bg-emerald-600" : "bg-brand";
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={i}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-700">{r.label}</span>
            <span className="font-semibold text-slate-900 tabular-nums">
              {r.value}
              {unit}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="presentation">
            <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.round((r.value / max) * 100)}%` }} />
          </div>
          {r.note ? <div className="mt-0.5 text-xs text-slate-500">{r.note}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** Progress of `value` out of `total`, with the percentage. */
export function Progress({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-900 tabular-nums">{pct}%</span>
      </div>
      <div
        className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
      >
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export interface CountTableColumn {
  key: string;
  label: string;
}

/** Small table of counts: first column = row label, the rest are numbers; an optional total row. */
export function CountTable({
  columns,
  rows,
  total = true,
}: {
  columns: CountTableColumn[];
  rows: { label: string; values: Record<string, number> }[];
  total?: boolean;
}) {
  const sum = (k: string) => rows.reduce((n, r) => n + (r.values[k] ?? 0), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[20rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <th className="py-2 pr-3 font-semibold">&nbsp;</th>
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-2 text-right font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="py-2 pr-3 text-left font-medium text-slate-700">
                {r.label}
              </th>
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-2 text-right text-slate-900 tabular-nums">
                  {r.values[c.key] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total ? (
          <tfoot>
            <tr className="border-t border-slate-300 font-semibold text-slate-900">
              <th scope="row" className="py-2 pr-3 text-left">
                Total
              </th>
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                  {sum(c.key)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export const ageLabel = (g: string) => AGE_GROUP_LABEL[g] ?? AGE_GROUP_SHORT[g] ?? g;

/**
 * Reload the loader data every `ms` while the tab is visible (event day). The server answers with fresh counts only;
 * nothing is cached (the layout sets no-store).
 */
export function useAutoRefresh(ms: number, enabled = true) {
  const revalidator = useRevalidator();
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") {
        revalidator.revalidate();
        setAt(Date.now());
      }
    }, ms);
    return () => window.clearInterval(id);
  }, [ms, enabled, revalidator]);
  return { refreshing: revalidator.state !== "idle", lastAt: at, refresh: () => revalidator.revalidate() };
}

/** "Data per 14.32" + a refresh button. `asOf` comes from the server so SSR and browser agree. */
export function AsOf({ asOf, refreshing, onRefresh, auto }: { asOf: string; refreshing?: boolean; onRefresh?: () => void; auto?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>Data per {formatTime(asOf)} (waktu Belanda)</span>
      {auto ? <span className="text-slate-400">{auto}</span> : null}
      {onRefresh ? (
        <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-dark">
          <ArrowPathIcon className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          Muat ulang
        </button>
      ) : null}
    </span>
  );
}
