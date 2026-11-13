import { Suspense } from "react";
import { Link } from "react-router";

import { Brand } from "../components/Brand";
import { AppShell } from "../layout/AppShell";
import { SessionCheckingScreen } from "../pages/SessionScreens";
import { useSession } from "../session/SessionProvider";
import { HelpPage, PageFallback } from "./pages";

/**
 * /ayuda es pública. Con sesión activa se muestra dentro del panel (menú lateral incluido) y la
 * sesión no cambia; sin sesión, con una cabecera sencilla y un enlace a /acceso. Mientras se
 * valida un token guardado se espera, para no saltar de un diseño al otro.
 */
export function HelpRoute() {
  const { state } = useSession();

  if (state.status === "checking") return <SessionCheckingScreen />;
  if (state.status === "active") {
    return (
      <AppShell>
        <HelpPage />
      </AppShell>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-8">
        <Brand />
        <Link
          to="/acceso"
          className="rounded-control border border-line bg-surface px-4 py-2.5 text-body-sm font-semibold text-accent transition hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Crear cuenta o acceder
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-main min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <Suspense fallback={<PageFallback />}>
          <HelpPage />
        </Suspense>
      </main>
    </div>
  );
}
