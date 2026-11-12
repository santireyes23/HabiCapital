/** Paginación del frame 05 («Anterior», números y «Siguiente»), compartida por los listados. */

/** Números de página visibles (hasta 5 alrededor de la actual), con huecos marcados como null. */
export function pageWindow(current: number, last: number): (number | null)[] {
  if (last <= 7) return Array.from({ length: last }, (_v, index) => index + 1);
  const start = Math.max(2, Math.min(current - 2, last - 5));
  const end = Math.min(last - 1, start + 4);
  const middle = Array.from({ length: end - start + 1 }, (_v, index) => start + index);
  return [1, ...(start > 2 ? [null] : []), ...middle, ...(end < last - 1 ? [null] : []), last];
}

function PagerButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-control border border-line bg-surface px-[13px] py-[7px] text-caption leading-4 font-semibold text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-ink-placeholder disabled:hover:text-ink-placeholder"
    >
      {label}
    </button>
  );
}

export function Pagination({
  current,
  last,
  loading,
  onPage,
}: {
  current: number;
  last: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center gap-2">
      <PagerButton label="Anterior" disabled={current <= 1 || loading} onClick={() => { onPage(current - 1); }} />
      <div className="flex items-center gap-1">
        {pageWindow(current, last).map((number, index) =>
          number === null ? (
            <span key={`gap-${index}`} aria-hidden className="px-1 text-caption text-ink-subtle">
              …
            </span>
          ) : (
            <button
              key={number}
              type="button"
              aria-current={number === current ? "page" : undefined}
              aria-label={`Página ${number}`}
              disabled={loading}
              onClick={() => {
                onPage(number);
              }}
              className={`size-8 rounded-control text-caption leading-4 transition focus-visible:outline-2 focus-visible:outline-accent ${
                number === current ? "bg-accent font-bold text-on-accent" : "bg-surface font-semibold text-ink-muted hover:text-ink"
              }`}
            >
              {number}
            </button>
          ),
        )}
      </div>
      <PagerButton label="Siguiente" disabled={current >= last || loading} onClick={() => { onPage(current + 1); }} />
    </nav>
  );
}
