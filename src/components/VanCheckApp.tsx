'use client';

import { useMemo, useRef, useState } from 'react';
import { uploadPhoto } from '@/lib/supabaseBrowser';
import type { FleetEntry } from '@/lib/fleetRepository';
import {
  resolveStatus,
  type CheckAnswer,
  type CheckItem,
  type InspectionStatus,
  type InspectionSummary,
  type Profile,
} from '@/lib/types';

type Answer = {
  passed?: boolean;
  numericValue?: number;
  note?: string;
  photoKey?: string;
  photoPreview?: string;
  uploading?: boolean;
};

type Outcome = {
  status: InspectionStatus;
  plate: string;
  failedItems: string[];
  time: string;
};

type Screen = 'vans' | 'check' | 'outcome' | 'report';

const STATUS_META: Record<InspectionStatus, { label: string; text: string; bg: string; solid: string }> = {
  compliant: { label: 'Cleared', text: 'text-pass', bg: 'bg-pass-soft', solid: 'bg-pass' },
  noncompliant: { label: 'Non-compliant', text: 'text-fail', bg: 'bg-fail-soft', solid: 'bg-fail' },
  action_required: { label: 'Dispatch held', text: 'text-hold', bg: 'bg-hold-soft', solid: 'bg-hold' },
};

const clockTime = (): string =>
  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

type Props = {
  profile: Profile;
  fleet: FleetEntry[];
  checkItems: CheckItem[];
  initialToday: InspectionSummary[];
};

