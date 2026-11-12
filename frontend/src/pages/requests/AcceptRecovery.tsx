import { useRef, useState } from "react";

import { useApi, useIdempotency } from "../../api/ApiContext";
import { ApiError } from "../../api/errors";
import type { PendingOperation } from "../../api/idempotency";
import type { MoneyRequestAccepted } from "../../api/types";
import { ConfirmDiscardPanel, SummaryRow, UncertainPanel } from "../../components/operation";
import { DangerNotice } from "../../components/ui";
import { invalidResponse, isMoneyRequestAccepted, pendingAcceptId } from "./requests";

/**
 * Pago de una solicitud sin respuesta confirmada (red, timeout, 5xx). Se reintenta a mano con la
 * MISMA clave; si ya se había pagado, el backend devuelve el resultado original sin cobrar dos veces.
 */
export function AcceptRecovery({
  operation,
  onSettled,
  onAccepted,
}: {
  operation: PendingOperation;
  onSettled: () => void;
  onAccepted: (result: MoneyRequestAccepted, replayed: boolean) => void;
}) {
  const api = useApi();
  const idempotency = useIdempotency();
  const requestId = pendingAcceptId(operation);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function retry() {
    if (requestId === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const response = await idempotency.run(operation.scope, { request_id: requestId }, async (key) => {
        const result = await api.acceptMoneyRequest(requestId, key);
        if (!isMoneyRequestAccepted(result.data)) throw invalidResponse(result.status);
        return result;
      });
      onAccepted(response.data, response.replayed);
    } catch (error) {
      if (error instanceof ApiError && !error.outcomeUncertain) {
        // Rechazo definitivo: la operación se cerró; se informa y se recargan las listas.
        setMessage(error.status === 409 && error.message !== "Saldo insuficiente" ? "La solicitud ya no está pendiente: se actualizó la lista." : error.message);
        onSettled();
      } else {
        setMessage(error instanceof ApiError ? `${error.message} El resultado sigue sin confirmar.` : "El resultado sigue sin confirmar.");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (confirmingDiscard) {
    return (
      <ConfirmDiscardPanel
        question="¿Dejar de intentar recuperar este pago?"
        onBack={() => { setConfirmingDiscard(false); }}
        onConfirm={() => {
          idempotency.discard(operation.scope);
          onSettled();
        }}
      >
        Solo se borrará la información guardada en este navegador. Esto <strong className="text-ink">no cancela ni
        revierte</strong> un pago que pudo haberse realizado en el servidor: si se pagó, el dinero ya está en la otra
        cuenta. Revisa la solicitud y tus movimientos para saberlo.
      </ConfirmDiscardPanel>
    );
  }

  return (
    <section aria-label="Pago de solicitud sin confirmar" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 sm:p-[25px]">
      {message !== null && (
        <DangerNotice role="alert" title="Resultado del reintento">
          {message}
        </DangerNotice>
      )}
      <UncertainPanel
        title="No sabemos si se pagó la solicitud"
        summary={
          requestId === null ? null : (
            <div className="rounded-card border border-line bg-surface-sunken p-[21px]">
              <SummaryRow label="Solicitud">
                <span className="font-mono text-body-sm break-all">{requestId}</span>
              </SummaryRow>
            </div>
          )
        }
        blockText={busy ? "Reintentando con la misma clave…" : "Mientras no se resuelva, esta solicitud no se puede pagar de nuevo con otra clave."}
        onRetry={requestId === null || busy ? null : () => void retry()}
        onDiscard={() => { setConfirmingDiscard(true); }}
      >
        Hay un pago de esta sesión sin respuesta confirmada del servidor. Puede que se haya realizado o no. Si lo
        reintentas, se envía con la misma clave de idempotencia: si ya se había pagado, el servidor devolverá el
        resultado original sin cobrarlo dos veces.
      </UncertainPanel>
    </section>
  );
}
