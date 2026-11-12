/**
 * Iconos de Figma (src/assets/figma). Todos son de un solo color, así que se dibujan como
 * máscara: la forma es exactamente la del SVG original y el color sale del token de texto
 * (`text-accent`, `text-ink-subtle`...). Así un mismo icono sirve en su estado activo e inactivo,
 * como en el diseño (p. ej. la navegación: #94A3B8 inactivo, #C7FF58 activo).
 */

import type { CSSProperties } from "react";

export interface IconProps {
  src: string;
  /** Lado en px, el mismo que el contenedor del icono en Figma. */
  size: number;
  /** Alto en px si el icono no es cuadrado (p. ej. la «X» del toast: 18 × 10.5). */
  height?: number;
  className?: string;
}

export function Icon({ src, size, height, className = "" }: IconProps) {
  const style: CSSProperties = {
    width: size,
    height: height ?? size,
    backgroundColor: "currentColor",
    maskImage: `url("${src}")`,
    WebkitMaskImage: `url("${src}")`,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  };
  return <span aria-hidden="true" className={`inline-block shrink-0 ${className}`} style={style} />;
}
