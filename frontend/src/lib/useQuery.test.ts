import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiError } from "../api/errors";
import { useQuery } from "./useQuery";

function controllable() {
  const calls: { page: number; resolve: (value: string) => void; reject: (error: unknown) => void; signal: AbortSignal }[] = [];
  const fetcher = (page: number) => (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      calls.push({ page, resolve, reject, signal });
    });
  return { calls, fetcher };
}

describe("useQuery", () => {
  it("al cambiar las dependencias informa «cargando» aunque conserve los datos anteriores", async () => {
    const { calls, fetcher } = controllable();
    const { result, rerender } = renderHook(({ page }) => useQuery(fetcher(page), [page]), { initialProps: { page: 1 } });
    expect(result.current.state).toEqual({ status: "loading", data: null });
    act(() => {
      calls[0]?.resolve("página 1");
    });
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "success", data: "página 1" });
    });

    rerender({ page: 2 });
    expect(result.current.state).toEqual({ status: "loading", data: "página 1" });
    act(() => {
      calls[1]?.resolve("página 2");
    });
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "success", data: "página 2" });
    });
  });

  it("una respuesta vieja no pisa a la nueva (la anterior se aborta)", async () => {
    const { calls, fetcher } = controllable();
    const { result, rerender } = renderHook(({ page }) => useQuery(fetcher(page), [page]), { initialProps: { page: 1 } });
    rerender({ page: 2 });
    expect(calls[0]?.signal.aborted).toBe(true);
    act(() => {
      calls[1]?.resolve("página 2");
      calls[0]?.resolve("página 1");
    });
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "success", data: "página 2" });
    });
  });

  it("error y «reload»: conserva los datos y vuelve a «cargando» hasta la nueva respuesta", async () => {
    const { calls, fetcher } = controllable();
    const { result } = renderHook(() => useQuery(fetcher(1), []));
    act(() => {
      calls[0]?.resolve("datos");
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe("success");
    });
    act(() => {
      result.current.reload();
    });
    expect(result.current.state).toEqual({ status: "loading", data: "datos" });
    const error = new ApiError("network", "Sin conexión");
    act(() => {
      calls[1]?.reject(error);
    });
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: "error", data: "datos", error });
    });
  });
});
