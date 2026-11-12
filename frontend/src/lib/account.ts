/** Presentación de datos públicos de una cuenta (nombre y UUID). */

const graphemes = new Intl.Segmenter("es-CO", { granularity: "grapheme" });

function firstGraphemes(word: string, count: number): string {
  return Array.from(graphemes.segment(word), (part) => part.segment)
    .slice(0, count)
    .join("");
}

/** «Camilo Aristizábal» -> «CA»; una sola palabra -> sus dos primeras letras. */
export function initials(ownerName: string): string {
  const words = ownerName.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  const letters =
    words.length >= 2 ? firstGraphemes(first, 1) + firstGraphemes(last, 1) : firstGraphemes(first, 2);
  return letters.toLocaleUpperCase("es-CO");
}

/** «e8d24a91-9c3f-…-6102f83c5d99» -> «e8d2...5d99», como en la barra lateral de Figma. */
export function shortUuid(uuid: string): string {
  const compact = uuid.replaceAll("-", "");
  return compact.length <= 8 ? uuid : `${compact.slice(0, 4)}...${compact.slice(-4)}`;
}
