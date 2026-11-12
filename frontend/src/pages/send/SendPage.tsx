import { useCallback, useRef, useState, type ReactNode, type SubmitEvent } from "react";

import { useApi, useIdempotency } from "../../api/ApiContext";
import { ApiError } from "../../api/errors";
import { PendingOperationConflictError } from "../../api/idempotency";
import { DESCRIPTION_MAX_LENGTH, type TransferCreate, type TransferRead } from "../../api/types";
import { Icon } from "../../components/Icon";
import {
  checkCircleIcon,
  cube18Icon,
  fingerprintIcon,
  info20Icon,
  irreversibleIcon,
  piggyIcon,
  questionIcon,
  walletIcon,
} from "../../components/icons";
import {
  ConfirmDiscardPanel,
  ConfirmPanel,
  DiscardedPanel,
  SecondaryLink,
  SummaryRow,
  UncertainPanel,
} from "../../components/operation";
import { BalanceCard, HeaderPill, PageHeader } from "../../components/PageHeader";
import { Toast } from "../../components/Toast";
import { DangerNotice, FieldError, PrimaryButton } from "../../components/ui";
import { shortUuid } from "../../lib/account";
import { readUuidFromClipboard } from "../../lib/clipboard";
import { formatDateTime } from "../../lib/dates";
import { AMOUNT_ERROR_MESSAGES, formatCop, parseCopInput } from "../../lib/money";
import { useActiveAccount, useSession } from "../../session/SessionProvider";
import {
  allBalanceAmount,
  invalidTransferResponse,
  isTransferRead,
  normalizeDescription,
  pendingTransfer,
  SUGGESTED_AMOUNTS,
  transferPayload,
  transferScope,
  validateRecipient,
} from "./transfer";

type Step =
  | { kind: "form" }
  | { kind: "confirm"; payload: TransferCreate }
  | { kind: "submitting"; payload: TransferCreate }
  | { kind: "success"; result: TransferRead; replayed: boolean }
  | { kind: "uncertain"; payload: TransferCreate; detail: string }
  | { kind: "recovery"; payload: TransferCreate | null }
  | { kind: "confirmDiscard"; payload: TransferCreate | null; previous: Step }
  | { kind: "discarded" };

interface FormValues {
  recipient: string;
  amount: string;
  description: string;
}

type FieldErrors = Partial<Record<keyof FormValues, string>>;

const EMPTY_FORM: FormValues = { recipient: "", amount: "", description: "" };

/** Traduce el 422 de validación de FastAPI a errores por campo (sin inventar otros mensajes). */
function fieldErrorsFrom(error: ApiError): FieldErrors {
  const errors: FieldErrors = {};
  for (const item of error.fieldErrors) {
    if (item.field === "to_account_id") errors.recipient = "El servidor no aceptó el UUID de destino.";
    else if (item.field === "amount") errors.amount = "El servidor no aceptó el monto: debe ser un entero entre $1 y $10.000.000.";
    else if (item.field === "description") {
      errors.description = `El servidor no aceptó la descripción (máximo ${DESCRIPTION_MAX_LENGTH} caracteres).`;
    }
  }
  return errors;
}

