import { useRef, useState, type SubmitEvent } from "react";

import { ApiError } from "../../api/errors";
import { Icon } from "../../components/Icon";
import { keyIcon, shieldCheckIcon } from "../../components/icons";
import { FieldError, FieldLabel, InfoNotice, PrimaryButton } from "../../components/ui";
import { isPlausibleToken } from "../../session/tokenStore";

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isUnauthorized) {
      return "El servidor no reconoció este token. Verifica que lo copiaste completo; si lo regeneraste, usa el más reciente.";
    }
    if (error.outcomeUncertain) {
      return "No se pudo conectar con el servidor para validar el token. No se guardó nada; puedes reintentar.";
    }
    return error.message;
  }
  return "No se pudo validar el token. Puedes reintentar.";
}

/**
 * «Ya tengo cuenta» (estado de Stitch). El token solo se guarda si GET /accounts/me responde 200.
 * No hay prefijos válidos ni tokens de ejemplo: el único juez es el backend.
 */
export function LoginForm({
  login,
  onLoggedIn,
}: {
  login: (token: string) => Promise<unknown>;
  onLoggedIn: () => void;
}) {
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const candidate = token.trim();
    if (candidate === "") {
      setError("Pega tu token Bearer de acceso.");
      return;
    }
    if (!isPlausibleToken(candidate)) {
      setError("El token tiene espacios o caracteres no válidos. Cópialo de nuevo sin modificarlo.");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await login(candidate);
      setToken("");
      onLoggedIn();
    } catch (failure) {
      setError(messageFor(failure));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-[3px]">
        <h2 className="text-[20px] leading-[30px] font-bold text-ink">Acceder con Bearer Token</h2>
        <p className="text-body-sm text-ink-muted">Pega el token secreto generado al crear tu cuenta.</p>
      </div>

      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="access-token" required>
            Bearer token de acceso
          </FieldLabel>
          <div className="relative">
            <span className="absolute top-3.5 left-3.5 text-ink-subtle">
              <Icon src={keyIcon} size={18} />
            </span>
            <input
              id="access-token"
              name="access-token"
              type={visible ? "text" : "password"}
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setError(null);
              }}
              disabled={submitting}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? "access-token-error" : undefined}
              placeholder="Pega aquí tu token"
              className={`w-full rounded-control border bg-field py-[13px] pr-[92px] pl-[41px] font-mono text-body text-ink placeholder:font-sans placeholder:text-ink-placeholder focus:outline-none focus:ring-1 disabled:opacity-60 ${
                error !== null
                  ? "border-negative focus:border-negative focus:ring-negative"
                  : "border-line focus:border-accent focus:ring-accent"
              }`}
            />
            <button
              type="button"
              onClick={() => {
                setVisible((value) => !value);
              }}
              aria-pressed={visible}
              aria-controls="access-token"
              className="absolute top-2 right-2 rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-overline font-bold text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              {visible ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {error !== null && <FieldError id="access-token-error">{error}</FieldError>}
        </div>

        <div className="pt-2">
          <PrimaryButton type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? "Verificando token…" : "Acceder a mi cuenta"}
          </PrimaryButton>
        </div>
      </form>

      <InfoNotice icon={shieldCheckIcon}>
        El backend valida tu sesión a través del encabezado{" "}
        <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>. Nunca compartas tu
        clave secreta con terceros.
      </InfoNotice>
    </div>
  );
}
