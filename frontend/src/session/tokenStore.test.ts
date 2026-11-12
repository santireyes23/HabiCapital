import { describe, expect, it, vi } from "vitest";

import { memoryStore, safeStore } from "../lib/safeStorage";
import { createTokenStore, TOKEN_STORAGE_KEY } from "./tokenStore";

const TOKEN = "Zx9_abc-DEF123ghiJKL456mnoPQR789stuVWX0yz12";

describe("almacenamiento del token", () => {
  it("guarda, lee y borra el token", () => {
    const store = memoryStore();
    const tokens = createTokenStore(store);

    tokens.set(`  ${TOKEN}\n`);
    expect(tokens.get()).toBe(TOKEN);
    expect(store.get(TOKEN_STORAGE_KEY)).toBe(TOKEN);

    tokens.clear();
    expect(tokens.get()).toBeNull();
    expect(store.get(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("recupera la sesión tras recargar la pestaña (mismo sessionStorage)", () => {
    const store = memoryStore();
    createTokenStore(store).set(TOKEN);
    expect(createTokenStore(store).get()).toBe(TOKEN);
  });

  it("descarta un valor guardado con formato inválido", () => {
    const store = memoryStore();
    store.set(TOKEN_STORAGE_KEY, "con espacios no vale");
    expect(createTokenStore(store).get()).toBeNull();
    expect(store.get(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("rechaza tokens con espacios o saltos de línea internos sin repetir el valor en el error", () => {
    const tokens = createTokenStore(memoryStore());
    for (const bad of ["", "a b", "a\nb", "ñandú"]) {
      expect(() => {
        tokens.set(bad);
      }).toThrow("El token no tiene un formato válido");
    }
    try {
      tokens.set("secreto con espacio");
    } catch (error) {
      expect(String(error)).not.toContain("secreto");
    }
  });

  it("avisa a los suscriptores al iniciar y cerrar sesión", () => {
    const tokens = createTokenStore(memoryStore());
    const listener = vi.fn();
    const unsubscribe = tokens.subscribe(listener);

    tokens.set(TOKEN);
    tokens.clear();
    tokens.clear(); // sin sesión: no vuelve a avisar
    unsubscribe();
    tokens.set(TOKEN);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("usa sessionStorage del navegador y nunca localStorage", () => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    const tokens = createTokenStore();

    tokens.set(TOKEN);

    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBe(TOKEN);
    expect(window.localStorage.length).toBe(0);
    tokens.clear();
    expect(window.sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("funciona en memoria si sessionStorage lanza excepciones", () => {
    const broken = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    } as unknown as Storage;
    const tokens = createTokenStore(safeStore(() => broken));

    tokens.set(TOKEN);
    expect(tokens.get()).toBe(TOKEN);
    tokens.clear();
    expect(tokens.get()).toBeNull();
  });

  it("funciona si ni siquiera se puede obtener sessionStorage", () => {
    const tokens = createTokenStore(
      safeStore(() => {
        throw new Error("SecurityError");
      }),
    );
    tokens.set(TOKEN);
    expect(tokens.get()).toBe(TOKEN);
  });
});
