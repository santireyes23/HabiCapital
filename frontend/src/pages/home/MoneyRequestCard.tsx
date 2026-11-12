import { Link } from "react-router";

import type { MoneyRequestRead } from "../../api/types";
import { Icon } from "../../components/Icon";
import { checkCircleIcon } from "../../components/icons";
import { StatusBadge } from "../../components/StatusBadge";
import { initials } from "../../lib/account";
import { formatDateTime } from "../../lib/dates";
import { formatCop } from "../../lib/money";
import { describeRequest, type AmountTone } from "./requestCopy";

const AMOUNT_TONE: Record<AmountTone, string> = {
  accent: "text-accent",
  negative: "text-negative",
  muted: "text-ink-subtle",
};

const AVATAR_TONE = {
  PENDING: "text-accent",
  ACCEPTED: "text-ink",
  REJECTED: "text-negative",
  CANCELLED: "text-ink-subtle",
} as const;

/**
 * Tarjeta de solicitud de Inicio (Figma 1:610…1:693). Es solo informativa: las acciones (aceptar,
 * rechazar, cancelar) viven en Solicitudes, a la que enlaza si hay una recibida por responder.
 */
export function MoneyRequestCard({ request, accountId }: { request: MoneyRequestRead; accountId: string }) {
  const copy = describeRequest(request, accountId);
  const resolved = request.status !== "PENDING";
  return (
    <article
      aria-label={`Solicitud ${copy.roleTag.toLowerCase()} ${copy.counterparty.owner_name}`}
      className={`flex flex-col gap-5 rounded-card border border-line bg-surface p-[25px] ${
        request.status === "REJECTED" || request.status === "CANCELLED" ? "opacity-90" : ""
      }`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <StatusBadge status={request.status} />
          <p className="text-caption font-medium text-ink-muted">{formatDateTime(copy.date)}</p>
        </div>

        <div className="flex min-w-0 items-center gap-3.5">
          <div
            className={`flex size-11 shrink-0 items-center justify-center rounded-pill border border-line-strong bg-surface-sunken text-body font-bold ${AVATAR_TONE[request.status]}`}
          >
            {initials(copy.counterparty.owner_name)}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="truncate text-title font-bold text-ink">{copy.counterparty.owner_name}</h3>
              <span className="rounded-pill border border-line bg-surface-sunken px-2 py-px text-overline text-ink-muted">
                {copy.roleTag}
              </span>
            </div>
            <p className="truncate text-body-sm text-ink-muted">
              Concepto:{" "}
              <span className="font-medium text-ink">{request.description ?? "Sin concepto"}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-control border border-line bg-surface-sunken p-[15px]">
          <p className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">{copy.amountLabel}</p>
          <p className={`text-amount font-extrabold whitespace-nowrap ${AMOUNT_TONE[copy.amountTone]}`}>
            {copy.amountSign}
            {formatCop(request.amount)} COP
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-[13px]">
        <p
          className={`flex min-w-0 items-center gap-1.5 text-caption ${
            request.status === "ACCEPTED" ? "font-semibold text-accent" : "text-ink-muted"
          }`}
        >
          {request.status === "ACCEPTED" && <Icon src={checkCircleIcon} size={16} />}
          <span className="truncate">{copy.footer}</span>
        </p>
        <p className="shrink-0 font-mono text-caption text-ink-subtle" title={request.id}>
          ID: {request.id.slice(0, 8)}
        </p>
      </div>
      {!resolved && copy.role === "received" && (
        <Link
          to="/solicitudes?rol=recibidas&estado=pendientes&pagina=1"
          className="inline-flex items-center justify-center rounded-control border border-line bg-surface-sunken px-4 py-2.5 text-body-sm font-semibold text-accent transition hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent"
        >
          Responder en Solicitudes
        </Link>
      )}
    </article>
  );
}
