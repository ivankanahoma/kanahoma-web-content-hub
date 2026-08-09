import { CLIENT_TIMEZONE } from "./queue";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every timestamp the hub shows is in the client's timezone, never the viewer's.
 *
 * Date-only values are the exception, and getting this wrong is silent: `new Date("2026-09-07")`
 * is parsed as UTC midnight, which converts to the *previous* day in any zone behind UTC.
 * A deadline of the 7th would render as the 6th. Calendar dates carry no timezone, so
 * they are formatted as written.
 */
export function formatDate(value, timeZone = CLIENT_TIMEZONE) {
  if (!value) return null;

  const isDateOnly = typeof value === "string" && DATE_ONLY.test(value);
  const parsed = isDateOnly ? new Date(`${value}T12:00:00`) : new Date(value);

  return parsed.toLocaleDateString("en-US", {
    ...(isDateOnly ? {} : { timeZone }),
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatClock(timeZone) {
  return new Date().toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Hours-until-due split into parts so the row can render the number large and the
 * qualifier small. Under two days reads in hours, beyond that in days.
 */
export function formatDue(hours) {
  if (hours == null) return null;
  const overdue = hours < 0;
  const abs = Math.abs(hours);

  const useHours = abs < 48;
  return {
    value: useHours ? Math.max(1, Math.round(abs)) : Math.round(abs / 24),
    unit: useHours ? "h" : "d",
    overdue,
  };
}

export function pluralDays(n) {
  if (n == null) return null;
  return `${n} ${n === 1 ? "day" : "days"}`;
}
