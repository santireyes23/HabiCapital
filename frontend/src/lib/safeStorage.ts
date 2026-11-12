/**
 * Acceso a sessionStorage que nunca lanza: en modo privado, con almacenamiento bloqueado o en
 * pruebas, el acceso puede fallar. En ese caso se usa memoria (dura lo que dure la página).
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
}

/**
 * Envuelve un Storage (sessionStorage) con respaldo en memoria. Si una escritura falla, el valor
 * queda en memoria; si el Storage no existe o lanza al obtenerlo, se usa solo memoria.
 */
export function safeStore(getStorage: () => Storage | null | undefined): KeyValueStore {
  const fallback = memoryStore();

  function storage(): Storage | null {
    try {
      return getStorage() ?? null;
    } catch {
      return null;
    }
  }

  return {
    get(key) {
      const memory = fallback.get(key);
      if (memory !== null) return memory;
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const target = storage();
        if (target === null) throw new Error("sin almacenamiento");
        target.setItem(key, value);
        fallback.remove(key);
      } catch {
        fallback.set(key, value);
      }
    },
    remove(key) {
      fallback.remove(key);
      try {
        storage()?.removeItem(key);
      } catch {
        // Nada que hacer: el valor ya no está en memoria.
      }
    },
  };
}

/** sessionStorage del navegador: se borra al cerrar la pestaña. Nunca localStorage. */
export function browserSessionStore(): KeyValueStore {
  return safeStore(() => (typeof window === "undefined" ? null : window.sessionStorage));
}
