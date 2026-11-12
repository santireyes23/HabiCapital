import { useEffect } from "react";

import { Icon } from "./Icon";
import { checkCircle20Icon, closeIcon } from "./icons";

/**
 * Notificación «Transacción completada» de Figma (Inicio, nodo 1:416). Solo se muestra tras una
 * respuesta exitosa del backend, con los datos de esa respuesta. Se cierra sola a los 8 s.
 */
export function Toast({
  title,
  message,
  onClose,
  autoCloseMs = 8_000,
}: {
  title: string;
  message: string;
  onClose: () => void;
  autoCloseMs?: number;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, autoCloseMs);
    return () => {
      clearTimeout(timer);
    };
  }, [autoCloseMs, onClose]);

  return (
    <aside
      role="status"
      aria-live="polite"
      className="fixed top-6 right-4 left-4 z-50 sm:left-auto sm:w-[448px] lg:right-8"
    >
      <div className="flex items-start gap-3.5 rounded-card border border-accepted-border bg-surface p-[17px] shadow-[0_25px_50px_-12px_rgb(0_0_0/0.25)]">
        <div className="pt-0.5">
          <span className="flex size-8 items-center justify-center rounded-control bg-accepted-bg text-accent">
            <Icon src={checkCircle20Icon} size={20} />
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-body font-bold text-ink">{title}</p>
            <p className="shrink-0 text-overline text-ink-muted">Ahora mismo</p>
          </div>
          <p className="text-caption text-ink-muted">{message}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar notificación"
          className="shrink-0 pt-[5px] text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Icon src={closeIcon} size={18} height={10.5} />
        </button>
      </div>
    </aside>
  );
}