/** «02 — Enviar dinero» (Figma 4:810): transferencia con POST /accounts/me/transfers. */
export function SendPage() {
  const api = useApi();
  const idempotency = useIdempotency();
  const account = useActiveAccount();
  const { applyServerBalance, refreshAccount } = useSession();
  const scope = transferScope(account.id);

  const [step, setStep] = useState<Step>(() => {
    const pending = idempotency.pending(scope);
    return pending === null ? { kind: "form" } : { kind: "recovery", payload: pendingTransfer(pending) };
  });
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const inFlight = useRef(false);

  const closeToast = useCallback(() => {
    setToast(null);
  }, []);

  function backToForm(payload: TransferCreate) {
    setValues({
      recipient: payload.to_account_id,
      amount: String(payload.amount),
      description: payload.description ?? "",
    });
    setStep({ kind: "form" });
  }

  async function send(payload: TransferCreate) {
    if (inFlight.current) return;
    inFlight.current = true;
    setStep({ kind: "submitting", payload });
    setFormError(null);
    setErrors({});
    try {
      const response = await idempotency.run(scope, payload, async (key) => {
        const result = await api.transfer(payload, key);
        // Un 2xx ilegible es incierto: la operación queda pendiente con la misma clave.
        if (!isTransferRead(result.data)) throw invalidTransferResponse(result.status);
        return result;
      });
      const result = response.data;
      applyServerBalance(account.id, result.balance);
      void refreshAccount().catch(() => undefined);
      setStep({ kind: "success", result, replayed: response.replayed });
      setToast({
        title: response.replayed ? "Esta transferencia ya se había realizado" : "Transacción completada",
        message: `${response.replayed ? "Se confirmó una transferencia de" : "Se transfirieron"} ${formatCop(result.amount)} COP a la cuenta ${shortUuid(result.to_account_id)}. Saldo actualizado: ${formatCop(result.balance)} COP.`,
      });
    } catch (error) {
      if (error instanceof PendingOperationConflictError) {
        setStep({ kind: "recovery", payload: pendingTransfer(error.pending) });
      } else if (error instanceof ApiError && !error.outcomeUncertain) {
        // Rechazo definitivo del servidor: la transferencia no se hizo (un 401 ya cerró la sesión).
        backToForm(payload);
        if (error.status === 404) setErrors({ recipient: error.message });
        else if (error.kind === "validation") {
          const byField = fieldErrorsFrom(error);
          setErrors(byField);
          if (Object.keys(byField).length === 0) setFormError("El servidor rechazó los datos de la transferencia.");
        } else setFormError(error.message);
      } else {
        setStep({
          kind: "uncertain",
          payload,
          detail: error instanceof ApiError ? error.message : "Se interrumpió la operación.",
        });
      }
    } finally {
      inFlight.current = false;
    }
  }

  function review(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: FieldErrors = {};
    const recipientError = validateRecipient(values.recipient, account.id);
    if (recipientError !== null) next.recipient = recipientError;
    const amount = parseCopInput(values.amount);
    if (!amount.ok) next.amount = AMOUNT_ERROR_MESSAGES[amount.error];
    const description = normalizeDescription(values.description);
    if (!description.ok) next.description = description.error;
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0 || !amount.ok || !description.ok) return;
    setStep({ kind: "confirm", payload: transferPayload(values.recipient, amount.value, description.value) });
  }

  function startOver() {
    setValues(EMPTY_FORM);
    setErrors({});
    setFormError(null);
    setStep({ kind: "form" });
  }

  const stepLabel =
    step.kind === "form"
      ? "Paso 1 de 2: Datos"
      : step.kind === "confirm" || step.kind === "submitting"
        ? "Paso 2 de 2: Confirmar"
        : step.kind === "success"
          ? "Transferencia completada"
          : "Transferencia sin confirmar";

  return (
    <>
      <PageHeader
        pill={<HeaderPill>Transferencia entre cuentas</HeaderPill>}
        note="Demostración en vivo"
        title="Enviar dinero simulado"
        description="Transfiere saldo disponible a otra cuenta de HabiCapital ingresando el identificador único (UUID) del destinatario."
        aside={<BalanceCard label="Saldo disponible" balance={account.balance} />}
      />

      <div className="grid w-full grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <section
          aria-labelledby="send-title"
          className="flex flex-col gap-6 rounded-card border border-line bg-surface p-6 sm:p-[33px] lg:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-[13px]">
            <h2 id="send-title" className="flex items-center gap-2.5 text-card-title font-bold text-ink">
              <span className="text-accent">
                <Icon src={walletIcon} size={22} />
              </span>
              Detalles de la transferencia
            </h2>
            <p className="text-caption text-ink-muted">{stepLabel}</p>
          </div>

          {step.kind === "form" && (
            <TransferForm
              values={values}
              errors={errors}
              formError={formError}
              balance={account.balance}
              onChange={(field, value) => {
                setValues((current) => ({ ...current, [field]: value }));
                setErrors((current) => ({ ...current, [field]: undefined }));
              }}
              onSubmit={review}
            />
          )}

          {(step.kind === "confirm" || step.kind === "submitting") && (
            <ConfirmPanel
              rows={<TransferRows payload={step.payload} />}
              balanceDelta={-step.payload.amount}
              submitting={step.kind === "submitting"}
              confirmLabel="Confirmar transferencia"
              busyLabel="Procesando transferencia…"
              onEdit={() => {
                backToForm(step.payload);
              }}
              onConfirm={() => void send(step.payload)}
            />
          )}

          {step.kind === "success" && <SuccessStep result={step.result} replayed={step.replayed} onAnother={startOver} />}

          {(step.kind === "uncertain" || step.kind === "recovery") && (
            <UncertainPanel
              title="No sabemos si la transferencia se realizó"
              summary={
                step.payload === null ? null : (
                  <div className="rounded-card border border-line bg-surface-sunken p-[21px]">
                    <TransferRows payload={step.payload} pending />
                  </div>
                )
              }
              blockText="Mientras esta transferencia no se resuelva no se puede iniciar otra distinta."
              onRetry={
                step.payload === null
                  ? null
                  : () => {
                      if (step.payload !== null) void send(step.payload);
                    }
              }
              onDiscard={() => {
                setStep({ kind: "confirmDiscard", payload: step.payload, previous: step });
              }}
            >
              {step.kind === "recovery"
                ? "Hay una transferencia de esta sesión sin respuesta confirmada del servidor. "
                : `${step.detail} El servidor no confirmó el resultado. `}
              Puede que se haya realizado o no. Si la reintentas, se envía exactamente igual y con la misma clave de
              idempotencia: si ya se había realizado, el servidor devolverá el resultado original sin enviar el
              dinero dos veces.
            </UncertainPanel>
          )}

          {step.kind === "confirmDiscard" && (
            <ConfirmDiscardPanel
              question="¿Dejar de intentar recuperar esta transferencia?"
              onBack={() => {
                setStep(step.previous);
              }}
              onConfirm={() => {
                idempotency.discard(scope);
                setStep({ kind: "discarded" });
              }}
            >
              Solo se borrará la información guardada en este navegador
              {step.payload !== null
                ? ` sobre la transferencia de ${formatCop(step.payload.amount)} COP a ${shortUuid(step.payload.to_account_id)}`
                : ""}
              . Esto <strong className="text-ink">no cancela ni revierte</strong> una transferencia que pudo haberse
              ejecutado en el servidor: si se realizó, el dinero ya está en la otra cuenta. Después no podrás
              reintentarla con la misma clave. Revisa tus movimientos para saber si se realizó.
            </ConfirmDiscardPanel>
          )}

          {step.kind === "discarded" && (
            <DiscardedPanel newLabel="Nueva transferencia" onNew={startOver}>
              No se canceló ni se revirtió nada en el servidor. Consulta tus movimientos para comprobar si la
              transferencia anterior se realizó antes de hacer otra.
            </DiscardedPanel>
          )}
        </section>

        <GuideColumn balance={account.balance} />
      </div>

      {toast !== null && <Toast title={toast.title} message={toast.message} onClose={closeToast} />}
    </>
  );
}

