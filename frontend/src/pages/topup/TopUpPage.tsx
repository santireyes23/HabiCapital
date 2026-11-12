import { useCallback, useRef, useState, type ReactNode, type SubmitEvent } from "react";

import { useApi, useIdempotency } from "../../api/ApiContext";
import { ApiError } from "../../api/errors";
import { PendingOperationConflictError } from "../../api/idempotency";
import type { DepositRead } from "../../api/types";
import { Icon } from "../../components/Icon";
import {
  cardOffIcon,
  cardPlusIcon,
  checkCircleIcon,
  cube18Icon,
  cube20Icon,
  questionIcon,
  swapIcon,
} from "../../components/icons";
import { BalanceCard, HeaderPill, PageHeader } from "../../components/PageHeader";
import { Toast } from "../../components/Toast";
import {
  ConfirmDiscardPanel,
  ConfirmPanel,
  DiscardedPanel,
  SecondaryLink,
  SummaryRow,
  UncertainPanel,
} from "../../components/operation";
import { DangerNotice, FieldError, PrimaryButton } from "../../components/ui";
import { formatDateTime } from "../../lib/dates";
import { AMOUNT_ERROR_MESSAGES, formatCop, parseCopInput } from "../../lib/money";
import { useActiveAccount, useSession } from "../../session/SessionProvider";
import {
  depositPayload,
  depositScope,
  invalidDepositResponse,
  isDepositRead,
  pendingAmount,
  QUICK_AMOUNTS,
} from "./deposit";

type Step =
  | { kind: "form" }
  | { kind: "confirm"; amount: number }
  | { kind: "submitting"; amount: number }
  | { kind: "success"; result: DepositRead; replayed: boolean }
  /** Sin respuesta segura del servidor: la operación sigue pendiente con su misma clave. */
  | { kind: "uncertain"; amount: number; detail: string }
  /** Al abrir la pantalla había una recarga pendiente (p. ej. tras recargar la página). */
  | { kind: "recovery"; amount: number | null }
  | { kind: "confirmDiscard"; amount: number | null; previous: Step }
  | { kind: "discarded" };