export const VanCheckApp = ({ profile, fleet, checkItems, initialToday }: Props) => {
  const [screen, setScreen] = useState<Screen>('vans');
  const [today, setToday] = useState<InspectionSummary[]>(initialToday);
  const [van, setVan] = useState<FleetEntry | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [temp, setTemp] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  const tempItem = checkItems.find((item) => item.inputType === 'temperature');
  const tempMin = van?.tempMinC ?? 0;
  const tempMax = van?.tempMaxC ?? 5;

  const tempValue = useMemo(() => {
    const parsed = Number.parseFloat(temp);
    return temp === '' || Number.isNaN(parsed) ? null : parsed;
  }, [temp]);

  const tempOk = tempValue !== null && tempValue >= tempMin && tempValue <= tempMax;

  const merged = useMemo((): Record<string, Answer> => {
    const next = { ...answers };
    if (tempItem !== undefined && tempValue !== null) {
      next[tempItem.code] = { ...next[tempItem.code], passed: tempOk, numericValue: tempValue };
    }
    return next;
  }, [answers, tempItem, tempValue, tempOk]);

  const answeredCount = checkItems.filter((item) => merged[item.code]?.passed !== undefined).length;
  const failures = checkItems.filter((item) => merged[item.code]?.passed === false);
  const incomplete = failures.filter((item) => {
    const answer = merged[item.code];
    return answer?.photoKey === undefined || (answer.note ?? '').trim() === '';
  });
  const uploading = Object.values(merged).some((answer) => answer.uploading === true);
  const ready = answeredCount === checkItems.length && incomplete.length === 0 && !uploading;

  const patch = (code: string, values: Answer): void => {
    setAnswers((current) => ({ ...current, [code]: { ...current[code], ...values } }));
  };

  const startVan = (entry: FleetEntry): void => {
    setVan(entry);
    setAnswers({});
    setTemp('');
    setError(null);
    setScreen('check');
  };

  const pressKey = (key: string): void => {
    if (key === 'del') {
      setTemp((value) => value.slice(0, -1));
      return;
    }
    if (key === '.' && temp.includes('.')) {
      return;
    }
    if (temp.replace('.', '').length >= 4) {
      return;
    }
    setTemp((value) => value + key);
  };

  const submit = async (): Promise<void> => {
    if (van === null) {
      return;
    }
    setSaving(true);
    setError(null);

    const payload: CheckAnswer[] = checkItems.map((item) => {
      const answer = merged[item.code] ?? {};
      return {
        checkItemCode: item.code,
        passed: answer.passed === true,
        numericValue: answer.numericValue,
        note: answer.note,
        photoKey: answer.photoKey,
      };
    });

    try {
      const response = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vanId: van.vanId, driverId: van.driverId, answers: payload }),
      });

      if (!response.ok) {
        const body: unknown = await response.json();
        const message =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'Could not save the check';
        throw new Error(message);
      }

      const status = resolveStatus(payload, checkItems);
      const time = clockTime();

      setOutcome({
        status,
        plate: van.plate,
        failedItems: failures.map((item) => item.label),
        time,
      });
      setToday((current) => [
        ...current,
        {
          id: `${van.vanId}-${time}`,
          performedAt: new Date().toISOString(),
          plate: van.plate,
          depot: profile.depot,
          driverName: van.driverName,
          inspectorName: profile.fullName,
          status,
          dispatchBlocked: status === 'action_required',
          failedCount: failures.length,
          tempReadingC: tempValue,
        },
      ]);
      setScreen('outcome');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not save the check');
    } finally {
      setSaving(false);
    }
  };

  const checkedPlates = new Map(today.map((record) => [record.plate, record.status]));

  return (
    <div className="flex min-h-screen items-start justify-center px-3 py-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-steel shadow-2xl">
        {screen === 'vans' && (
          <VanList
            profile={profile}
            fleet={fleet}
            checkedPlates={checkedPlates}
            query={query}
            onQuery={setQuery}
            onPick={startVan}
            onReport={() => setScreen('report')}
          />
        )}

        {screen === 'check' && van !== null && (
          <Checklist
            van={van}
            checkItems={checkItems}
            answers={merged}
            temp={temp}
            tempOk={tempOk}
            tempValue={tempValue}
            tempMin={tempMin}
            tempMax={tempMax}
            error={error}
            saving={saving}
            ready={ready}
            answeredCount={answeredCount}
            incompleteCount={incomplete.length}
            uploading={uploading}
            onKey={pressKey}
            onPatch={patch}
            onBack={() => setScreen('vans')}
            onSubmit={() => void submit()}
            onError={setError}
          />
        )}

        {screen === 'outcome' && outcome !== null && (
          <OutcomeView
            outcome={outcome}
            inspectorName={profile.fullName}
            onNext={() => {
              setVan(null);
              setScreen('vans');
            }}
          />
        )}

        {screen === 'report' && (
          <Report today={today} tempMin={tempMin} tempMax={tempMax} onBack={() => setScreen('vans')} />
        )}
      </div>
    </div>
  );
};

/* ------------------------------ header ------------------------------ */

const Header = ({
  eyebrow,
  title,
  sub,
  onBack,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  onBack?: () => void;
}) => (
  <header className="bg-fleet-dark px-5 pb-4 pt-5">
    <div className="flex items-start gap-3">
      {onBack !== undefined && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg text-white"
        >
          ←
        </button>
      )}
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
          {eyebrow}
        </div>
        <h1 className="truncate text-xl font-bold leading-tight text-white">{title}</h1>
        <div className="truncate text-xs text-white/70">{sub}</div>
      </div>
    </div>
  </header>
);

