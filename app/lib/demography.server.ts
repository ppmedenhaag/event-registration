import { buildTimeline } from "./admin.server";
import { gateState, type GateState } from "./checkin.server";
import type { EventRow } from "./db.server";
import { AGE_GROUPS, formatTime, localDateKey } from "./format";
import { quotaSummary } from "./registration.server";

/**
 * Aggregate numbers for the read-only panitia dashboards (/panitia).
 *
 * PRIVACY RULE: everything returned from this file is a COUNT, a time-of-day bucket or a fixed label. Rows are read
 * and summed inside these functions; no name, email, phone, ticket code, registration id or free text ever leaves
 * them (tests/viewer.test.ts asserts it on a database full of recognisable personal data). Do not add a field here
 * that identifies a person; if a new chart needs one, it belongs in /admin, not /panitia.
 */

type Gender = "laki-laki" | "perempuan" | "unknown";
const genderOf = (g: string | null): Gender => (g === "laki-laki" || g === "perempuan" ? g : "unknown");

export interface GenderCounts {
  lakiLaki: number;
  perempuan: number;
  unknown: number;
}
const emptyGender = (): GenderCounts => ({ lakiLaki: 0, perempuan: 0, unknown: 0 });
function addGender(c: GenderCounts, g: Gender, n: number) {
  if (g === "laki-laki") c.lakiLaki += n;
  else if (g === "perempuan") c.perempuan += n;
  else c.unknown += n;
}

/** Active = counts toward the plan: accepted, waiting for member validation, or waiting for payment within the deadline. */
const ACTIVE_SQL = `(r.status IN ('accepted', 'pending_membership') OR (r.status = 'pending_payment' AND r.pay_deadline > ?))`;

// ---------------------------------------------------------------- planning (everyone who registered)

export interface PlanningStats {
  asOf: string;
  /** "Pasti" = accepted. "Menunggu" = waiting for payment or member validation (may still drop out). */
  totals: { confirmedPeople: number; pendingPeople: number; confirmedFamilies: number; pendingFamilies: number };
  quota: Awaited<ReturnType<typeof quotaSummary>>;
  ageGroups: { group: string; confirmed: number; pending: number; member: number; nonMember: number }[];
  genderByAge: ({ group: string } & GenderCounts)[];
  gender: GenderCounts;
  membership: { member: number; nonMember: number };
  source: { online: number; manual: number };
  children: {
    balita: { confirmed: number; pending: number };
    anak: { confirmed: number; pending: number };
    familiesWithBalita: number;
    familiesWithAnak: number;
    familiesWithChildren: number;
    /** (balita + anak) per remaja/dewasa, rounded to 2 decimals; null when there are no adults/teens yet. */
    childrenPerAdult: number | null;
  };
  partySizes: { label: string; families: number }[];
  timeline: { date: string; member: number; nonMember: number }[];
}

export async function planningStats(db: D1Database, event: EventRow, now = new Date()): Promise<PlanningStats> {
  const nowIso = now.toISOString();

  const [cells, families, regRows, quota] = await Promise.all([
    db
      .prepare(
        `SELECT CASE WHEN r.status = 'accepted' THEN 'confirmed' ELSE 'pending' END AS scope,
                p.age_group, p.gender, r.is_member, r.source, COUNT(*) AS n
         FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE r.event_id = ? AND ${ACTIVE_SQL}
         GROUP BY 1, 2, 3, 4, 5`,
      )
      .bind(event.id, nowIso)
      .all<{ scope: "confirmed" | "pending"; age_group: string; gender: string | null; is_member: number; source: string; n: number }>(),
    db
      .prepare(
        `SELECT r.status = 'accepted' AS confirmed, r.people,
                EXISTS (SELECT 1 FROM participants p WHERE p.registration_id = r.id AND p.age_group = 'balita') AS has_balita,
                EXISTS (SELECT 1 FROM participants p WHERE p.registration_id = r.id AND p.age_group = 'anak') AS has_anak
         FROM registrations r WHERE r.event_id = ? AND ${ACTIVE_SQL}`,
      )
      .bind(event.id, nowIso)
      .all<{ confirmed: number; people: number; has_balita: number; has_anak: number }>(),
    db
      .prepare(
        `SELECT r.created_at, r.is_member, r.people FROM registrations r
         WHERE r.event_id = ? AND ${ACTIVE_SQL} ORDER BY r.created_at`,
      )
      .bind(event.id, nowIso)
      .all<{ created_at: string; is_member: number; people: number }>(),
    quotaSummary(db, event, now),
  ]);

  const totals = { confirmedPeople: 0, pendingPeople: 0, confirmedFamilies: 0, pendingFamilies: 0 };
  const gender = emptyGender();
  const membership = { member: 0, nonMember: 0 };
  const source = { online: 0, manual: 0 };
  const ageGroups = AGE_GROUPS.map((group) => ({ group, confirmed: 0, pending: 0, member: 0, nonMember: 0 }));
  const genderByAge = AGE_GROUPS.map((group) => ({ group, ...emptyGender() }));

  for (const c of cells.results) {
    const a = ageGroups.find((x) => x.group === c.age_group);
    const g = genderByAge.find((x) => x.group === c.age_group);
    if (!a || !g) continue;
    if (c.scope === "confirmed") {
      a.confirmed += c.n;
      totals.confirmedPeople += c.n;
    } else {
      a.pending += c.n;
      totals.pendingPeople += c.n;
    }
    if (c.is_member) {
      a.member += c.n;
      membership.member += c.n;
    } else {
      a.nonMember += c.n;
      membership.nonMember += c.n;
    }
    if (c.source === "manual") source.manual += c.n;
    else source.online += c.n;
    addGender(g, genderOf(c.gender), c.n);
    addGender(gender, genderOf(c.gender), c.n);
  }

  const sizes = [0, 0, 0, 0, 0]; // 1, 2, 3, 4, 5+
  let withBalita = 0;
  let withAnak = 0;
  let withChildren = 0;
  for (const f of families.results) {
    if (f.confirmed) totals.confirmedFamilies++;
    else totals.pendingFamilies++;
    sizes[Math.min(Math.max(f.people, 1), 5) - 1]++;
    if (f.has_balita) withBalita++;
    if (f.has_anak) withAnak++;
    if (f.has_balita || f.has_anak) withChildren++;
  }

  const age = (g: string) => ageGroups.find((x) => x.group === g)!;
  const kids = age("balita").confirmed + age("balita").pending + age("anak").confirmed + age("anak").pending;
  const grownUps = age("remaja").confirmed + age("remaja").pending + age("dewasa").confirmed + age("dewasa").pending;

  return {
    asOf: nowIso,
    totals,
    quota,
    ageGroups,
    genderByAge,
    gender,
    membership,
    source,
    children: {
      balita: { confirmed: age("balita").confirmed, pending: age("balita").pending },
      anak: { confirmed: age("anak").confirmed, pending: age("anak").pending },
      familiesWithBalita: withBalita,
      familiesWithAnak: withAnak,
      familiesWithChildren: withChildren,
      childrenPerAdult: grownUps > 0 ? Math.round((kids / grownUps) * 100) / 100 : null,
    },
    partySizes: sizes.map((families, i) => ({ label: i === 4 ? "5+" : String(i + 1), families })),
    timeline: buildTimeline(regRows.results, now),
  };
}

