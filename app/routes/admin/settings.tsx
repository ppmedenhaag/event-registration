import { useEffect, useRef, useState } from "react";
import { Switch } from "@headlessui/react";
import { useFetcher } from "react-router";
import {
  CalendarDaysIcon,
  ArrowUturnLeftIcon,
  BanknotesIcon,
  CheckCircleIcon,
  DocumentArrowDownIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  HeartIcon,
  ClockIcon,
  InformationCircleIcon,
  LockClosedIcon,
  LockOpenIcon,
  MapPinIcon,
  MicrophoneIcon,
  UserPlusIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";

import type { Route } from "./+types/settings";
import { Notice, PageHeader, Panel } from "~/components/admin";
import { TextField } from "~/components/forms";
import { Callout, Spinner, buttonClass } from "~/components/ui";
import { handleAdminIntent } from "~/lib/admin-actions.server";
import { adminEmailContext } from "~/lib/admin-context";
import { getEventBySlug } from "~/lib/db.server";

import { getAppEnv } from "~/lib/env.server";
import { MAX_QUOTA, formatDateTime, formatEuro, utcIsoToLocalInput } from "~/lib/format";
import { quotaSummary, registrationWindowError } from "~/lib/registration.server";
import { RETENTION_DAYS, retentionStatus, type RetentionStatus } from "~/lib/retention.server";

export function meta() {
  return [{ title: "Pengaturan Acara – PPME Den Haag" }, { name: "robots", content: "noindex" }];
}

export async function loader() {
  const env = getAppEnv();
  const event = await getEventBySlug(env.DB, env.DEFAULT_EVENT_SLUG ?? "");
  if (!event) throw new Response("Acara tidak ditemukan.", { status: 404 });
  const quota = await quotaSummary(env.DB, event);
  const retention = await retentionStatus(env.DB, event);
  return {
    quota,
    retention,
    retentionDays: RETENTION_DAYS,
    title: event.title,
    speaker: event.speaker ?? "",
    theme: event.theme ?? "",
    locationName: event.location_name ?? "",
    locationAddress: event.location_address ?? "",
    locationMapUrl: event.location_map_url ?? "",
    infaqUrl: event.infaq_url ?? "",
    startsAt: event.starts_at,
    startsAtLocal: utcIsoToLocalInput(event.starts_at),
    endsAtLocal: utcIsoToLocalInput(event.ends_at),
    opensAt: utcIsoToLocalInput(event.registration_opens_at),
    nonMemberOpensAt: utcIsoToLocalInput(event.non_member_opens_at),
    closesAt: utcIsoToLocalInput(event.registration_closes_at),
    closesAtUtc: event.registration_closes_at,
    nonMemberOpensAtUtc: event.non_member_opens_at,
    price: (event.price_non_member_cents / 100).toFixed(2).replace(/\.00$/, "").replace(".", ","),
    priceCents: event.price_non_member_cents,
    selfAdd: event.self_add_allowed === 1,
    state: registrationWindowError(event, new Date()), // null = open right now
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleAdminIntent(getAppEnv(), context.get(adminEmailContext), await request.formData());
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { title, speaker, theme, locationName, locationAddress, locationMapUrl, infaqUrl, startsAt, startsAtLocal, endsAtLocal, opensAt, nonMemberOpensAt, closesAt, closesAtUtc, nonMemberOpensAtUtc, state, price, priceCents, quota, selfAdd, retention, retentionDays } = loaderData;
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const timesFetcher = useFetcher<{ ok: boolean; message: string }>();
  const timesBusy = timesFetcher.state !== "idle";
  const detailsFetcher = useFetcher<{ ok: boolean; message: string }>();
  const detailsBusy = detailsFetcher.state !== "idle";
  const locationFetcher = useFetcher<{ ok: boolean; message: string }>();
  const locationBusy = locationFetcher.state !== "idle";
  const infaqFetcher = useFetcher<{ ok: boolean; message: string }>();
  const infaqBusy = infaqFetcher.state !== "idle";
  const priceFetcher = useFetcher<{ ok: boolean; message: string }>();
  const priceBusy = priceFetcher.state !== "idle";
  const busy = fetcher.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);

  // Keep the inputs in sync with what was saved (also after a reload of the loader).
  useEffect(() => {
    if (!formRef.current) return;
    (formRef.current.elements.namedItem("opensAt") as HTMLInputElement).value = opensAt;
    (formRef.current.elements.namedItem("nonMemberOpensAt") as HTMLInputElement).value = nonMemberOpensAt;
    (formRef.current.elements.namedItem("closesAt") as HTMLInputElement).value = closesAt;
  }, [opensAt, nonMemberOpensAt, closesAt]);

  return (
    <div>
      <PageHeader eyebrow="Pengaturan" title="Pengaturan acara" description={title} />

      <Panel title="Waktu acara" icon={ClockIcon}>
        <timesFetcher.Form method="post" className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="intent" value="save-event-times" />
          <TextField name="startsAt" type="datetime-local" label="Acara dimulai" defaultValue={startsAtLocal} />
          <TextField name="endsAt" type="datetime-local" label="Acara selesai" defaultValue={endsAtLocal} />
          <div className="sm:col-span-2">
            <button type="submit" disabled={timesBusy} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
              {timesBusy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
              {timesBusy ? "Menyimpan…" : "Simpan waktu acara"}
            </button>
            <button type="reset" disabled={timesBusy} className={buttonClass("secondary", "md", "mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto")}>
              <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
              Reset
            </button>
          </div>
        </timesFetcher.Form>
        <Notice result={timesFetcher.data} className="mt-4" />
        <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
          <Hint icon={ClockIcon}>Waktu dalam zona waktu Belanda (Europe/Amsterdam).</Hint>
          <Hint icon={CalendarDaysIcon}>
            Pendaftaran selalu berakhir saat acara dimulai, jadi batas pendaftaran tidak boleh melewati waktu mulai. Untuk
            memajukan acara, ubah dulu batas pendaftaran.
          </Hint>
          <Hint icon={InformationCircleIcon}>
            Tampil di formulir publik dan di email yang dikirim sesudahnya. Email yang sudah terkirim tidak berubah.
          </Hint>
        </ul>
      </Panel>

      <Panel title="Jadwal pendaftaran online" icon={CalendarDaysIcon} className="mt-6">
        <Callout tone={state ? "warning" : "success"} icon={state ? LockClosedIcon : LockOpenIcon} className="mb-6">
          <p>
            <span className="font-semibold">{state ? `Saat ini: ${state}` : "Saat ini pendaftaran dibuka."}</span>
            {closesAtUtc ? ` Batas pendaftaran: ${formatDateTime(closesAtUtc)} waktu Belanda.` : " Tidak ada batas pendaftaran."}
          </p>
        </Callout>

        <fetcher.Form ref={formRef} method="post" className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="intent" value="save-event-settings" />
          <TextField name="opensAt" type="datetime-local" label="Pendaftaran dibuka" defaultValue={opensAt} />
          <TextField
            name="nonMemberOpensAt"
            type="datetime-local"
            label="Pendaftaran non-anggota dibuka"
            defaultValue={nonMemberOpensAt}
          />
          <TextField name="closesAt" type="datetime-local" label="Batas pendaftaran (ditutup)" defaultValue={closesAt} />
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
              {busy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
              {busy ? "Menyimpan…" : "Simpan jadwal"}
            </button>
            <button type="reset" disabled={busy} className={buttonClass("secondary", "md", "mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto")}>
              <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
              Reset
            </button>
          </div>
        </fetcher.Form>
        <Notice result={fetcher.data} className="mt-4" />
        <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
          <Hint icon={ClockIcon}>Waktu dalam zona waktu Belanda (Europe/Amsterdam).</Hint>
          <Hint icon={CalendarDaysIcon}>
            Kosongkan kolom pembukaan non-anggota agar mereka dapat mendaftar sejak pendaftaran umum dibuka.
            Kosongkan batas pendaftaran untuk tanpa batas. Pendaftaran selalu berakhir saat acara dimulai ({formatDateTime(startsAt)}).
          </Hint>
          {nonMemberOpensAtUtc ? (
            <Hint icon={UsersIcon}>Pendaftaran non-anggota dibuka {formatDateTime(nonMemberOpensAtUtc)} waktu Belanda.</Hint>
          ) : null}
          <Hint icon={LockClosedIcon}>
            Pendaftaran juga ditutup otomatis bila kuota sudah penuh, berapa pun batas waktunya.
          </Hint>
          <Hint icon={InformationCircleIcon}>Perubahan berlaku seketika di formulir publik.</Hint>
        </ul>
      </Panel>

      <Panel title="Pemateri dan tema" icon={MicrophoneIcon} className="mt-6">
        <detailsFetcher.Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="save-event-details" />
          <TextField name="speaker" label="Pemateri" defaultValue={speaker} maxLength={120} placeholder="dr. Aisah Dahlan" />
          <TextField name="theme" label="Tema" defaultValue={theme} maxLength={200} placeholder="Tema kajian" />
          <div>
            <button type="submit" disabled={detailsBusy} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
              {detailsBusy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
              {detailsBusy ? "Menyimpan…" : "Simpan pemateri dan tema"}
            </button>
            <button type="reset" disabled={detailsBusy} className={buttonClass("secondary", "md", "mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto")}>
              <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
              Reset
            </button>
          </div>
        </detailsFetcher.Form>
        <Notice result={detailsFetcher.data} className="mt-4" />
        <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
          <Hint icon={InformationCircleIcon}>
            Tampil di formulir publik dan di email yang dikirim sesudahnya. Kosongkan kolom untuk menyembunyikannya. Email
            yang sudah terkirim tidak berubah.
          </Hint>
        </ul>
      </Panel>

      <Panel title="Lokasi acara" icon={MapPinIcon} className="mt-6">
        <locationFetcher.Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="save-event-location" />
          <TextField name="locationName" label="Nama lokasi" defaultValue={locationName} maxLength={120} placeholder="Masjid Al Hikmah" />
          <TextField name="locationAddress" label="Alamat" defaultValue={locationAddress} maxLength={200} placeholder="Medlerstraat 4, 2531 HA Den Haag" />
          <TextField name="locationMapUrl" label="Tautan Google Maps" defaultValue={locationMapUrl} maxLength={300} placeholder="https://maps.app.goo.gl/…" />
          <div>
            <button type="submit" disabled={locationBusy} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
              {locationBusy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
              {locationBusy ? "Menyimpan…" : "Simpan lokasi"}
            </button>
            <button type="reset" disabled={locationBusy} className={buttonClass("secondary", "md", "mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto")}>
              <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
              Reset
            </button>
          </div>
        </locationFetcher.Form>
        <Notice result={locationFetcher.data} className="mt-4" />
        <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
          <Hint icon={InformationCircleIcon}>
            Tampil di formulir pendaftaran, email konfirmasi, dan kalender (.ics, Google, Outlook). Kosongkan semua kolom untuk
            menyembunyikan lokasi. Email yang sudah terkirim tidak berubah.
          </Hint>
        </ul>
      </Panel>

      <Panel title="Infaq sukarela" icon={HeartIcon} className="mt-6">
        <infaqFetcher.Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="save-event-infaq" />
          <TextField name="infaqUrl" label="Tautan pembayaran infaq" defaultValue={infaqUrl} maxLength={300} placeholder="https://www.ing.nl/payreq/m/…" />
          <div>
            <button type="submit" disabled={infaqBusy} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
              {infaqBusy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
              {infaqBusy ? "Menyimpan…" : "Simpan tautan infaq"}
            </button>
            <button type="reset" disabled={infaqBusy} className={buttonClass("secondary", "md", "mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto")}>
              <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
              Reset
            </button>
          </div>
        </infaqFetcher.Form>
        <Notice result={infaqFetcher.data} className="mt-4" />
        <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
          <Hint icon={InformationCircleIcon}>
            Tombol "Berikan Infaq" di email konfirmasi. Harus berupa alamat https://. Kosongkan untuk menyembunyikan seluruh blok
            infaq dari email. Email yang sudah terkirim tidak berubah.
          </Hint>
        </ul>
      </Panel>

      <Panel title="Kapasitas (kuota)" icon={UsersIcon} className="mt-6">
        <QuotaForm quota={quota} />
      </Panel>

      <Panel title="Tambah peserta lewat Pendaftaran Saya" icon={UserPlusIcon} className="mt-6">
        <SelfAddToggle allowed={selfAdd} />
      </Panel>

      <Panel title="Biaya pendaftaran" icon={BanknotesIcon} className="mt-6">
        <Callout tone="warning" icon={ExclamationTriangleIcon} className="mb-6">
          <p>
            <span className="font-semibold">Perubahan biaya hanya berlaku untuk pendaftaran baru.</span> Pendaftaran yang sudah
            masuk tetap memakai jumlah lama. Satu pengecualian: bila peserta non-anggota mengubah pendaftarannya yang belum
            dibayar lewat "Pendaftaran Saya", totalnya dihitung ulang dengan biaya yang berlaku saat itu.
          </p>
        </Callout>
        <priceFetcher.Form method="post" className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="intent" value="save-event-price" />
          <TextField
            name="price"
            label="Biaya non-anggota per orang remaja/dewasa (€)"
            inputMode="decimal"
            defaultValue={price}
            placeholder="10"
          />
          <div className="sm:col-span-2">
            <button type="submit" disabled={priceBusy} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
              {priceBusy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
              {priceBusy ? "Menyimpan…" : "Simpan biaya"}
            </button>
            <button type="reset" disabled={priceBusy} className={buttonClass("secondary", "md", "mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto")}>
              <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
              Reset
            </button>
          </div>
        </priceFetcher.Form>
        <Notice result={priceFetcher.data} className="mt-4" />
        <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
          <Hint icon={BanknotesIcon}>
            {priceCents === 0
              ? "Biaya saat ini: GRATIS. Non-anggota langsung diterima dan QR Code dikirim lewat email oleh cron (maksimal sekitar 10 menit); tidak ada instruksi pembayaran."
              : `Biaya saat ini: ${formatEuro(priceCents)} per orang remaja/dewasa. Balita, anak, dan anggota gratis.`}
          </Hint>
          <Hint icon={InformationCircleIcon}>Isi 0 untuk acara gratis bagi non-anggota. Anggota tetap menunggu validasi keanggotaan.</Hint>
          <Hint icon={InformationCircleIcon}>Setiap perubahan dicatat di audit log.</Hint>
        </ul>
      </Panel>

      <div id="retensi" className="mt-6 scroll-mt-24">
        <Panel title="Retensi data (penghapusan otomatis)" icon={TrashIcon}>
          <RetentionPanel status={retention} days={retentionDays} />
        </Panel>
      </div>
    </div>
  );
}

function Hint({ icon: Icon, children }: { icon: typeof ClockIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function RetentionPanel({ status, days }: { status: RetentionStatus; days: number }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const pending = fetcher.formData ? fetcher.formData.get("hold") === "1" : null;
  const hold = pending ?? status.hold;
  const { counts, purged, warnings, decision } = status;
  const dueText = status.dueIso ? formatDateTime(status.dueIso) : "";

  let tone: "success" | "warning" | "info" = "info";
  let headline = "";
  if (purged) {
    tone = "success";
    headline = `Data peserta sudah dihapus pada ${formatDateTime(purged.at)}. Tersisa hanya angka ringkasan.`;
  } else if (hold) {
    tone = "warning";
    headline = "Penghapusan otomatis DITUNDA. Tidak ada peringatan atau penghapusan sampai tunda dimatikan.";
  } else if (!status.dueIso) {
    tone = "warning";
    headline = "Tanggal selesai acara tidak valid, jadi penghapusan otomatis tidak berjalan. Perbaiki di Waktu acara.";
  } else if (decision?.action === "purge") {
    tone = "warning";
    headline = "Syarat terpenuhi: data dihapus pada pengecekan otomatis berikutnya (dalam beberapa menit).";
  } else if (decision?.action === "wait" && decision.reason === "final_warning_too_recent") {
    headline = "Peringatan terakhir baru dikirim. Penghapusan menyusul paling cepat 24 jam setelahnya.";
  } else if (decision?.action === "warn") {
    headline = "Peringatan ke semua admin akan dikirim pada pengecekan otomatis berikutnya.";
  } else {
    headline = `Dijadwalkan: ${dueText} waktu Belanda (${days} hari setelah acara selesai).`;
  }

  return (
    <>
      <Callout tone={tone} icon={purged ? CheckCircleIcon : hold ? ExclamationTriangleIcon : InformationCircleIcon} className="mb-6">
        <p className="font-semibold">{headline}</p>
      </Callout>

      {!purged ? (
        <dl className="mb-6 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Tanggal penghapusan</dt>
            <dd className="mt-0.5 text-slate-900">{dueText || "–"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Akan dihapus permanen</dt>
            <dd className="mt-0.5 text-slate-900 tabular-nums">
              {counts.registrations} pendaftaran, {counts.participants} peserta
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Peringatan ke admin yang sudah terkirim</dt>
            <dd className="mt-0.5 text-slate-900">
              {warnings.length
                ? warnings.map((w) => `${w.stage === "w30" ? "30 hari" : w.stage === "w7" ? "7 hari" : "1 hari"} sebelum (${formatDateTime(w.at)}, ${w.sent} penerima)`).join(" · ")
                : "Belum ada. Peringatan dikirim 30, 7, dan 1 hari sebelum tanggal penghapusan."}
            </dd>
          </div>
        </dl>
      ) : (
        <dl className="mb-6 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Dihapus</dt>
            <dd className="mt-0.5 text-slate-900 tabular-nums">
              {purged.snapshot.registrations} pendaftaran, {purged.snapshot.participants} peserta ({purged.snapshot.checkedIn} pernah check-in)
            </dd>
          </div>
        </dl>
      )}

      {!purged ? (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">{hold ? "Penghapusan ditunda" : "Tunda penghapusan"}</p>
              <p className="mt-1 text-sm text-slate-600">
                Aktifkan hanya jika ada sengketa atau insiden keamanan yang belum selesai. Setelah dimatikan, admin menerima
                peringatan terakhir dulu dan penghapusan menyusul paling cepat 24 jam kemudian.
              </p>
            </div>
            <Switch
              checked={hold}
              disabled={fetcher.state !== "idle"}
              onChange={(v) => fetcher.submit({ intent: "save-retention-hold", hold: v ? "1" : "0" }, { method: "post" })}
              aria-label="Tunda penghapusan data otomatis"
              className="group relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-slate-300 bg-slate-200 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60 data-checked:border-brand data-checked:bg-brand"
            >
              <span className="pointer-events-none inline-block size-5 translate-x-0.5 translate-y-px rounded-full bg-white shadow transition-transform group-data-checked:translate-x-5" />
            </Switch>
          </div>
          <Notice result={fetcher.data} className="mt-4" />
          <div className="mt-5">
            <a href="/admin/export" className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
              <DocumentArrowDownIcon className="size-4" aria-hidden="true" />
              Unduh ekspor (CSV) sebelum dihapus
            </a>
          </div>
        </>
      ) : null}

      <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
        <Hint icon={TrashIcon}>
          Sesuai Kebijakan Privasi, data pribadi peserta dihapus otomatis {days} hari setelah acara selesai: pendaftaran, peserta, log email, dan nama serta email pada catatan aktivitas lama. Penghapusan tidak dapat dibatalkan.
        </Hint>
        <Hint icon={InformationCircleIcon}>
          Peringatan dikirim ke semua admin. Penghapusan hanya berjalan setelah peringatan terakhir sampai ke minimal satu admin. Tersisa hanya angka ringkasan.
        </Hint>
        <Hint icon={InformationCircleIcon}>Setiap perubahan dicatat di audit log.</Hint>
      </ul>
    </>
  );
}

function SelfAddToggle({ allowed }: { allowed: boolean }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  // Show the requested value right away while saving.
  const pending = fetcher.formData ? fetcher.formData.get("allowed") === "1" : null;
  const on = pending ?? allowed;
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {on ? "Peserta boleh menambah peserta baru sendiri" : "Peserta tidak boleh menambah peserta baru sendiri"}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Hanya menyangkut menambah orang baru di "Pendaftaran Saya". Mengubah data, menghapus peserta, dan membatalkan
            pendaftaran tetap bisa dilakukan sendiri.
          </p>
        </div>
        <Switch
          checked={on}
          disabled={fetcher.state !== "idle"}
          onChange={(v) => fetcher.submit({ intent: "save-self-add", allowed: v ? "1" : "0" }, { method: "post" })}
          aria-label="Izinkan peserta menambah peserta baru sendiri"
          className="group relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-slate-300 bg-slate-200 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60 data-checked:border-brand data-checked:bg-brand"
        >
          <span className="pointer-events-none inline-block size-5 translate-x-0.5 translate-y-px rounded-full bg-white shadow transition-transform group-data-checked:translate-x-5" />
        </Switch>
      </div>
      <Notice result={fetcher.data} className="mt-4" />
      <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
        <Hint icon={UsersIcon}>
          Standarnya mati, supaya kuota tidak bertambah tanpa sepengetahuan panitia. Peserta yang butuh tambahan orang
          menghubungi panitia. Saat menyala, penambahan tetap dicek terhadap sisa kuota.
        </Hint>
        <Hint icon={InformationCircleIcon}>Setiap perubahan dicatat di audit log dan berlaku seketika.</Hint>
      </ul>
    </>
  );
}

type QuotaGroup = { quota: number; used: number; remaining: number };

function QuotaForm({ quota }: { quota: { member: QuotaGroup; nonMember: QuotaGroup } }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const busy = fetcher.state !== "idle";
  const [resetKey, setResetKey] = useState(0); // remounting the sliders restores the saved values
  return (
    <>
      <fetcher.Form method="post" className="grid gap-6 sm:grid-cols-2">
        <input type="hidden" name="intent" value="save-quotas" />
        <QuotaSlider key={`m${resetKey}`} name="quotaMember" label="Kuota anggota" group={quota.member} />
        <QuotaSlider key={`n${resetKey}`} name="quotaNonMember" label="Kuota non-anggota" group={quota.nonMember} />
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
            {busy ? <Spinner /> : <CheckCircleIcon className="size-4" aria-hidden="true" />}
            {busy ? "Menyimpan…" : "Simpan kuota"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setResetKey((k) => k + 1)}
            className={buttonClass("secondary", "md", "mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto")}
          >
            <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
            Reset
          </button>
        </div>
      </fetcher.Form>
      <Notice result={fetcher.data} className="mt-4" />
      <ul className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
        <Hint icon={UsersIcon}>Kuota tidak bisa lebih kecil dari kursi yang sudah terpakai (pendaftaran online diterima + menunggu bayar yang belum lewat batas).</Hint>
        <Hint icon={InformationCircleIcon}>Pendaftaran manual tidak dihitung dalam kuota. Perubahan berlaku seketika di formulir publik.</Hint>
      </ul>
    </>
  );
}

function QuotaSlider({ name, label, group }: { name: string; label: string; group: QuotaGroup }) {
  const [value, setValue] = useState(String(group.quota));
  // Re-sync after a save/reload.
  useEffect(() => setValue(String(group.quota)), [group.quota]);
  const min = group.used;
  const max = Math.max(500, group.quota);
  const n = Number(value);
  const clamp = (v: number) => Math.min(MAX_QUOTA, Math.max(min, v));
  const sliderValue = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  const invalid = value.trim() === "" || !/^\d+$/.test(value.trim()) || n < min || n > MAX_QUOTA;
  return (
    <div>
      <TextField
        name={name}
        label={label}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        onBlur={() => setValue(String(clamp(Number.isFinite(n) ? n : group.quota)))}
        aria-invalid={invalid}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={sliderValue}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`${label} (slider)`}
        className="mt-3 h-2 w-full cursor-pointer accent-brand"
      />
      <div className="mt-1 flex justify-between text-xs text-slate-500 tabular-nums">
        <span>min {min} (terpakai)</span>
        <span>{max}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Terpakai {group.used} · sisa {group.remaining}
      </p>
      {invalid ? <p className="mt-1 text-xs text-red-600">Minimal {min}, maksimal {MAX_QUOTA}.</p> : null}
    </div>
  );
}
