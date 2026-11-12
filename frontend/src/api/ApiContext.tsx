import { createContext, useContext, type ReactNode } from "react";

import type { Endpoints } from "./endpoints";
import type { IdempotencyManager } from "./idempotency";

interface ApiDeps {
  api: Endpoints;
  idempotency: IdempotencyManager;
}

const ApiContext = createContext<ApiDeps | null>(null);

/** Da a las pantallas los endpoints reales y el gestor de idempotencia (o los de prueba). */
export function ApiProvider({
  api,
  idempotency,
  children,
}: ApiDeps & { children: ReactNode }) {
  return <ApiContext value={{ api, idempotency }}>{children}</ApiContext>;
}

function useDeps(): ApiDeps {
  const deps = useContext(ApiContext);
  if (deps === null) throw new Error("useApi debe usarse dentro de ApiProvider");
  return deps;
}

export function useApi(): Endpoints {
  return useDeps().api;
}

export function useIdempotency(): IdempotencyManager {
  return useDeps().idempotency;
}
