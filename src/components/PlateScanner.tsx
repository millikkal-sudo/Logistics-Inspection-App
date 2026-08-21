'use client';

import { useRef, useState } from 'react';

/**
 * Reads a plate from a photo to prefill the field.
 *
 * OCR on a plate photographed in a yard is not reliable enough to trust
 * blind — glare, angle and the Arabic script all cost accuracy. So this
 * never submits anything: it fills the box and the manager confirms.
 * A wrong plate silently entered is worse than typing it by hand.
 */

const PLATE_PATTERN = /\b([A-Z]{2,3})[\s-]?(\d{3,5})\b/;

const normalise = (raw: string): string | null => {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9\s-]/g, ' ');
  const match = PLATE_PATTERN.exec(upper);
  if (match === null) {
    return null;
  }
  return `${match[1]}-${match[2]}`;
};

type Props = {
  onDetected: (plate: string) => void;
};

export const PlateScanner = ({ onDetected }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const scan = async (file: File): Promise<void> => {
    setBusy(true);
    setStatus('Reading the plate…');

    try {
      // Loaded on demand — the OCR engine is a few megabytes and most
      // visits to this page never scan anything.
      const { default: Tesseract } = await import('tesseract.js');

      const { data } = await Tesseract.recognize(file, 'eng', {
        logger: () => {
          // Progress events are noisy; the status text above is enough.
        },
      });

      const plate = normalise(data.text);

      if (plate === null) {
        setStatus('Could not read a plate. Type it in instead.');
        return;
      }

      onDetected(plate);
      setStatus(`Read "${plate}" — check it before saving.`);
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
        className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-bold text-fleet disabled:opacity-60"
      >
        {busy ? 'Reading…' : 'Scan plate'}
      </button>

      {status !== null && <p className="mt-2 text-xs text-sub">{status}</p>}
    </div>
  );
};
