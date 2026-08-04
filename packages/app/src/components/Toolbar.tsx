import {
  Command,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ThemePreference } from "../lib/view-preferences";
import { AppMark } from "./AppMark";

interface ToolbarProps {
  query: string;
  sidebarVisible: boolean;
  theme: ThemePreference;
  searchRef: React.RefObject<HTMLInputElement | null>;
  commandButtonRef: React.RefObject<HTMLButtonElement | null>;
  onQueryChange(value: string): void;
  onToggleSidebar(): void;
  onOpenCommand(): void;
  onToggleTheme(): void;
}

export function Toolbar({
  query,
  sidebarVisible,
  theme,
  searchRef,
  commandButtonRef,
  onQueryChange,
  onToggleSidebar,
  onOpenCommand,
  onToggleTheme,
}: ToolbarProps) {
  const { t } = useTranslation();
  return (
    <header className="toolbar window-toolbar">
      <div className="toolbar-identity" aria-label="Debrief">
        <AppMark decorative />
        <strong>Debrief</strong>
      </div>

      <label className="global-search">
        <Search aria-hidden="true" />
        <span className="sr-only">{t("toolbar.search")}</span>
        <input
          ref={searchRef}
          type="search"
          aria-label={t("toolbar.search")}
          aria-keyshortcuts="Meta+F"
          value={query}
          placeholder={t("toolbar.searchPlaceholder")}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            aria-label={t("toolbar.clearSearch")}
            onClick={() => onQueryChange("")}
          >
            <X aria-hidden="true" />
          </button>
        ) : (
          <kbd>⌘F</kbd>
        )}
      </label>

      <div className="toolbar-actions">
        <button
          ref={commandButtonRef}
          className="toolbar-command"
          type="button"
          aria-label={t("toolbar.openCommand")}
          aria-keyshortcuts="Meta+K"
          title={t("toolbar.commandHelp")}
          onClick={onOpenCommand}
        >
          <Command aria-hidden="true" />
          <span>{t("toolbar.command")}</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={
            theme === "light" ? t("toolbar.darkMode") : t("toolbar.lightMode")
          }
          onClick={onToggleTheme}
        >
          {theme === "light" ? (
            <Moon aria-hidden="true" />
          ) : (
            <Sun aria-hidden="true" />
          )}
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={
            sidebarVisible
              ? t("toolbar.hideSidebar")
              : t("toolbar.showSidebar")
          }
          aria-keyshortcuts="Meta+Shift+S"
          title={
            sidebarVisible
              ? t("toolbar.hideSidebarHelp")
              : t("toolbar.showSidebarHelp")
          }
          onClick={onToggleSidebar}
        >
          {sidebarVisible ? (
            <PanelLeftClose aria-hidden="true" />
          ) : (
            <PanelLeftOpen aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
