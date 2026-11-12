import { useEffect, useId, useState } from "react";

import { Icon } from "../../components/Icon";
import { checkCircleIcon } from "../../components/icons";
import { DangerNotice, PrimaryButton } from "../../components/ui";
import type { CreatedAccount } from "../../session/SessionProvider";
import { CopyField } from "./CopyField";

/**
 * «¡Cuenta creada con éxito!» (estado de Stitch, con los tokens de Figma). Muestra el UUID y el
 * token reales de la respuesta 201. El token solo existe en las props de este componente: al
 * salir de esta vista no se puede volver a ver.
 */
export function AccountCreatedView({
  created,
  onContinue,
}: {
  created: CreatedAccount;
  onContinue: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const checkboxId = useId();

  // Aviso al recargar o cerrar la pestaña antes de confirmar. Los navegadores muestran su propio
  // texto genérico (no se puede personalizar) y pueden omitirlo si no hubo interacción.
  useEffect(() => {
    if (saved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [saved]);

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-center gap-3 border-b border-line pb-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-control border border-accepted-border bg-accepted-bg text-accepted-text">
          <Icon src={checkCircleIcon} size={24} />
        </div>
        <div>
          <h2 className="text-card-title font-bold text-ink">¡Cuenta creada con éxito!</h2>
          <p className="text-caption text-ink-muted">
            {created.account.owner_name}: guarda tus credenciales de acceso
          </p>
        </div>
      </div>

      <DangerNotice title="Guarda tu token ahora">
        Por seguridad, el token Bearer se muestra <strong className="text-ink">únicamente en esta
        ocasión</strong> y no se puede recuperar. Mientras esta sesión siga abierta podrás regenerarlo
        desde «Mi cuenta»; si la cierras sin haberlo guardado, no podrás volver a entrar a esta cuenta.
      </DangerNotice>

      <CopyField
        label="UUID de tu cuenta"
        badge="Público"
        badgeClassName="font-semibold text-accent"
        value={created.account.id}
        valueClassName="text-ink"
        buttonVariant="ghost"
        copyLabel="Copiar UUID"
      />

      <CopyField
        label="Bearer token de acceso"
        badge="Secreto · Copia ahora"
        badgeClassName="font-bold text-negative"
        value={created.token}
        valueClassName="font-bold text-accent"
        buttonVariant="accent"
        copyLabel="Copiar token"
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
        <span>Ya guardé mi token en un lugar seguro.</span>
      </label>

      <PrimaryButton type="button" disabled={!saved} onClick={onContinue}>
        Continuar a mi panel
      </PrimaryButton>
    </div>
  );
}
