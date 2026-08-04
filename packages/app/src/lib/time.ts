import i18n, { currentLocale, type AppLocale } from "../i18n";

export function formatRelative(
  value: string | null,
  now = new Date(),
  locale: AppLocale = currentLocale(),
): string {
  if (!value) return i18n.t("time.noActivity", { lng: locale });
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return i18n.t("time.unknown", { lng: locale });
  }
  const relativeTime = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
  });
  const seconds = Math.round((timestamp - now.getTime()) / 1_000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return relativeTime.format(seconds, "second");
  if (absolute < 3_600) {
    return relativeTime.format(Math.round(seconds / 60), "minute");
  }
  if (absolute < 86_400) {
    return relativeTime.format(Math.round(seconds / 3_600), "hour");
  }
  return relativeTime.format(Math.round(seconds / 86_400), "day");
}

export function formatDateTime(
  value: string | null,
  locale: AppLocale = currentLocale(),
): string {
  if (!value) return i18n.t("time.unknown", { lng: locale });
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return i18n.t("time.unknown", { lng: locale });
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