/** «03 — Recargar saldo» (Figma 5:1051): depósito simulado con POST /accounts/me/deposits. */
export function TopUpPage() {
  const api = useApi();
  const idempotency = useIdempotency();
  const account = useActiveAccount();
  const { applyServerBalance, refreshAccount } = useSession();
  const scope = depositScope(account.id);

  const [step, setStep] = useState<Step>(() => {
    const pending = idempotency.pending(scope);
    return pending === null ? { kind: "form" } : { kind: "recovery", amount: pendingAmount(pending) };
  });
  const [amountText, setAmountText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const inFlight = useRef(false);

  const closeToast = useCallback(() => {
    setToast(null);
  }, []);

  async function send(amount: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    setStep({ kind: "submitting", amount });
    setFormError(null);
    try {
      const response = await idempotency.run(scope, depositPayload(amount), async (key) => {
        const result = await api.deposit(depositPayload(amount), key);
        // Un 2xx ilegible es incierto: la operación queda pendiente con la misma clave.
        if (!isDepositRead(result.data)) throw invalidDepositResponse(result.status);
        return result;
      });
      const result = response.data;
      applyServerBalance(account.id, result.balance);
      void refreshAccount().catch(() => undefined);
      setStep({ kind: "success", result, replayed: response.replayed });
      setToast({
        title: response.replayed ? "Esta recarga ya se había aplicado" : "Transacción completada",
        message: `${response.replayed ? "Se confirmó una recarga" : "Se acreditaron"} ${formatCop(result.amount)} COP. Saldo actualizado: ${formatCop(result.balance)} COP.`,
      });
    } catch (error) {
      if (error instanceof PendingOperationConflictError) {
        setStep({ kind: "recovery", amount: pendingAmount(error.pending) });
      } else if (error instanceof ApiError && !error.outcomeUncertain) {
        // Rechazo definitivo: no se aplicó (un 401 ya cerró la sesión).
        setFormError(
          error.kind === "validation"
            ? "El servidor rechazó el monto. Revisa que sea un entero entre $1 y $10.000.000."
            : error.message,
        );
        setAmountText(String(amount));
        setStep({ kind: "form" });
      } else {
        setStep({
          kind: "uncertain",
          amount,
          detail: error instanceof ApiError ? error.message : "Se interrumpió la operación.",
        });
      }
    } finally {
      inFlight.current = false;
    }
  }

  function goToConfirm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseCopInput(amountText);
    if (!parsed.ok) {
      setFieldError(AMOUNT_ERROR_MESSAGES[parsed.error]);
      return;
    }
    setFieldError(null);
    setFormError(null);
    setStep({ kind: "confirm", amount: parsed.value });
  }

  function startOver() {
    setAmountText("");
    setFieldError(null);
    setFormError(null);
    setStep({ kind: "form" });
  }

  const stepLabel =
    step.kind === "form"
      ? "Paso 1 de 2: Definir monto"
      : step.kind === "confirm" || step.kind === "submitting"
        ? "Paso 2 de 2: Confirmar"
        : step.kind === "success"
          ? "Recarga completada"
          : "Recarga sin confirmar";

  return (
    <>
      <PageHeader
        pill={<HeaderPill>Recarga de demostración</HeaderPill>}
        note="Demostración en vivo"
        title="Recargar saldo"
        description="Agrega fondos simulados a tu cuenta HabiCapital para realizar transferencias de prueba."
        aside={<BalanceCard label="Saldo disponible actual" balance={account.balance} />}
      />

      <div className="grid w-full grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <section
          aria-labelledby="topup-title"
          className="flex flex-col gap-6 rounded-card border border-line bg-surface p-6 sm:p-[33px] lg:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-[13px]">
            <h2 id="topup-title" className="flex items-center gap-2.5 text-card-title font-bold text-ink">
              <span className="text-accent">
                <Icon src={cardPlusIcon} size={22} />
              </span>
              Nueva recarga
            </h2>
            <p className="text-caption text-ink-muted">{stepLabel}</p>
          </div>

          {step.kind === "form" && (
            <AmountForm
              amountText={amountText}
              fieldError={fieldError}
              formError={formError}
              onChange={(value) => {
                setAmountText(value);
                setFieldError(null);
              }}
              onSubmit={goToConfirm}
            />
          )}

          {(step.kind === "confirm" || step.kind === "submitting") && (
            <ConfirmStep
              amount={step.amount}
              submitting={step.kind === "submitting"}
              onEdit={() => {
                setAmountText(String(step.amount));
                setStep({ kind: "form" });
              }}
              onConfirm={() => void send(step.amount)}
            />
          )}

          {step.kind === "success" && (
            <SuccessStep result={step.result} replayed={step.replayed} onAnother={startOver} />
          )}

          {(step.kind === "uncertain" || step.kind === "recovery") && (
            <UncertainStep
              amount={step.amount}
              detail={step.kind === "uncertain" ? step.detail : null}
              fromReload={step.kind === "recovery"}
              onRetry={(amount) => void send(amount)}
              onDiscard={() => {
                setStep({ kind: "confirmDiscard", amount: step.amount, previous: step });
              }}
            />
          )}

          {step.kind === "confirmDiscard" && (
            <ConfirmDiscardStep
              amount={step.amount}
              onBack={() => {
                setStep(step.previous);
              }}
              onConfirm={() => {
                idempotency.discard(scope);
                setStep({ kind: "discarded" });
              }}
            />
          )}

          {step.kind === "discarded" && <DiscardedStep onNew={startOver} />}
        </section>

        <GuideCard />
      </div>

      {toast !== null && <Toast title={toast.title} message={toast.message} onClose={closeToast} />}
    </>
  );
}

