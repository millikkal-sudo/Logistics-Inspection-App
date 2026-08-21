'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CaloMark } from './CaloMark';
import { PlateScanner, type PlateReading } from './PlateScanner';
import type { Area, Driver, InspectionStatus, Van } from '@/lib/types';

type Tab = 'reports' | 'areas' | 'vans' | 'drivers';

type ReportRow = {
  id: string;
  performedAt: string;
  plate: string;
  areaName: string;
  driverName: string;
  helperName: string | null;
  inspectorName: string;
  status: InspectionStatus;
  dispatchBlocked: boolean;
  failedCount: number;
  tempReadingC: number | null;
  notes: string | null;
};

type FailureDetail = {
  label: string;
  critical: boolean;
  numericValue: number | null;
  note: string | null;
  photoUrls: string[];
};

type Detail = {
  id: string;
  plate: string;
  driverName: string;
  helperName: string | null;
  inspectorName: string;
  notes: string | null;
  failures: FailureDetail[];
  passedCount: number;
};

const STATUS_META: Record<InspectionStatus, { label: string; text: string; bg: string }> = {
  compliant: { label: 'Cleared', text: 'text-pass', bg: 'bg-pass-soft' },
  noncompliant: { label: 'Non-compliant', text: 'text-fail', bg: 'bg-fail-soft' },
  action_required: { label: 'Held', text: 'text-hold', bg: 'bg-hold-soft' },
};

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

type Props = {
  areas: Area[];
  vans: Van[];
  drivers: Driver[];
  isAdmin: boolean;
};

