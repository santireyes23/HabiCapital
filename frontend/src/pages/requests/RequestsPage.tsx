import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { useApi, useIdempotency } from "../../api/ApiContext";
import type { MoneyRequestAccepted, MoneyRequestPage, MoneyRequestRead, MoneyRequestRole } from "../../api/types";
import { Icon } from "../../components/Icon";
import { plusCircle20Icon } from "../../components/icons";
import { HeaderPill, PageHeader } from "../../components/PageHeader";
import { Pagination } from "../../components/Pagination";
import { EmptyState, SectionError, Skeleton } from "../../components/states";
import { Toast } from "../../components/Toast";
import { useRefreshPendingCount } from "../../layout/pendingCount";
import { formatCop } from "../../lib/money";
import { useQuery } from "../../lib/useQuery";
import { useActiveAccount, useSession } from "../../session/SessionProvider";
import { AcceptRecovery } from "./AcceptRecovery";
import { NewRequestPanel } from "./NewRequestPanel";
import { RequestCard } from "./RequestCard";
import {
  acceptPrefix,
  createScope,
  lastRequestPage,
  parseRequestParams,
  pendingAcceptId,
  REQUESTS_PAGE_SIZE,
  STATUS_FILTERS,
  statusOf,
  toRequestSearch,
  type RequestParams,
} from "./requests";

/** «04 — Solicitudes de dinero» (Figma 5:1239). */
export function RequestsPage() {
  const account = useActiveAccount();
  // Al cambiar de cuenta se monta de nuevo: nunca quedan solicitudes de otra sesión a la vista.
  return <RequestsView key={account.id} />;
}

