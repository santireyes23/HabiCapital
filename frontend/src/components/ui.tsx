/**
 * Piezas compartidas con los estilos exactos de Figma (frames 03, 06 y 07). Solo usan los tokens
 * de theme.css.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Icon } from "./Icon";
import { arrowRightIcon, infoIcon, shieldAlertIcon } from "./icons";

/** Etiqueta de campo: 12/18 Bold, mayúsculas, tracking 0.6px, asterisco lima si es obligatorio. */
export function FieldLabel({
  htmlFor,
  required = false,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase"
    >
      {children}
      {required && <span className="text-accent"> *</span>}
    </label>
  );
}

/** Botón principal lima («Crear mi cuenta», «Continuar»): 14 Bold, py 14, sombra lima. */
export function PrimaryButton({
  children,
  withArrow = true,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { withArrow?: boolean }) {
  return (
    <button
      {...props}
      className={`flex w-full items-center justify-center gap-2 rounded-control bg-accent px-6 py-3.5 text-body font-bold text-on-accent shadow-accent transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100 ${className}`}
    >
      <span>{children}</span>
      {withArrow && <Icon src={arrowRightIcon} size={18} />}
    </button>
  );
}

/** Botón secundario («Cancelar», «Cerrar sesión»): fondo #16222B, borde #263847. */
export function SecondaryButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-control border border-line bg-surface-sunken px-[21px] py-[13px] text-body-sm font-semibold text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

/** Aviso informativo (fondo #16222B, icono lima), como el del formulario de registro. */
export function InfoNotice({
  icon = infoIcon,
  children,
}: {
  icon?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full items-start gap-2.5 rounded-card border border-line bg-surface-sunken p-[15px]">
      <span className="pt-0.5 text-accent">
        <Icon src={icon} size={18} />
      </span>
      <div className="min-w-0 text-overline text-ink-muted">{children}</div>
    </div>
  );
}

/** Aviso de riesgo (estilo «Regla de seguridad» de Mi cuenta: rojo #361A1D / #68272C). */
export function DangerNotice({
  title,
  children,
  role,
}: {
  title: string;
  children?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className="flex w-full items-start gap-3 rounded-card border border-rejected-border bg-rejected-bg p-[17px]"
    >
      <span className="pt-0.5 text-negative">
        <Icon src={shieldAlertIcon} size={20} />
      </span>
      <div className="min-w-0">
        <p className="text-body-sm font-bold text-rejected-text">{title}</p>
        {children !== undefined && (
          <div className="mt-0.5 text-caption text-ink-muted">{children}</div>
        )}
      </div>
    </div>
  );
}

/** Mensaje de error bajo un campo: 11 px, rojo, con el icono de alerta de Figma. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1 text-overline text-negative">
      <span className="pt-px">
        <Icon src={shieldAlertIcon} size={14} />
      </span>
      <span>{children}</span>
    </p>
  );
}
