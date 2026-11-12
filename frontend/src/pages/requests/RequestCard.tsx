import { useRef, useState } from "react";

import { useApi, useIdempotency } from "../../api/ApiContext";
import { ApiError } from "../../api/errors";
import type { MoneyRequestAccepted, MoneyRequestRead } from "../../api/types";
import { Icon } from "../../components/Icon";
import { checkCircleIcon, checkCircle18Icon, xCircleIcon } from "../../components/icons";
import { ConfirmPanel, SummaryRow } from "../../components/operation";
import { StatusBadge } from "../../components/StatusBadge";
import { DangerNotice, SecondaryButton } from "../../components/ui";
import { initials } from "../../lib/account";
import { formatDateTime } from "../../lib/dates";
import { formatCop } from "../../lib/money";
import { describeRequest } from "../home/requestCopy";
import { acceptScope, invalidResponse, isMoneyRequestAccepted, isMoneyRequestRead } from "./requests";

type Phase =
  | { kind: "idle" }
  | { kind: "confirmAccept" }
  | { kind: "accepting" }
  | { kind: "confirmReject" }
  | { kind: "confirmCancel" }
  | { kind: "resolving"; action: "reject" | "cancel" }
  | { kind: "checking"; action: "reject" | "cancel" }
  | { kind: "unknown"; action: "reject" | "cancel" };

const AMOUNT_TONE = { accent: "text-accent", negative: "text-negative", muted: "text-ink-subtle" } as const;
const AVATAR_TONE = { PENDING: "text-accent", ACCEPTED: "text-ink", REJECTED: "text-negative", CANCELLED: "text-ink-subtle" } as const;

export interface RequestCardEvents {
  /**
   * La solicitud cambió en el servidor (resuelta o actualizada): hay que recargar listas y
   * contadores. `notice` se muestra también fuera de la tarjeta, porque al recargar una vista
   * filtrada (p. ej. «Pendientes») la tarjeta puede desaparecer.
   */
  onChanged: (notice?: { title: string; message: string }) => void;
  onAccepted: (result: MoneyRequestAccepted, replayed: boolean) => void;
  onResolved: (request: MoneyRequestRead, action: "reject" | "cancel") => void;
  /** El pago quedó sin respuesta segura: se gestiona en el aviso de recuperación de la página. */
  onAcceptUncertain: () => void;
}

/**
 * Tarjeta de solicitud del frame 04 con sus acciones según el papel:
 * pagador + pendiente → «Aceptar y transferir» y «Rechazar»; solicitante + pendiente → «Cancelar
 * solicitud»; estados finales → sin acciones.
 */
