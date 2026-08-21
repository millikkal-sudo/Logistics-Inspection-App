'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlateScanner } from './PlateScanner';
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
        body: JSON.stringify(body),
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
    <div className="mx-auto min-h-screen max-w-5xl bg-steel">
      <header className="bg-fleet-dark px-6 pb-4 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
              Calo UAE · Manager view
            </div>
            <h1 className="text-2xl font-bold text-white">Van check admin</h1>
          </div>
          <a
            href="/"
            className="rounded-lg bg-white/15 px-3 py-2 text-xs font-bold text-white"
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
                tab === key ? 'bg-white text-fleet-dark' : 'text-white/70'
              }`}
            >
              {key}
            </button>
          ))}
        </nav>
      </header>

      <div className="p-4 sm:p-6">
        {error !== null && (
          <div className="mb-4 rounded-lg bg-fail-soft p-3 text-sm font-medium text-fail">
            {error}
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

const Reports = ({ areas }: { areas: Area[] }) => {
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [areaId, setAreaId] = useState('');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const params = (): string => {
    const search = new URLSearchParams({ from, to });
    if (areaId !== '') {
      search.set('areaId', areaId);
    }
    return search.toString();
  };

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await fetch(`/api/reports?${params()}`);
      setRows(response.ok ? ((await response.json()) as ReportRow[]) : []);
    } finally {
      setLoading(false);
    }
  };

  const held = rows?.filter((row) => row.dispatchBlocked).length ?? 0;
  const cleared = rows?.filter((row) => row.status === 'compliant').length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4">
        <label className="text-xs font-bold uppercase tracking-wide text-sub">
          From
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="mt-1 block rounded-lg border border-line bg-steel px-3 py-2 text-sm font-normal text-ink"
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-wide text-sub">
          To
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="mt-1 block rounded-lg border border-line bg-steel px-3 py-2 text-sm font-normal text-ink"
          />
        </label>

        <label className="text-xs font-bold uppercase tracking-wide text-sub">
          Area
          <select
            value={areaId}
            onChange={(event) => setAreaId(event.target.value)}
            className="mt-1 block rounded-lg border border-line bg-steel px-3 py-2 text-sm font-normal text-ink"
          >
            <option value="">All areas</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg bg-fleet px-5 py-2.5 text-sm font-bold text-white disabled:bg-line disabled:text-sub"
        >
          {loading ? 'Loading…' : 'Run report'}
        </button>

        <a
          href={`/api/reports?${params()}&format=csv`}
          className="rounded-lg border border-line px-5 py-2.5 text-sm font-bold text-fleet"
        >
          Download CSV
        </a>
      </div>

      {rows !== null && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Checks" value={rows.length} tone="text-ink" bg="bg-white" />
            <Tile label="Cleared" value={cleared} tone="text-pass" bg="bg-pass-soft" />
            <Tile label="Dispatch held" value={held} tone="text-hold" bg="bg-hold-soft" />
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-wide text-sub">
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
                {rows.map((row) => (
                  <InspectionRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>

            {rows.length === 0 && (
              <p className="p-8 text-center text-sm text-sub">
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
 * anything to show, so a fully compliant inspection does not expand —
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
        className={`border-b border-line last:border-b-0 ${hasDetail ? 'cursor-pointer hover:bg-steel' : ''}`}
        onClick={hasDetail ? () => void toggle() : undefined}
      >
        <td className="px-4 py-3 text-xs text-sub">
          {new Date(row.performedAt).toLocaleString('en-GB', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </td>
        <td className="px-4 py-3">{row.areaName}</td>
        <td className="px-4 py-3 font-bold text-ink">
          {row.plate}
          {hasDetail && (
            <span className="ml-2 text-xs font-normal text-fleet">
              {open ? '\u25be' : '\u25b8'} {row.failedCount > 0 ? `${row.failedCount} issue${row.failedCount > 1 ? 's' : ''}` : 'note'}
            </span>
          )}
        </td>
        <td className="px-4 py-3">
          {row.driverName}
          {row.helperName !== null && (
            <span className="text-xs text-sub"> + {row.helperName}</span>
          )}
        </td>
        <td className={`px-4 py-3 tabular-nums ${row.tempReadingC === null ? 'text-sub' : ''}`}>
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
        <tr className="border-b border-line bg-steel">
          <td colSpan={6} className="px-4 py-4">
            {loading && <p className="text-sm text-sub">Loading evidence\u2026</p>}

            {detail !== null && (
              <div className="space-y-4">
                {detail.failures.map((failure) => (
                  <div
                    key={failure.label}
                    className="rounded-xl border border-line bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-ink">{failure.label}</span>
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
                      <p className="mt-1 text-sm text-sub">{failure.note}</p>
                    )}

                    {failure.photoUrls.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-3">
                        {failure.photoUrls.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Evidence for ${failure.label}`}
                              className="h-40 w-40 rounded-lg border border-line object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    )}

                    {failure.photoUrls.length === 0 && (
                      <p className="mt-2 text-xs text-hold">No photo attached.</p>
                    )}
                  </div>
                ))}

                {detail.notes !== null && detail.notes !== '' && (
                  <div className="rounded-xl border border-line bg-white p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-sub">
                      Inspector\u2019s notes
                    </div>
                    <p className="mt-1 text-sm text-ink">{detail.notes}</p>
                  </div>
                )}

                <p className="text-xs text-sub">
                  {detail.passedCount} check{detail.passedCount === 1 ? '' : 's'} passed \u00b7
                  recorded by {detail.inspectorName}. Photo links expire after an hour.
                </p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

