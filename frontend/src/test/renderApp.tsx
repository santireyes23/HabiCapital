/** Monta la aplicación completa (rutas + sesión + cliente HTTP real) sobre un backend falso. */

import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, type Location } from "react-router";

import App from "../App";
import { createApiClient } from "../api/client";
import { createEndpoints } from "../api/endpoints";
import { createIdempotencyManager } from "../api/idempotency";
import { memoryStore, type KeyValueStore } from "../lib/safeStorage";
import { createTokenStore } from "../session/tokenStore";
import { fakeBackend, type FakeBackend } from "./fakeBackend";

/** Los tres almacenes de sessionStorage. Reutilizarlos en otro render simula recargar la pestaña. */
export interface TabStorage {
  session: KeyValueStore;
  notices: KeyValueStore;
  operations: KeyValueStore;
}

export function newTabStorage(): TabStorage {
  return { session: memoryStore(), notices: memoryStore(), operations: memoryStore() };
}

export const locations: Location[] = [];

function LocationProbe() {
  const location = useLocation();
  locations.push(location);
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

export function renderApp({
  path = "/",
  storage = newTabStorage(),
  backend = fakeBackend(),
  timeoutMs,
}: { path?: string; storage?: TabStorage; backend?: FakeBackend; timeoutMs?: number } = {}) {
  const tokenStore = createTokenStore(storage.session);
  const api = createEndpoints(
    createApiClient({
      getToken: () => tokenStore.get(),
      onUnauthorized: () => {
        tokenStore.clear();
      },
      fetchFn: backend.fetchFn,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
  );
  const idempotency = createIdempotencyManager({ store: storage.operations });
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App api={api} tokenStore={tokenStore} idempotency={idempotency} noticeStore={storage.notices} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { ...view, user, api, backend, storage, tokenStore, idempotency };
}
