import {
  Activity,
  Archive,
  BriefcaseBusiness,
  CircleAlert,
  Clock3,
  Database,
  FolderKanban,
  LayoutDashboard,
  PanelLeftClose,
  Pin,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { projectStatus } from "../lib/project-status";
import type {
  Project,
  RuntimeStatus,
  SidebarSelection,
} from "../types";

interface SidebarProps {
  projects: Project[];
  selection: SidebarSelection;
  visible: boolean;
  runtimeStatus: RuntimeStatus | null;
  runtimeError: string | null;
  onSelect(selection: SidebarSelection): void;
  onHide(): void;
}

export function Sidebar({
  projects,
  selection,
  visible,
  runtimeStatus,
  runtimeError,
  onSelect,
  onHide,
}: SidebarProps) {
  const { t } = useTranslation();
  const clients = clientNames(projects);
  const visibleProjects = projects.filter((project) => !project.hidden);
  const healthLabel = sourceHealthLabel(runtimeStatus, runtimeError, t);
  const count = (predicate: (project: Project) => boolean) =>
    projects.filter(predicate).length;
  let shortcut = 1;

  return (
    <aside
      className="sidebar handoff-sidebar"
      aria-label={t("sidebar.ariaLabel")}
      hidden={!visible}
    >
      <div className="sidebar-compact-header">
        <strong>{t("sidebar.workbench")}</strong>
        <button
          className="icon-button sidebar-toggle"
          type="button"
          aria-label={t("toolbar.hideSidebar")}
          aria-keyshortcuts="Meta+Shift+S"
          title={t("toolbar.hideSidebarHelp")}
          onClick={onHide}
        >
          <PanelLeftClose aria-hidden="true" />
        </button>
      </div>

      <nav className="sidebar-nav" aria-label={t("sidebar.navigationLabel")}>
        <p className="sidebar-section-label">{t("sidebar.handoff")}</p>
        <SidebarItem
          active={selection.kind === "all"}
          icon={<LayoutDashboard />}
          label={t("sidebar.overview")}
          count={visibleProjects.length}
          shortcut={shortcut++}
          onClick={() => onSelect({ kind: "all" })}
        />
        <SidebarItem
          active={selection.kind === "attention"}
          icon={<CircleAlert />}
          label={t("sidebar.attention")}
          count={count(
            (project) =>
              !project.hidden && projectStatus(project) === "attention",
          )}
          shortcut={shortcut++}
          onClick={() => onSelect({ kind: "attention" })}
        />
        <SidebarItem
          active={selection.kind === "running"}
          icon={<Activity />}
          label={t("sidebar.running")}
          count={count(
            (project) =>
              !project.hidden && projectStatus(project) === "running",
          )}
          shortcut={shortcut++}
          onClick={() => onSelect({ kind: "running" })}
        />
        <SidebarItem
          active={selection.kind === "recent"}
          icon={<Clock3 />}
          label={t("sidebar.recent")}
          count={visibleProjects.length}
          shortcut={shortcut++}
          onClick={() => onSelect({ kind: "recent" })}
        />
        <SidebarItem
          active={selection.kind === "pinned"}
          icon={<Pin />}
          label={t("sidebar.pinned")}
          count={count((project) => project.pinned && !project.hidden)}
          shortcut={shortcut++}
          onClick={() => onSelect({ kind: "pinned" })}
        />

        {clients.length > 0 && (
          <>
            <p className="sidebar-section-label">{t("common.clients")}</p>
            {clients.map((client) => (
              <SidebarItem
                key={client}
                active={
                  selection.kind === "client" && selection.value === client
                }
                icon={<BriefcaseBusiness />}
                label={client}
                count={count(
                  (project) =>
                    project.client === client && !project.hidden,
                )}
                shortcut={shortcut++}
                onClick={() => onSelect({ kind: "client", value: client })}
              />
            ))}
          </>
        )}

        <p className="sidebar-section-label">{t("common.workspace")}</p>
        <SidebarItem
          active={selection.kind === "internal"}
          icon={<FolderKanban />}
          label={t("common.internal")}
          count={count((project) => !project.client && !project.hidden)}
          shortcut={shortcut++}
          onClick={() => onSelect({ kind: "internal" })}
        />
        <SidebarItem
          active={selection.kind === "hidden"}
          icon={<Archive />}
          label={t("common.hidden")}
          count={count((project) => project.hidden)}
          shortcut={shortcut++}
          onClick={() => onSelect({ kind: "hidden" })}
        />
        <SidebarItem
          active={selection.kind === "settings"}
          icon={<Settings />}
          label={t("sidebar.settings")}
          keyboardShortcut="Meta+,"
          title="⌘,"
          onClick={() => onSelect({ kind: "settings" })}
        />
      </nav>

      <button
        className="source-status-link"
        type="button"
        data-active={selection.kind === "sources"}
        aria-current={selection.kind === "sources" ? "page" : undefined}
        aria-label={`${t("sidebar.sources")}: ${healthLabel}`}
        aria-keyshortcuts={shortcut <= 9 ? `Meta+${shortcut}` : undefined}
        title={healthLabel}
        onClick={() => onSelect({ kind: "sources" })}
      >
        <span className="source-status-icon" aria-hidden="true">
          <Database />
          <span
            className="source-health-dot"
            data-state={sourceHealthState(runtimeStatus, runtimeError)}
          />
        </span>
        <span>
          <strong>{t("sidebar.sources")}</strong>
          <small>{healthLabel}</small>
        </span>
      </button>
    </aside>
  );
}

interface SidebarItemProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  shortcut?: number;
  keyboardShortcut?: string;
  title?: string;
  onClick(): void;
}