function TransferRows({ payload, pending = false }: { payload: TransferCreate; pending?: boolean }) {
  return (
    <>
      <SummaryRow label={pending ? "Monto pendiente" : "Monto de la transferencia"} strong>
        {formatCop(payload.amount)} COP
      </SummaryRow>
      <SummaryRow label="Cuenta destino">
        <span className="font-mono text-body-sm break-all">{payload.to_account_id}</span>
      </SummaryRow>
      {payload.description !== undefined && payload.description !== null && (
        <SummaryRow label="Descripción">
          <span className="text-body-sm font-medium break-words">{payload.description}</span>
        </SummaryRow>
      )}
    </>
  );
}

function TransferForm({
  values,
  errors,
  formError,
  balance,
  onChange,
  onSubmit,
}: {
  values: FormValues;
  errors: FieldErrors;
  formError: string | null;
  balance: number;
  onChange: (field: keyof FormValues, value: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
}) {
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const parsed = parseCopInput(values.amount);
  const exceedsBalance = parsed.ok && parsed.value > balance;

  async function paste() {
    setPasteMessage(null);
    const result = await readUuidFromClipboard();
    if (result.ok) onChange("recipient", result.value);
    else setPasteMessage(result.message);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError !== null && (
        <DangerNotice role="alert" title="No se realizó la transferencia">
          {formError}
        </DangerNotice>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="send-recipient" className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">
            UUID de la cuenta destino <span className="text-accent">*</span>
          </label>
          <button
            type="button"
            onClick={() => void paste()}
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
            id="send-recipient"
            name="to_account_id"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={values.recipient}
            onChange={(event) => {
              setPasteMessage(null);
              onChange("recipient", event.target.value);
            }}
            placeholder="Ej. 4f9b2d8e-17c3-4d62-a58f-90e8c71b3e21"
            aria-invalid={errors.recipient !== undefined}
            aria-describedby={errors.recipient !== undefined ? "send-recipient-error" : "send-recipient-help"}
            className={`w-full rounded-control border bg-field py-[15px] pr-[17px] pl-[41px] font-mono text-body text-ink placeholder:text-ink-placeholder focus:ring-1 focus:outline-none ${
              errors.recipient !== undefined
                ? "border-negative focus:border-negative focus:ring-negative"
                : "border-line focus:border-accent focus:ring-accent"
            }`}
          />
        </div>
        {errors.recipient !== undefined ? (
          <FieldError id="send-recipient-error">{errors.recipient}</FieldError>
        ) : (
          <p id="send-recipient-help" className="text-overline text-ink-muted">
            Pídele al destinatario su UUID de cuenta que aparece en su sección «Mi cuenta».
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
          <label htmlFor="send-amount" className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">
            Monto en pesos colombianos (COP) <span className="text-accent">*</span>
          </label>
          <p className="text-overline text-ink-muted">Máximo: $10.000.000 COP</p>
        </div>
        <div className="relative">
          <span aria-hidden className="absolute top-1/2 left-4 -translate-y-1/2 text-title font-bold text-ink-subtle">
            $
          </span>
          <input
            id="send-amount"
            name="amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={values.amount}
            onChange={(event) => {
              onChange("amount", event.target.value);
            }}
            placeholder="150000"
            aria-invalid={errors.amount !== undefined}
            aria-describedby={errors.amount !== undefined ? "send-amount-error" : undefined}
            className={`h-[50px] w-full rounded-control border bg-field pr-16 pl-8 text-[17px] font-extrabold text-ink placeholder:text-ink-placeholder focus:ring-1 focus:outline-none ${
              errors.amount !== undefined
                ? "border-negative focus:border-negative focus:ring-negative"
                : "border-line focus:border-accent focus:ring-accent"
            }`}
          />
          <span aria-hidden className="absolute top-1/2 right-4 -translate-y-1/2 text-caption font-bold text-ink-muted">
            COP
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-overline font-semibold text-ink-muted">Sugeridos:</span>
          {SUGGESTED_AMOUNTS.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => {
                onChange("amount", String(amount));
              }}
              aria-pressed={values.amount === String(amount)}
              className={`rounded-[10px] border bg-field px-[11px] py-[5px] text-overline font-bold text-ink-muted transition hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${
                values.amount === String(amount) ? "border-accent" : "border-line"
              }`}
            >
              {formatCop(amount)}
            </button>
          ))}
          <button
            type="button"
            disabled={balance < 1}
            onClick={() => {
              onChange("amount", String(allBalanceAmount(balance)));
            }}
            title={balance < 1 ? "No tienes saldo disponible" : undefined}
            className="rounded-[10px] border border-line bg-field px-[11px] py-[5px] text-overline font-bold text-accent transition hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Todo el saldo
          </button>
        </div>
        {errors.amount !== undefined && <FieldError id="send-amount-error">{errors.amount}</FieldError>}
        {errors.amount === undefined && exceedsBalance && (
          <p className="text-overline text-pending-text">
            Supera tu saldo disponible ({formatCop(balance)} COP): el servidor la rechazará por saldo insuficiente.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="send-description" className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">
            Descripción / motivo <span className="font-normal lowercase">(opcional)</span>
          </label>
          <p className="text-overline text-ink-muted">Máx {DESCRIPTION_MAX_LENGTH} caracteres</p>
        </div>
        <input
          id="send-description"
          name="description"
          type="text"
          autoComplete="off"
          value={values.description}
          onChange={(event) => {
            onChange("description", event.target.value);
          }}
          placeholder="Ej. Cuota almuerzo compartido"
          aria-invalid={errors.description !== undefined}
          aria-describedby={errors.description !== undefined ? "send-description-error" : undefined}
          className={`w-full rounded-control border bg-field px-[17px] pt-[13px] pb-[14px] text-body text-ink placeholder:text-ink-placeholder focus:ring-1 focus:outline-none ${
            errors.description !== undefined
              ? "border-negative focus:border-negative focus:ring-negative"
              : "border-line focus:border-accent focus:ring-accent"
          }`}
        />
        {errors.description !== undefined && <FieldError id="send-description-error">{errors.description}</FieldError>}
      </div>

      <div className="flex flex-col-reverse gap-4 pt-2 sm:flex-row sm:items-center">
        <SecondaryLink to="/">Cancelar</SecondaryLink>
        <PrimaryButton type="submit" className="sm:flex-1">
          Revisar transferencia
        </PrimaryButton>
      </div>
    </form>
  );
}

function SuccessStep({ result, replayed, onAnother }: { result: TransferRead; replayed: boolean; onAnother: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-accepted-border bg-accepted-bg text-accent">
          <Icon src={checkCircleIcon} size={24} />
        </span>
        <div>
          <h3 className="text-card-title font-bold text-ink">
            {replayed ? "Esta transferencia ya se había realizado" : "Transferencia completada"}
          </h3>
          <p className="text-caption text-ink-muted">
            {replayed
              ? "El servidor reconoció la operación y devolvió su resultado original, sin enviar el dinero otra vez."
              : "El servidor confirmó la transferencia."}
          </p>
        </div>
      </div>
      <div className="rounded-card border border-line bg-surface-sunken p-[21px]">
        <SummaryRow label="Monto transferido" strong>
          -{formatCop(result.amount)} COP
        </SummaryRow>
        <SummaryRow label="Cuenta destino">
          <span className="font-mono text-body-sm break-all">{result.to_account_id}</span>
        </SummaryRow>
        <SummaryRow label="Saldo restante">{formatCop(result.balance)} COP</SummaryRow>
        {result.description !== null && (
          <SummaryRow label="Descripción">
            <span className="text-body-sm font-medium break-words">{result.description}</span>
          </SummaryRow>
        )}
        <SummaryRow label="Fecha">{formatDateTime(result.created_at)}</SummaryRow>
        <SummaryRow label="Transacción">
          <span className="font-mono text-body-sm" title={result.transaction_id}>
            {result.transaction_id.slice(0, 8)}
          </span>
        </SummaryRow>
      </div>
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center">
        <SecondaryLink to="/">Volver a Inicio</SecondaryLink>
        <PrimaryButton type="button" onClick={onAnother} className="sm:flex-1">
          Hacer otra transferencia
        </PrimaryButton>
      </div>
    </div>
  );
}

function GuideStep({ number, children }: { number: number; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="pt-0.5">
        <span className="flex size-6 items-center justify-center rounded-pill border border-line-strong bg-surface-sunken text-caption font-bold text-accent">
          {number}
        </span>
      </div>
      <p className="min-w-0 text-body-sm leading-[21.13px] text-ink-muted">{children}</p>
    </div>
  );
}

function ConditionItem({ icon, iconClass, title, children }: { icon: string; iconClass: string; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-control border border-line bg-surface-sunken p-[15px]">
      <span className={`pt-0.5 ${iconClass}`}>
        <Icon src={icon} size={18} />
      </span>
      <div className="flex min-w-0 flex-col gap-[1.5px]">
        <p className="text-caption font-bold text-ink">{title}</p>
        <p className="text-caption text-ink-muted">{children}</p>
      </div>
    </div>
  );
}

/** Columna derecha del frame 02 (sin la tarjeta «Probar respuestas del sistema», decisión de la etapa 0). */
function GuideColumn({ balance }: { balance: number }) {
  return (
    <div className="flex flex-col gap-6 lg:col-span-5">
      <aside aria-labelledby="send-guide-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 sm:p-[25px]">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-[13px]">
          <h2 id="send-guide-title" className="flex items-center gap-2 text-[15px] leading-[22.5px] font-bold text-ink">
            <span className="text-accent">
              <Icon src={questionIcon} size={20} />
            </span>
            Cómo transferir con UUID
          </h2>
          <p className="text-overline font-bold text-accent uppercase">Guía</p>
        </div>
        <div className="flex flex-col gap-3.5">
          <GuideStep number={1}>
            Cada billetera en HabiCapital tiene un <strong className="font-bold text-ink">UUID de cuenta único</strong> que
            sirve como dirección de destino.
          </GuideStep>
          <GuideStep number={2}>
            Solicita el código a tu contraparte: lo encuentra en la sección <strong className="font-bold text-ink">Mi cuenta</strong>{" "}
            de su aplicación.
          </GuideStep>
          <GuideStep number={3}>
            Pega el código completo de 36 caracteres en el campo de destino y especifica el monto en pesos colombianos.
          </GuideStep>
        </div>
      </aside>

      <aside aria-labelledby="send-conditions-title" className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 sm:p-[25px]">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-[13px]">
          <h2 id="send-conditions-title" className="flex items-center gap-2 text-[15px] leading-[22.5px] font-bold text-ink">
            <span className="text-accent">
              <Icon src={info20Icon} size={20} />
            </span>
            Antes de enviar
          </h2>
          <p className="text-overline text-ink-muted">Condiciones</p>
        </div>
        <div className="flex flex-col gap-3">
          <ConditionItem icon={cube18Icon} iconClass="text-accent" title="Operación 100% simulada">
            Los fondos transferidos no corresponden a dinero bancario real ni tienen curso legal fuera de esta plataforma.
          </ConditionItem>
          <ConditionItem icon={piggyIcon} iconClass="text-accent" title="Requiere saldo suficiente">
            Solo puedes transferir montos iguales o menores a tu saldo disponible actual ({formatCop(balance)} COP).
          </ConditionItem>
          <ConditionItem icon={irreversibleIcon} iconClass="text-negative" title="Transferencia irreversible">
            Una vez confirmada, la transferencia se liquida inmediatamente entre cuentas y no puede cancelarse desde la
            interfaz.
          </ConditionItem>
        </div>
      </aside>
    </div>
  );
}