export function RequestCard({
  request,
  accountId,
  paymentPending,
  events,
}: {
  request: MoneyRequestRead;
  accountId: string;
  /** Hay un pago de esta solicitud sin respuesta confirmada (se recupera arriba). */
  paymentPending: boolean;
  events: RequestCardEvents;
}) {
  const api = useApi();
  const idempotency = useIdempotency();
  const copy = describeRequest(request, accountId);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [notice, setNotice] = useState<{ tone: "danger" | "info"; title: string; body?: string } | null>(null);
  const inFlight = useRef(false);
  const pending = request.status === "PENDING";
  const isPayer = copy.role === "received";
  const amountLabel = pending && isPayer ? "Monto por transferir" : copy.amountLabel;

  /** Tras un error o un resultado incierto: el estado real lo dice GET /money-requests/{id}. */
  async function readCurrent(): Promise<MoneyRequestRead | "missing" | null> {
    try {
      const response = await api.getMoneyRequest(request.id);
      return isMoneyRequestRead(response.data) ? response.data : null;
    } catch (error) {
      return error instanceof ApiError && error.status === 404 ? "missing" : null;
    }
  }

  async function accept() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: "accepting" });
    setNotice(null);
    try {
      const response = await idempotency.run(acceptScope(accountId, request.id), { request_id: request.id }, async (key) => {
        const result = await api.acceptMoneyRequest(request.id, key);
        if (!isMoneyRequestAccepted(result.data)) throw invalidResponse(result.status);
        return result;
      });
      setPhase({ kind: "idle" });
      events.onAccepted(response.data, response.replayed);
    } catch (error) {
      setPhase({ kind: "idle" });
      if (error instanceof ApiError && !error.outcomeUncertain) {
        if (error.status === 409 && error.message === "Saldo insuficiente") {
          setNotice({ tone: "danger", title: "Saldo insuficiente", body: "No se movió dinero y la solicitud sigue pendiente. Recarga saldo e inténtalo de nuevo." });
        } else if (error.status === 409 || error.status === 404) {
          const title = error.status === 404 ? "Solicitud no encontrada" : "La solicitud ya no está pendiente";
          setNotice({ tone: "info", title, body: "Se actualizó la lista con su estado real." });
          events.onChanged({ title, message: "No se movió dinero. Se actualizó la lista con su estado real." });
        } else {
          setNotice({ tone: "danger", title: "No se pagó la solicitud", body: error.message });
        }
      } else {
        events.onAcceptUncertain();
      }
    } finally {
      inFlight.current = false;
    }
  }

  async function resolve(action: "reject" | "cancel") {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: "resolving", action });
    setNotice(null);
    try {
      const response =
        action === "reject" ? await api.rejectMoneyRequest(request.id) : await api.cancelMoneyRequest(request.id);
      if (!isMoneyRequestRead(response.data)) throw invalidResponse(response.status);
      setPhase({ kind: "idle" });
      events.onResolved(response.data, action);
    } catch (error) {
      if (error instanceof ApiError && !error.outcomeUncertain) {
        setPhase({ kind: "idle" });
        if (error.status === 409 || error.status === 404) {
          const title = error.status === 404 ? "Solicitud no encontrada" : "La solicitud ya no está pendiente";
          setNotice({ tone: "info", title, body: "Se actualizó la lista con su estado real." });
          events.onChanged({ title, message: "No se movió dinero. Se actualizó la lista con su estado real." });
        } else {
          setNotice({ tone: "danger", title: "No se pudo completar la acción", body: error.message });
        }
      } else {
        await check(action);
      }
    } finally {
      inFlight.current = false;
    }
  }

  /** Sin reintento automático: solo se consulta el estado real. */
  async function check(action: "reject" | "cancel") {
    setPhase({ kind: "checking", action });
    const current = await readCurrent();
    const target = action === "reject" ? "REJECTED" : "CANCELLED";
    if (current === null) {
      setPhase({ kind: "unknown", action });
      return;
    }
    setPhase({ kind: "idle" });
    if (current === "missing") {
      setNotice({ tone: "info", title: "Solicitud no encontrada", body: "Se actualizó la lista." });
      events.onChanged({ title: "Solicitud no encontrada", message: "Se actualizó la lista." });
    } else if (current.status === target) {
      events.onResolved(current, action);
    } else if (current.status === "PENDING") {
      setNotice({
        tone: "danger",
        title: "La acción no se completó",
        body: "Comprobamos que la solicitud sigue pendiente. Puedes intentarlo de nuevo.",
      });
    } else {
      setNotice({ tone: "info", title: "La solicitud ya no está pendiente", body: "Se actualizó la lista con su estado real." });
      events.onChanged({ title: "La solicitud ya no está pendiente", message: "Se actualizó la lista con su estado real." });
    }
  }

  const busy = phase.kind === "accepting" || phase.kind === "resolving" || phase.kind === "checking";

  return (
    <article
      aria-label={`Solicitud ${copy.roleTag.toLowerCase()} ${copy.counterparty.owner_name}`}
      className={`flex flex-col gap-6 rounded-card border border-line bg-surface p-6 shadow-soft sm:p-[29px] ${
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
            className={`flex size-12 shrink-0 items-center justify-center rounded-pill border border-line-strong bg-surface-sunken text-body font-bold ${AVATAR_TONE[request.status]}`}
          >
            {initials(copy.counterparty.owner_name)}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="text-[17px] leading-[25.5px] font-bold break-words text-ink">{copy.counterparty.owner_name}</h3>
              <span className="rounded-[10px] bg-surface-sunken px-2 py-0.5 text-overline font-semibold text-ink-muted">
                {isPayer ? "Solicitante" : "Pagador"}
              </span>
            </div>
            <p className="font-mono text-caption break-all text-ink-muted">UUID: {copy.counterparty.account_id}</p>
          </div>
        </div>

        <div className="flex flex-col gap-[3px] rounded-control border border-line bg-surface-sunken px-[15px] pt-[14px] pb-[15px]">
          <p className="text-overline font-bold tracking-[0.55px] text-ink-muted uppercase">Concepto</p>
          <p className="text-body-sm break-words text-ink">{request.description ?? "Sin concepto"}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">{amountLabel}</p>
          <p className="whitespace-nowrap">
            <span className={`text-[24px] leading-[36px] font-extrabold ${AMOUNT_TONE[copy.amountTone]}`}>
              {copy.amountSign}
              {formatCop(request.amount)}{" "}
            </span>
            <span className="text-body font-semibold text-ink-muted">COP</span>
          </p>
        </div>
      </div>

      {notice !== null &&
        (notice.tone === "danger" ? (
          <DangerNotice role="alert" title={notice.title}>
            {notice.body}
          </DangerNotice>
        ) : (
          <div role="status" className="rounded-card border border-line-strong bg-surface-sunken p-[15px]">
            <p className="text-body-sm font-bold text-ink">{notice.title}</p>
            {notice.body !== undefined && <p className="text-caption text-ink-muted">{notice.body}</p>}
          </div>
        ))}

      {(phase.kind === "confirmAccept" || phase.kind === "accepting") && (
        <div className="flex flex-col gap-4 border-t border-line pt-[17px]">
          <DangerNotice title="Aceptar transfiere fondos simulados">
            Se enviarán {formatCop(request.amount)} COP desde tu saldo a {request.requester.owner_name}. Una vez
            confirmada, la transferencia no se puede deshacer desde la interfaz.
          </DangerNotice>
          <ConfirmPanel
            rows={
              <>
                <SummaryRow label="Solicitante">
                  <span className="text-body-sm">{request.requester.owner_name}</span>
                  <span className="block font-mono text-caption break-all text-ink-muted">{request.requester.account_id}</span>
                </SummaryRow>
                <SummaryRow label="Monto solicitado" strong>
                  {formatCop(request.amount)} COP
                </SummaryRow>
              </>
            }
            balanceDelta={-request.amount}
            submitting={phase.kind === "accepting"}
            confirmLabel="Confirmar pago"
            busyLabel="Procesando pago…"
            onEdit={() => {
              setPhase({ kind: "idle" });
            }}
            onConfirm={() => void accept()}
          />
        </div>
      )}

      {(phase.kind === "confirmReject" || phase.kind === "confirmCancel" || phase.kind === "resolving") && (
        <ResolveConfirm
          action={phase.kind === "confirmReject" ? "reject" : phase.kind === "confirmCancel" ? "cancel" : phase.action}
          busy={phase.kind === "resolving"}
          request={request}
          onBack={() => {
            setPhase({ kind: "idle" });
          }}
          onConfirm={(action) => void resolve(action)}
        />
      )}

      {phase.kind === "checking" && (
        <p role="status" className="border-t border-line pt-[17px] text-caption text-ink-muted">
          No recibimos respuesta del servidor. Consultando el estado real de la solicitud…
        </p>
      )}

      {phase.kind === "unknown" && (
        <DangerNotice role="alert" title="No sabemos si la acción se completó">
          No recibimos respuesta y tampoco pudimos consultar la solicitud. No se reintentó nada.
          <span className="mt-3 block">
            <SecondaryButton type="button" onClick={() => void check(phase.action)}>
              Comprobar estado
            </SecondaryButton>
          </span>
        </DangerNotice>
      )}

      {phase.kind === "idle" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-[17px]">
          {pending && paymentPending ? (
            <p className="text-caption text-pending-text">Pago sin confirmar: resuélvelo en el aviso de arriba.</p>
          ) : pending && isPayer ? (
            <div className="flex w-full flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setNotice(null);
                  setPhase({ kind: "confirmAccept" });
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-3 text-body-sm font-bold text-on-accent shadow-[0_2px_6px_rgb(199_255_88/0.12)] transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <Icon src={checkCircle18Icon} size={18} />
                Aceptar y transferir
              </button>
              <SecondaryButton
                type="button"
                onClick={() => {
                  setNotice(null);
                  setPhase({ kind: "confirmReject" });
                }}
              >
                Rechazar
              </SecondaryButton>
            </div>
          ) : pending ? (
            <>
              <p className="text-caption text-ink-muted">{copy.footer}</p>
              <SecondaryButton
                type="button"
                onClick={() => {
                  setNotice(null);
                  setPhase({ kind: "confirmCancel" });
                }}
              >
                Cancelar solicitud
              </SecondaryButton>
            </>
          ) : (
            <>
              <p
                className={`flex min-w-0 items-center gap-1.5 text-caption ${
                  request.status === "ACCEPTED"
                    ? "font-semibold text-accent"
                    : request.status === "REJECTED"
                      ? "text-negative"
                      : "text-ink-muted"
                }`}
              >
                {request.status === "ACCEPTED" && <Icon src={checkCircleIcon} size={16} />}
                {request.status === "REJECTED" && <Icon src={xCircleIcon} size={16} />}
                <span>{copy.footer}</span>
              </p>
              <p className="shrink-0 font-mono text-caption text-ink-subtle" title={request.id}>
                ID: {request.id.slice(0, 8)}
              </p>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function ResolveConfirm({
  action,
  busy,
  request,
  onBack,
  onConfirm,
}: {
  action: "reject" | "cancel";
  busy: boolean;
  request: MoneyRequestRead;
  onBack: () => void;
  onConfirm: (action: "reject" | "cancel") => void;
}) {
  const reject = action === "reject";
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-[17px]">
      <div className="flex flex-col gap-1 rounded-card border border-danger-soft-border bg-surface-sunken p-[17px]">
        <p className="text-body-sm font-bold text-rejected-text">
          {reject ? "¿Rechazar esta solicitud?" : "¿Cancelar esta solicitud?"}
        </p>
        <p className="text-caption text-ink-muted">
          {reject
            ? `${request.requester.owner_name} verá que la rechazaste. No se moverá dinero y no se podrá deshacer.`
            : `${request.payer.owner_name} ya no podrá pagarla. No se moverá dinero y no se podrá deshacer.`}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <SecondaryButton type="button" onClick={onBack} disabled={busy}>
          Volver
        </SecondaryButton>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            onConfirm(action);
          }}
          className="flex flex-1 items-center justify-center rounded-control border border-rejected-border bg-rejected-bg px-4 py-3 text-body-sm font-bold text-rejected-text transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Procesando…" : reject ? "Sí, rechazar" : "Sí, cancelar solicitud"}
        </button>
      </div>
    </div>
  );
}
