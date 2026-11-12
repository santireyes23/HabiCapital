import { Navigate, Outlet, useLocation } from "react-router";

import { SessionCheckingScreen, SessionOfflineScreen } from "../pages/SessionScreens";
import { useSession } from "../session/SessionProvider";

/**
 * Ruta protegida: solo renderiza su contenido con una sesión validada por el backend. Sin sesión
 * lleva a /acceso recordando la ruta pedida (solo la ruta; nunca el token).
 */
export function RequireSession() {
  const { state } = useSession();
  const location = useLocation();

  if (state.status === "checking") return <SessionCheckingScreen />;
  if (state.status === "offline") return <SessionOfflineScreen />;
  if (state.status === "anonymous") {
    // Tras cerrar sesión no se recuerda la ruta: la siguiente persona empieza desde Inicio.
    const from =
      state.reason === "logout" ? undefined : `${location.pathname}${location.search}`;
    return <Navigate to="/acceso" replace state={from === undefined ? null : { from }} />;
  }
  return <Outlet />;
}
