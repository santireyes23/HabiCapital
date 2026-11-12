/** Instancias compartidas por la aplicación: sesión, cliente HTTP, endpoints e idempotencia. */

import { createTokenStore } from "../session/tokenStore";
import { createApiClient } from "./client";
import { createEndpoints } from "./endpoints";
import { createIdempotencyManager } from "./idempotency";

export const tokenStore = createTokenStore();

export const api = createEndpoints(
  createApiClient({
    getToken: () => tokenStore.get(),
    // Token inválido o reemplazado por una regeneración: se cierra la sesión local.
    onUnauthorized: () => {
      tokenStore.clear();
    },
  }),
);

export const idempotency = createIdempotencyManager();