const Chip = ({ status }: { status: InspectionStatus }) => {
  const meta = STATUS_META[status];
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.bg} ${meta.text}`}>
      {meta.label}
    </span>
  );
};

/* ----------------------------- van list ----------------------------- */

const VanList = ({
  profile,
  fleet,
  checkedPlates,
  query,
  onQuery,
  onPick,
  onReport,
}: {
  profile: Profile;
  fleet: FleetEntry[];
  checkedPlates: Map<string, InspectionStatus>;
  query: string;
  onQuery: (value: string) => void;
  onPick: (entry: FleetEntry) => void;
  onReport: () => void;
}) => {
  const term = query.toLowerCase();
  const visible = fleet.filter(
    (entry) =>
      entry.plate.toLowerCase().includes(term) || entry.driverName.toLowerCase().includes(term),
  );

  return (
    <div>
      <Header
        eyebrow={`${profile.depot} · ${profile.fullName}`}
        title="Which van?"
        sub={`${checkedPlates.size} checked this morning`}
      />
      <div className="space-y-3 p-4">
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Plate or driver"
          aria-label="Search vans"
          className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none"
        />

        {visible.map((entry) => {
          const done = checkedPlates.get(entry.plate);
          return (
            <button
              key={entry.vanId}
              type="button"
              onClick={() => onPick(entry)}
              disabled={done !== undefined}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-white p-4 text-left active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
            >
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white ${
                  done === undefined ? 'bg-fleet' : 'bg-sub'
                }`}
              >
                {entry.plate.slice(-4)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-ink">{entry.plate}</div>
                <div className="truncate text-xs text-sub">
                  {entry.driverName}
                  {entry.route === '' ? '' : ` · ${entry.route}`}
                </div>
              </div>
              {done === undefined ? (
                <span className="text-lg text-fleet">›</span>
              ) : (
                <Chip status={done} />
              )}
            </button>
          );
        })}

        {visible.length === 0 && (
          <p className="py-8 text-center text-sm text-sub">
            No van matches that. Check the plate and try again.
          </p>
        )}

        <button
          type="button"
          onClick={onReport}
          className="w-full rounded-xl border border-line bg-white py-3.5 text-sm font-bold text-fleet"
        >
          View morning report
        </button>
      </div>
    </div>
  );
};

/* ----------------------------- checklist ----------------------------- */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

