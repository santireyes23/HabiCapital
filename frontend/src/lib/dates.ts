/**
 * Fechas del backend (ISO 8601 con zona) mostradas en hora de Colombia, con el estilo del
 * diseño: «Hoy, 10:45 AM», «Ayer, 04:30 PM», «11 Nov, 06:15 PM», «10 Nov, 2026».
 */

export const TIME_ZONE = "America/Bogota";

const dayFormat = new Intl.DateTimeFormat("es-CO", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function toDate(value: string | Date): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error("Fecha inválida");
  return date;
}

interface CalendarDay {
  year: number;
  month: number; // 1-12
  day: number;
}

function calendarDay(date: Date): CalendarDay {
  const parts = dayFormat.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function dayNumber({ year, month, day }: CalendarDay): number {
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** "10:45 AM" en hora de Colombia. */
export function formatTime(value: string | Date): string {
  const parts = partsFormat.formatToParts(toDate(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

/** «Hoy, 10:45 AM», «Ayer, 04:30 PM» o «11 Nov, 06:15 PM». */
export function formatDateTime(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value);
  const day = calendarDay(date);
  const diff = dayNumber(calendarDay(now)) - dayNumber(day);
  const time = formatTime(date);
  if (diff === 0) return `Hoy, ${time}`;
  if (diff === 1) return `Ayer, ${time}`;
  const month = MONTHS[day.month - 1] ?? "";
  return `${day.day} ${month}, ${time}`;
}

/** «10 Nov, 2026». */
export function formatDate(value: string | Date): string {
  const day = calendarDay(toDate(value));
  return `${day.day} ${MONTHS[day.month - 1] ?? ""}, ${day.year}`;
}
