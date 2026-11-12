import { describe, expect, it } from "vitest";

import { MAX_PAGE_LIMIT, MAX_PAGE_OFFSET } from "../../api/types";
import {
  lastPage,
  maxPageFor,
  offsetFor,
  PAGE_SIZES,
  pageSizesWithinApi,
  pageWindow,
  parseHistoryParams,
  rangeLabel,
  toSearch,
} from "./history";

const parse = (query: string) => parseHistoryParams(new URLSearchParams(query));

describe("parámetros del historial en la URL", () => {
  it("valores por defecto: recientes, 10 por página, página 1", () => {
    expect(parse("")).toEqual({ order: "desc", limit: 10, page: 1, canonical: true });
  });

  it("lee valores válidos", () => {
    expect(parse("orden=antiguos&limite=50&pagina=3")).toEqual({ order: "asc", limit: 50, page: 3, canonical: true });
  });

  it.each([
    ["orden=raro", { order: "desc" }],
    ["limite=7", { limit: 10 }],
    ["limite=100", { limit: 10 }],
    ["pagina=0", { page: 1 }],
    ["pagina=-2", { page: 1 }],
    ["pagina=2.5", { page: 1 }],
    ["pagina=abc", { page: 1 }],
    [`limite=10&pagina=${maxPageFor(10) + 1}`, { page: 1 }],
  ])("«%s» se corrige y se marca para reescribir la URL", (query, expected) => {
    const result = parse(query);
    expect(result).toMatchObject(expected);
    expect(result.canonical).toBe(false);
  });

  it("toSearch produce la URL canónica", () => {
    expect(toSearch({ order: "asc", limit: 20, page: 2 })).toEqual({ orden: "antiguos", limite: "20", pagina: "2" });
  });
});

describe("paginación", () => {
  it("los tamaños ofrecidos respetan el tope de la API", () => {
    expect(PAGE_SIZES).toEqual([10, 20, 50]);
    expect(pageSizesWithinApi()).toBe(true);
    expect(Math.max(...PAGE_SIZES)).toBeLessThanOrEqual(MAX_PAGE_LIMIT);
  });

  it("offset y última página", () => {
    expect(offsetFor({ limit: 20, page: 3 })).toBe(40);
    expect(lastPage(0, 10)).toBe(1);
    expect(lastPage(28, 10)).toBe(3);
    expect(lastPage(30, 10)).toBe(3);
    expect((maxPageFor(10) - 1) * 10).toBeLessThanOrEqual(MAX_PAGE_OFFSET);
  });

  it("ventana de números de página con huecos", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 6, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 15, 16, 17, 18, 19, 20]);
  });

  it("rango «Mostrando X–Y»", () => {
    expect(rangeLabel(0, 5)).toEqual({ from: 1, to: 5 });
    expect(rangeLabel(20, 3)).toEqual({ from: 21, to: 23 });
    expect(rangeLabel(0, 0)).toEqual({ from: 0, to: 0 });
  });
});
