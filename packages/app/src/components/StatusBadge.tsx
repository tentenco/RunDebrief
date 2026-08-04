import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import type { ProjectStatus } from "../types";

const LABEL_KEYS = {
  attention: "common.needsAttention",
  running: "common.running",
  idle: "common.idle",
  stale: "common.stale",
} as const satisfies Record<ProjectStatus, string>;

export function StatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation();
  const label = t(LABEL_KEYS[status]);
  return (
    <span
      className={`status-badge status-${status}`}
      aria-label={t("project.statusAria", { status: label })}
    >
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
};

export function statusLabel(status: ProjectStatus): string {
  return i18n.t(LABEL_KEYS[status]);
}
