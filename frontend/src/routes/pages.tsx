/**
 * Pantallas con carga diferida: cada una es un archivo JS aparte que se descarga al visitarla.
 * Las privadas se precargan en segundo plano cuando hay sesión (AppShell), así que la navegación
 * no espera a la red.
 */

import { lazy } from "react";

import { LoadingLabel, Skeleton } from "../components/states";

const loaders = {
  access: () => import("../pages/access/AccessPage"),
  home: () => import("../pages/home/HomePage"),
  send: () => import("../pages/send/SendPage"),
  topUp: () => import("../pages/topup/TopUpPage"),
  requests: () => import("../pages/requests/RequestsPage"),
  movements: () => import("../pages/movements/MovementsPage"),
  account: () => import("../pages/account/AccountPage"),
  help: () => import("../pages/help/HelpPage"),
};

export const AccessPage = lazy(() => loaders.access().then((module) => ({ default: module.AccessPage })));
export const HomePage = lazy(() => loaders.home().then((module) => ({ default: module.HomePage })));
export const SendPage = lazy(() => loaders.send().then((module) => ({ default: module.SendPage })));
export const TopUpPage = lazy(() => loaders.topUp().then((module) => ({ default: module.TopUpPage })));
export const RequestsPage = lazy(() => loaders.requests().then((module) => ({ default: module.RequestsPage })));
export const MovementsPage = lazy(() => loaders.movements().then((module) => ({ default: module.MovementsPage })));
export const HelpPage = lazy(() => loaders.help().then((module) => ({ default: module.HelpPage })));
export const AccountPage = lazy(() => loaders.account().then((module) => ({ default: module.AccountPage })));

let preloaded = false;

/** Descarga las pantallas privadas sin mostrarlas. Un fallo aquí no importa: se reintenta al visitar. */
export function preloadPrivatePages(): void {
  if (preloaded) return;
  preloaded = true;
  for (const load of [loaders.home, loaders.send, loaders.topUp, loaders.requests, loaders.movements, loaders.account, loaders.help]) {
    load().catch(() => undefined);
  }
}

/** Mientras llega el código de una pantalla (normalmente un instante): bloques de carga del diseño. */
export function PageFallback() {
  return (
    <div role="status" aria-busy="true" className="flex w-full flex-col gap-6">
      <LoadingLabel>Cargando pantalla…</LoadingLabel>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-12 w-full max-w-[420px]" />
      <Skeleton className="h-[240px] w-full rounded-card" />
    </div>
  );
}

/** Igual que PageFallback, a pantalla completa (para /acceso, que no tiene barra lateral). */
export function FullPageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[470px]">
        <PageFallback />
      </div>
    </div>
  );
}
