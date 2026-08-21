'use client';

import { useRef, useState } from 'react';

/**
 * Reads a UAE plate from a photo to prefill the form.
 *
 * UAE plates carry an emirate name, an Arabic rendering, a one to two
 * character category code, and up to five digits. Photographed in a yard
 * with glare and angle, OCR also picks up watermarks and background text.
 * So this never submits anything: it offers candidates and the manager
 * confirms. A wrong plate saved silently is worse than typing it.
 */

const EMIRATES: { code: string; patterns: string[] }[] = [
  { code: 'DXB', patterns: ['DUBAI'] },
  { code: 'AUH', patterns: ['ABUDHABI', 'ABU DHABI', 'ABUDHABT'] },
  { code: 'SHJ', patterns: ['SHARJAH', 'SHARJA'] },
  { code: 'AJM', patterns: ['AJMAN'] },
  { code: 'FUJ', patterns: ['FUJAIRAH', 'FUJAIRA'] },
  { code: 'UAQ', patterns: ['UMMALQUWAIN', 'UMM AL QUWAIN', 'QUWAIN'] },
  { code: 'RAK', patterns: ['RASALKHAIMAH', 'RAS AL KHAIMAH', 'KHAIMAH'] },
  { code: 'AAN', patterns: ['ALAIN', 'AL AIN'] },
];

export type PlateReading = {
  /** Best guess, already formatted. */
  best: string;
  /** Other plausible formats, offered as chips. */
  alternatives: string[];
  /** Emirate code if the plate named one, so the area can be preselected. */
  emirateCode: string | null;
  /** What the OCR actually saw, for when it goes wrong. */
  raw: string;
};

export const parsePlateText = (text: string): PlateReading | null => {
  const upper = text.toUpperCase();
  const squashed = upper.replace(/[^A-Z]/g, '');

  const emirate =
    EMIRATES.find((entry) =>
      entry.patterns.some(
        (pattern) => squashed.includes(pattern.replace(/ /g, '')) || upper.includes(pattern),
      ),
    ) ?? null;

  // The registration number is the longest run of digits on the plate.
  // Anything shorter is usually a watermark or a year.
  const digitRuns = [...upper.matchAll(/\d{3,6}/g)].map((match) => match[0]);
  if (digitRuns.length === 0) {
    return null;
  }
  const number = digitRuns.sort((a, b) => b.length - a.length)[0] ?? '';

  // The category code is one or two letters sitting next to the number.
  // Requiring two was the bug: most Dubai plates use a single letter.
  const adjacent = new RegExp(`\\b([A-Z]{1,2})\\s*${number}\\b|\\b${number}\\s*([A-Z]{1,2})\\b`);
  const codeMatch = adjacent.exec(upper);
  const code = (codeMatch?.[1] ?? codeMatch?.[2] ?? '').trim();

  const candidates: string[] = [];
  if (emirate !== null) {
    candidates.push(`${emirate.code}-${number}`);
  }
  if (code !== '') {
    candidates.push(`${code}-${number}`);
    if (emirate !== null) {
      candidates.push(`${emirate.code}-${code}-${number}`);
    }
  }
  candidates.push(number);

  const unique = [...new Set(candidates)];
  const best = unique[0];
  if (best === undefined) {
    return null;
  }

  return {
    best,
    alternatives: unique.slice(1),
    emirateCode: emirate?.code ?? null,
    raw: upper.replace(/\s+/g, ' ').trim().slice(0, 120),
  };
};

type Props = {
  onDetected: (reading: PlateReading) => void;
  onPick: (plate: string) => void;
};

export const PlateScanner = ({ onDetected, onPick }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<PlateReading | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const scan = async (file: File): Promise<void> => {
    setBusy(true);
    setStatus('Reading the plate…');
    setReading(null);

    try {
      // Loaded on demand: the OCR engine is several megabytes and most
      // visits to this page never scan anything.
      const Tesseract = await import('tesseract.js');
      const worker = await Tesseract.createWorker('eng');

      // Without a whitelist the Arabic script and watermarks come back as
      // punctuation soup and pollute the match.
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
      });

      const { data } = await worker.recognize(file);
      await worker.terminate();

      const parsed = parsePlateText(data.text);

      if (parsed === null) {
        setStatus('No plate number found. Type it in instead.');
        return;
      }

      setReading(parsed);
      onDetected(parsed);
      setStatus(null);
    } catch {
      setStatus('Scanning failed. Type the plate in instead.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) {
            void scan(file);
          }
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="rounded-sm border border-line bg-surface-card px-4 py-2.5 text-sm font-bold text-brand disabled:opacity-60"
      >
        {busy ? 'Reading…' : 'Scan plate'}
      </button>

      {status !== null && <p className="mt-2 text-xs text-content-secondary">{status}</p>}

      {reading !== null && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-content-secondary">
            Filled in <span className="font-bold text-content">{reading.best}</span>. Check it, or
            pick another reading:
          </p>

          {reading.alternatives.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {reading.alternatives.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onPick(option)}
                  className="rounded-full bg-surface-page px-3 py-1.5 text-xs font-bold text-content"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs font-bold text-brand"
          >
            {showRaw ? 'Hide' : 'Show'} what the camera read
          </button>

          {showRaw && (
            <p className="rounded-sm bg-surface-page p-2 font-mono text-[11px] text-content-secondary">
              {reading.raw === '' ? 'Nothing legible' : reading.raw}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
