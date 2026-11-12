import { useRef, useState, type SubmitEvent } from "react";

import { useApi, useIdempotency } from "../../api/ApiContext";
import { ApiError } from "../../api/errors";
import { PendingOperationConflictError } from "../../api/idempotency";
import { DESCRIPTION_MAX_LENGTH, type MoneyRequestCreate, type MoneyRequestRead } from "../../api/types";
import { Icon } from "../../components/Icon";
import { checkCircleIcon, fingerprintIcon, plusCircle20Icon } from "../../components/icons";
import { ConfirmDiscardPanel, DiscardedPanel, SummaryRow, UncertainPanel } from "../../components/operation";
import { DangerNotice, FieldError, PrimaryButton, SecondaryButton } from "../../components/ui";
import { shortUuid } from "../../lib/account";
import { readUuidFromClipboard } from "../../lib/clipboard";
import { AMOUNT_ERROR_MESSAGES, formatCop, parseCopInput } from "../../lib/money";
import { normalizeDescription } from "../send/transfer";
import { createPayload, createScope, invalidResponse, isMoneyRequestRead, pendingCreate, validatePayer } from "./requests";

type Step =
  | { kind: "form" }
  | { kind: "confirm"; payload: MoneyRequestCreate }
  | { kind: "submitting"; payload: MoneyRequestCreate }
  | { kind: "success"; request: MoneyRequestRead; replayed: boolean }
  | { kind: "uncertain"; payload: MoneyRequestCreate; detail: string }
  | { kind: "recovery"; payload: MoneyRequestCreate | null }
  | { kind: "confirmDiscard"; payload: MoneyRequestCreate | null; previous: Step }
  | { kind: "discarded" };

interface Values {
  payer: string;
  amount: string;
  description: string;
}
type Errors = Partial<Record<keyof Values, string | undefined>>;
const EMPTY: Values = { payer: "", amount: "", description: "" };

/**
 * «Nueva solicitud»: POST /money-requests con Idempotency-Key. No mueve dinero; solo crea una
 * solicitud PENDIENTE que la otra cuenta puede aceptar o rechazar.
 */
