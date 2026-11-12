import { useRef } from "react";

import { Icon } from "../../components/Icon";
import { copyIcon } from "../../components/icons";
import { selectContents, useCopy } from "../../lib/useCopy";

/**
 * Caja con un valor (UUID o token) y botón «Copiar», según el estado «Cuenta creada con éxito»
 * de Stitch. Si el portapapeles no está disponible o el navegador lo niega, se selecciona el texto
 * para copiarlo a mano. El valor nunca se registra.
 */
export function CopyField({
  label,
  badge,
  badgeClassName,
  value,
  valueClassName,
  buttonVariant,
  copyLabel,
}: {
  label: string;
  badge: string;
  badgeClassName: string;
  value: string;
  valueClassName: string;
  buttonVariant: "ghost" | "accent";
  /** Nombre accesible del botón, p. ej. «Copiar token». */
  copyLabel: string;
}) {
  const { state, copy } = useCopy();
  const valueRef = useRef<HTMLSpanElement>(null);

  const buttonClass =
    buttonVariant === "accent"
      ? "bg-accent text-on-accent"
      : "border border-line bg-surface text-accent hover:border-accent";

  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface-sunken p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-overline font-bold tracking-[0.55px] text-ink-muted uppercase">
          {label}
        </span>
        <span className={`text-overline ${badgeClassName}`}>{badge}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 rounded-control border border-line bg-field px-3.5 py-2.5">
        <span ref={valueRef} className={`min-w-0 font-mono text-caption break-all select-all ${valueClassName}`}>
          {value}
        </span>
        <button
          type="button"
          onClick={() => {
            void copy(value).then((ok) => {
              if (!ok) selectContents(valueRef.current);
            });
          }}
          aria-label={copyLabel}
          className={`flex shrink-0 items-center gap-1 rounded-[10px] px-2.5 py-1 text-overline font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${buttonClass}`}
        >
          <Icon src={copyIcon} size={14} />
          <span>{state === "copied" ? "Copiado" : "Copiar"}</span>
        </button>
      </div>
      <p aria-live="polite" className="min-h-0 text-overline text-ink-muted empty:hidden">
        {state === "failed"
          ? "No se pudo copiar automáticamente. El texto quedó seleccionado: cópialo manualmente."
          : ""}
      </p>
    </div>
  );
}
