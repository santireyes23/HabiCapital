import type { ReactNode } from "react";

import { Brand } from "../components/Brand";
import { DangerNotice, PrimaryButton, SecondaryButton } from "../components/ui";
import { useSession } from "../session/SessionProvider";

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-[470px] flex-col gap-6 rounded-[16px] border border-line bg-surface p-6 sm:p-9">
        <Brand />
        {children}
      </div>
    </div>
  );
}

/** Mientras GET /accounts/me valida el token guardado: no se muestra ningún dato privado. */
export function SessionCheckingScreen() {
  return (
    <CenteredCard>
      <p role="status" className="flex items-center gap-2.5 text-body text-ink-muted">
        <span aria-hidden className="size-2 animate-pulse rounded-pill bg-accent" />
        Verificando tu sesión con el servidor…
      </p>
    </CenteredCard>
  );
}

/**
 * Hay un token guardado pero no se pudo validar (red caída o error del servidor). La sesión no se
 * cierra por esto: el usuario decide reintentar o cerrarla.
 */
export function SessionOfflineScreen() {
  const { state, retry, logout } = useSession();
  const detail = state.status === "offline" ? state.error.message : "";
  return (
    <CenteredCard>
      <DangerNotice role="alert" title="No pudimos validar tu sesión">
        {detail} Tu token sigue guardado en esta pestaña; no se cerró la sesión.
      </DangerNotice>
      <div className="flex flex-col gap-3 sm:flex-row">
        <SecondaryButton type="button" onClick={logout}>
          Cerrar sesión
        </SecondaryButton>
        <PrimaryButton type="button" onClick={retry} className="sm:flex-1">
          Reintentar
        </PrimaryButton>
      </div>
    </CenteredCard>
  );
}