function AmountForm({
  amountText,
  fieldError,
  formError,
  onChange,
  onSubmit,
}: {
  amountText: string;
  fieldError: string | null;
  formError: string | null;
  onChange: (value: string) => void;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
}) {
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      {formError !== null && (
        <DangerNotice role="alert" title="No se aplicó la recarga">
          {formError}
        </DangerNotice>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="topup-amount"
            className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase"
          >
            Monto en pesos colombianos (COP) <span className="text-accent">*</span>
          </label>
          <p className="text-overline text-ink-muted">Ingresa el monto a simular</p>
        </div>
        <div className="relative">
          <span aria-hidden className="absolute top-1/2 left-4 -translate-y-1/2 text-title font-bold text-ink-subtle">
            $
          </span>
          <input
            id="topup-amount"
            name="amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={amountText}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            placeholder="100000"
            aria-invalid={fieldError !== null}
            aria-describedby={fieldError !== null ? "topup-amount-error" : undefined}
            className={`h-[54px] w-full rounded-control border bg-field pr-16 pl-8 text-card-title font-extrabold text-ink placeholder:text-ink-placeholder focus:ring-1 focus:outline-none ${
              fieldError !== null
                ? "border-negative focus:border-negative focus:ring-negative"
                : "border-line focus:border-accent focus:ring-accent"
            }`}
          />
          <span aria-hidden className="absolute top-1/2 right-4 -translate-y-1/2 text-caption font-bold text-ink-muted">
            COP
          </span>
        </div>
        {fieldError !== null && <FieldError id="topup-amount-error">{fieldError}</FieldError>}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">Montos rápidos de recarga</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_AMOUNTS.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => {
                onChange(String(amount));
              }}
              aria-pressed={amountText === String(amount)}
              className={`rounded-control border bg-field py-[13px] text-body-sm font-bold text-ink transition hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${
                amountText === String(amount) ? "border-accent" : "border-line"
              }`}
            >
              {formatCop(amount)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-card border border-line-strong bg-surface-sunken p-[17px]">
        <span className="pt-0.5 text-accent">
          <Icon src={cube20Icon} size={20} />
        </span>
        <div className="flex flex-col gap-[1.44px]">
          <p className="text-caption font-bold text-ink">Operación con dinero simulado</p>
          <p className="text-overline leading-[17.88px] text-ink-muted">
            Esta recarga aumentará tu saldo virtual de prueba en HabiCapital. No se requiere tarjeta de crédito, PSE
            ni transacción bancaria real.
          </p>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-4 pt-2 sm:flex-row sm:items-center">
        <SecondaryLink to="/">Cancelar</SecondaryLink>
        <PrimaryButton type="submit" className="sm:flex-1">
          Continuar
        </PrimaryButton>
      </div>
    </form>
  );
}

/** Paso 2: el saldo actual se pide al backend al entrar; el estimado es solo informativo. */
function ConfirmStep({
  amount,
  submitting,
  onEdit,
  onConfirm,
}: {
  amount: number;
  submitting: boolean;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmPanel
      rows={
        <SummaryRow label="Monto de la recarga" strong>
          {formatCop(amount)} COP
        </SummaryRow>
      }
      balanceDelta={amount}
      submitting={submitting}
      confirmLabel="Confirmar recarga"
      busyLabel="Procesando recarga…"
      onEdit={onEdit}
      onConfirm={onConfirm}
    />
  );
}

function SuccessStep({ result, replayed, onAnother }: { result: DepositRead; replayed: boolean; onAnother: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-accepted-border bg-accepted-bg text-accent">
          <Icon src={checkCircleIcon} size={24} />
        </span>
        <div>
          <h3 className="text-card-title font-bold text-ink">
            {replayed ? "Esta recarga ya se había aplicado" : "Recarga completada"}
          </h3>
          <p className="text-caption text-ink-muted">
            {replayed
              ? "El servidor reconoció la operación y devolvió su resultado original, sin acreditarla otra vez."
              : "El servidor confirmó la operación."}
          </p>
        </div>
      </div>
      <div className="rounded-card border border-line bg-surface-sunken p-[21px]">
        <SummaryRow label="Monto acreditado" strong>
          +{formatCop(result.amount)} COP
        </SummaryRow>
        <SummaryRow label="Saldo actualizado">{formatCop(result.balance)} COP</SummaryRow>
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
          Hacer otra recarga
        </PrimaryButton>
      </div>
    </div>
  );
}

