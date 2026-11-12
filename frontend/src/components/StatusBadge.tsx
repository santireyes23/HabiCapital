import type { MoneyRequestStatus } from "../api/types";

/** Insignias de estado de Figma (badge-status-pending/accepted/rejected/cancelled). */
const STYLES: Record<MoneyRequestStatus, { label: string; box: string; dot: string; text: string }> = {
  PENDING: {
    label: "Pendiente",
    box: "border-pending-border bg-pending-bg",
    dot: "bg-pending-dot",
    text: "text-pending-text",
  },
  ACCEPTED: {
    label: "Aceptada",
    box: "border-accepted-border bg-accepted-bg",
    dot: "bg-accent",
    text: "text-accepted-text",
  },
  REJECTED: {
    label: "Rechazada",
    box: "border-rejected-border bg-rejected-bg",
    dot: "bg-rejected-dot",
    text: "text-rejected-text",
  },
  CANCELLED: {
    label: "Cancelada",
    box: "border-cancelled-border bg-cancelled-bg",
    dot: "bg-cancelled-dot",
    text: "text-cancelled-text",
  },
};

export function StatusBadge({ status }: { status: MoneyRequestStatus }) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-[13px] py-[5px] text-overline font-bold tracking-[0.55px] uppercase ${style.box} ${style.text}`}
    >
      <span aria-hidden className={`size-1.5 rounded-pill ${style.dot}`} />
      {style.label}
    </span>
  );
}

/** «Completado» de la tabla de movimientos: todo movimiento del ledger ya está confirmado. */
export function CompletedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-accepted-border bg-accepted-bg px-[13px] py-[5px] text-caption font-bold text-accepted-text">
      <span aria-hidden className="size-1.5 rounded-pill bg-accent" />
      Completado
    </span>
  );
}
