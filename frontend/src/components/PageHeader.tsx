import type { ReactNode } from "react";

import { formatCop } from "../lib/money";

/** Pastilla de la cabecera («RECARGA DE DEMOSTRACIÓN»…): 11 px Bold lima con punto. */
export function HeaderPill({ children }: { children: string }) {
  return (
    <p className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-line-strong bg-surface-sunken px-2.5 py-[3px] text-overline font-bold tracking-[0.275px] text-accent uppercase">
      <span aria-hidden className="size-2 rounded-pill bg-accent" />
      {children}
    </p>
  );
}

/** Cabecera de página de Figma: pastilla + nota, H1 de 36 px, descripción y bloque a la derecha. */
export function PageHeader({
  pill,
  note,
  title,
  description,
  aside,
}: {
  pill: ReactNode;
  note?: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <header className="flex w-full flex-col gap-4 border-b border-line pb-[17px] md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {pill}
          {note !== undefined && <p className="text-caption text-ink-muted">{note}</p>}
        </div>
        <h1 className="text-display font-extrabold text-ink">{title}</h1>
        <p className="max-w-[672px] text-body text-ink-muted">{description}</p>
      </div>
      {aside}
    </header>
  );
}

/** Tarjeta compacta «SALDO DISPONIBLE» con el saldo real de GET /accounts/me. */
export function BalanceCard({ label, balance }: { label: string; balance: number }) {
  return (
    <div className="flex shrink-0 flex-col items-start rounded-card border border-line bg-surface px-[21px] pt-[14px] pb-[15px] md:items-end">
      <p className="text-overline font-bold tracking-[0.55px] text-ink-muted uppercase">{label}</p>
      <p className="whitespace-nowrap">
        <span className="text-amount-header font-extrabold text-accent">{formatCop(balance)} </span>
        <span className="text-body-sm font-semibold text-ink-muted">COP</span>
      </p>
    </div>
  );
}
