/**
 * Piezas compartidas por las operaciones de dinero (recargar y enviar): resumen, confirmación con
 * el saldo leído de FastAPI, resultado incierto con la misma Idempotency-Key, y descarte local.
 * Los textos los pone cada pantalla; aquí solo vive la estructura y el comportamiento común.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { formatCop } from "../lib/money";
import { useSession } from "../session/SessionProvider";
import { Icon } from "./Icon";
import { refreshIcon } from "./icons";
import { DangerNotice, PrimaryButton, SecondaryButton } from "./ui";

export function SummaryRow({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
      <p className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">{label}</p>
      <div
        className={`min-w-0 text-right ${strong ? "text-amount font-extrabold whitespace-nowrap text-accent" : "text-title font-bold text-ink"}`}
      >
        {children}
      </div>
    </div>
  );
}

/** Enlace con el estilo del botón secundario de Figma («Cancelar», «Volver a Inicio»). */
export function SecondaryLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-center rounded-control border border-line bg-surface-sunken px-[21px] py-[13px] text-body-sm font-semibold text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </Link>
  );
}

type FreshBalance = { status: "loading" } | { status: "ok"; value: number } | { status: "error" };

/** Saldo actual leído de GET /accounts/me al entrar en la confirmación (no el de la sesión). */
function useFreshBalance() {
  const { refreshAccount } = useSession();
  const [balance, setBalance] = useState<FreshBalance>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    refreshAccount(controller.signal)
      .then((account) => {
        if (!controller.signal.aborted) setBalance({ status: "ok", value: account.balance });
      })
      .catch(() => {
        if (!controller.signal.aborted) setBalance({ status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, [attempt, refreshAccount]);

  return {
    balance,
    retry: () => {
      setBalance({ status: "loading" });
      setAttempt((value) => value + 1);
    },
  };
}

/**
 * Paso 2 de una operación: filas propias, saldo actual del backend y saldo estimado
 * (`balanceDelta` positivo al recargar, negativo al enviar). El estimado es solo informativo.
 */
export function ConfirmPanel({
  rows,
  balanceDelta,
  submitting,
  confirmLabel,
  busyLabel,
  onEdit,
  onConfirm,
}: {
  rows: ReactNode;
  balanceDelta: number;
  submitting: boolean;
  confirmLabel: string;
  busyLabel: string;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const { balance, retry } = useFreshBalance();
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-card border border-line bg-surface-sunken p-[21px]" aria-live="polite">
        {rows}
        <SummaryRow label="Saldo actual">
          {balance.status === "ok" ? `${formatCop(balance.value)} COP` : balance.status === "loading" ? "Consultando…" : "No disponible"}
        </SummaryRow>
        <SummaryRow label="Saldo estimado después">
          {balance.status === "ok" ? `${formatCop(balance.value + balanceDelta)} COP` : "—"}
        </SummaryRow>
      </div>
      {balance.status === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-caption text-ink-muted">
          <span>No se pudo consultar el saldo actual. Puedes confirmar igualmente: el saldo real lo dará el servidor.</span>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-[15px] py-[7px] font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon src={refreshIcon} size={16} />
            Reintentar
          </button>
        </div>
      ) : (
        <p className="text-caption text-ink-muted">
          El saldo estimado es informativo: el saldo definitivo es el que confirme el servidor.
        </p>
      )}
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center">
        <SecondaryButton type="button" onClick={onEdit} disabled={submitting}>
          Editar
        </SecondaryButton>
        <PrimaryButton type="button" onClick={onConfirm} disabled={submitting} aria-busy={submitting} className="sm:flex-1">
          {submitting ? busyLabel : confirmLabel}
        </PrimaryButton>
      </div>
    </div>
  );
}

/** Resultado incierto: se ofrece reintentar con la MISMA clave o dejar de intentar recuperar. */
export function UncertainPanel({
  title,
  children,
  summary,
  blockText,
  onRetry,
  onDiscard,
}: {
  title: string;
  /** Explicación (por qué es incierto y qué hace el reintento). */
  children: ReactNode;
  /** Datos de la operación pendiente, o null si no se pudieron leer. */
  summary: ReactNode | null;
  blockText: string;
  /** null si no se puede reintentar (no se pudo leer la operación pendiente). */
  onRetry: (() => void) | null;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <DangerNotice role="alert" title={title}>
        {children}
      </DangerNotice>
      {summary ?? <p className="text-caption text-ink-muted">No se pudieron leer los datos de la operación pendiente.</p>}
      <p className="text-caption text-ink-muted">{blockText}</p>
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center">
        <SecondaryButton type="button" onClick={onDiscard}>
          Dejar de intentar recuperar
        </SecondaryButton>
        {onRetry !== null && (
          <PrimaryButton type="button" onClick={onRetry} className="sm:flex-1">
            Reintentar con la misma clave
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

/** Confirmación explícita antes de borrar la información local de una operación pendiente. */
export function ConfirmDiscardPanel({
  question,
  children,
  onBack,
  onConfirm,
}: {
  question: string;
  children: ReactNode;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-card border border-danger-soft-border bg-surface-sunken p-[17px]">
        <p className="text-body-sm font-bold text-rejected-text">{question}</p>
        <p className="text-caption text-ink-muted">{children}</p>
      </div>
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center">
        <SecondaryButton type="button" onClick={onBack}>
          Volver
        </SecondaryButton>
        <PrimaryButton type="button" withArrow={false} onClick={onConfirm} className="sm:flex-1">
          Sí, dejar de intentar recuperar
        </PrimaryButton>
      </div>
    </div>
  );
}

export function DiscardedPanel({
  children,
  newLabel,
  onNew,
  link = { to: "/movimientos", label: "Ver movimientos" },
}: {
  children: ReactNode;
  newLabel: string;
  onNew: () => void;
  link?: { to: string; label: string };
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 rounded-card border border-line bg-surface-sunken p-[17px]">
        <p className="text-body-sm font-bold text-ink">Se descartó la información local</p>
        <p className="text-caption text-ink-muted">{children}</p>
      </div>
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center">
        <SecondaryLink to={link.to}>{link.label}</SecondaryLink>
        <PrimaryButton type="button" onClick={onNew} className="sm:flex-1">
          {newLabel}
        </PrimaryButton>
      </div>
    </div>
  );
}
