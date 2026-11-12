import { useRef, useState, type SubmitEvent } from "react";

import { ApiError } from "../../api/errors";
import { OWNER_NAME_MAX_LENGTH } from "../../api/types";
import { Icon } from "../../components/Icon";
import { userIcon } from "../../components/icons";
import { DangerNotice, FieldError, FieldLabel, InfoNotice, PrimaryButton } from "../../components/ui";
import type { CreatedAccount } from "../../session/SessionProvider";

/** Mismo criterio que el backend: se quitan espacios y se exigen 1 a 100 caracteres. */
export function validateOwnerName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return "Ingresa el nombre completo del titular.";
  // Python cuenta caracteres (puntos de código), no unidades UTF-16.
  if (Array.from(name).length > OWNER_NAME_MAX_LENGTH) {
    return `El nombre admite máximo ${OWNER_NAME_MAX_LENGTH} caracteres.`;
  }
  return null;
}

type Failure =
  | { kind: "field"; message: string }
  | { kind: "uncertain" }
  | { kind: "server"; message: string };

function describeFailure(error: unknown): Failure {
  if (error instanceof ApiError) {
    if (error.outcomeUncertain) return { kind: "uncertain" };
    if (error.kind === "validation") {
      return {
        kind: "field",
        message: `El nombre no es válido: debe tener entre 1 y ${OWNER_NAME_MAX_LENGTH} caracteres.`,
      };
    }
    return { kind: "server", message: error.message };
  }
  return { kind: "uncertain" };
}

/**
 * «Crear cuenta» (Figma 07, TAB 1). POST /accounts no es idempotente: se impide el doble envío y
 * nunca se reintenta solo.
 */
export function CreateAccountForm({
  createAccount,
  onCreated,
  onBusyChange,
}: {
  createAccount: (ownerName: string) => Promise<CreatedAccount>;
  onCreated: (created: CreatedAccount) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Bloqueo síncrono: un segundo clic antes de volver a renderizar no envía otra petición.
  const inFlight = useRef(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const invalid = validateOwnerName(name);
    if (invalid !== null) {
      setFailure({ kind: "field", message: invalid });
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    onBusyChange(true);
    setFailure(null);
    try {
      const created = await createAccount(name.trim());
      onCreated(created);
    } catch (error) {
      setFailure(describeFailure(error));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
      onBusyChange(false);
    }
  }

  const fieldError = failure?.kind === "field" ? failure.message : null;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-[3px]">
        <h2 className="text-[20px] leading-[30px] font-bold text-ink">Nueva cuenta HabiCapital</h2>
        <p className="text-body-sm text-ink-muted">
          Genera un identificador único de cuenta y tu clave Bearer de acceso.
        </p>
      </div>

      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="owner-name" required>
            Nombre completo del titular
          </FieldLabel>
          <div className="relative">
            <span className="absolute top-3 left-3.5 text-ink-subtle">
              <Icon src={userIcon} size={20} />
            </span>
            <input
              id="owner-name"
              name="owner_name"
              type="text"
              autoComplete="name"
              maxLength={OWNER_NAME_MAX_LENGTH * 2}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (failure?.kind === "field") setFailure(null);
              }}
              disabled={submitting}
              aria-invalid={fieldError !== null}
              aria-describedby={fieldError !== null ? "owner-name-error" : "owner-name-help"}
              placeholder="Ej. Camilo Aristizábal"
              className={`w-full rounded-control border bg-field py-[13px] pr-[17px] pl-[41px] text-body text-ink placeholder:text-ink-placeholder focus:outline-none focus:ring-1 disabled:opacity-60 ${
                fieldError !== null
                  ? "border-negative focus:border-negative focus:ring-negative"
                  : "border-line focus:border-accent focus:ring-accent"
              }`}
            />
          </div>
          {fieldError !== null ? (
            <FieldError id="owner-name-error">{fieldError}</FieldError>
          ) : (
            <p id="owner-name-help" className="text-overline text-ink-muted">
              Identifica tu cuenta frente a otros usuarios para transferencias.
            </p>
          )}
        </div>

        <div className="pt-2">
          <PrimaryButton type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? "Creando cuenta…" : "Crear mi cuenta"}
          </PrimaryButton>
        </div>
      </form>

      {failure?.kind === "uncertain" && (
        <DangerNotice role="alert" title="No pudimos confirmar si la cuenta se creó">
          Se perdió la conexión con el servidor antes de recibir su respuesta. Si vuelves a intentarlo
          podría crearse otra cuenta distinta. No se guardó ningún token en este navegador.
        </DangerNotice>
      )}
      {failure?.kind === "server" && (
        <DangerNotice role="alert" title="No se pudo crear la cuenta">
          {failure.message}
        </DangerNotice>
      )}

      <InfoNotice>
        Al crear tu cuenta se generará un UUID relacional y un token Bearer único. No se solicitan
        correos electrónicos ni contraseñas.
      </InfoNotice>
    </div>
  );
}