function RequestsView() {
  const api = useApi();
  const idempotency = useIdempotency();
  const account = useActiveAccount();
  const { applyServerBalance, refreshAccount } = useSession();
  const refreshPending = useRefreshPendingCount();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseRequestParams(searchParams);
  const { role, filter, page } = params;
  const status = statusOf(filter);

  const [creating, setCreating] = useState(() => idempotency.pending(createScope(account.id)) !== null);
  const [pendingAccepts, setPendingAccepts] = useState(() => idempotency.pendingByPrefix(acceptPrefix(account.id)));
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  const go = (next: RequestParams, replace = false) => {
    setSearchParams(toRequestSearch(next), { replace });
  };

  useEffect(() => {
    if (!params.canonical) setSearchParams(toRequestSearch({ role, filter, page }), { replace: true });
  }, [filter, page, params.canonical, role, setSearchParams]);

  const list = useQuery(
    async (signal) =>
      (
        await api.listMoneyRequests(
          { role, ...(status === null ? {} : { status }), limit: REQUESTS_PAGE_SIZE, offset: (page - 1) * REQUESTS_PAGE_SIZE, order: "desc" },
          { signal },
        )
      ).data,
    [api, page, role, status],
  );

  // Contadores reales de cada pestaña (todas las solicitudes de ese papel).
  const counts = useQuery(
    async (signal) => {
      const [received, sent] = await Promise.all([
        api.listMoneyRequests({ role: "received", limit: 1 }, { signal }),
        api.listMoneyRequests({ role: "sent", limit: 1 }, { signal }),
      ]);
      return { received: received.data.total, sent: sent.data.total };
    },
    [api],
  );

  const total = list.state.status === "success" ? list.state.data.total : null;
  useEffect(() => {
    if (total === null) return;
    const last = lastRequestPage(total);
    if (page > last) setSearchParams(toRequestSearch({ role, filter, page: last }), { replace: true });
  }, [filter, page, role, setSearchParams, total]);

  const { reload: reloadList } = list;
  const { reload: reloadCounts } = counts;
  const refreshAll = useCallback(() => {
    reloadList();
    reloadCounts();
    refreshPending();
    setPendingAccepts(idempotency.pendingByPrefix(acceptPrefix(account.id)));
  }, [account.id, idempotency, refreshPending, reloadCounts, reloadList]);

  const closeToast = useCallback(() => {
    setToast(null);
  }, []);

  const onAccepted = (result: MoneyRequestAccepted, replayed: boolean) => {
    applyServerBalance(account.id, result.balance);
    void refreshAccount().catch(() => undefined);
    setToast({
      title: replayed ? "Esta solicitud ya había sido pagada" : "Transacción completada",
      message: `${replayed ? "Se confirmó el pago de" : "Pagaste"} ${formatCop(result.amount)} COP a ${result.requester.owner_name}. Saldo actualizado: ${formatCop(result.balance)} COP.`,
    });
    refreshAll();
  };

  const onResolved = (request: MoneyRequestRead, action: "reject" | "cancel") => {
    setToast({
      title: action === "reject" ? "Solicitud rechazada" : "Solicitud cancelada",
      message:
        action === "reject"
          ? `Rechazaste la solicitud de ${request.requester.owner_name} por ${formatCop(request.amount)} COP. No se movió dinero.`
          : `Cancelaste tu solicitud a ${request.payer.owner_name} por ${formatCop(request.amount)} COP. No se movió dinero.`,
    });
    refreshAll();
  };

  const pendingIds = new Set(pendingAccepts.map((operation) => pendingAcceptId(operation)));

  return (
    <>
      <PageHeader
        pill={<HeaderPill>Solicitudes P2P</HeaderPill>}
        note="Gestión de cobros entre cuentas"
        title="Solicitudes de dinero"
        description="Solicita dinero a otra cuenta o responde solicitudes recibidas."
        aside={
          <button
            type="button"
            onClick={() => {
              setCreating(true);
            }}
            disabled={creating}
            className="inline-flex w-fit items-center gap-2 rounded-control bg-accent px-6 py-3 text-body font-bold text-on-accent shadow-accent transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            <Icon src={plusCircle20Icon} size={20} />
            Nueva solicitud
          </button>
        }
      />

      {creating && (
        <NewRequestPanel
          accountId={account.id}
          onClose={() => {
            setCreating(false);
          }}
          onCreated={(request, replayed) => {
            setToast({
              title: replayed ? "Esta solicitud ya se había creado" : "Solicitud creada",
              message: `Le pediste ${formatCop(request.amount)} COP a ${request.payer.owner_name}. No se movió dinero.`,
            });
            refreshAll();
          }}
          onShowSent={() => {
            setCreating(false);
            go({ role: "sent", filter: "todas", page: 1 });
          }}
        />
      )}

      {pendingAccepts.map((operation) => (
        <AcceptRecovery key={operation.scope} operation={operation} onSettled={refreshAll} onAccepted={onAccepted} />
      ))}

      <div className="flex w-full flex-col gap-4 border-b border-line pb-[13px] lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Solicitudes recibidas o enviadas" className="flex items-center gap-2">
          {(["received", "sent"] as MoneyRequestRole[]).map((item) => {
            const active = role === item;
            const count = counts.state.data?.[item];
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  go({ role: item, filter, page: 1 });
                }}
                className={`flex items-center gap-2.5 rounded-control border px-4 py-2 text-body-sm transition focus-visible:outline-2 focus-visible:outline-accent ${
                  active ? "border-line-strong bg-surface font-bold text-ink-active" : "border-transparent font-semibold text-ink-muted hover:text-ink"
                }`}
              >
                {item === "received" ? "Recibidas" : "Enviadas"}
                {count !== undefined && (
                  <span className={`rounded-pill px-2 py-0.5 text-overline font-extrabold ${active ? "bg-canvas text-accent" : "bg-surface-sunken text-ink-muted"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="Filtrar por estado" className="flex w-fit max-w-full flex-wrap items-center gap-y-1 rounded-control border border-line bg-surface-sunken p-[5px]">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => {
                go({ role, filter: item.id, page: 1 });
              }}
              className={`shrink-0 rounded-tab px-3 py-1.5 text-caption transition focus-visible:outline-2 focus-visible:outline-accent ${
                filter === item.id
                  ? "border border-line-strong bg-surface font-bold text-ink-active shadow-soft"
                  : "border border-transparent font-semibold text-ink-muted hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {list.state.status === "error" && (
        <SectionError title="No se pudieron cargar las solicitudes" error={list.state.error} onRetry={list.reload} />
      )}

      {list.state.data === null && list.state.status === "loading" && (
        <div aria-busy="true" aria-label="Cargando solicitudes" className="grid w-full grid-cols-1 gap-6 md:grid-cols-2">
          <Skeleton className="h-[320px] rounded-card" />
          <Skeleton className="h-[320px] rounded-card" />
        </div>
      )}

      {list.state.data !== null && (
        <RequestList
          page={list.state.data}
          current={page}
          loading={list.state.status === "loading"}
          role={role}
          filterLabel={STATUS_FILTERS.find((item) => item.id === filter)?.label ?? "Todas"}
          accountId={account.id}
          pendingIds={pendingIds}
          onPage={(next) => {
            go({ role, filter, page: next });
          }}
          onCreate={() => {
            setCreating(true);
          }}
          events={{
            onChanged: (notice) => {
              if (notice !== undefined) setToast(notice);
              refreshAll();
            },
            onAccepted,
            onResolved,
            onAcceptUncertain: refreshAll,
          }}
        />
      )}

      {toast !== null && <Toast title={toast.title} message={toast.message} onClose={closeToast} />}
    </>
  );
}

function RequestList({
  page,
  current,
  loading,
  role,
  filterLabel,
  accountId,
  pendingIds,
  onPage,
  onCreate,
  events,
}: {
  page: MoneyRequestPage;
  current: number;
  loading: boolean;
  role: MoneyRequestRole;
  filterLabel: string;
  accountId: string;
  pendingIds: Set<string | null>;
  onPage: (page: number) => void;
  onCreate: () => void;
  events: Parameters<typeof RequestCard>[0]["events"];
}) {
  if (page.total === 0) {
    return (
      <EmptyState
        title={
          filterLabel !== "Todas"
            ? `No hay solicitudes ${role === "received" ? "recibidas" : "enviadas"} en «${filterLabel}»`
            : role === "received"
              ? "Nadie te ha pedido dinero todavía"
              : "Aún no has pedido dinero"
        }
        action={
          role === "sent" ? (
            <button
              type="button"
              onClick={onCreate}
              className="rounded-control bg-accent px-4 py-2 text-caption font-bold text-on-accent shadow-accent focus-visible:outline-2 focus-visible:outline-accent"
            >
              Nueva solicitud
            </button>
          ) : undefined
        }
      >
        {role === "received"
          ? "Cuando otra cuenta te pida dinero, aparecerá aquí para que la aceptes o la rechaces."
          : "Las solicitudes que crees aparecerán aquí con su estado."}
      </EmptyState>
    );
  }
  const from = page.offset + 1;
  const to = page.offset + page.items.length;
  return (
    <div aria-busy={loading} className={`flex w-full flex-col gap-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="grid w-full grid-cols-1 items-start gap-6 md:grid-cols-2">
        {page.items.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            accountId={accountId}
            paymentPending={pendingIds.has(request.id)}
            events={events}
          />
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface-sunken px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-ink-muted" aria-live="polite">
          Mostrando <span className="font-bold text-ink-active">{from} - {to}</span> de{" "}
          <span className="font-bold text-ink-active">{page.total}</span> {page.total === 1 ? "solicitud" : "solicitudes"}
        </p>
        <Pagination current={current} last={lastRequestPage(page.total)} loading={loading} onPage={onPage} />
      </div>
    </div>
  );
}
