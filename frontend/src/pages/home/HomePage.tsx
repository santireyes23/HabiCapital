import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useApi } from "../../api/ApiContext";
import { ApiError } from "../../api/errors";
import type { MoneyRequestPage } from "../../api/types";
import { Icon } from "../../components/Icon";
import { arrowRight24Icon, databaseIcon, plusCircle26Icon, send26Icon } from "../../components/icons";
import { PageHeader } from "../../components/PageHeader";
import { ServerStatusBadge } from "../../components/ServerStatusBadge";
import { EmptyState, SectionError, Skeleton } from "../../components/states";
import { shortUuid } from "../../lib/account";
import { formatCop } from "../../lib/money";
import { type QueryState, useQuery } from "../../lib/useQuery";
import { useActiveAccount, useSession } from "../../session/SessionProvider";
import { MoneyRequestCard } from "./MoneyRequestCard";
import { RecentMovements } from "./RecentMovements";
import { mergeRecent } from "./requestCopy";

/** Cuántas solicitudes y movimientos muestra Inicio (como en Figma: 2×2 y 4 filas). */
export const HOME_REQUESTS = 4;
export const HOME_MOVEMENTS = 4;

type RequestTab = "todas" | "recibidas" | "enviadas";

/** «Inicio» (Figma 1:415) con datos reales de FastAPI. */
export function HomePage() {
  const api = useApi();
  const account = useActiveAccount();
  const { refreshAccount } = useSession();
  const [balanceError, setBalanceError] = useState<ApiError | null>(null);
  const [balanceAttempt, setBalanceAttempt] = useState(0);
  const [refreshingBalance, setRefreshingBalance] = useState(true);

  // El saldo se vuelve a pedir a GET /accounts/me al entrar (nunca se calcula en el navegador).
  useEffect(() => {
    const controller = new AbortController();
    refreshAccount(controller.signal)
      .then(() => {
        if (controller.signal.aborted) return;
        setBalanceError(null);
        setRefreshingBalance(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setBalanceError(error instanceof ApiError ? error : new ApiError("network", "Error inesperado"));
        setRefreshingBalance(false);
      });
    return () => {
      controller.abort();
    };
  }, [balanceAttempt, refreshAccount]);

  const requests = useQuery(
    async (signal) => {
      const [received, sent] = await Promise.all([
        api.listMoneyRequests({ role: "received", limit: HOME_REQUESTS, order: "desc" }, { signal }),
        api.listMoneyRequests({ role: "sent", limit: HOME_REQUESTS, order: "desc" }, { signal }),
      ]);
      return { received: received.data, sent: sent.data };
    },
    [api],
  );

  const movements = useQuery(
    async (signal) =>
      (await api.listMovements({ limit: HOME_MOVEMENTS, offset: 0, order: "desc" }, { signal })).data,
    [api],
  );

  return (
    <>
      <PageHeader
        pill={<ServerStatusBadge checkHealth={api.health} />}
        note={`Cuenta: ${shortUuid(account.id)} · Token Bearer activo`}
        title="Tu dinero, en movimiento."
        description="Billetera web en tiempo real. Ejecuta transferencias atómicas simuladas, consulta balances y resuelve solicitudes de pago entre cuentas."
      />

      <section aria-label="Saldo y operaciones principales" className="grid w-full grid-cols-1 gap-6 lg:grid-cols-12">
        <BalanceCard
          balance={account.balance}
          refreshing={refreshingBalance}
          error={balanceError}
          onRetry={() => {
            setRefreshingBalance(true);
            setBalanceAttempt((value) => value + 1);
          }}
        />
        <div className="flex flex-col gap-4 lg:col-span-5">
          <Link
            to="/enviar"
            className="flex items-center justify-between gap-2 rounded-card border border-accent bg-accent px-[29px] py-8 shadow-[0_4px_10px_rgb(199_255_88/0.15)] transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:py-[52px]"
          >
            <span className="flex min-w-0 items-center gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-canvas text-accent">
                <Icon src={send26Icon} size={26} />
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <span className="text-card-title leading-[24.75px] font-bold text-on-accent">Enviar dinero</span>
                <span className="text-body-sm font-medium text-on-accent/85">Transferencia simulada inmediata por UUID</span>
              </span>
            </span>
            <span className="text-on-accent">
              <Icon src={arrowRight24Icon} size={24} />
            </span>
          </Link>
          <Link
            to="/recargar"
            className="flex items-center justify-between gap-4 rounded-card border border-line bg-surface px-[29px] py-8 transition hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:py-[52px]"
          >
            <span className="flex min-w-0 items-center gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface-sunken text-accent">
                <Icon src={plusCircle26Icon} size={26} />
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <span className="text-card-title leading-[24.75px] font-bold text-ink">Recargar saldo simulado</span>
                <span className="text-body-sm font-medium text-ink-muted">Suma fondos ficticios a tu balance de prueba</span>
              </span>
            </span>
            <span className="text-ink-muted">
              <Icon src={arrowRight24Icon} size={24} />
            </span>
          </Link>
        </div>
      </section>

      <RequestsSummary state={requests.state} onReload={requests.reload} accountId={account.id} />

      <RecentMovements state={movements.state} onReload={movements.reload} />
    </>
  );
}

function BalanceCard({
  balance,
  refreshing,
  error,
  onRetry,
}: {
  balance: number;
  refreshing: boolean;
  error: ApiError | null;
  onRetry: () => void;
}) {
  return (
    <article
      aria-label="Saldo total disponible"
      aria-busy={refreshing}
      className="flex flex-col justify-between gap-6 overflow-clip rounded-card border border-line bg-surface p-6 sm:p-[33px] lg:col-span-7"
    >
      <div className="flex flex-col gap-[7px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2.5 text-body-sm font-bold tracking-[0.65px] text-ink-muted uppercase">
            <span aria-hidden className="size-2.5 rounded-pill bg-accent" />
            Saldo total disponible
          </p>
          <p className="flex items-center gap-1.5 rounded-pill border border-line bg-canvas px-3 py-[5px] text-overline font-semibold text-ink-muted">
            <span className="text-accent">
              <Icon src={databaseIcon} size={14} />
            </span>
            Saldo simulado COP
          </p>
        </div>
        <p className="flex flex-wrap items-baseline gap-3 pt-[9px] whitespace-nowrap">
          <span className="text-[40px] leading-[60px] font-extrabold tracking-[-1px] text-ink sm:text-[50px] sm:leading-[75px] sm:tracking-[-1.25px]">
            {formatCop(balance)}
          </span>
          <span className="text-[20px] leading-[30px] font-bold text-ink-muted">COP</span>
        </p>
        <p className="text-body-sm leading-[21.13px] text-ink-muted">
          Fondos calculados a partir del registro transaccional en base de datos.
        </p>
      </div>
      {error !== null && (
        <SectionError title="No se pudo actualizar el saldo" error={error} onRetry={onRetry} />
      )}
    </article>
  );
}

function RequestsSummary({
  state,
  onReload,
  accountId,
}: {
  state: QueryState<{ received: MoneyRequestPage; sent: MoneyRequestPage }>;
  onReload: () => void;
  accountId: string;
}) {
  const [tab, setTab] = useState<RequestTab>("todas");
  const data = state.data;
  const receivedTotal = data?.received.total ?? 0;
  const sentTotal = data?.sent.total ?? 0;
  const tabs: { id: RequestTab; label: string; count: number }[] = [
    { id: "todas", label: "Todas", count: receivedTotal + sentTotal },
    { id: "recibidas", label: "Recibidas", count: receivedTotal },
    { id: "enviadas", label: "Enviadas", count: sentTotal },
  ];

  const visible =
    data === null
      ? []
      : tab === "recibidas"
        ? data.received.items.slice(0, HOME_REQUESTS)
        : tab === "enviadas"
          ? data.sent.items.slice(0, HOME_REQUESTS)
          : mergeRecent(data.received.items, data.sent.items, HOME_REQUESTS);

  return (
    <section aria-labelledby="home-requests-title" className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="home-requests-title" className="text-section font-bold text-ink">
              Solicitudes de dinero
            </h2>
            {data !== null && (
              <span className="rounded-pill border border-line bg-surface px-[11px] py-[3px] text-caption font-bold text-accent">
                {receivedTotal + sentTotal} {receivedTotal + sentTotal === 1 ? "registrada" : "registradas"}
              </span>
            )}
          </div>
          <p className="text-body-sm text-ink-muted">
            Endpoint FastAPI: <span className="font-mono">GET /money-requests</span> (enviadas y recibidas).
          </p>
        </div>
        <div role="tablist" aria-label="Filtrar solicitudes" className="flex rounded-control border border-line bg-surface-sunken p-[5px]">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => {
                setTab(item.id);
              }}
              className={`rounded-tab px-[14px] py-[7px] text-caption transition focus-visible:outline-2 focus-visible:outline-accent ${
                tab === item.id
                  ? "border border-line-strong bg-surface font-bold text-ink-active shadow-soft"
                  : "border border-transparent font-semibold text-ink-muted hover:text-ink"
              }`}
            >
              {item.label}
              {data !== null && ` (${item.count})`}
            </button>
          ))}
        </div>
      </div>

      {state.status === "error" && (
        <SectionError title="No se pudieron cargar las solicitudes" error={state.error} onRetry={onReload} />
      )}

      {data === null && state.status === "loading" && (
        <div aria-busy="true" aria-label="Cargando solicitudes" className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Skeleton className="h-[230px] rounded-card" />
          <Skeleton className="h-[230px] rounded-card" />
        </div>
      )}

      {data !== null && visible.length === 0 && (
        <EmptyState
          title={
            tab === "recibidas"
              ? "Nadie te ha pedido dinero todavía"
              : tab === "enviadas"
                ? "Aún no has pedido dinero"
                : "Aún no tienes solicitudes"
          }
          action={
            <Link
              to="/solicitudes"
              className="rounded-control border border-line bg-surface-sunken px-4 py-2 text-caption font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              Ir a Solicitudes
            </Link>
          }
        >
          Las solicitudes que envíes o recibas aparecerán aquí.
        </EmptyState>
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {visible.map((request) => (
            <MoneyRequestCard key={request.id} request={request} accountId={accountId} />
          ))}
        </div>
      )}
    </section>
  );
}
