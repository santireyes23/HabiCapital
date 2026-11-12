import { useEffect, useState } from "react";

import type { Endpoints } from "../api/endpoints";

type HealthState = "checking" | "ok" | "down";

const BADGE = {
  checking: {
    label: "Comprobando servidor",
    box: "border-line-strong bg-surface-sunken text-ink-muted",
    dot: "bg-ink-subtle",
  },
  ok: {
    label: "Servidor FastAPI conectado",
    box: "border-line-strong bg-surface-sunken text-accent",
    dot: "bg-accent",
  },
  down: {
    label: "Servidor no disponible",
    box: "border-rejected-border bg-rejected-bg text-rejected-text",
    dot: "bg-rejected-dot",
  },
} as const;

/**
 * Pastilla «SERVIDOR FASTAPI CONECTADO» de la cabecera de Inicio (Figma), alimentada por el
 * GET /health real: solo dice «conectado» si el servidor respondió {"status": "ok"}.
 */
export function ServerStatusBadge({ checkHealth }: { checkHealth: Endpoints["health"] }) {
  const [health, setHealth] = useState<HealthState>("checking");

  useEffect(() => {
    let active = true;
    checkHealth()
      .then((response) => {
        if (active) setHealth(response.data.status === "ok" ? "ok" : "down");
      })
      .catch(() => {
        if (active) setHealth("down");
      });
    return () => {
      active = false;
    };
  }, [checkHealth]);

  const badge = BADGE[health];
  return (
    <p
      role="status"
      className={`inline-flex w-fit items-center gap-1.5 rounded-pill border px-2.5 py-[3px] text-overline font-bold tracking-[0.275px] uppercase ${badge.box}`}
    >
      <span aria-hidden className={`size-2 rounded-pill ${badge.dot}`} />
      {badge.label}
    </p>
  );
}
