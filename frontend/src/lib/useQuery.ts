/**
 * Carga de datos de solo lectura (GET) con estados de carga, éxito y error, y «Reintentar».
 * Cada llamada recibe una señal que se aborta al desmontar o al volver a cargar, para que una
 * respuesta vieja nunca pise a una nueva. No reintenta sola.
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../api/errors";

export type QueryState<T> =
  | { status: "loading"; data: T | null }
  | { status: "success"; data: T }
  | { status: "error"; data: T | null; error: ApiError };

export interface QueryResult<T> {
  state: QueryState<T>;
  /** Vuelve a pedir los datos (conserva los anteriores mientras tanto). */
  reload: () => void;
}

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("network", "Error inesperado");
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

/** Resultado interno: recuerda para qué dependencias se obtuvo. */
type Settled<T> =
  | { status: "success"; data: T; deps: readonly unknown[] }
  | { status: "error"; data: T | null; error: ApiError; deps: readonly unknown[] };

export function useQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): QueryResult<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetcher(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setSettled({ status: "success", data, deps });
        setReloading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSettled((previous) => ({ status: "error", data: previous?.data ?? null, error: toApiError(error), deps }));
        setReloading(false);
      });
    return () => {
      controller.abort();
    };
    // `fetcher` cambia en cada render; las dependencias reales las da quien llama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ...deps]);

  const reload = useCallback(() => {
    setReloading(true);
    setAttempt((value) => value + 1);
  }, []);

  // Si cambiaron las dependencias (otra página, otro filtro) el resultado guardado es de la
  // consulta anterior: se informa «cargando» y se conservan sus datos solo como referencia.
  const state: QueryState<T> =
    settled === null
      ? { status: "loading", data: null }
      : reloading || !sameDeps(settled.deps, deps)
        ? { status: "loading", data: settled.data }
        : settled.status === "success"
          ? { status: "success", data: settled.data }
          : { status: "error", data: settled.data, error: settled.error };

  return { state, reload };
}
