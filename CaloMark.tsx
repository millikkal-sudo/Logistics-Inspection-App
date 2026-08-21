/**
 * Calo logo lockup.
 *
 * The app-icon tile is a faithful reproduction. The wordmark uses the brand
 * font with wide tracking to echo the official letterform, which is
 * proprietary. Drop the real wordmark SVG in and replace the span if it
 * becomes available.
 */
export const CaloMark = ({ invert = false }: { invert?: boolean }) => (
  <span className="inline-flex items-center gap-2.5">
    <span
      className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
      style={{ background: invert ? 'var(--base-0)' : 'var(--brand-50)' }}
    >
      <span
        className="text-[11px] font-black uppercase leading-none tracking-[0.14em]"
        style={{ color: invert ? 'var(--brand-50)' : 'var(--base-0)' }}
      >
        C
      </span>
    </span>
    <span
      className="text-[15px] font-black uppercase leading-none tracking-[0.18em]"
      style={{ color: invert ? 'var(--base-0)' : 'var(--brand-90)' }}
    >
      Calo
    </span>
  </span>
);
