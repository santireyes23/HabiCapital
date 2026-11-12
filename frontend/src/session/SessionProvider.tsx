/**
 * Sesión del navegador.
 *
 * Estados:
 * - anonymous: sin token (nunca hubo, se cerró la sesión o el servidor respondió 401).
 * - checking:  hay un token guardado y se está validando con GET /accounts/me.
 * - active:    el backend aceptó el token; `account` viene de su respuesta.
 * - offline:   hay un token guardado pero no se pudo validar (red o error del servidor). La
 *              sesión NO se cierra: se ofrece reintentar.
 *
 * El token vive en el TokenStore (memoria + sessionStorage). Este módulo nunca lo copia al
 * estado de React ni lo devuelve, salvo `createAccount`, que entrega el token recién emitido una
 * única vez para mostrarlo.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Endpoints } from "../api/endpoints";
import { ApiError } from "../api/errors";
import type { IdempotencyManager } from "../api/idempotency";
import type { AccountRead } from "../api/types";
import { browserSessionStore, type KeyValueStore } from "../lib/safeStorage";
import {
  invalidAccountResponse,
  isAccountCreated,
  isAccountRead,
  publicAccount,
} from "./accountResponse";
import { isPlausibleToken, type TokenStore } from "./tokenStore";

/** Id de la cuenta cuyo token se mostró pero el usuario no confirmó haber guardado (opción A). */
export const TOKEN_UNCONFIRMED_STORAGE_KEY = "habicapital.session.token-unconfirmed";

export type AnonymousReason = "none" | "expired" | "logout";

export type SessionState =
  | { status: "anonymous"; reason: AnonymousReason }
  | { status: "checking" }
  | { status: "active"; account: AccountRead }
  | { status: "offline"; error: ApiError };

export interface CreatedAccount {
  account: AccountRead;
  /** El token emitido por el backend. Solo para mostrarlo una vez; no se guarda en el estado. */
  token: string;
}

export interface SessionValue {
  state: SessionState;
  /** true si la cuenta activa recibió un token que el usuario no confirmó haber guardado. */
  tokenUnconfirmed: boolean;
  createAccount: (ownerName: string) => Promise<CreatedAccount>;
  login: (token: string) => Promise<AccountRead>;
  logout: () => void;
  retry: () => void;
  confirmTokenSaved: () => void;
  /** Vuelve a leer GET /accounts/me (p. ej. para tener el saldo al día). */
  refreshAccount: (signal?: AbortSignal) => Promise<AccountRead>;
  /**
   * Usa el saldo que devolvió el backend en una operación (p. ej. el `balance` de un depósito).
   * Nunca se calcula en el navegador. Solo se aplica si la sesión sigue en la cuenta que hizo la
   * operación: una respuesta tardía de otra cuenta (tras cerrar sesión) no pisa el saldo actual.
   */
  applyServerBalance: (accountId: string, balance: number) => void;
  /**
   * POST /accounts/me/token. Solo con una respuesta válida guarda el token nuevo y lo devuelve
   * para mostrarlo una vez. No reintenta: la operación no es idempotente.
   */
  rotateToken: () => Promise<string>;
  /**
   * Comprueba si el token guardado sigue funcionando, SIN cerrar la sesión si no funciona
   * (se usa tras un resultado incierto al regenerar).
   */
  checkStoredToken: () => Promise<TokenCheck>;
}

/** valid: el backend lo acepta; rejected: 401; unknown: no se pudo comprobar. */
export type TokenCheck = "valid" | "rejected" | "unknown";

const SessionContext = createContext<SessionValue | null>(null);

export interface SessionProviderProps {
  api: Pick<Endpoints, "createAccount" | "getMe" | "rotateToken">;
  tokenStore: TokenStore;
  idempotency: Pick<IdempotencyManager, "discardAccount" | "discardAll">;
  noticeStore?: KeyValueStore;
  children: ReactNode;
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("network", "Error inesperado");
}

