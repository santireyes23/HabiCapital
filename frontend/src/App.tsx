import { ApiProvider } from "./api/ApiContext";
import type { Endpoints } from "./api/endpoints";
import type { IdempotencyManager } from "./api/idempotency";
import type { KeyValueStore } from "./lib/safeStorage";
import { AppRoutes } from "./routes/AppRoutes";
import { SessionProvider } from "./session/SessionProvider";
import type { TokenStore } from "./session/tokenStore";

export interface AppProps {
  api: Endpoints;
  tokenStore: TokenStore;
  idempotency: IdempotencyManager;
  noticeStore?: KeyValueStore;
}

/** Raíz de la aplicación (el router lo pone main.tsx o la prueba). */
export default function App({ api, tokenStore, idempotency, noticeStore }: AppProps) {
  return (
    <ApiProvider api={api} idempotency={idempotency}>
      <SessionProvider
        api={api}
        tokenStore={tokenStore}
        idempotency={idempotency}
        {...(noticeStore === undefined ? {} : { noticeStore })}
      >
        <AppRoutes />
      </SessionProvider>
    </ApiProvider>
  );
}
