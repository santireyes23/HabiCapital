import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { useApi } from "../../api/ApiContext";
import type { MovementPage, MovementRead } from "../../api/types";
import { Icon } from "../../components/Icon";
import {
  arrowDownIcon,
  arrowUpIcon,
  chevronDownIcon,
  plusCircle22Icon,
  refreshIcon,
  selectChevronIcon,
} from "../../components/icons";
import { BalanceCard, HeaderPill, PageHeader } from "../../components/PageHeader";
import { Pagination } from "../../components/Pagination";
import { EmptyState, SectionError, Skeleton } from "../../components/states";
import { shortUuid } from "../../lib/account";
import { formatDateTime } from "../../lib/dates";
import { formatCop, formatSignedCop } from "../../lib/money";
import { useQuery } from "../../lib/useQuery";
import { useActiveAccount, useSession } from "../../session/SessionProvider";
import {
  lastPage,
  offsetFor,
  PAGE_SIZES,
  parseHistoryParams,
  rangeLabel,
  toSearch,
  TYPE_COPY,
  type HistoryParams,
  type PageSize,
} from "./history";

/** «05 — Movimientos» (Figma 6:1428): historial real de GET /accounts/me/movements. */
export function MovementsPage() {
  const account = useActiveAccount();
  // Al cambiar de cuenta el historial se monta de nuevo: nunca se ven datos de otra sesión.
  return <MovementsView key={account.id} />;
}

function MovementsView() {
  const api = useApi();
  const account = useActiveAccount();
  const { refreshAccount } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseHistoryParams(searchParams);
  const { order, limit, page } = params;
  const [expanded, setExpanded] = useState<string | null>(null);

  const navigate = (next: HistoryParams, replace = false) => {
    setExpanded(null);
    setSearchParams(toSearch(next), { replace });
  };

  // Valores inválidos en la URL: se reescriben con los válidos (sin crear otra entrada de historial).
  useEffect(() => {
    if (!params.canonical) setSearchParams(toSearch({ order, limit, page }), { replace: true });
  }, [limit, order, page, params.canonical, setSearchParams]);

  // Saldo real de la cabecera al entrar.
  useEffect(() => {
    const controller = new AbortController();
    refreshAccount(controller.signal).catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [refreshAccount]);

  const movements = useQuery(
    async (signal) => (await api.listMovements({ limit, offset: offsetFor({ limit, page }), order }, { signal })).data,
    [api, limit, order, page],
  );
  const data = movements.state.data;

  // Página fuera de rango (p. ej. ?pagina=99 con 3 páginas): a la última válida.
  const total = movements.state.status === "success" ? movements.state.data.total : null;
  useEffect(() => {
    if (total === null) return;
    const last = lastPage(total, limit);
    if (page > last) setSearchParams(toSearch({ order, limit, page: last }), { replace: true });
  }, [limit, order, page, setSearchParams, total]);

  const loading = movements.state.status === "loading";

  return (
    <>
      <PageHeader
        pill={<HeaderPill>Historial de cuenta</HeaderPill>}
        note="Demostración en vivo"
        title="Mis movimientos"
        description="Consulta el historial de recargas y transferencias de tu cuenta HabiCapital."
        aside={<BalanceCard label="Saldo disponible" balance={account.balance} />}
      />

      <section
        aria-label="Controles de navegación y orden"
        className="flex w-full flex-col gap-4 rounded-card border border-line bg-surface p-[17px] md:flex-row md:items-center md:justify-between"
      >
        <div className="flex flex-wrap items-center gap-4">
          <SelectControl
            label="Ordenar por:"
            value={order}
            options={[
              { value: "desc", label: "Más recientes primero" },
              { value: "asc", label: "Más antiguos primero" },
            ]}
            onChange={(value) => {
              navigate({ order: value === "asc" ? "asc" : "desc", limit, page: 1 });
            }}
          />
          <SelectControl
            label="Mostrar:"
            value={String(limit)}
            options={PAGE_SIZES.map((size) => ({ value: String(size), label: `${size} por página` }))}
            onChange={(value) => {
              navigate({ order, limit: Number(value) as PageSize, page: 1 });
            }}
          />
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            movements.reload();
            void refreshAccount().catch(() => undefined);
          }}
          className="inline-flex items-center justify-center gap-2 rounded-control border border-line bg-surface-sunken px-[17px] py-[9px] text-body-sm font-semibold text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
        >
          <Icon src={refreshIcon} size={18} className={loading ? "animate-spin" : ""} />
          {loading ? "Actualizando…" : "Actualizar historial"}
        </button>
      </section>

      {movements.state.status === "error" && (
        <SectionError title="No se pudo cargar el historial" error={movements.state.error} onRetry={movements.reload} />
      )}

      {data === null && loading && (
        <div aria-busy="true" aria-label="Cargando movimientos" className="flex w-full flex-col gap-3 rounded-card border border-line bg-surface p-6">
          {Array.from({ length: 5 }, (_v, index) => (
            <Skeleton key={index} className="h-12" />
          ))}
        </div>
      )}

      {data !== null && data.total === 0 && (
        <EmptyState
          title="Aún no tienes movimientos"
          action={
            <Link
              to="/recargar"
              className="rounded-control bg-accent px-4 py-2 text-caption font-bold text-on-accent shadow-accent focus-visible:outline-2 focus-visible:outline-accent"
            >
              Recargar saldo
            </Link>
          }
        >
          Tus recargas y transferencias aparecerán aquí en cuanto el servidor las registre.
        </EmptyState>
      )}

      {data !== null && data.total > 0 && (
        <MovementsTable
          page={data}
          current={page}
          limit={limit}
          loading={loading}
          expanded={expanded}
          onToggle={(id) => {
            setExpanded((value) => (value === id ? null : id));
          }}
          onPage={(next) => {
            navigate({ order, limit, page: next });
          }}
        />
      )}
    </>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className="appearance-none rounded-control border border-line bg-field py-[7px] pr-9 pl-[13px] text-caption leading-4 font-semibold text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute top-1/2 right-[9px] -translate-y-1/2 text-cancelled-dot">
          <Icon src={selectChevronIcon} size={18} />
        </span>
      </div>
    </div>
  );
}