export function NewRequestPanel({
  accountId,
  onClose,
  onCreated,
  onShowSent,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: (request: MoneyRequestRead, replayed: boolean) => void;
  onShowSent: () => void;
}) {
  const api = useApi();
  const idempotency = useIdempotency();
  const scope = createScope(accountId);
  const [step, setStep] = useState<Step>(() => {
    const pending = idempotency.pending(scope);
    return pending === null ? { kind: "form" } : { kind: "recovery", payload: pendingCreate(pending) };
  });
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  function backToForm(payload: MoneyRequestCreate) {
    setValues({ payer: payload.payer_account_id, amount: String(payload.amount), description: payload.description ?? "" });
    setStep({ kind: "form" });
  }

  async function send(payload: MoneyRequestCreate) {
    if (inFlight.current) return;
    inFlight.current = true;
    setStep({ kind: "submitting", payload });
    setErrors({});
    setFormError(null);
    try {
      const response = await idempotency.run(scope, payload, async (key) => {
        const result = await api.createMoneyRequest(payload, key);
        if (!isMoneyRequestRead(result.data)) throw invalidResponse(result.status);
        return result;
      });
      setStep({ kind: "success", request: response.data, replayed: response.replayed });
      onCreated(response.data, response.replayed);
    } catch (error) {
      if (error instanceof PendingOperationConflictError) {
        setStep({ kind: "recovery", payload: pendingCreate(error.pending) });
      } else if (error instanceof ApiError && !error.outcomeUncertain) {
        backToForm(payload);
        if (error.status === 404) setErrors({ payer: error.message });
        else if (error.kind === "validation") {
          const next: Errors = {};
          for (const item of error.fieldErrors) {
            if (item.field === "payer_account_id") next.payer = "El servidor no aceptó el UUID de la cuenta que pagará.";
            if (item.field === "amount") next.amount = "El servidor no aceptó el monto: debe ser un entero entre $1 y $10.000.000.";
            if (item.field === "description") next.description = `El servidor no aceptó el concepto (máximo ${DESCRIPTION_MAX_LENGTH} caracteres).`;
          }
          setErrors(next);
          if (Object.keys(next).length === 0) setFormError("El servidor rechazó los datos de la solicitud.");
        } else setFormError(error.message);
      } else {
        setStep({ kind: "uncertain", payload, detail: error instanceof ApiError ? error.message : "Se interrumpió la operación." });
      }
    } finally {
      inFlight.current = false;
    }
  }

  function review(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Errors = {};
    const payerError = validatePayer(values.payer, accountId);
    if (payerError !== null) next.payer = payerError;
    const amount = parseCopInput(values.amount);
    if (!amount.ok) next.amount = AMOUNT_ERROR_MESSAGES[amount.error];
    const description = normalizeDescription(values.description);
    if (!description.ok) next.description = description.error.replace("descripción", "concepto");
    setErrors(next);
    setFormError(null);
    if (!amount.ok || !description.ok || Object.keys(next).length > 0) return;
    setStep({ kind: "confirm", payload: createPayload(values.payer, amount.value, description.value) });
  }

  function reset() {
    setValues(EMPTY);
    setErrors({});
    setFormError(null);
    setStep({ kind: "form" });
  }

  const field = (name: keyof Values) =>
    `w-full rounded-control border bg-field text-body text-ink placeholder:text-ink-placeholder focus:ring-1 focus:outline-none ${
      errors[name] !== undefined ? "border-negative focus:border-negative focus:ring-negative" : "border-line focus:border-accent focus:ring-accent"
    }`;

  const rows = (payload: MoneyRequestCreate, pending = false) => (
    <>
      <SummaryRow label={pending ? "Monto pendiente" : "Monto a solicitar"} strong>
        {formatCop(payload.amount)} COP
      </SummaryRow>
      <SummaryRow label="Cuenta que pagará">
        <span className="font-mono text-body-sm break-all">{payload.payer_account_id}</span>
      </SummaryRow>
      {payload.description !== undefined && payload.description !== null && (
        <SummaryRow label="Concepto">
          <span className="text-body-sm font-medium break-words">{payload.description}</span>
        </SummaryRow>
      )}
    </>
  );

  return (
    <section aria-labelledby="new-request-title" className="flex w-full flex-col gap-6 rounded-card border border-line bg-surface p-6 sm:p-[33px]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-[13px]">
        <h2 id="new-request-title" className="flex items-center gap-2.5 text-card-title font-bold text-ink">
          <span className="text-accent">
            <Icon src={plusCircle20Icon} size={20} />
          </span>
          Nueva solicitud
        </h2>
        <p className="text-caption text-ink-muted">
          {step.kind === "form" ? "Paso 1 de 2: Datos" : step.kind === "confirm" || step.kind === "submitting" ? "Paso 2 de 2: Confirmar" : step.kind === "success" ? "Solicitud creada" : "Solicitud sin confirmar"}
        </p>
      </div>

      {step.kind === "form" && (
        <form noValidate onSubmit={review} className="flex flex-col gap-5">
          {formError !== null && (
            <DangerNotice role="alert" title="No se creó la solicitud">
              {formError}
            </DangerNotice>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="request-payer" className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">
                UUID de la cuenta que pagará <span className="text-accent">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setPasteMessage(null);
                  void readUuidFromClipboard().then((result) => {
                    if (result.ok) {
                      setValues((current) => ({ ...current, payer: result.value }));
                      setErrors((current) => ({ ...current, payer: undefined }));
                    } else setPasteMessage(result.message);
                  });
                }}
                className="text-overline font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Pegar
              </button>
            </div>
            <div className="relative">
              <span className="absolute top-3 left-3.5 text-ink-subtle">
                <Icon src={fingerprintIcon} size={20} />
              </span>
              <input
                id="request-payer"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={values.payer}
                onChange={(event) => {
                  setPasteMessage(null);
                  setValues((current) => ({ ...current, payer: event.target.value }));
                  setErrors((current) => ({ ...current, payer: undefined }));
                }}
                placeholder="UUID de la otra cuenta"
                aria-invalid={errors.payer !== undefined}
                aria-describedby={errors.payer !== undefined ? "request-payer-error" : "request-payer-help"}
                className={`${field("payer")} py-[15px] pr-[17px] pl-[41px] font-mono`}
              />
            </div>
            {errors.payer !== undefined ? (
              <FieldError id="request-payer-error">{errors.payer}</FieldError>
            ) : (
              <p id="request-payer-help" className="text-overline text-ink-muted">
                Pídele a la otra persona su UUID de cuenta: lo encuentra en «Mi cuenta».
              </p>
            )}
            {pasteMessage !== null && (
              <p role="status" className="text-overline text-ink-muted">
                {pasteMessage}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="request-amount" className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">
                Monto en pesos colombianos (COP) <span className="text-accent">*</span>
              </label>
              <p className="text-overline text-ink-muted">Máximo: $10.000.000 COP</p>
            </div>
            <div className="relative">
              <span aria-hidden className="absolute top-1/2 left-4 -translate-y-1/2 text-title font-bold text-ink-subtle">
                $
              </span>
              <input
                id="request-amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={values.amount}
                onChange={(event) => {
                  setValues((current) => ({ ...current, amount: event.target.value }));
                  setErrors((current) => ({ ...current, amount: undefined }));
                }}
                placeholder="42500"
                aria-invalid={errors.amount !== undefined}
                aria-describedby={errors.amount !== undefined ? "request-amount-error" : undefined}
                className={`${field("amount")} h-[50px] pr-16 pl-8 text-[17px] font-extrabold`}
              />
              <span aria-hidden className="absolute top-1/2 right-4 -translate-y-1/2 text-caption font-bold text-ink-muted">
                COP
              </span>
            </div>
            {errors.amount !== undefined && <FieldError id="request-amount-error">{errors.amount}</FieldError>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="request-description" className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">
                Concepto <span className="font-normal lowercase">(opcional)</span>
              </label>
              <p className="text-overline text-ink-muted">Máx {DESCRIPTION_MAX_LENGTH} caracteres</p>
            </div>
            <input
              id="request-description"
              type="text"
              autoComplete="off"
              value={values.description}
              onChange={(event) => {
                setValues((current) => ({ ...current, description: event.target.value }));
                setErrors((current) => ({ ...current, description: undefined }));
              }}
              placeholder="Ej. Almuerzo compartido"
              aria-invalid={errors.description !== undefined}
              aria-describedby={errors.description !== undefined ? "request-description-error" : undefined}
              className={`${field("description")} px-[17px] pt-[13px] pb-[14px]`}
            />
            {errors.description !== undefined && <FieldError id="request-description-error">{errors.description}</FieldError>}
          </div>

          <p className="text-caption text-ink-muted">Crear la solicitud no mueve dinero: solo se cobra si la otra cuenta la acepta.</p>

          <div className="flex flex-col-reverse gap-4 pt-2 sm:flex-row sm:items-center">
            <SecondaryButton type="button" onClick={onClose}>
              Cerrar
            </SecondaryButton>
            <PrimaryButton type="submit" className="sm:flex-1">
              Revisar solicitud
            </PrimaryButton>
          </div>
        </form>
      )}

      {(step.kind === "confirm" || step.kind === "submitting") && (
        <div className="flex flex-col gap-6">
          <div className="rounded-card border border-line bg-surface-sunken p-[21px]">{rows(step.payload)}</div>
          <p className="text-caption text-ink-muted">
            Crear la solicitud no mueve dinero. La otra cuenta verá su nombre y tu solicitud, y podrá aceptarla o
            rechazarla.
          </p>
          <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center">
            <SecondaryButton type="button" disabled={step.kind === "submitting"} onClick={() => { backToForm(step.payload); }}>
              Editar
            </SecondaryButton>
            <PrimaryButton
              type="button"
              disabled={step.kind === "submitting"}
              aria-busy={step.kind === "submitting"}
              onClick={() => void send(step.payload)}
              className="sm:flex-1"
            >
              {step.kind === "submitting" ? "Creando solicitud…" : "Confirmar solicitud"}
            </PrimaryButton>
          </div>
        </div>
      )}

      {step.kind === "success" && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-accepted-border bg-accepted-bg text-accent">
              <Icon src={checkCircleIcon} size={24} />
            </span>
            <div>
              <h3 className="text-card-title font-bold text-ink">
                {step.replayed ? "Esta solicitud ya se había creado" : "Solicitud creada"}
              </h3>
              <p className="text-caption text-ink-muted">No se movió dinero: queda pendiente hasta que la otra cuenta responda.</p>
            </div>
          </div>
          <div className="rounded-card border border-line bg-surface-sunken p-[21px]">
            <SummaryRow label="Monto solicitado" strong>
              {formatCop(step.request.amount)} COP
            </SummaryRow>
            <SummaryRow label="Le pediste a">
              <span className="text-body-sm">{step.request.payer.owner_name}</span>
              <span className="block font-mono text-caption text-ink-muted">{shortUuid(step.request.payer.account_id)}</span>
            </SummaryRow>
            {step.request.description !== null && (
              <SummaryRow label="Concepto">
                <span className="text-body-sm font-medium">{step.request.description}</span>
              </SummaryRow>
            )}
            <SummaryRow label="Estado">Pendiente</SummaryRow>
          </div>
          <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center">
            <SecondaryButton type="button" onClick={onShowSent}>
              Ver solicitudes enviadas
            </SecondaryButton>
            <PrimaryButton type="button" onClick={reset} className="sm:flex-1">
              Crear otra solicitud
            </PrimaryButton>
          </div>
        </div>
      )}

      {(step.kind === "uncertain" || step.kind === "recovery") && (
        <UncertainPanel
          title="No sabemos si la solicitud se creó"
          summary={step.payload === null ? null : <div className="rounded-card border border-line bg-surface-sunken p-[21px]">{rows(step.payload, true)}</div>}
          blockText="Mientras esta solicitud no se resuelva no se puede crear otra distinta."
          onRetry={step.payload === null ? null : () => { if (step.payload !== null) void send(step.payload); }}
          onDiscard={() => {
            setStep({ kind: "confirmDiscard", payload: step.payload, previous: step });
          }}
        >
          {step.kind === "recovery"
            ? "Hay una solicitud de esta sesión sin respuesta confirmada del servidor. "
            : `${step.detail} El servidor no confirmó el resultado. `}
          Si la reintentas, se envía igual y con la misma clave de idempotencia: si ya se había creado, el servidor
          devolverá la misma solicitud sin duplicarla. Crear una solicitud no mueve dinero.
        </UncertainPanel>
      )}

      {step.kind === "confirmDiscard" && (
        <ConfirmDiscardPanel
          question="¿Dejar de intentar recuperar esta solicitud?"
          onBack={() => { setStep(step.previous); }}
          onConfirm={() => {
            idempotency.discard(scope);
            setStep({ kind: "discarded" });
          }}
        >
          Solo se borrará la información guardada en este navegador. Esto{" "}
          <strong className="text-ink">no cancela ni revierte</strong> una solicitud que pudo haberse creado en el
          servidor: si se creó, seguirá pendiente y podrás cancelarla desde «Enviadas».
        </ConfirmDiscardPanel>
      )}

      {step.kind === "discarded" && (
        <DiscardedPanel newLabel="Nueva solicitud" onNew={reset} link={{ to: "/solicitudes?rol=enviadas&estado=todas&pagina=1", label: "Ver solicitudes enviadas" }}>
          No se canceló nada en el servidor. Revisa tus solicitudes enviadas antes de crear otra igual.
        </DiscardedPanel>
      )}
    </section>
  );
}