// ---------------------------------------------------------------- event day (who actually checked in)

export interface AttendanceStats {
  asOf: string;
  /** True when "now" is the calendar day of the event (Netherlands time): the page opens on this view. */
  eventDay: boolean;
  gate: GateState;
  expected: number;
  checkedIn: number;
  remaining: number;
  byAge: { group: string; expected: number; checkedIn: number; remaining: number }[];
  /** Checked-in people only. */
  genderByAge: ({ group: string } & GenderCounts)[];
  gender: GenderCounts;
  membership: { member: number; nonMember: number };
  /** Children currently registered as present (balita + anak), for the baby/children room. */
  childrenIn: { balita: number; anak: number; total: number };
  /** Arrivals per 15 minutes (Netherlands time), cumulative `total` alongside. */
  arrivals: { time: string; n: number; total: number }[];
  peak: { time: string; n: number } | null;
  lastCheckinAt: string | null;
}

const BUCKET_MS = 15 * 60_000;

export async function attendanceStats(db: D1Database, event: EventRow, now = new Date()): Promise<AttendanceStats> {
  const [cells, stamps] = await Promise.all([
    db
      .prepare(
        `SELECT p.age_group, p.gender, r.is_member, COUNT(*) AS expected,
                SUM(CASE WHEN p.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
         FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE r.event_id = ? AND p.status = 'accepted'
         GROUP BY 1, 2, 3`,
      )
      .bind(event.id)
      .all<{ age_group: string; gender: string | null; is_member: number; expected: number; checked_in: number | null }>(),
    db
      .prepare(
        `SELECT p.checked_in_at AS at FROM participants p JOIN registrations r ON r.id = p.registration_id
         WHERE r.event_id = ? AND p.status = 'accepted' AND p.checked_in_at IS NOT NULL ORDER BY p.checked_in_at`,
      )
      .bind(event.id)
      .all<{ at: string }>(),
  ]);

  let expected = 0;
  let checkedIn = 0;
  const gender = emptyGender();
  const membership = { member: 0, nonMember: 0 };
  const byAge = AGE_GROUPS.map((group) => ({ group, expected: 0, checkedIn: 0, remaining: 0 }));
  const genderByAge = AGE_GROUPS.map((group) => ({ group, ...emptyGender() }));

  for (const c of cells.results) {
    const a = byAge.find((x) => x.group === c.age_group);
    const g = genderByAge.find((x) => x.group === c.age_group);
    if (!a || !g) continue;
    const inN = c.checked_in ?? 0;
    a.expected += c.expected;
    a.checkedIn += inN;
    expected += c.expected;
    checkedIn += inN;
    addGender(g, genderOf(c.gender), inN);
    addGender(gender, genderOf(c.gender), inN);
    if (c.is_member) membership.member += inN;
    else membership.nonMember += inN;
  }
  for (const a of byAge) a.remaining = a.expected - a.checkedIn;

  const buckets = new Map<number, number>();
  for (const s of stamps.results) {
    const t = Math.floor(Date.parse(s.at) / BUCKET_MS) * BUCKET_MS;
    if (Number.isFinite(t)) buckets.set(t, (buckets.get(t) ?? 0) + 1);
  }
  let running = 0;
  let peak: { time: string; n: number } | null = null;
  const arrivals = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, n]) => {
      running += n;
      const time = formatTime(new Date(t).toISOString());
      if (!peak || n > peak.n) peak = { time, n };
      return { time, n, total: running };
    });

  const childIn = (g: string) => byAge.find((a) => a.group === g)!.checkedIn;
  return {
    asOf: now.toISOString(),
    eventDay: localDateKey(now) === localDateKey(event.starts_at),
    gate: gateState(event, now),
    expected,
    checkedIn,
    remaining: expected - checkedIn,
    byAge,
    genderByAge,
    gender,
    membership,
    childrenIn: { balita: childIn("balita"), anak: childIn("anak"), total: childIn("balita") + childIn("anak") },
    arrivals,
    peak,
    lastCheckinAt: stamps.results.length ? stamps.results[stamps.results.length - 1].at : null,
  };
}