const COLUMNS = "md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.15fr)_minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(0,0.65fr)]";

function MovementIcon({ movement }: { movement: MovementRead }) {
  const style =
    movement.type === "TRANSFER_SENT"
      ? { box: "border-danger-soft-border bg-outgoing-bg text-negative", icon: arrowUpIcon }
      : movement.type === "TRANSFER_RECEIVED"
        ? { box: "border-accepted-border bg-accepted-bg text-accent", icon: arrowDownIcon }
        : { box: "border-accepted-border bg-accepted-bg text-accent", icon: plusCircle22Icon };
  return (
    <span className={`flex size-10 shrink-0 items-center justify-center rounded-control border ${style.box}`}>
      <Icon src={style.icon} size={22} />
    </span>
  );
}

function Counterparty({ movement }: { movement: MovementRead }) {
  return movement.counterparty === null ? (
    <>
      <p className="text-body-sm font-semibold text-ink">Sistema HabiCapital</p>
      <p className="font-mono text-overline text-ink-subtle">Depósito de prueba</p>
    </>
  ) : (
    <>
      <p className="truncate text-body-sm font-semibold text-ink">{movement.counterparty.owner_name}</p>
      <p className="font-mono text-overline text-ink-subtle">UUID: {shortUuid(movement.counterparty.account_id)}</p>
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-overline font-bold tracking-[0.55px] text-ink-muted uppercase">{label}</dt>
      <dd className="min-w-0 text-body-sm break-all text-ink">{children}</dd>
    </div>
  );
}

/** Detalle con los datos que ya trae la respuesta (no hay endpoint de detalle). */
function MovementDetail({ movement, id }: { movement: MovementRead; id: string }) {
  return (
    <dl id={id} className="grid grid-cols-1 gap-4 border-t border-line bg-surface-sunken px-6 py-5 sm:grid-cols-2 lg:grid-cols-3">
      <DetailRow label="Transacción">
        <span className="font-mono">{movement.transaction_id}</span>
      </DetailRow>
      <DetailRow label="Tipo de operación">{TYPE_COPY[movement.type].label}</DetailRow>
      <DetailRow label="Fecha y hora">{formatDateTime(movement.created_at)}</DetailRow>
      <DetailRow label="Monto">{formatSignedCop(movement.amount, movement.direction)} COP</DetailRow>
      <DetailRow label="Saldo después del movimiento">{formatCop(movement.balance_after)} COP</DetailRow>
      {movement.description !== null && <DetailRow label="Descripción">{movement.description}</DetailRow>}
      {movement.counterparty !== null && (
        <DetailRow label={movement.direction === "OUT" ? "Enviado a" : "Recibido de"}>
          {movement.counterparty.owner_name}
          <span className="block font-mono text-caption text-ink-subtle">{movement.counterparty.account_id}</span>
        </DetailRow>
      )}
    </dl>
  );
}