export const AdminDashboard = ({ areas, vans, drivers, isAdmin }: Props) => {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('reports');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (path: string, method: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json();
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? String((payload as { error: unknown }).error)
            : 'Something went wrong';
        setError(message);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError('Could not reach the server');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const areaName = (id: string | null): string =>
    areas.find((area) => area.id === id)?.name ?? 'Unassigned';

  return (
    <div className="mx-auto min-h-screen max-w-5xl bg-surface-page">
      <header className="bg-brand-bold px-6 pb-4 pt-6">
        <div className="mb-5">
          <CaloMark invert />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-content-invert-secondary">
              UAE · Manager view
            </div>
            <h1 className="text-2xl font-black text-content-invert">Van check admin</h1>
          </div>
          <a
            href="/"
            className="rounded-lg bg-invert-subtle px-3 py-2 text-xs font-bold text-content-invert"
          >
            Back to checks
          </a>
        </div>

        <nav className="mt-4 flex gap-1 overflow-x-auto">
          {(['reports', 'areas', 'vans', 'drivers'] as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold capitalize ${
                tab === key ? 'bg-content-invert text-brand-bold' : 'text-content-invert-secondary'
              }`}
            >
              {key}
            </button>
          ))}
        </nav>
      </header>

      <div className="p-4 sm:p-6">
        {error !== null && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-fail-soft p-4">
            <p className="text-sm font-medium leading-relaxed text-fail">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss"
              className="shrink-0 text-fail"
            >
              ✕
            </button>
          </div>
        )}

        {tab === 'reports' && <Reports areas={areas} />}

        {tab === 'areas' && (
          <AreasTab areas={areas} busy={busy} isAdmin={isAdmin} onCall={call} />
        )}

        {tab === 'vans' && (
          <VansTab vans={vans} areas={areas} busy={busy} areaName={areaName} onCall={call} />
        )}

        {tab === 'drivers' && (
          <DriversTab
            drivers={drivers}
            vans={vans}
            areas={areas}
            busy={busy}
            areaName={areaName}
            onCall={call}
          />
        )}
      </div>
    </div>
  );
};

/* ------------------------------ reports ------------------------------ */

type Stats = {
  checks: number;
  cleared: number;
  nonCompliant: number;
  held: number;
  compliancePct: number;
  vansCovered: number;
  vansActive: number;
  coveragePct: number;
  missedPlates: string[];
  worstTempC: number | null;
};

type ReportPayload = { records: ReportRow[]; stats: Stats; previous: Stats };

type PresetKey = 'today' | 'week' | 'last7' | 'month' | 'lastMonth' | 'custom';

const iso = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

/**
 * Presets rather than two typed date fields. Picking a range was friction
 * on every single visit, and the page opened on zeros because nothing was
 * selected. This week is the default so it is useful on load.
 */
const resolvePreset = (key: PresetKey): { from: string; to: string } | null => {
  const now = new Date();

  if (key === 'today') {
    return { from: iso(now), to: iso(now) };
  }
  if (key === 'week') {
    const monday = new Date(now);
    // getDay() is 0 on Sunday, which belongs to the week just ended.
    const offset = (now.getDay() + 6) % 7;
    monday.setDate(now.getDate() - offset);
    return { from: iso(monday), to: iso(now) };
  }
  if (key === 'last7') {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { from: iso(start), to: iso(now) };
  }
  if (key === 'month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  }
  if (key === 'lastMonth') {
    return {
      from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  return null;
};

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
];

const Reports = ({ areas }: { areas: Area[] }) => {
  const initial = resolvePreset('week') ?? { from: iso(new Date()), to: iso(new Date()) };

  const [preset, setPreset] = useState<PresetKey>('week');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [areaId, setAreaId] = useState('');
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMissed, setShowMissed] = useState(false);

  const params = (): string => {
    const search = new URLSearchParams({ from, to });
    if (areaId !== '') {
      search.set('areaId', areaId);
    }
    return search.toString();
  };

  const load = useCallback(
    async (nextFrom: string, nextTo: string, nextArea: string): Promise<void> => {
      setLoading(true);
      try {
        const search = new URLSearchParams({ from: nextFrom, to: nextTo });
        if (nextArea !== '') {
          search.set('areaId', nextArea);
        }
        const response = await fetch(`/api/reports?${search.toString()}`);
        setData(response.ok ? ((await response.json()) as ReportPayload) : null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Load on mount and whenever the window changes, so the page is never
  // sitting on stale zeros waiting for a button press.
  useEffect(() => {
    void load(from, to, areaId);
  }, [from, to, areaId, load]);

  const choosePreset = (key: PresetKey): void => {
    setPreset(key);
    const range = resolvePreset(key);
    if (range !== null) {
      setFrom(range.from);
      setTo(range.to);
    }
  };



  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line bg-surface-card p-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => choosePreset(option.key)}
              className={`rounded-full px-4 py-2 text-sm font-bold ${
                preset === option.key
                  ? 'bg-brand-action text-content-invert'
                  : 'bg-surface-page text-content-secondary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          {preset === 'custom' && (
            <>
              <label className="text-xs font-bold uppercase tracking-wide text-content-secondary">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="mt-1 block rounded-sm border border-line bg-surface-page px-3 py-2 text-sm font-normal text-content"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-wide text-content-secondary">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  className="mt-1 block rounded-sm border border-line bg-surface-page px-3 py-2 text-sm font-normal text-content"
                />
              </label>
            </>
          )}

          <label className="text-xs font-bold uppercase tracking-wide text-content-secondary">
            Area
            <select
              value={areaId}
              onChange={(event) => setAreaId(event.target.value)}
              className="mt-1 block rounded-sm border border-line bg-surface-page px-3 py-2 text-sm font-normal text-content"
            >
              <option value="">All areas</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>

          <a
            href={`/api/reports/pdf?${params()}`}
            className="rounded-sm bg-brand-action px-5 py-2.5 text-sm font-bold text-content-invert"
          >
            Download PDF
          </a>

          <span className="text-xs text-content-secondary">
            {loading ? 'Loading…' : `${from} to ${to}`}
          </span>
        </div>
      </div>

      {data !== null && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Fleet covered"
              value={`${data.stats.coveragePct}%`}
              caption={`${data.stats.vansCovered} of ${data.stats.vansActive} active vans`}
              delta={data.stats.coveragePct - data.previous.coveragePct}
              tone={data.stats.coveragePct >= 95 ? 'pass' : data.stats.coveragePct >= 80 ? 'hold' : 'fail'}
            />
            <Tile
              label="Compliance"
              value={`${data.stats.compliancePct}%`}
              caption={`${data.stats.cleared} cleared of ${data.stats.checks} checked`}
              delta={data.stats.compliancePct - data.previous.compliancePct}
              tone={data.stats.compliancePct >= 90 ? 'pass' : data.stats.compliancePct >= 70 ? 'hold' : 'fail'}
            />
            <Tile
              label="Dispatch held"
              value={String(data.stats.held)}
              caption={`${data.stats.nonCompliant} non-compliant`}
              delta={data.previous.held - data.stats.held}
              tone={data.stats.held === 0 ? 'pass' : 'hold'}
            />
            <Tile
              label="Highest temp"
              value={data.stats.worstTempC === null ? '—' : `${data.stats.worstTempC.toFixed(1)}°C`}
              caption="An average hides the one hot van"
              tone={
                data.stats.worstTempC === null || data.stats.worstTempC <= 5
                  ? 'pass'
                  : 'fail'
              }
            />
          </div>

          {data.stats.missedPlates.length > 0 && (
            <div className="rounded-md border border-line bg-hold-soft p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-hold">
                    {data.stats.missedPlates.length} van
                    {data.stats.missedPlates.length === 1 ? '' : 's'} never inspected in this period
                  </div>
                  <p className="mt-0.5 text-xs text-content-secondary">
                    An uninspected van is a bigger unknown than a failed one.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMissed(!showMissed)}
                  className="rounded-sm border border-line bg-surface-card px-4 py-2 text-xs font-bold text-content"
                >
                  {showMissed ? 'Hide' : 'Show plates'}
                </button>
              </div>

              {showMissed && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.stats.missedPlates.map((plate) => (
                    <span
                      key={plate}
                      className="rounded-full bg-surface-card px-3 py-1 text-xs font-bold text-content"
                    >
                      {plate}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-md border border-line bg-surface-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-content-secondary">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Area</th>
                  <th className="px-4 py-3">Van</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Temp</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((row) => (
                  <InspectionRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>

            {data.records.length === 0 && (
              <p className="p-8 text-center text-sm text-content-secondary">
                No checks in that range.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * A row that expands to show the evidence. Only failed checks have
 * anything to show, so a fully compliant inspection does not expand:
 * an empty panel is a worse answer than no panel.
 */
const InspectionRow = ({ row }: { row: ReportRow }) => {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);

  const hasDetail = row.failedCount > 0 || (row.notes !== null && row.notes !== '');

  const toggle = async (): Promise<void> => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);

    if (detail === null) {
      setLoading(true);
      try {
        const response = await fetch(`/api/inspections/${row.id}`);
        if (response.ok) {
          setDetail((await response.json()) as Detail);
        }
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <>
      <tr
        className={`border-b border-line last:border-b-0 ${hasDetail ? 'cursor-pointer hover:bg-surface-page' : ''}`}
        onClick={hasDetail ? () => void toggle() : undefined}
      >
        <td className="px-4 py-3 text-xs text-content-secondary">
          {new Date(row.performedAt).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </td>
        <td className="px-4 py-3">{row.areaName}</td>
        <td className="px-4 py-3 font-bold text-content">
          {row.plate}
          {hasDetail && (
            <span className="ml-2 text-xs font-normal text-brand">
              {open ? '\u25be' : '\u25b8'}{' '}
              {row.failedCount > 0
                ? `${row.failedCount} issue${row.failedCount > 1 ? 's' : ''}`
                : 'note'}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          {row.driverName}
          {row.helperName !== null && (
            <span className="text-xs text-content-secondary"> + {row.helperName}</span>
          )}
        </td>
        <td
          className={`px-4 py-3 tabular-nums ${row.tempReadingC === null ? 'text-content-secondary' : ''}`}
        >
          {row.tempReadingC === null ? '\u2014' : `${row.tempReadingC.toFixed(1)}\u00b0C`}
        </td>
        <td className="px-4 py-3">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_META[row.status].bg} ${STATUS_META[row.status].text}`}
          >
            {STATUS_META[row.status].label}
          </span>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-line bg-surface-page">
          <td colSpan={6} className="px-4 py-4">
            {loading && <p className="text-sm text-content-secondary">Loading evidence\u2026</p>}

            {detail !== null && (
              <div className="space-y-4">
                {detail.failures.map((failure) => (
                  <div key={failure.label} className="rounded-md border border-line bg-surface-card p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-content">{failure.label}</span>
                      {failure.critical && (
                        <span className="rounded bg-hold-soft px-1.5 py-0.5 text-[9px] font-bold text-hold">
                          BLOCKED DISPATCH
                        </span>
                      )}
                      {failure.numericValue !== null && (
                        <span className="text-xs font-bold text-fail">
                          {failure.numericValue.toFixed(1)}\u00b0C
                        </span>
                      )}
                    </div>

                    {failure.note !== null && failure.note !== '' && (
                      <p className="mt-1 text-sm text-content-secondary">{failure.note}</p>
                    )}

                    {failure.photoUrls.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-3">
                        {failure.photoUrls.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Evidence for ${failure.label}`}
                              className="h-40 w-40 rounded-sm border border-line object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-hold">No photo attached.</p>
                    )}
                  </div>
                ))}

                {detail.notes !== null && detail.notes !== '' && (
                  <div className="rounded-md border border-line bg-surface-card p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-content-secondary">
                      Inspector&rsquo;s notes
                    </div>
                    <p className="mt-1 text-sm text-content">{detail.notes}</p>
                  </div>
                )}

                <p className="text-xs text-content-secondary">
                  {detail.passedCount} check{detail.passedCount === 1 ? '' : 's'} passed, recorded
                  by {detail.inspectorName}. Photo links expire after an hour.
                </p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

const TONES = {
  pass: { text: 'text-pass', bg: 'bg-pass-soft' },
  hold: { text: 'text-hold', bg: 'bg-hold-soft' },
  fail: { text: 'text-fail', bg: 'bg-fail-soft' },
} as const;

/**
 * A figure with no baseline is decoration. Every tile carries the same
 * figure for the preceding window of equal length.
 */
const Tile = ({
  label,
  value,
  caption,
  delta,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  delta?: number;
  tone: keyof typeof TONES;
}) => {
  const meta = TONES[tone];
  const rounded = delta === undefined ? 0 : Math.round(delta);

  return (
    <div className={`rounded-md border border-line p-4 ${meta.bg}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-content-secondary">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-4xl font-black ${meta.text}`}>{value}</span>
        {delta !== undefined && rounded !== 0 && (
          <span
            className={`text-xs font-bold ${rounded > 0 ? 'text-pass' : 'text-fail'}`}
          >
            {rounded > 0 ? '▲' : '▼'} {Math.abs(rounded)} vs previous
          </span>
        )}
        {delta !== undefined && rounded === 0 && (
          <span className="text-xs font-bold text-content-secondary">no change</span>
        )}
      </div>
      <div className="mt-1 text-xs text-content-secondary">{caption}</div>
    </div>
  );
};

/* ------------------------------- shared ------------------------------- */

type CallFn = (path: string, method: string, body: unknown) => Promise<boolean>;

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="text-xs font-bold uppercase tracking-wide text-content-secondary">
    {label}
    {children}
  </label>
);

const inputClass =
  'mt-1 block w-full rounded-lg border border-line bg-surface-page px-3 py-2 text-sm font-normal text-content outline-none focus:border-brand';

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-line bg-surface-card p-4">
    <h2 className="mb-3 text-sm font-bold text-content">{title}</h2>
    {children}
  </div>
);

/**
 * Deactivate is always available. Delete is offered too, but the server
 * refuses it for anything named on a filed inspection — deleting that
 * would take the audit trail with it.
 */
const ActiveToggle = ({
  entity,
  id,
  label,
  active,
  busy,
  onCall,
}: {
  entity: string;
  id: string;
  label: string;
  active: boolean;
  busy: boolean;
  onCall: CallFn;
}) => {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-content-secondary">Delete permanently?</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            void onCall(`/api/admin/${entity}?id=${id}`, 'DELETE', undefined);
          }}
          className="rounded-lg bg-fail px-3 py-1.5 text-xs font-bold text-content-invert"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg bg-surface-page px-3 py-1.5 text-xs font-bold text-content-secondary"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void onCall(`/api/admin/${entity}`, 'PATCH', { id, active: !active })}
        className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
          active ? 'bg-hold-soft text-hold' : 'bg-pass-soft text-pass'
        }`}
      >
        {active ? 'Deactivate' : 'Reactivate'}
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label={`Delete ${label}`}
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-fail"
      >
        Delete
      </button>
    </div>
  );
};

/* -------------------------------- areas -------------------------------- */

const AreasTab = ({
  areas,
  busy,
  isAdmin,
  onCall,
}: {
  areas: Area[];
  busy: boolean;
  isAdmin: boolean;
  onCall: CallFn;
}) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const add = async (): Promise<void> => {
    const ok = await onCall('/api/admin/areas', 'POST', {
      name,
      code,
      sortOrder: areas.length + 1,
    });
    if (ok) {
      setName('');
      setCode('');
    }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Panel title="Add an area">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Name">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ras Al Khaimah"
                className={inputClass}
              />
            </Field>
            <Field label="Code">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="RAK"
                maxLength={4}
                className={`${inputClass} w-24`}
              />
            </Field>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy}
              className="rounded-lg bg-brand-action px-5 py-2.5 text-sm font-bold text-content-invert disabled:bg-line disabled:text-content-secondary"
            >
              Add
            </button>
          </div>
        </Panel>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-surface-card">
        {areas.map((area) => (
          <div
            key={area.id}
            className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0"
          >
            <div>
              <span className="font-bold text-content">{area.name}</span>
              <span className="ml-2 text-xs text-content-secondary">{area.code}</span>
              {!area.active && (
                <span className="ml-2 rounded bg-line px-2 py-0.5 text-[10px] font-bold text-content-secondary">
                  INACTIVE
                </span>
              )}
            </div>
            <ActiveToggle
              entity="areas"
              id={area.id}
              label={area.name}
              active={area.active}
              busy={busy}
              onCall={onCall}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

/* -------------------------------- vans -------------------------------- */

const VansTab = ({
  vans,
  areas,
  busy,
  areaName,
  onCall,
}: {
  vans: Van[];
  areas: Area[];
  busy: boolean;
  areaName: (id: string | null) => string;
  onCall: CallFn;
}) => {
  const [plate, setPlate] = useState('');
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '');

  const add = async (): Promise<void> => {
    const ok = await onCall('/api/admin/vans', 'POST', { plate, areaId });
    if (ok) {
      setPlate('');
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Add a van">
        <p className="mb-3 text-xs text-content-secondary">
          All vans run 0–5 °C. Scanning fills the plate in for you — check it before saving.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Plate">
            <input
              value={plate}
              onChange={(event) => setPlate(event.target.value.toUpperCase())}
              placeholder="DXB-4025"
              className={inputClass}
            />
          </Field>
          <Field label="Area">
            <select
              value={areaId}
              onChange={(event) => setAreaId(event.target.value)}
              className={inputClass}
            >
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="self-end">
            <PlateScanner
              onDetected={(reading: PlateReading) => {
                setPlate(reading.best);
                // The plate names its emirate, so the area does not need
                // choosing twice.
                const match = areas.find((area) => area.code === reading.emirateCode);
                if (match !== undefined) {
                  setAreaId(match.id);
                }
              }}
              onPick={setPlate}
            />
          </div>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="rounded-lg bg-brand-action px-5 py-2.5 text-sm font-bold text-content-invert disabled:bg-line disabled:text-content-secondary"
          >
            Add
          </button>
        </div>
      </Panel>

      <div className="overflow-hidden rounded-xl border border-line bg-surface-card">
        {vans.map((van) => (
          <div
            key={van.id}
            className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0"
          >
            <div>
              <span className="font-bold text-content">{van.plate}</span>
              <span className="ml-2 text-xs text-content-secondary">{areaName(van.areaId)} · 0–5 °C</span>
              {!van.active && (
                <span className="ml-2 rounded bg-line px-2 py-0.5 text-[10px] font-bold text-content-secondary">
                  INACTIVE
                </span>
              )}
            </div>
            <ActiveToggle
              entity="vans"
              id={van.id}
              label={van.plate}
              active={van.active}
              busy={busy}
              onCall={onCall}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

/* ------------------------------- drivers ------------------------------- */

const DriversTab = ({
  drivers,
  vans,
  areas,
  busy,
  areaName,
  onCall,
}: {
  drivers: Driver[];
  vans: Van[];
  areas: Area[];
  busy: boolean;
  areaName: (id: string | null) => string;
  onCall: CallFn;
}) => {
  const [staffRole, setStaffRole] = useState<'driver' | 'helper'>('driver');
  const [fullName, setFullName] = useState('');
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '');
  const [vanId, setVanId] = useState('');
  const [partnerId, setPartnerId] = useState('');

  const vansInArea = vans.filter((van) => van.areaId === areaId && van.active);
  const activeDrivers = drivers.filter(
    (person) => person.staffRole === 'driver' && person.active,
  );

  // A driver who already has a helper cannot take another.
  const pairedDriverIds = new Set(
    drivers
      .filter((person) => person.staffRole === 'helper' && person.active)
      .map((person) => person.partnerId),
  );
  const availableDrivers = activeDrivers.filter((person) => !pairedDriverIds.has(person.id));

  const partner = drivers.find((person) => person.id === partnerId);

  const add = async (): Promise<void> => {
    const payload =
      staffRole === 'helper'
        ? {
            staffRole,
            fullName,
            partnerId,
            // Inherited so the pair can never end up on different vans.
            areaId: partner?.areaId ?? null,
            defaultVanId: partner?.defaultVanId ?? null,
          }
        : { staffRole, fullName, areaId, defaultVanId: vanId };

    const ok = await onCall('/api/admin/drivers', 'POST', payload);
    if (ok) {
      setFullName('');
      setVanId('');
      setPartnerId('');
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Add a driver or helper">
        <div className="mb-3 flex gap-2">
          {(['driver', 'helper'] as const).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => setStaffRole(role)}
              className={`rounded-lg px-4 py-2 text-sm font-bold capitalize ${
                staffRole === role ? 'bg-brand-action text-content-invert' : 'bg-surface-page text-content-secondary'
              }`}
            >
              {role}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name">
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Rashid Al Mansoori"
              className={inputClass}
            />
          </Field>

          {staffRole === 'driver' ? (
            <>
              <Field label="Area">
                <select
                  value={areaId}
                  onChange={(event) => {
                    setAreaId(event.target.value);
                    setVanId('');
                  }}
                  className={inputClass}
                >
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Van">
                <select
                  value={vanId}
                  onChange={(event) => setVanId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">No van yet</option>
                  {vansInArea.map((van) => (
                    <option key={van.id} value={van.id}>
                      {van.plate}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <Field label="Rides with">
              <select
                value={partnerId}
                onChange={(event) => setPartnerId(event.target.value)}
                className={inputClass}
              >
                <option value="">Choose a driver</option>
                {availableDrivers.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName} · {areaName(person.areaId)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || (staffRole === 'helper' && partnerId === '')}
            className="rounded-lg bg-brand-action px-5 py-2.5 text-sm font-bold text-content-invert disabled:bg-line disabled:text-content-secondary"
          >
            Add
          </button>
        </div>

        {staffRole === 'helper' && (
          <p className="mt-3 text-xs text-content-secondary">
            {availableDrivers.length === 0
              ? 'Every active driver already has a helper. Add a driver first.'
              : 'The helper takes the same van and area as their driver.'}
          </p>
        )}

        {staffRole === 'driver' && vansInArea.length === 0 && (
          <p className="mt-3 text-xs text-content-secondary">
            No active vans in {areaName(areaId)} yet. Add the van first, or leave the driver
            unassigned &mdash; an unassigned driver will not appear in the supervisor&rsquo;s list.
          </p>
        )}
      </Panel>

      <div className="overflow-hidden rounded-xl border border-line bg-surface-card">
        {drivers.map((person) => {
          const van = vans.find((candidate) => candidate.id === person.defaultVanId);
          const pairedWith = drivers.find((candidate) => candidate.id === person.partnerId);

          return (
            <div
              key={person.id}
              className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <span className="font-bold text-content">{person.fullName}</span>
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    person.staffRole === 'helper'
                      ? 'bg-surface-page text-content-secondary'
                      : 'bg-brand-light text-brand'
                  }`}
                >
                  {person.staffRole}
                </span>
                <span className="ml-2 text-xs text-content-secondary">
                  {areaName(person.areaId)} ·{' '}
                  {van === undefined ? (
                    <span className="text-hold">no van assigned</span>
                  ) : (
                    van.plate
                  )}
                  {pairedWith !== undefined && ` · with ${pairedWith.fullName}`}
                </span>
                {!person.active && (
                  <span className="ml-2 rounded bg-line px-2 py-0.5 text-[10px] font-bold text-content-secondary">
                    INACTIVE
                  </span>
                )}
              </div>
              <ActiveToggle
                entity="drivers"
                id={person.id}
                label={person.fullName}
                active={person.active}
                busy={busy}
                onCall={onCall}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