function UncertainStep({
  amount,
  detail,
  fromReload,
  onRetry,
  onDiscard,
}: {
  amount: number | null;
  detail: string | null;
  fromReload: boolean;
  onRetry: (amount: number) => void;
  onDiscard: () => void;
}) {
  return (
    <UncertainPanel
      title="No sabemos si la recarga se aplicó"
      summary={
        amount === null ? null : (
          <div className="rounded-card border border-line bg-surface-sunken p-[21px]">
            <SummaryRow label="Monto de la recarga pendiente" strong>
              {formatCop(amount)} COP
            </SummaryRow>
          </div>
        )
      }
      blockText="Mientras esta recarga no se resuelva no se puede iniciar otra distinta."
      onRetry={amount === null ? null : () => { onRetry(amount); }}
      onDiscard={onDiscard}
    >
      {fromReload
        ? "Hay una recarga de esta sesión sin respuesta confirmada del servidor. "
        : `${detail ?? ""} El servidor no confirmó el resultado. `}
      Puede que se haya aplicado o no. Si la reintentas, se envía con la misma clave de idempotencia: si ya se
      había aplicado, el servidor devolverá el resultado original sin acreditarla dos veces.
    </UncertainPanel>
  );
}

function ConfirmDiscardStep({
  amount,
  onBack,
  onConfirm,
}: {
  amount: number | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDiscardPanel question="¿Dejar de intentar recuperar esta recarga?" onBack={onBack} onConfirm={onConfirm}>
      Solo se borrará la información guardada en este navegador
      {amount !== null ? ` sobre la recarga de ${formatCop(amount)} COP` : ""}. Esto{" "}
      <strong className="text-ink">no cancela ni revierte</strong> una operación que pudo haberse ejecutado en el
      servidor: si se aplicó, seguirá aplicada. Después no podrás reintentarla con la misma clave. Revisa tus
      movimientos para saber si se aplicó.
    </ConfirmDiscardPanel>
  );
}

function DiscardedStep({ onNew }: { onNew: () => void }) {
  return (
    <DiscardedPanel newLabel="Nueva recarga" onNew={onNew}>
      No se canceló ni se revirtió nada en el servidor. Consulta tus movimientos para comprobar si la recarga
      anterior se aplicó antes de hacer otra.
    </DiscardedPanel>
  );
}

function GuideItem({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="pt-0.5">
        <span className="flex size-8 items-center justify-center rounded-control border border-line-strong bg-surface-sunken text-accent">
          <Icon src={icon} size={18} />
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-body-sm leading-[21.13px] font-bold text-ink">{title}</p>
        <p className="text-body-sm leading-[21.13px] text-ink-muted">{children}</p>
      </div>
    </div>
  );
}

/** Columna derecha del frame 03: «¿Cómo funcionan las recargas?» (textos de Figma). */
function GuideCard() {
  return (
    <aside
      aria-labelledby="topup-guide-title"
      className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6 sm:p-[25px] lg:col-span-5"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line pb-[13px]">
        <h2 id="topup-guide-title" className="flex items-center gap-2 text-title font-bold text-ink">
          <span className="text-accent">
            <Icon src={questionIcon} size={20} />
          </span>
          ¿Cómo funcionan las recargas?
        </h2>
        <p className="text-overline font-bold text-accent uppercase">Guía</p>
      </div>
      <div className="flex flex-col gap-4">
        <GuideItem icon={cube18Icon} title="Depósitos simulados">
          Las recargas son demostraciones educativas de flujo de saldo. No existe dinero fiduciario real involucrado
          en ninguna etapa.
        </GuideItem>
        <GuideItem icon={cardOffIcon} title="Sin métodos de pago bancarios">
          No se solicitan tarjetas de crédito, cuentas bancarias, pasarelas de pago ni transferencias interbancarias
          PSE.
        </GuideItem>
        <GuideItem icon={swapIcon} title="Prueba transferencias y solicitudes">
          El saldo acreditado te permite simular transferencias entre cuentas por UUID y responder solicitudes de
          cobro con datos realistas.
        </GuideItem>
      </div>
    </aside>
  );
}
