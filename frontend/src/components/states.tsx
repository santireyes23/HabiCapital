/** Estados de carga, vacío y error de una sección, con los estilos de Figma. */

import type { ReactNode } from "react";

import type { ApiError } from "../api/errors";
import { Icon } from "./Icon";
import { infoIcon, refreshIcon, shieldAlertIcon } from "./icons";

/** Bloque gris que ocupa el lugar del contenido mientras carga (sin datos inventados). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-control bg-surface-sunken ${className}`} />;
}

export function LoadingLabel({ children }: { children: string }) {
  return <span className="sr-only">{children}</span>;
}

/** Error de una sección: el mensaje real de la API y «Reintentar» (sin reintento automático). */
export function SectionError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: ApiError;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex w-full flex-col gap-3 rounded-card border border-rejected-border bg-rejected-bg p-[17px] sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="pt-0.5 text-negative">
          <Icon src={shieldAlertIcon} size={20} />
        </span>
        <div>
          <p className="text-body-sm font-bold text-rejected-text">{title}</p>
          <p className="text-caption text-ink-muted">{error.message}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-control border border-line bg-surface px-[15px] py-[7px] text-caption font-semibold text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent sm:self-center"
      >
        <Icon src={refreshIcon} size={16} />
        Reintentar
      </button>
    </div>
  );
}

/** Estado vacío dentro de una tarjeta: icono, texto y una acción opcional. */
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex w-full flex-col items-start gap-3 rounded-card border border-line bg-surface p-[25px] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="pt-0.5 text-accent">
          <Icon src={infoIcon} size={18} />
        </span>
        <div>
          <p className="text-body-sm font-bold text-ink">{title}</p>
          <p className="text-caption text-ink-muted">{children}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
