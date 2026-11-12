/**
 * Estado del historial en la URL (?orden=&limite=&pagina=) y utilidades de paginación, validados
 * contra los límites reales de GET /accounts/me/movements (limit 1–100, offset 0–1.000.000).
 */

import { MAX_PAGE_LIMIT, MAX_PAGE_OFFSET, type MovementRead, type SortOrder } from "../../api/types";

export const PAGE_SIZES = [10, 20, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const ORDER_PARAM = "orden";
export const LIMIT_PARAM = "limite";
export const PAGE_PARAM = "pagina";

const ORDER_VALUES = { recientes: "desc", antiguos: "asc" } as const satisfies Record<string, SortOrder>;
type OrderValue = keyof typeof ORDER_VALUES;

export interface HistoryParams {
  order: SortOrder;
  limit: PageSize;
  page: number;
}

export const DEFAULT_PARAMS: HistoryParams = { order: "desc", limit: 10, page: 1 };

/** Página más alta cuyo offset sigue dentro del tope de la API. */
export function maxPageFor(limit: number): number {
  return Math.floor(MAX_PAGE_OFFSET / limit) + 1;
}

/**
 * Lee la URL. Cualquier valor fuera de lo permitido se sustituye por el predeterminado y se indica
 * `canonical: false` para que la pantalla reescriba la URL con valores válidos.
 */
export function parseHistoryParams(search: URLSearchParams): HistoryParams & { canonical: boolean } {
  const rawOrder = search.get(ORDER_PARAM);
  const rawLimit = search.get(LIMIT_PARAM);
  const rawPage = search.get(PAGE_PARAM);

  const order = rawOrder !== null && rawOrder in ORDER_VALUES ? ORDER_VALUES[rawOrder as OrderValue] : DEFAULT_PARAMS.order;
  const limitNumber = rawLimit !== null && /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const limit = (PAGE_SIZES as readonly number[]).includes(limitNumber) ? (limitNumber as PageSize) : DEFAULT_PARAMS.limit;
  const pageNumber = rawPage !== null && /^\d{1,7}$/.test(rawPage) ? Number(rawPage) : NaN;
  const page = Number.isSafeInteger(pageNumber) && pageNumber >= 1 && pageNumber <= maxPageFor(limit) ? pageNumber : 1;

  const canonical =
    (rawOrder === null || ORDER_VALUES[rawOrder as OrderValue] === order) &&
    (rawLimit === null || limitNumber === limit) &&
    (rawPage === null || pageNumber === page);
  return { order, limit, page, canonical };
}

export function toSearch({ order, limit, page }: HistoryParams): Record<string, string> {
  return {
    [ORDER_PARAM]: order === "desc" ? "recientes" : "antiguos",
    [LIMIT_PARAM]: String(limit),
    [PAGE_PARAM]: String(page),
  };
}

export function offsetFor({ limit, page }: Pick<HistoryParams, "limit" | "page">): number {
  return (page - 1) * limit;
}

export function lastPage(total: number, limit: number): number {
  return Math.max(1, Math.min(Math.ceil(total / limit), maxPageFor(limit)));
}

export { pageWindow } from "../../components/Pagination";

/** «Mostrando X–Y de N». */
export function rangeLabel(offset: number, count: number): { from: number; to: number } {
  return count === 0 ? { from: 0, to: 0 } : { from: offset + 1, to: offset + count };
}

export const TYPE_COPY: Record<MovementRead["type"], { title: string; subtitle: string; label: string }> = {
  DEPOSIT: { title: "Recarga simulada", subtitle: "Acreditación directa", label: "Recarga" },
  TRANSFER_SENT: { title: "Transferencia enviada", subtitle: "Débito entre cuentas", label: "Transferencia enviada" },
  TRANSFER_RECEIVED: { title: "Transferencia recibida", subtitle: "Crédito entre cuentas", label: "Transferencia recibida" },
};

/** El tope de la API por página es 100: los tamaños ofrecidos deben respetarlo. */
export function pageSizesWithinApi(): boolean {
  return PAGE_SIZES.every((size) => size <= MAX_PAGE_LIMIT);
}