const Checklist = ({
  van,
  checkItems,
  answers,
  temp,
  tempOk,
  tempValue,
  tempMin,
  tempMax,
  error,
  saving,
  ready,
  answeredCount,
  incompleteCount,
  uploading,
  onKey,
  onPatch,
  onBack,
  onSubmit,
  onError,
}: {
  van: FleetEntry;
  checkItems: CheckItem[];
  answers: Record<string, Answer>;
  temp: string;
  tempOk: boolean;
  tempValue: number | null;
  tempMin: number;
  tempMax: number;
  error: string | null;
  saving: boolean;
  ready: boolean;
  answeredCount: number;
  incompleteCount: number;
  uploading: boolean;
  onKey: (key: string) => void;
  onPatch: (code: string, values: Answer) => void;
  onBack: () => void;
  onSubmit: () => void;
  onError: (message: string) => void;
}) => {
  let label = 'Submit check';
  if (saving) {
    label = 'Saving…';
  } else if (uploading) {
    label = 'Uploading photo…';
  } else if (answeredCount < checkItems.length) {
    label = `${checkItems.length - answeredCount} left to check`;
  } else if (incompleteCount > 0) {
    label = `Add evidence for ${incompleteCount} failed item${incompleteCount > 1 ? 's' : ''}`;
  }

  return (
    <div>
      <Header
        eyebrow="Pre-departure check"
        title={van.plate}
        sub={`${van.driverName} · ${van.route}`}
        onBack={onBack}
      />

      <div className="px-5 pt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-fleet transition-all duration-300"
            style={{ width: `${(answeredCount / checkItems.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-3 p-4">
        {error !== null && (
          <div className="rounded-lg bg-fail-soft p-3 text-sm font-medium text-fail">
            Not saved: {error}
          </div>
        )}

        {checkItems.map((item) => {
          const answer = answers[item.code] ?? {};
          const border =
            answer.passed === true
              ? 'border-pass'
              : answer.passed === false
                ? 'border-fail'
                : 'border-line';

          return (
            <div key={item.code} className={`rounded-xl border-2 bg-white p-4 ${border}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
                {item.label}
                {item.critical && (
                  <span className="rounded bg-hold-soft px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-hold">
                    BLOCKS DISPATCH
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-sub">{item.helpText}</div>

              {item.inputType === 'temperature' ? (
                <div className="mt-3">
                  <div
                    className={`rounded-lg py-4 text-center transition-colors ${
                      tempValue === null ? 'bg-steel' : tempOk ? 'bg-pass-soft' : 'bg-fail-soft'
                    }`}
                  >
                    <div
                      className={`text-4xl font-bold tabular-nums ${
                        tempValue === null ? 'text-sub' : tempOk ? 'text-pass' : 'text-fail'
                      }`}
                    >
                      {temp === '' ? '––' : temp}
                      <span className="ml-1 text-xl">°C</span>
                    </div>
                    <div
                      className={`mt-1 text-[11px] font-bold ${
                        tempValue === null ? 'text-sub' : tempOk ? 'text-pass' : 'text-fail'
                      }`}
                    >
                      {tempValue === null
                        ? 'Enter the reading'
                        : tempOk
                          ? 'Within range'
                          : `Outside ${tempMin}–${tempMax} °C`}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onKey(key)}
                        aria-label={key === 'del' ? 'Delete last digit' : key}
                        className="rounded-lg bg-steel py-3.5 text-lg font-bold text-ink"
                      >
                        {key === 'del' ? '⌫' : key}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onPatch(item.code, {
                        passed: true,
                        note: '',
                        photoKey: undefined,
                        photoPreview: undefined,
                      })
                    }
                    className={`flex-1 rounded-lg py-3 text-sm font-bold ${
                      answer.passed === true ? 'bg-pass text-white' : 'bg-pass-soft text-pass'
                    }`}
                  >
                    ✓ Pass
                  </button>
                  <button
                    type="button"
                    onClick={() => onPatch(item.code, { passed: false })}
                    className={`flex-1 rounded-lg py-3 text-sm font-bold ${
                      answer.passed === false ? 'bg-fail text-white' : 'bg-fail-soft text-fail'
                    }`}
                  >
                    ✗ Fail
                  </button>
                </div>
              )}

              {answer.passed === false && (
                <Evidence
                  plate={van.plate}
                  code={item.code}
                  answer={answer}
                  onPatch={onPatch}
                  onError={onError}
                />
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={onSubmit}
          disabled={!ready || saving}
          className="w-full rounded-xl bg-fleet py-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-sub"
        >
          {label}
        </button>
      </div>
    </div>
  );
};

/* ------------------------------ evidence ------------------------------ */

const Evidence = ({
  plate,
  code,
  answer,
  onPatch,
  onError,
}: {
  plate: string;
  code: string;
  answer: Answer;
  onPatch: (code: string, values: Answer) => void;
  onError: (message: string) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File): Promise<void> => {
    onPatch(code, { uploading: true, photoPreview: URL.createObjectURL(file) });
    try {
      const key = await uploadPhoto(plate, code, file);
      onPatch(code, { photoKey: key, uploading: false });
    } catch (cause: unknown) {
      onPatch(code, { uploading: false, photoPreview: undefined });
      onError(cause instanceof Error ? cause.message : 'Photo did not upload');
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-dashed border-line pt-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-fail">
        Evidence required
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) {
            void handleFile(file);
          }
        }}
      />

      {answer.photoPreview === undefined ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-lg bg-fail-soft py-3 text-sm font-bold text-fail"
        >
          Take photo
        </button>
      ) : (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={answer.photoPreview}
            alt="Evidence"
            className="h-36 w-full rounded-lg object-cover"
          />
          {answer.uploading === true && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-ink/60 text-sm font-bold text-white">
              Uploading…
            </div>
          )}
          {answer.uploading !== true && (
            <button
              type="button"
              onClick={() => onPatch(code, { photoKey: undefined, photoPreview: undefined })}
              aria-label="Remove photo"
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-white"
            >
              ✗
            </button>
          )}
        </div>
      )}

      <textarea
        value={answer.note ?? ''}
        onChange={(event) => onPatch(code, { note: event.target.value })}
        placeholder="What is wrong, and what did you do about it?"
        rows={2}
        className="w-full resize-none rounded-lg border border-line bg-steel p-3 text-sm text-ink outline-none"
      />
    </div>
  );
};

