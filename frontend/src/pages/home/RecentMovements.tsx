import type { MovementPage, MovementRead } from "../../api/types";
import { Icon } from "../../components/Icon";
import { cloudCheckIcon, plusCircle22Icon, refreshIcon } from "../../components/icons";
import { CompletedBadge } from "../../components/StatusBadge";
import { EmptyState, SectionError, Skeleton } from "../../components/states";
import { initials, shortUuid } from "../../lib/account";
import { formatDateTime } from "../../lib/dates";
import { formatSignedCop } from "../../lib/money";
import type { QueryState } from "../../lib/useQuery";
import { Link } from "react-router";

const TYPE_LABEL = {
  DEPOSIT: "Recarga interna",
  TRANSFER_SENT: "Transferencia enviada",
  TRANSFER_RECEIVED: "Transferencia recibida",
} as const;

export function movementTitle(movement: MovementRead): string {
  return movement.counterparty?.owner_name ?? "Recarga de saldo simulada";
}

export function movementSubtitle(movement: MovementRead): string {
  const description = movement.description ?? "Sin descripción";
  return movement.counterparty === null
    ? description
    : `${shortUuid(movement.counterparty.account_id)} · ${description}`;
}

function MovementIcon({ movement }: { movement: MovementRead }) {
  if (movement.counterparty === null) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-control border border-accepted-border bg-accepted-bg text-accent">
        <Icon src={plusCircle22Icon} size={22} />
      </div>
    );
  }
  return (
    <div
      className={`flex size-10 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface-sunken text-caption font-bold ${
        movement.direction === "IN" ? "text-accent" : "text-ink"
      }`}
    >
      {initials(movement.counterparty.owner_name)}
    </div>
  );
}

const COLUMNS = "md:grid-cols-[minmax(0,2.1fr)_minmax(0,1.05fr)_minmax(0,0.85fr)_minmax(0,0.9fr)_minmax(0,1fr)]";

function MovementRow({ movement }: { movement: MovementRead }) {
  const incoming = movement.direction === "IN";
  return (
    <li className={`grid grid-cols-1 gap-2 border-t border-line px-6 py-4 first:border-t-0 md:items-center md:gap-0 md:py-[22px] ${COLUMNS}`}>
      <div className="flex min-w-0 items-center gap-4">
        <MovementIcon movement={movement} />
        <div className="min-w-0">
          <p className="truncate text-[15px] leading-[22.5px] font-bold text-ink">{movementTitle(movement)}</p>
          <p className="truncate text-body-sm text-ink-muted">{movementSubtitle(movement)}</p>
        </div>
      </div>
      <p className="text-body-sm font-medium text-ink-muted md:pl-12">{TYPE_LABEL[movement.type]}</p>
      <p className="text-body-sm font-medium text-ink-muted md:px-6">{formatDateTime(movement.created_at)}</p>
      <div className="md:px-6">
        <CompletedBadge />
      </div>
      <p
        className={`text-title font-extrabold whitespace-nowrap md:text-right ${incoming ? "text-accent" : "text-negative"}`}
      >
        {formatSignedCop(movement.amount, movement.direction)} COP
      </p>
    </li>
  );
}

/** «Movimientos recientes» de Inicio (Figma 1:720): los últimos movimientos reales. */
export function RecentMovements({ state, onReload }: { state: QueryState<MovementPage>; onReload: () => void }) {
  const page = state.data;
  const loading = state.status === "loading";

  return (
    <section aria-labelledby="recent-movements-title" className="flex w-full flex-col gap-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="recent-movements-title" className="text-section font-bold text-ink">
            Movimientos recientes
          </h2>
          <p className="text-body-sm text-ink-muted">
            Sincronizado con el registro transaccional en PostgreSQL.
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-[15px] py-[7px] text-caption font-semibold text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
        >
          <Icon src={refreshIcon} size={16} className={loading ? "animate-spin" : ""} />
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {state.status === "error" && (
        <SectionError title="No se pudieron cargar los movimientos" error={state.error} onRetry={onReload} />
      )}

      {page === null && loading && (
        <div aria-busy="true" aria-label="Cargando movimientos" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}

      {page !== null && page.items.length === 0 && (
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
          Las recargas y transferencias de tu cuenta aparecerán aquí.
        </EmptyState>
      )}

      {page !== null && page.items.length > 0 && (
        <div className="w-full overflow-clip rounded-card border border-line bg-surface p-px shadow-soft">
          <div
            aria-hidden
            className={`hidden border-b border-line bg-surface-sunken text-caption font-bold tracking-[0.6px] text-ink-muted uppercase md:grid ${COLUMNS}`}
          >
            <p className="px-6 py-4">Contraparte / Concepto</p>
            <p className="px-6 py-4">Tipo de operación</p>
            <p className="px-6 py-4">Fecha y hora</p>
            <p className="px-6 py-4">Estado</p>
            <p className="px-6 py-4 text-right">Monto (COP)</p>
          </div>
          <ul aria-label="Últimos movimientos">
            {page.items.map((movement) => (
              <MovementRow key={`${movement.transaction_id}-${movement.direction}`} movement={movement} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-sunken px-6 py-4">
            <p className="text-body-sm text-ink-muted">
              {page.items.length} {page.items.length === 1 ? "movimiento cargado" : "movimientos cargados"} desde la base de datos
              {page.total > page.items.length ? ` (de ${page.total} en total)` : ""}
            </p>
            <p className="flex items-center gap-1.5 text-body-sm font-bold text-accent">
              <Icon src={cloudCheckIcon} size={18} />
              Conexión API activa
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
