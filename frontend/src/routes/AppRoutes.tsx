import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";

import { AppShell } from "../layout/AppShell";
import {
  AccessPage,
  AccountPage,
  FullPageFallback,
  HomePage,
  MovementsPage,
  RequestsPage,
  SendPage,
  TopUpPage,
} from "./pages";
import { RequireSession } from "./RequireSession";

/**
 * Mapa de rutas. /acceso es pública; el resto exige una sesión validada por el backend.
 * Cada pantalla se carga aparte (routes/pages.tsx); la barra lateral queda fija mientras tanto.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/acceso"
        element={
          <Suspense fallback={<FullPageFallback />}>
            <AccessPage />
          </Suspense>
        }
      />
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="enviar" element={<SendPage />} />
          <Route path="recargar" element={<TopUpPage />} />
          <Route path="solicitudes" element={<RequestsPage />} />
          <Route path="movimientos" element={<MovementsPage />} />
          <Route path="cuenta" element={<AccountPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