export function SessionProvider({
  api,
  tokenStore,
  idempotency,
  noticeStore,
  children,
}: SessionProviderProps) {
  const notices = useMemo(() => noticeStore ?? browserSessionStore(), [noticeStore]);
  const [state, setState] = useState<SessionState>(() =>
    tokenStore.get() === null ? { status: "anonymous", reason: "none" } : { status: "checking" },
  );
  const [unconfirmedId, setUnconfirmedId] = useState<string | null>(() =>
    notices.get(TOKEN_UNCONFIRMED_STORAGE_KEY),
  );
  const [attempt, setAttempt] = useState(0);
  const loggingOut = useRef(false);

  const forgetUnconfirmed = useCallback(() => {
    notices.remove(TOKEN_UNCONFIRMED_STORAGE_KEY);
    setUnconfirmedId(null);
  }, [notices]);

  // Validación del token guardado al cargar (y en cada «Reintentar»).
  useEffect(() => {
    if (state.status !== "checking") return;
    const controller = new AbortController();
    api
      .getMe({ signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (!isAccountRead(response.data)) throw invalidAccountResponse(response.status);
        setState({ status: "active", account: publicAccount(response.data) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const apiError = asApiError(error);
        if (apiError.isUnauthorized) {
          // El cliente ya borró el token (onUnauthorized); aquí solo se refleja.
          tokenStore.clear();
          forgetUnconfirmed();
          setState({ status: "anonymous", reason: "expired" });
        } else {
          setState({ status: "offline", error: apiError });
        }
      });
    return () => {
      controller.abort();
    };
  }, [api, attempt, forgetUnconfirmed, state.status, tokenStore]);

  // Un 401 en cualquier llamada borra el token (api/index.ts): la sesión pasa a anónima.
  useEffect(
    () =>
      tokenStore.subscribe(() => {
        if (tokenStore.get() !== null || loggingOut.current) return;
        notices.remove(TOKEN_UNCONFIRMED_STORAGE_KEY);
        setUnconfirmedId(null);
        setState((current) =>
          current.status === "anonymous" ? current : { status: "anonymous", reason: "expired" },
        );
      }),
    [notices, tokenStore],
  );

  const createAccount = useCallback(
    async (ownerName: string): Promise<CreatedAccount> => {
      const response = await api.createAccount({ owner_name: ownerName });
      if (!isAccountCreated(response.data)) throw invalidAccountResponse(response.status);
      const account = publicAccount(response.data);
      const { token } = response.data;
      // Opción A: el token se guarda en cuanto el backend confirma (201). Si la pestaña se
      // recarga antes de confirmar, la sesión sigue y se avisa que debe regenerarlo.
      tokenStore.set(token);
      notices.set(TOKEN_UNCONFIRMED_STORAGE_KEY, account.id);
      setUnconfirmedId(account.id);
      setState({ status: "active", account });
      return { account, token };
    },
    [api, notices, tokenStore],
  );

  const login = useCallback(
    async (token: string): Promise<AccountRead> => {
      // Se valida ANTES de guardar: si falla, la credencial no queda en ningún sitio.
      const response = await api.getMe({ token });
      if (!isAccountRead(response.data)) throw invalidAccountResponse(response.status);
      const account = publicAccount(response.data);
      tokenStore.set(token);
      setState({ status: "active", account });
      return account;
    },
    [api, tokenStore],
  );

  const logout = useCallback(() => {
    loggingOut.current = true;
    try {
      if (state.status === "active") idempotency.discardAccount(state.account.id);
      else idempotency.discardAll();
      forgetUnconfirmed();
      tokenStore.clear();
      setState({ status: "anonymous", reason: "logout" });
    } finally {
      loggingOut.current = false;
    }
  }, [forgetUnconfirmed, idempotency, state, tokenStore]);

  const retry = useCallback(() => {
    if (tokenStore.get() === null) {
      setState({ status: "anonymous", reason: "none" });
      return;
    }
    setState({ status: "checking" });
    setAttempt((value) => value + 1);
  }, [tokenStore]);

  const refreshAccount = useCallback(
    async (signal?: AbortSignal): Promise<AccountRead> => {
      const response = await api.getMe(signal === undefined ? {} : { signal });
      if (!isAccountRead(response.data)) throw invalidAccountResponse(response.status);
      const account = publicAccount(response.data);
      // Solo si la sesión sigue activa y es la misma cuenta (pudo cerrarse mientras tanto).
      setState((current) =>
        current.status === "active" && current.account.id === account.id
          ? { status: "active", account }
          : current,
      );
      return account;
    },
    [api],
  );

  const applyServerBalance = useCallback((accountId: string, balance: number) => {
    if (!Number.isSafeInteger(balance)) return;
    setState((current) =>
      current.status === "active" && current.account.id === accountId
        ? { status: "active", account: { ...current.account, balance } }
        : current,
    );
  }, []);

  const activeAccountId = state.status === "active" ? state.account.id : null;

  const rotateToken = useCallback(async (): Promise<string> => {
    if (activeAccountId === null) throw new ApiError("http", "Token ausente o inválido", 401);
    const response = await api.rotateToken();
    const data: unknown = response.data;
    const token =
      typeof data === "object" && data !== null ? (data as Record<string, unknown>).token : null;
    if (typeof token !== "string" || !isPlausibleToken(token)) {
      // No sabemos qué pasó en el servidor: quien llama lo trata como resultado incierto.
      throw invalidAccountResponse(response.status);
    }
    // El anterior ya no sirve: el nuevo reemplaza al guardado. Opción A hasta que se confirme.
    tokenStore.set(token);
    notices.set(TOKEN_UNCONFIRMED_STORAGE_KEY, activeAccountId);
    setUnconfirmedId(activeAccountId);
    return token;
  }, [activeAccountId, api, notices, tokenStore]);

  const checkStoredToken = useCallback(async (): Promise<TokenCheck> => {
    const token = tokenStore.get();
    if (token === null) return "rejected";
    try {
      // Con el token explícito, un 401 no cierra la sesión: quien llama decide qué explicar.
      await api.getMe({ token });
      return "valid";
    } catch (error) {
      return error instanceof ApiError && error.isUnauthorized ? "rejected" : "unknown";
    }
  }, [api, tokenStore]);

  const tokenUnconfirmed =
    state.status === "active" && unconfirmedId !== null && unconfirmedId === state.account.id;

  const value = useMemo<SessionValue>(
    () => ({
      state,
      tokenUnconfirmed,
      createAccount,
      login,
      logout,
      retry,
      confirmTokenSaved: forgetUnconfirmed,
      refreshAccount,
      applyServerBalance,
      rotateToken,
      checkStoredToken,
    }),
    [
      applyServerBalance,
      checkStoredToken,
      createAccount,
      forgetUnconfirmed,
      login,
      logout,
      refreshAccount,
      retry,
      rotateToken,
      state,
      tokenUnconfirmed,
    ],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession debe usarse dentro de SessionProvider");
  return value;
}

/** La cuenta de la sesión activa. Solo para componentes bajo una ruta protegida. */
export function useActiveAccount(): AccountRead {
  const { state } = useSession();
  if (state.status !== "active") throw new Error("No hay una sesión activa");
  return state.account;
}