function MovementRow({
  movement,
  open,
  onToggle,
}: {
  movement: MovementRead;
  open: boolean;
  onToggle: () => void;
}) {
  const detailId = useId();
  const copy = TYPE_COPY[movement.type];
  const incoming = movement.direction === "IN";
  return (
    <li className="border-t border-line first:border-t-0">
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-6 py-4 md:gap-0 md:py-[22px] ${COLUMNS}`}>
        <div className="flex min-w-0 items-center gap-3.5">
          <MovementIcon movement={movement} />
          <div className="min-w-0">
            <p className="text-[15px] leading-[22.5px] font-bold text-ink md:truncate">{copy.title}</p>
            <p className="text-caption text-ink-muted">{copy.subtitle}</p>
          </div>
        </div>
        <p
          className={`text-right text-title font-extrabold whitespace-nowrap md:hidden ${incoming ? "text-accent" : "text-negative"}`}
        >
          {formatSignedCop(movement.amount, movement.direction)} COP
        </p>
        <div className="min-w-0 md:pl-12">
          <Counterparty movement={movement} />
        </div>
        <p className="text-right text-body-sm font-medium text-ink-muted md:px-6 md:text-left">{formatDateTime(movement.created_at)}</p>
        <p
          className={`hidden text-right text-title font-extrabold whitespace-nowrap md:block md:px-6 ${incoming ? "text-accent" : "text-negative"}`}
        >
          {formatSignedCop(movement.amount, movement.direction)} COP
        </p>
        <div className="col-span-2 flex justify-end md:col-span-1 md:justify-center">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={`${open ? "Ocultar" : "Ver"} detalle de ${copy.title.toLowerCase()} del ${formatDateTime(movement.created_at)}`}
            onClick={onToggle}
            className="flex items-center gap-2 rounded-tab px-1.5 pt-[9.22px] pb-1.5 text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="text-caption font-semibold md:hidden">{open ? "Ocultar detalle" : "Ver detalle"}</span>
            <Icon src={chevronDownIcon} size={18} height={9} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {open && <MovementDetail movement={movement} id={detailId} />}
    </li>
  );
}

function MovementsTable({
  page,
  current,
  limit,
  loading,
  expanded,
  onToggle,
  onPage,
}: {
  page: MovementPage;
  current: number;
  limit: number;
  loading: boolean;
  expanded: string | null;
  onToggle: (id: string) => void;
  onPage: (page: number) => void;
}) {
  const last = lastPage(page.total, limit);
  const { from, to } = rangeLabel(page.offset, page.items.length);
  return (
    <section
      aria-label="Historial de movimientos"
      aria-busy={loading}
      className={`w-full overflow-clip rounded-card border border-line bg-surface p-px shadow-soft transition-opacity ${loading ? "opacity-60" : ""}`}
    >
      <div
        aria-hidden
        className={`hidden border-b border-line bg-surface-sunken text-caption font-bold tracking-[0.6px] text-ink-muted uppercase md:grid ${COLUMNS}`}
      >
        <p className="px-6 py-4">Operación</p>
        <p className="px-6 py-4">Contraparte</p>
        <p className="px-6 py-4">Fecha y hora</p>
        <p className="px-6 py-4 text-right">Monto (COP)</p>
        <p className="px-6 py-4 text-center">Detalle</p>
      </div>
      <ul aria-label="Movimientos">
        {page.items.map((movement) => (
          <MovementRow
            key={movement.transaction_id}
            movement={movement}
            open={expanded === movement.transaction_id}
            onToggle={() => {
              onToggle(movement.transaction_id);
            }}
          />
        ))}
      </ul>
      <div className="flex flex-col gap-3 border-t border-line bg-surface-sunken px-6 pt-[17px] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-ink-muted" aria-live="polite">
          Mostrando <span className="font-bold text-ink-active">{from} - {to}</span> de{" "}
          <span className="font-bold text-ink-active">{page.total}</span> {page.total === 1 ? "movimiento" : "movimientos"}
        </p>
        <Pagination current={current} last={last} loading={loading} onPage={onPage} />
      </div>
      <p className="border-t border-line px-6 py-3 text-overline text-ink-subtle">
        Si llegan movimientos nuevos mientras recorres las páginas, el listado se desplaza: un movimiento puede
        aparecer en dos páginas.
      </p>
    </section>
  );
}
