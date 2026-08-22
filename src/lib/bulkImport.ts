'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Paste from a spreadsheet or pick a CSV, preview what will happen, then
 * commit. Nothing is written until the preview has been seen.
 */

type Issue = { line: number; input: string; reason: string };

type VanDraft = { line: number; plate: string; areaName: string };
type StaffDraft = {
  line: number;
  fullName: string;
  staffRole: 'driver' | 'helper';
  areaName: string;
  plate: string;
  partnerName: string;
};

type PreviewResult = {
  valid: (VanDraft | StaffDraft)[];
  issues: Issue[];
  imported?: number;
};

type Column = { key: string; label: string; note: string };

const SCHEMA: Record<'vans' | 'drivers', { heading: string; columns: Column[] }> = {
  vans: {
    heading: 'Bulk add vans',
    columns: [
      { key: 'plate', label: 'plate', note: 'DXB-12345' },
      { key: 'area', label: 'area', note: 'the emirate' },
    ],
  },
  drivers: {
    heading: 'Bulk add drivers and helpers',
    columns: [
      { key: 'name', label: 'name', note: 'full name' },
      { key: 'area', label: 'area', note: 'drivers only' },
      { key: 'van', label: 'van', note: 'drivers only, optional' },
      { key: 'rides with', label: 'rides with', note: 'helpers only, the driver name' },
    ],
  },
};

const isStaff = (draft: VanDraft | StaffDraft): draft is StaffDraft => 'fullName' in draft;

