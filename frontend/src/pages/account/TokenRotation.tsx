import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "../../api/errors";
import { Icon } from "../../components/Icon";
import { refreshIcon } from "../../components/icons";
import { DangerNotice, PrimaryButton, SecondaryButton } from "../../components/ui";
import { useSession, type TokenCheck } from "../../session/SessionProvider";
import { CopyField } from "../access/CopyField";

type Step =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "rotating" }
  | { kind: "revealed"; token: string }
  | { kind: "failed"; message: string }
  | { kind: "checking" }
  | { kind: "uncertain"; check: TokenCheck };

/**
 * «Regenerar token» (POST /accounts/me/token). No es idempotente: un solo envío, sin reintentos
 * automáticos. Si el resultado es incierto (red, timeout, 5xx o respuesta ilegible) se comprueba
 * el token guardado con GET /accounts/me y se explica solo lo que esa comprobación demuestra.
 */
export function TokenRotation() {
  const { rotateToken, checkStoredToken, confirmTokenSaved, logout } = useSession();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const checkboxId = useId();

  // Opción A: aviso del navegador si se recarga o cierra con el token nuevo sin confirmar.
  const revealedUnconfirmed = step.kind === "revealed" && !saved;
  useEffect(() => {
    if (!revealedUnconfirmed) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [revealedUnconfirmed]);

  async function verify() {
    setStep({ kind: "checking" });
    setStep({ kind: "uncertain", check: await checkStoredToken() });
  }

  async function rotate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStep({ kind: "rotating" });
    try {
      const token = await rotateToken();
      setSaved(false);
      setStep({ kind: "revealed", token });
    } catch (error) {
      if (error instanceof ApiError && !error.outcomeUncertain) {
        // Rechazo definitivo del servidor: el token no cambió. (Un 401 ya cerró la sesión.)
        setStep({ kind: "failed", message: error.message });
      } else {
        await verify();
      }
    } finally {
      inFlight.current = false;
    }
  }

  if (step.kind === "revealed") {
    return (
      <div className="flex flex-col gap-4 rounded-card border border-line bg-canvas p-[17px]">
        <DangerNotice title="Este es tu nuevo token">
          El token anterior ya no funciona. El nuevo se muestra{" "}
          <strong className="text-ink">únicamente ahora</strong>: cópialo y guárdalo antes de salir de
          esta pantalla.
        </DangerNotice>
        <CopyField
          label="Nuevo Bearer token de acceso"
          badge="Secreto · Copia ahora"
          badgeClassName="font-bold text-negative"
          value={step.token}
          valueClassName="font-bold text-accent"
          buttonVariant="accent"
          copyLabel="Copiar nuevo token"
        />
        <label
          htmlFor={checkboxId}
          className="flex cursor-pointer items-start gap-3 rounded-card border border-line bg-surface-sunken p-[15px] text-body-sm text-ink"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={saved}
            onChange={(event) => {
              setSaved(event.target.checked);
            }}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span>Ya guardé mi nuevo token.</span>
        </label>
        <PrimaryButton
          type="button"
          disabled={!saved}
          onClick={() => {
            confirmTokenSaved();
            setStep({ kind: "idle" });
          }}
        >
          Listo, ocultar el token
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-body-sm font-bold text-ink">Token de acceso</p>
          <p className="text-caption text-ink-muted">
            Genera uno nuevo si lo perdiste o crees que alguien más lo conoce.
          </p>
        </div>
        {(step.kind === "idle" || step.kind === "failed") && (
          <SecondaryButton
            type="button"
            onClick={() => {
              setStep({ kind: "confirming" });
            }}
            className="shrink-0 font-bold"
          >
            <Icon src={refreshIcon} size={16} />
            Regenerar token
          </SecondaryButton>
        )}
      </div>

      {step.kind === "failed" && (
        <DangerNotice role="alert" title="No se regeneró el token">
          {step.message} Tu token actual sigue siendo el mismo.
        </DangerNotice>
      )}

      {(step.kind === "confirming" || step.kind === "rotating") && (
        <div className="flex flex-col gap-3 rounded-card border border-danger-soft-border bg-surface-sunken p-[17px]">
          <p className="text-body-sm font-bold text-rejected-text">¿Regenerar el token?</p>
          <p className="text-caption text-ink-muted">
            El token actual dejará de funcionar en cuanto el servidor genere el nuevo, en este y en
            cualquier otro lugar donde lo uses. El nuevo se mostrará una sola vez.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <SecondaryButton
              type="button"
              disabled={step.kind === "rotating"}
              onClick={() => {
                setStep({ kind: "idle" });
              }}
            >
              Cancelar
            </SecondaryButton>
            <PrimaryButton
              type="button"
              withArrow={false}
              disabled={step.kind === "rotating"}
              aria-busy={step.kind === "rotating"}
              onClick={() => void rotate()}
              className="sm:flex-1"
            >
              {step.kind === "rotating" ? "Regenerando token…" : "Sí, regenerar token"}
            </PrimaryButton>
          </div>
        </div>
      )}

      {step.kind === "checking" && (
        <p role="status" className="text-caption text-ink-muted">
          No recibimos respuesta del servidor. Comprobando si tu token actual sigue funcionando…
        </p>
      )}

      {step.kind === "uncertain" && step.check === "valid" && (
        <DangerNotice role="alert" title="El token no cambió">
          No recibimos la respuesta del servidor, pero comprobamos que tu token actual sigue
          funcionando, así que no se generó uno nuevo. Puedes intentarlo otra vez cuando quieras.
          <span className="mt-3 block">
            <SecondaryButton
              type="button"
              onClick={() => {
                setStep({ kind: "idle" });
              }}
            >
              Entendido
            </SecondaryButton>
          </span>
        </DangerNotice>
      )}

      {step.kind === "uncertain" && step.check === "rejected" && (
        <DangerNotice role="alert" title="Es posible que hayas perdido el acceso a esta cuenta">
          El servidor ya no acepta tu token anterior, pero no alcanzamos a recibir el nuevo. Si no
          tienes otra sesión abierta con un token válido, no podrás volver a entrar a esta cuenta.
          <span className="mt-3 block">
            <SecondaryButton type="button" onClick={logout}>
              Cerrar sesión
            </SecondaryButton>
          </span>
        </DangerNotice>
      )}

      {step.kind === "uncertain" && step.check === "unknown" && (
        <DangerNotice role="alert" title="No sabemos si el token se regeneró">
          No recibimos la respuesta del servidor y tampoco pudimos comprobar tu token actual. No
          vuelvas a regenerarlo todavía: primero comprueba la conexión.
          <span className="mt-3 block">
            <SecondaryButton type="button" onClick={() => void verify()}>
              Comprobar de nuevo
            </SecondaryButton>
          </span>
        </DangerNotice>
      )}
    </div>
  );
}
