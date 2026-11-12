import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import { Brand } from "../components/Brand";
import { Icon } from "../components/Icon";
import {
  infoIcon,
  logoutIcon,
  navAccountIcon,
  navHomeIcon,
  navMovementsIcon,
  navRequestsIcon,
  navSendIcon,
  navTopUpIcon,
  shieldAlertIcon,
} from "../components/icons";
import { useApi } from "../api/ApiContext";
import { initials, shortUuid } from "../lib/account";
import { useQuery } from "../lib/useQuery";
import { PageFallback, preloadPrivatePages } from "../routes/pages";
import { PendingCountContext } from "./pendingCount";
import { useActiveAccount, useSession } from "../session/SessionProvider";

export const NAV_ITEMS = [
  { to: "/", label: "Inicio", icon: navHomeIcon },
  { to: "/enviar", label: "Enviar dinero", icon: navSendIcon },
  { to: "/recargar", label: "Recargar saldo", icon: navTopUpIcon },
  { to: "/solicitudes", label: "Solicitudes", icon: navRequestsIcon },
  { to: "/movimientos", label: "Movimientos", icon: navMovementsIcon },
  { to: "/cuenta", label: "Mi cuenta", icon: navAccountIcon },
] as const;

/** Estructura de las pantallas privadas: barra lateral de 280 px (Figma) y área principal. */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  // El menú móvil se cierra al cambiar de ruta (se guarda la ruta en la que se abrió).
  const [menuPath, setMenuPath] = useState(location.pathname);
  if (menuPath !== location.pathname) {
    setMenuPath(location.pathname);
    setMenuOpen(false);
  }

  // Contador de la barra lateral: solicitudes RECIBIDAS que siguen pendientes (total real de la
  // API). Se vuelve a consultar al cambiar de pantalla.
  const api = useApi();
  const pending = useQuery(
    async (signal) =>
      (await api.listMoneyRequests({ role: "received", status: "PENDING", limit: 1 }, { signal }))
        .data.total,
    [api, location.pathname],
  );
  // Mientras se vuelve a consultar se muestra el último total conocido (sin parpadeo a 0).
  // Con la sesión ya abierta se descargan en segundo plano las demás pantallas, para que la
  // navegación sea inmediata sin cargarlas todas en el primer acceso.
  useEffect(() => {
    preloadPrivatePages();
  }, []);

  const pendingCount = pending.state.data ?? 0;

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Como en Figma: la barra ocupa todo el alto de la página (sin scroll propio, que en
          Windows restaría ancho al contenido). */}
      <aside className="hidden min-h-screen w-sidebar shrink-0 flex-col justify-between self-stretch border-r border-line bg-canvas py-8 pr-[25px] pl-6 lg:flex">
        <SidebarContent pendingCount={pendingCount} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-4 sm:px-6 lg:hidden">
          <Brand />
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            // «Cerrar» a secas se confundiría con «Cerrar sesión» en un lector de pantalla.
            aria-label={menuOpen ? "Cerrar menú" : "Menú"}
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
            className="rounded-control border border-line bg-surface-sunken px-4 py-2.5 text-body-sm font-semibold text-ink-muted focus-visible:outline-2 focus-visible:outline-accent"
          >
            {menuOpen ? "Cerrar" : "Menú"}
          </button>
        </header>
        {menuOpen && (
          <div id="mobile-menu" className="flex flex-col gap-8 border-b border-line px-4 py-6 sm:px-6 lg:hidden">
            <SidebarContent showBrand={false} pendingCount={pendingCount} />
          </div>
        )}

        <main className="mx-auto flex w-full max-w-main min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          <UnconfirmedTokenBanner />
          <PendingCountContext value={pending.reload}>
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </PendingCountContext>
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  showBrand = true,
  pendingCount,
}: {
  showBrand?: boolean;
  pendingCount: number;
}) {
  const account = useActiveAccount();
  const { logout } = useSession();

  return (
    <>
      <div className="flex w-full flex-col gap-9">
        {showBrand && (
          <div className="px-2">
            <Brand />
          </div>
        )}
        <nav aria-label="Navegación principal" className="flex flex-col gap-1.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3.5 rounded-control border text-body transition focus-visible:outline-2 focus-visible:outline-accent ${
                  isActive
                    ? "border-line-strong bg-surface px-3.5 py-3 font-semibold text-ink-active"
                    : "border-transparent px-3.5 py-3 font-medium text-ink-muted hover:text-ink"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={isActive ? "text-accent" : "text-ink-subtle"}>
                    <Icon src={item.icon} size={22} />
                  </span>
                  <span className="whitespace-nowrap">{item.label}</span>
                  {item.to === "/solicitudes" && pendingCount > 0 ? (
                    <span
                      aria-label={`${pendingCount} solicitudes recibidas pendientes`}
                      className="ml-auto shrink-0 rounded-pill border border-pending-border bg-pending-bg px-[9px] py-[3px] text-overline font-bold text-pending-text"
                    >
                      {pendingCount > 99 ? "99+" : pendingCount}
                    </span>
                  ) : (
                    isActive && (
                      <span aria-hidden className="ml-auto size-2 shrink-0 rounded-pill bg-accent" />
                    )
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="flex w-full flex-col gap-4 border-t border-line pt-[25px]">
        <div className="flex items-start gap-2.5 rounded-card border border-line-strong bg-surface-sunken p-[15px]">
          <span className="pt-0.5 text-accent">
            <Icon src={infoIcon} size={18} />
          </span>
          <div className="flex flex-col gap-[3px]">
            <p className="text-caption leading-[15px] font-bold text-ink">Billetera simulada COP</p>
            <p className="text-overline leading-[17.88px] text-ink-muted">
              Este entorno es estrictamente de demostración educativa. No procesa pagos bancarios ni
              dinero real.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-2 pt-1">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-pill border border-line-strong bg-surface text-caption font-bold text-accent">
              {initials(account.owner_name)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-body leading-[14px] font-bold text-ink">
                {account.owner_name}
              </p>
              <p className="pt-1 font-mono text-overline whitespace-nowrap text-ink-muted">
                Cuenta: {shortUuid(account.id)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="shrink-0 rounded-[10px] p-1.5 text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Icon src={logoutIcon} size={18} />
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Opción A: si la pestaña se recargó (o se salió de la pantalla) antes de confirmar que se guardó
 * el token, la sesión sigue pero el token ya no se puede volver a ver.
 */
function UnconfirmedTokenBanner() {
  const { tokenUnconfirmed, confirmTokenSaved } = useSession();
  if (!tokenUnconfirmed) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-card border border-rejected-border bg-rejected-bg p-[17px] sm:flex-row sm:items-start"
    >
      <span className="pt-0.5 text-negative">
        <Icon src={shieldAlertIcon} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-bold text-rejected-text">
          No confirmaste que guardaste tu token
        </p>
        <p className="mt-0.5 text-caption text-ink-muted">
          Por seguridad no se vuelve a mostrar. La sesión sigue abierta en esta pestaña, pero si la
          cierras sin tener el token no podrás volver a entrar. Genera uno nuevo desde{" "}
          <Link to="/cuenta" className="font-semibold text-accent underline-offset-2 hover:underline">
            «Mi cuenta»
          </Link>{" "}
          y guárdalo.
        </p>
      </div>
      <button
        type="button"
        onClick={confirmTokenSaved}
        className="shrink-0 self-start rounded-control border border-line bg-surface-sunken px-4 py-2 text-caption font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        Entendido
      </button>
    </div>
  );
}