function SidebarItem({
  active,
  icon,
  label,
  count,
  shortcut,
  keyboardShortcut,
  title,
  onClick,
}: SidebarItemProps) {
  const { t } = useTranslation();
  return (
    <button
      className="sidebar-item"
      data-active={active}
      type="button"
      aria-current={active ? "page" : undefined}
      aria-keyshortcuts={
        keyboardShortcut ??
        (shortcut !== undefined && shortcut <= 9
          ? `Meta+${shortcut}`
          : undefined)
      }
      title={
        title ??
        (shortcut !== undefined && shortcut <= 9
          ? `⌘${shortcut}`
          : undefined)
      }
      onClick={onClick}
    >
      <span className="sidebar-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
      {count !== undefined && (
        <span
          className="sidebar-count"
          aria-label={t("sidebar.projectCount", { count })}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function sidebarDestinations(projects: Project[]): SidebarSelection[] {
  return [
    { kind: "all" },
    { kind: "attention" },
    { kind: "running" },
    { kind: "recent" },
    { kind: "pinned" },
    ...clientNames(projects).map(
      (value): SidebarSelection => ({ kind: "client", value }),
    ),
    { kind: "internal" },
    { kind: "hidden" },
    { kind: "sources" },
  ];
}

function clientNames(projects: Project[]): string[] {
  return [
    ...new Set(
      projects
        .map((project) => project.client)
        .filter((client): client is string => Boolean(client)),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function sourceHealthState(
  status: RuntimeStatus | null,
  error: string | null,
): "ready" | "attention" | "checking" {
  if (error) return "attention";
  if (!status) return "checking";
  return status.databaseExists && status.daemon.running
    ? "ready"
    : "attention";
}

function sourceHealthLabel(
  status: RuntimeStatus | null,
  error: string | null,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (error) return t("sidebar.sourceStatusError");
  if (!status) return t("sidebar.sourceStatusChecking");
  if (status.databaseExists && status.daemon.running) {
    return t("sidebar.sourceStatusReady");
  }
  if (status.databaseExists) return t("sidebar.sourceStatusDaemon");
  return t("sidebar.sourceStatusMissing");
}