/* ------------------------------ outcome ------------------------------ */

const OutcomeView = ({
  outcome,
  inspectorName,
  onNext,
}: {
  outcome: Outcome;
  inspectorName: string;
  onNext: () => void;
}) => {
  const blocked = outcome.status === 'action_required';
  const meta = STATUS_META[outcome.status];

  const title = blocked
    ? 'Dispatch held'
    : outcome.status === 'compliant'
      ? 'Cleared for dispatch'
      : 'Non-compliant';

  const line = blocked
    ? `${outcome.plate} must not leave the yard until the failed items are fixed and re-checked.`
    : outcome.status === 'compliant'
      ? `${outcome.plate} passed every check at ${outcome.time}.`
      : `${outcome.plate} can dispatch, but the failures need closing today.`;

  return (
    <div>
      <div className={`px-6 pb-8 pt-10 text-center ${meta.solid}`}>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-white/85">{line}</p>
      </div>

      <div className="space-y-3 p-4">
        {blocked && (
          <div className="rounded-xl bg-hold-soft p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-hold">
              Alert sent
            </div>
            <div className="mt-1 text-sm text-ink">#uae-fleet-ops on Slack</div>
          </div>
        )}

        {outcome.failedItems.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-sub">
              Failed items
            </div>
            {outcome.failedItems.map((item) => (
              <div key={item} className="border-b border-line px-4 py-3 text-sm font-bold text-ink last:border-b-0">
                {item}
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-line bg-white p-4 text-xs text-sub">
          Recorded {outcome.time} by {inspectorName}. Record locked — corrections need a new check.
        </div>

        <button
          type="button"
          onClick={onNext}
          className="w-full rounded-xl bg-fleet py-4 text-base font-bold text-white"
        >
          Next van
        </button>
      </div>
    </div>
  );
};

/* ------------------------------- report ------------------------------- */

const Report = ({
  today,
  tempMin,
  tempMax,
  onBack,
}: {
  today: InspectionSummary[];
  tempMin: number;
  tempMax: number;
  onBack: () => void;
}) => {
  const counts: Record<InspectionStatus, number> = {
    compliant: 0,
    noncompliant: 0,
    action_required: 0,
  };
  for (const record of today) {
    counts[record.status] += 1;
  }

  const total = today.length === 0 ? 1 : today.length;
  const pct = Math.round((counts.compliant / total) * 100);

  return (
    <div>
      <Header eyebrow="Today · pre-departure" title="Morning report" sub="Central Warehouse" onBack={onBack} />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(counts) as InspectionStatus[]).map((key) => (
            <div key={key} className={`rounded-xl p-3 text-center ${STATUS_META[key].bg}`}>
              <div className={`text-3xl font-bold ${STATUS_META[key].text}`}>{counts[key]}</div>
              <div className={`mt-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_META[key].text}`}>
                {STATUS_META[key].label}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-sub">
              Cleared first time
            </span>
            <span
              className={`text-2xl font-bold ${
                pct >= 80 ? 'text-pass' : pct >= 50 ? 'text-hold' : 'text-fail'
              }`}
            >
              {pct}%
            </span>
          </div>
        </div>

        {today.length === 0 ? (
          <p className="py-8 text-center text-sm text-sub">No checks recorded yet today.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-sub">
              Vans checked
            </div>
            {today.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-bold text-ink">
                    {record.plate}
                    {record.tempReadingC !== null && (
                      <span
                        className={`text-xs tabular-nums ${
                          record.tempReadingC >= tempMin && record.tempReadingC <= tempMax
                            ? 'text-pass'
                            : 'text-fail'
                        }`}
                      >
                        {record.tempReadingC.toFixed(1)}°C
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-sub">{record.driverName}</div>
                </div>
                <Chip status={record.status} />
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-xl bg-fleet py-4 text-base font-bold text-white"
        >
          Back to vans
        </button>
      </div>
    </div>
  );
};