const Tile = ({
  label,
  value,
  tone,
  bg,
}: {
  label: string;
  value: number;
  tone: string;
  bg: string;
}) => (
  <div className={`rounded-xl border border-line p-4 ${bg}`}>
    <div className={`text-3xl font-bold ${tone}`}>{value}</div>
    <div className="text-[11px] font-bold uppercase tracking-wide text-sub">{label}</div>
  </div>
);

/* ------------------------------- shared ------------------------------- */

type CallFn = (path: string, method: string, body: unknown) => Promise<boolean>;

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="text-xs font-bold uppercase tracking-wide text-sub">
    {label}
    {children}
  </label>
);

const inputClass =
  'mt-1 block w-full rounded-lg border border-line bg-steel px-3 py-2 text-sm font-normal text-ink outline-none focus:border-fleet';

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-line bg-white p-4">
    <h2 className="mb-3 text-sm font-bold text-ink">{title}</h2>
    {children}
  </div>
);

const ActiveToggle = ({
  entity,
  id,
  active,
  busy,
  onCall,
}: {
  entity: string;
  id: string;
  active: boolean;
  busy: boolean;
  onCall: CallFn;
}) => (
  <button
    type="button"
    disabled={busy}
    onClick={() => void onCall(`/api/admin/${entity}`, 'PATCH', { id, active: !active })}
    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
      active ? 'bg-fail-soft text-fail' : 'bg-pass-soft text-pass'
    }`}
  >
    {active ? 'Deactivate' : 'Reactivate'}
  </button>
);

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
              className="rounded-lg bg-fleet px-5 py-2.5 text-sm font-bold text-white disabled:bg-line disabled:text-sub"
            >
              Add
            </button>
          </div>
        </Panel>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {areas.map((area) => (
          <div
            key={area.id}
            className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0"
          >
            <div>
              <span className="font-bold text-ink">{area.name}</span>
              <span className="ml-2 text-xs text-sub">{area.code}</span>
              {!area.active && (
                <span className="ml-2 rounded bg-line px-2 py-0.5 text-[10px] font-bold text-sub">
                  INACTIVE
                </span>
              )}
            </div>
            <ActiveToggle
              entity="areas"
              id={area.id}
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
        <p className="mb-3 text-xs text-sub">
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
            <PlateScanner onDetected={setPlate} />
          </div>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="rounded-lg bg-fleet px-5 py-2.5 text-sm font-bold text-white disabled:bg-line disabled:text-sub"
          >
            Add
          </button>
        </div>
      </Panel>

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {vans.map((van) => (
          <div
            key={van.id}
            className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0"
          >
            <div>
              <span className="font-bold text-ink">{van.plate}</span>
              <span className="ml-2 text-xs text-sub">{areaName(van.areaId)} · 0–5 °C</span>
              {!van.active && (
                <span className="ml-2 rounded bg-line px-2 py-0.5 text-[10px] font-bold text-sub">
                  INACTIVE
                </span>
              )}
            </div>
            <ActiveToggle
              entity="vans"
              id={van.id}
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
                staffRole === role ? 'bg-fleet text-white' : 'bg-steel text-sub'
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
            className="rounded-lg bg-fleet px-5 py-2.5 text-sm font-bold text-white disabled:bg-line disabled:text-sub"
          >
            Add
          </button>
        </div>

        {staffRole === 'helper' && (
          <p className="mt-3 text-xs text-sub">
            {availableDrivers.length === 0
              ? 'Every active driver already has a helper. Add a driver first.'
              : 'The helper takes the same van and area as their driver.'}
          </p>
        )}

        {staffRole === 'driver' && vansInArea.length === 0 && (
          <p className="mt-3 text-xs text-sub">
            No active vans in {areaName(areaId)} yet. Add the van first, or leave the driver
            unassigned &mdash; an unassigned driver will not appear in the supervisor&rsquo;s list.
          </p>
        )}
      </Panel>

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {drivers.map((person) => {
          const van = vans.find((candidate) => candidate.id === person.defaultVanId);
          const pairedWith = drivers.find((candidate) => candidate.id === person.partnerId);

          return (
            <div
              key={person.id}
              className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <span className="font-bold text-ink">{person.fullName}</span>
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    person.staffRole === 'helper'
                      ? 'bg-steel text-sub'
                      : 'bg-fleet/10 text-fleet'
                  }`}
                >
                  {person.staffRole}
                </span>
                <span className="ml-2 text-xs text-sub">
                  {areaName(person.areaId)} ·{' '}
                  {van === undefined ? (
                    <span className="text-hold">no van assigned</span>
                  ) : (
                    van.plate
                  )}
                  {pairedWith !== undefined && ` · with ${pairedWith.fullName}`}
                </span>
                {!person.active && (
                  <span className="ml-2 rounded bg-line px-2 py-0.5 text-[10px] font-bold text-sub">
                    INACTIVE
                  </span>
                )}
              </div>
              <ActiveToggle
                entity="drivers"
                id={person.id}
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
