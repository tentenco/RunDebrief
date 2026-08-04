import {
  Activity,
  Archive,
  CircleAlert,
  Clock3,
  Database,
  LayoutDashboard,
  Pin,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentLocale } from "../i18n";
import type { Project, SidebarSelection } from "../types";

interface CommandPaletteProps {
  projects: Project[];
  onClose(): void;
  onPage(selection: SidebarSelection): void;
  onProject(project: Project): void;
}

interface PageCommand {
  kind: "page";
  id: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  selection: SidebarSelection;
}

interface ProjectCommand {
  kind: "project";
  id: string;
  label: string;
  detail: string;
  project: Project;
}

type PaletteCommand = PageCommand | ProjectCommand;

const FOCUSABLE_SELECTOR = [
  "input:not([disabled])",
  "button:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

export function CommandPalette({
  projects,
  onClose,
  onPage,
  onProject,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const normalizedQuery = query
    .trim()
    .toLocaleLowerCase(currentLocale());
  const pageCommands = useMemo<PageCommand[]>(
    () => [
      {
        kind: "page",
        id: "overview",
        label: t("command.pages.overview"),
        detail: t("command.pages.overviewDetail"),
        icon: LayoutDashboard,
        selection: { kind: "all" },
      },
      {
        kind: "page",
        id: "attention",
        label: t("command.pages.attention"),
        detail: t("command.pages.attentionDetail"),
        icon: CircleAlert,
        selection: { kind: "attention" },
      },
      {
        kind: "page",
        id: "running",
        label: t("command.pages.running"),
        detail: t("command.pages.runningDetail"),
        icon: Activity,
        selection: { kind: "running" },
      },
      {
        kind: "page",
        id: "recent",
        label: t("command.pages.recent"),
        detail: t("command.pages.recentDetail"),
        icon: Clock3,
        selection: { kind: "recent" },
      },
      {
        kind: "page",
        id: "pinned",
        label: t("command.pages.pinned"),
        detail: t("command.pages.pinnedDetail"),
        icon: Pin,
        selection: { kind: "pinned" },
      },
      {
        kind: "page",
        id: "hidden",
        label: t("command.pages.hidden"),
        detail: t("command.pages.hiddenDetail"),
        icon: Archive,
        selection: { kind: "hidden" },
      },
      {
        kind: "page",
        id: "sources",
        label: t("command.pages.sources"),
        detail: t("command.pages.sourcesDetail"),
        icon: Database,
        selection: { kind: "sources" },
      },
      {
        kind: "page",
        id: "settings",
        label: t("command.pages.settings"),
        detail: t("command.pages.settingsDetail"),
        icon: Settings,
        selection: { kind: "settings" },
      },
    ],
    [t],
  );
  const commands = useMemo<PaletteCommand[]>(() => {
    const pages = pageCommands.filter((command) =>
      [command.label, command.detail]
        .join(" ")
        .toLocaleLowerCase(currentLocale())
        .includes(normalizedQuery),
    );
    const projectCommands = projects
      .filter((project) => {
        if (!normalizedQuery) return !project.hidden;
        return [
          project.name,
          project.path,
          project.client ?? t("common.internal"),
          project.latestSession?.gitBranch ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase(currentLocale())
          .includes(normalizedQuery);
      })
      .slice(0, normalizedQuery ? 8 : 5)
      .map(
        (project): ProjectCommand => ({
          kind: "project",
          id: String(project.id),
          label: project.name,
          detail: t("command.projectDetail", {
            client: project.client ?? t("common.internal"),
            tool: project.latestSession?.tool ?? t("common.noSession"),
          }),
          project,
        }),
      );
    return [...pages, ...projectCommands];
  }, [normalizedQuery, pageCommands, projects, t]);

  useEffect(() => {
    setActiveIndex((current) =>
      Math.max(0, Math.min(current, commands.length - 1)),
    );
  }, [commands.length]);

  const run = (command: PaletteCommand | undefined) => {
    if (!command) return;
    if (command.kind === "page") onPage(command.selection);
    else onProject(command.project);
  };

  const containTabFocus = (
    event: React.KeyboardEvent<HTMLElement>,
  ) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTOR,
      ),
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.hasAttribute("hidden") &&
        element.getAttribute("aria-hidden") !== "true",
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }

    const active = document.activeElement;
    if (first === last) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (
      event.shiftKey &&
      (active === first || !event.currentTarget.contains(active))
    ) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (
      !event.shiftKey &&
      (active === last || !event.currentTarget.contains(active))
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="command-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("command.ariaLabel")}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={containTabFocus}
      >
        <label className="command-search">
          <Search aria-hidden="true" />
          <span className="sr-only">{t("command.search")}</span>
          <input
            autoFocus
            role="combobox"
            aria-label={t("command.search")}
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={
              commands[activeIndex]
                ? `command-${commands[activeIndex].kind}-${commands[activeIndex].id}`
                : undefined
            }
            value={query}
            placeholder={t("command.placeholder")}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!commands.length) return;
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveIndex(
                  (current) =>
                    (current + direction + commands.length) %
                    commands.length,
                );
                return;
              }
              if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                setActiveIndex(event.key === "Home" ? 0 : commands.length - 1);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                run(commands[activeIndex]);
              }
            }}
          />
          <kbd>ESC</kbd>
        </label>

        <div className="command-results" id={listboxId} role="listbox">
          {commands.map((command, index) => {
            const Icon = command.kind === "page" ? command.icon : null;
            return (
              <button
                key={`${command.kind}-${command.id}`}
                id={`command-${command.kind}-${command.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-active={index === activeIndex}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => run(command)}
              >
                <span className="command-result-icon" aria-hidden="true">
                  {Icon ? (
                    <Icon />
                  ) : (
                    command.label.slice(0, 1).toLocaleUpperCase()
                  )}
                </span>
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.detail}</small>
                </span>
                <kbd>↩</kbd>
              </button>
            );
          })}
          {commands.length === 0 && (
            <p className="command-empty">{t("command.empty")}</p>
          )}
        </div>

        <footer className="command-footer">
          <span>
            <kbd>↑↓</kbd> {t("command.select")}
          </span>
          <span>
            <kbd>↩</kbd> {t("command.open")}
          </span>
          <span>
            <kbd>ESC</kbd> {t("command.close")}
          </span>
        </footer>
      </section>
    </div>
  );
}
