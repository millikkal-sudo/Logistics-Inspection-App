'use client';

import { useRef, useState } from 'react';

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

const TEMPLATES = {
  vans: {
    heading: 'Bulk add vans',
    columns: 'plate, area',
    sample: 'DXB-12345, Dubai\nAUH-22101, Abu Dhabi\nSHJ-11080, Sharjah',
  },
  drivers: {
    heading: 'Bulk add drivers and helpers',
    columns: 'name, role, area, van, rides with',
    sample:
      'Rashid Al Mansoori, driver, Dubai, DXB-12345,\nJoseph Fernandes, helper, , , Rashid Al Mansoori\nAnil Kumar, driver, Sharjah, SHJ-11080,',
  },
} as const;

const isStaff = (draft: VanDraft | StaffDraft): draft is StaffDraft => 'fullName' in draft;

export const BulkImport = ({
  entity,
  onImported,
}: {
  entity: 'vans' | 'drivers';
  onImported: () => void;
}) => {
  const template = TEMPLATES[entity];
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (commit: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, text, commit }),
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

      const payload = body as PreviewResult;
      setResult(payload);

      if (commit) {
        setText('');
        onImported();
      }
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  const readFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result));
      setResult(null);
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
          <h2 className="text-sm font-bold text-content">{template.heading}</h2>
          <p className="mt-0.5 text-xs text-content-secondary">
            Paste from a spreadsheet, or choose a CSV. Columns: {template.columns}
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

      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setResult(null);
        }}
        rows={6}
        placeholder={template.sample}
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
          onClick={() => fileRef.current?.click()}
          className="rounded-sm border border-line px-4 py-2 text-xs font-bold text-content"
        >
          Choose a file
        </button>
        <button
          type="button"
          onClick={() => void call(false)}
          disabled={busy || text.trim() === ''}
          className="rounded-sm bg-brand-action px-5 py-2 text-xs font-bold text-content-invert disabled:bg-disabled disabled:text-content-secondary"
        >
          {busy ? 'Checking…' : 'Preview'}
        </button>

        {result !== null && result.valid.length > 0 && result.imported === undefined && (
          <button
            type="button"
            onClick={() => void call(true)}
            disabled={busy}
            className="rounded-sm bg-pass px-5 py-2 text-xs font-bold text-content-invert"
          >
            Import {result.valid.length} row{result.valid.length === 1 ? '' : 's'}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setText(template.sample);
            setResult(null);
          }}
          className="text-xs font-bold text-brand"
        >
          Use example
        </button>
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