export const BulkImport = ({
  entity,
  areaNames,
  samplePlate,
  onImported,
}: {
  entity: 'vans' | 'drivers';
  areaNames: string[];
  samplePlate: string;
  onImported: () => void;
}) => {
  const schema = SCHEMA[entity];
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstArea = areaNames[0] ?? 'Dubai';

  // Built from the real areas and a real plate, so the example cannot
  // suggest a value the import would then reject.
  const templateCsv =
    entity === 'vans'
      ? `plate,area\n${samplePlate},${firstArea}\nDXB-99001,${areaNames[1] ?? firstArea}\n`
      : `name,area,van,rides with\nRashid Al Mansoori,${firstArea},${samplePlate},\nJoseph Fernandes,,,Rashid Al Mansoori\n`;

  const downloadTemplate = (): void => {
    const blob = new Blob([templateCsv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `calo-${entity}-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const call = useCallback(
    async (commit: boolean, source: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, text: source, commit }),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'Import failed';
        setError(message);
        return;
      }

      setResult(body as PreviewResult);

      if (commit) {
        setText('');
        onImported();
      }
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  },
    [entity, onImported],
  );

  // Previewing automatically. Requiring a Preview click before the
  // Import button appeared meant that after choosing a file nothing
  // actionable was on screen, which read as the button being missing.
  useEffect(() => {
    if (text.trim() === '') {
      setResult(null);
      return;
    }
    const timer = setTimeout(() => {
      void call(false, text);
    }, 500);
    return () => clearTimeout(timer);
  }, [text, call]);

  const readFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result));
    };
    reader.readAsText(file);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-line bg-surface-card px-4 py-2.5 text-sm font-bold text-brand"
      >
        Bulk import
      </button>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-content">{schema.heading}</h2>
          <p className="mt-0.5 text-xs text-content-secondary">
            Paste from a spreadsheet or choose a CSV. Keep the header row and the column order
            does not matter.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
            setError(null);
          }}
          className="text-xs font-bold text-content-secondary"
        >
          Close
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-sm border border-line">
        <div className="bg-surface-page px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-content-secondary">
          Columns
        </div>
        {schema.columns.map((column) => (
          <div
            key={column.key}
            className="flex items-baseline gap-3 border-t border-line px-3 py-1.5 text-xs"
          >
            <span className="w-24 shrink-0 font-mono font-bold text-content">{column.label}</span>
            <span className="text-content-secondary">{column.note}</span>
          </div>
        ))}
        <div className="border-t border-line bg-surface-page px-3 py-2 text-[11px] text-content-secondary">
          Areas must match exactly: {areaNames.length === 0 ? 'none set up yet' : areaNames.join(', ')}
        </div>
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={6}
        placeholder={templateCsv}
        className="mt-3 w-full resize-y rounded-sm border border-line bg-surface-page p-3 font-mono text-xs text-content outline-none"
      />

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) {
            readFile(file);
          }
        }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={downloadTemplate}
          className="rounded-sm border border-line px-4 py-2 text-xs font-bold text-brand"
        >
          Download template
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-sm border border-line px-4 py-2 text-xs font-bold text-content"
        >
          Choose a file
        </button>
        {result !== null && result.valid.length > 0 && result.imported === undefined && (
          <button
            type="button"
            onClick={() => void call(true, text)}
            disabled={busy}
            className="rounded-sm bg-pass px-6 py-2 text-xs font-bold text-content-invert"
          >
            Import {result.valid.length} row{result.valid.length === 1 ? '' : 's'}
          </button>
        )}

        {busy && <span className="text-xs text-content-secondary">Checking…</span>}

        {!busy && result !== null && result.valid.length === 0 && result.imported === undefined && (
          <span className="text-xs font-bold text-fail">Nothing to import yet</span>
        )}
      </div>

      {error !== null && (
        <div className="mt-3 rounded-sm bg-fail-soft p-3 text-sm font-medium text-fail">{error}</div>
      )}

      {result !== null && (
        <div className="mt-4 space-y-3">
          {result.imported !== undefined && (
            <div className="rounded-sm bg-pass-soft p-3 text-sm font-bold text-pass">
              Imported {result.imported} row{result.imported === 1 ? '' : 's'}.
            </div>
          )}

          {result.valid.length > 0 && result.imported === undefined && (
            <div className="overflow-hidden rounded-sm border border-line">
              <div className="bg-pass-soft px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-pass">
                {result.valid.length} ready to import
              </div>
              <div className="max-h-48 overflow-y-auto">
                {result.valid.map((draft) => (
                  <div
                    key={draft.line}
                    className="flex items-center gap-3 border-b border-line px-3 py-2 text-xs last:border-b-0"
                  >
                    <span className="w-8 text-content-secondary">{draft.line}</span>
                    {isStaff(draft) ? (
                      <span className="text-content">
                        <span className="font-bold">{draft.fullName}</span>{' '}
                        <span className="text-content-secondary">
                          {draft.staffRole}
                          {draft.areaName === '' ? '' : ` · ${draft.areaName}`}
                          {draft.plate === '' ? '' : ` · ${draft.plate}`}
                          {draft.partnerName === '' ? '' : ` · with ${draft.partnerName}`}
                        </span>
                      </span>
                    ) : (
                      <span className="text-content">
                        <span className="font-bold">{draft.plate}</span>{' '}
                        <span className="text-content-secondary">{draft.areaName}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.issues.length > 0 && (
            <div className="overflow-hidden rounded-sm border border-line">
              <div className="bg-fail-soft px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-fail">
                {result.issues.length} row{result.issues.length === 1 ? '' : 's'} skipped
              </div>
              <div className="max-h-48 overflow-y-auto">
                {result.issues.map((issue) => (
                  <div
                    key={`${issue.line}-${issue.reason}`}
                    className="border-b border-line px-3 py-2 text-xs last:border-b-0"
                  >
                    <span className="mr-2 text-content-secondary">Line {issue.line}</span>
                    <span className="font-bold text-fail">{issue.reason}</span>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-content-secondary">
                      {issue.input}
                    </div>
                  </div>
                ))}
              </div>
              <p className="border-t border-line px-3 py-2 text-[11px] text-content-secondary">
                Skipped rows are not imported. Fix them in your sheet and paste again.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
