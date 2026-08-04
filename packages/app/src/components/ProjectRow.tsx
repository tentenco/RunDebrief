import {
  Check,
  Code2,
  Copy,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  TerminalSquare,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectStatus } from "../lib/project-status";
import { sessionUsageDescription } from "../lib/session-usage";
import { formatRelative } from "../lib/time";
import type {
  ApplicationCapabilities,
  Project,
  ProjectPatch,
} from "../types";
import { AgentUsageCell } from "./AgentUsage";
import { StatusBadge, statusLabel } from "./StatusBadge";

interface ProjectRowProps {
  project: Project;
  busy: boolean;
  rowIndex: number;
  active: boolean;
  selected: boolean;
  applications: ApplicationCapabilities | null;
  onOpen(): void;
  onFocus(): void;
  onNavigate(direction: "up" | "down" | "first" | "last"): void;
  onTerminal(): void;
  onEditor(): void;
  onVisualStudioCode(): void;
  onWarp(): void;
  onCopyRecap(): void;
  onAcknowledge(): void;
  onUpdate(patch: ProjectPatch): void;
}

export function ProjectRow({
  project,
  busy,
  rowIndex,
  active,
  selected,
  applications,
  onOpen,
  onFocus,
  onNavigate,
  onTerminal,
  onEditor,
  onVisualStudioCode,
  onWarp,
  onCopyRecap,
  onAcknowledge,
  onUpdate,
}: ProjectRowProps) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [client, setClient] = useState(project.client ?? "");
  const [menuPlacement, setMenuPlacement] = useState<"bottom" | "top">(
    "bottom",
  );
  const menuRef = useRef<HTMLDetailsElement>(null);
  const menuSummaryRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const status = projectStatus(project);
  const session = project.latestSession;
  const summary = session?.summary;
  const handoff = summary?.blockedReason ?? summary?.nextSteps[0] ?? null;
  const running = project.liveStatus !== null;
  const namedEditor =
    applications?.editor?.kind === "visual-studio-code"
      ? !applications.visualStudioCode && applications.editor.available
        ? applications.editor
        : null
      : applications?.editor ?? null;
  const useConfiguredVisualStudioCode =
    namedEditor?.kind === "visual-studio-code";
  const usageDescription = sessionUsageDescription(
    session,
    running,
    t,
    i18n.resolvedLanguage ?? i18n.language,
  );

  const submitEdit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onUpdate({
      name: trimmedName,
      client: client.trim() || null,
    });
    setEditing(false);
  };

  return (
    <article
      className="handoff-project-row"
      data-selected={selected}
      data-status={status}
      role="listitem"
      data-testid={`project-card-${project.id}`}
    >
      <button
        className="handoff-row-main"
        type="button"
        data-project-index={rowIndex}
        tabIndex={active ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        aria-label={t("project.rowAria", {
          project: project.name,
          status: statusLabel(status),
          time: formatRelative(project.lastActivityAt),
          usage: usageDescription,
        })}
        onClick={onOpen}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.metaKey && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            onCopyRecap();
            return;
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            onNavigate(event.key === "ArrowUp" ? "up" : "down");
            return;
          }
          if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            onNavigate(event.key === "Home" ? "first" : "last");
          }
        }}
      >
        <span className="handoff-row-status">
          <StatusBadge status={status} />
        </span>
        <span className="handoff-row-project">
          <span className="handoff-row-title">
            <strong>{project.name}</strong>
            {project.pinned && <Pin aria-label={t("project.pinned")} />}
          </span>
          <span className="handoff-row-meta">
            <span>{project.client ?? t("common.internal")}</span>
            <span aria-hidden="true">·</span>
            <code>{session?.gitBranch ?? t("common.noBranch")}</code>
          </span>
        </span>
        <AgentUsageCell
          session={session}
          running={running}
          variant="row"
        />
        <span className="handoff-row-next">
          <small>
            {summary?.blocked ? t("project.blocked") : t("project.nextStep")}
          </small>
          <span>
            {handoff ??
              (project.summaryState === "awaiting-summary"
                ? t("project.waitingSummary")
                : t("project.noNextStep"))}
          </span>
        </span>
        <span className="handoff-row-activity">
          <strong>{t("project.lastActivity")}</strong>
          <small>{formatRelative(project.lastActivityAt)}</small>
        </span>
      </button>

      <div className="handoff-row-action">
        <details
          className="handoff-row-menu"
          ref={menuRef}
          data-placement={menuPlacement}
          onKeyDown={(event) => {
            if (
              event.key !== "Escape" ||
              !menuRef.current?.hasAttribute("open")
            ) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            menuRef.current.removeAttribute("open");
            menuSummaryRef.current?.focus();
          }}
          onToggle={(event) => {
            if (!event.currentTarget.open) return;
            window.requestAnimationFrame(() => {
              const menuBox = menuRef.current?.getBoundingClientRect();
              const popover = popoverRef.current;
              if (!menuBox || !popover) return;
              const spaceBelow = window.innerHeight - menuBox.bottom;
              const spaceAbove = menuBox.top;
              setMenuPlacement(
                spaceBelow < popover.scrollHeight &&
                  spaceAbove > spaceBelow
                  ? "top"
                  : "bottom",
              );
            });
          }}
        >
          <summary
            ref={menuSummaryRef}
            aria-label={t("project.moreActions", { project: project.name })}
          >
            <MoreHorizontal aria-hidden="true" />
          </summary>
          <div
            className="handoff-row-menu-popover"
            ref={popoverRef}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("button:not(:disabled)")) {
                menuRef.current?.removeAttribute("open");
              }
            }}
          >
            <button type="button" disabled={busy} onClick={onTerminal}>
              <TerminalSquare aria-hidden="true" />
              <span>{t("project.terminal")}</span>
            </button>
            {namedEditor && (
              <button
                type="button"
                disabled={busy || !namedEditor.available}
                title={
                  namedEditor.available
                    ? undefined
                    : t("project.namedEditorUnavailable", {
                        editor: namedEditor.name,
                      })
                }
                onClick={onEditor}
              >
                <Code2 aria-hidden="true" />
                <span>
                  {namedEditor.available
                    ? t("project.namedEditor", {
                        editor: namedEditor.name,
                      })
                    : t("project.namedEditorUnavailable", {
                        editor: namedEditor.name,
                      })}
                </span>
              </button>
            )}
            {!useConfiguredVisualStudioCode && (
              <button
                type="button"
                disabled={busy || !applications?.visualStudioCode}
                title={
                  applications && !applications.visualStudioCode
                    ? t("project.visualStudioCodeUnavailable")
                    : undefined
                }
                onClick={onVisualStudioCode}
              >
                <Code2 aria-hidden="true" />
                <span>
                  {!applications
                    ? t("project.visualStudioCodeChecking")
                    : applications.visualStudioCode
                      ? t("project.visualStudioCode")
                      : t("project.visualStudioCodeUnavailable")}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={busy || !applications?.warp}
              title={
                applications && !applications.warp
                  ? t("project.warpUnavailable")
                  : undefined
              }
              onClick={onWarp}
            >
              <TerminalSquare aria-hidden="true" />
              <span>
                {!applications
                  ? t("project.warpChecking")
                  : applications.warp
                    ? t("project.warp")
                    : t("project.warpUnavailable")}
              </span>
            </button>
            <button type="button" disabled={busy} onClick={onCopyRecap}>
              <Copy aria-hidden="true" />
              <span>{t("project.copyRecap")}</span>
            </button>
            <button
              type="button"
              disabled={busy || !summary || summary.acknowledged}
              onClick={onAcknowledge}
            >
              <Check aria-hidden="true" />
              <span>
                {summary?.acknowledged
                  ? t("project.acknowledged")
                  : t("project.acknowledge")}
              </span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdate({ pinned: !project.pinned })}
            >
              {project.pinned ? (
                <PinOff aria-hidden="true" />
              ) : (
                <Pin aria-hidden="true" />
              )}
              <span>{project.pinned ? t("project.unpin") : t("project.pin")}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}
              <span>{t("project.edit")}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onUpdate({ hidden: !project.hidden })}
            >
              {project.hidden ? (
                <Eye aria-hidden="true" />
              ) : (
                <EyeOff aria-hidden="true" />
              )}
              <span>{project.hidden ? t("project.show") : t("project.hide")}</span>
            </button>
          </div>
        </details>
      </div>

      {editing && (
        <form className="handoff-row-editor" onSubmit={submitEdit}>
          <label>
            <span>{t("project.name")}</span>
            <input
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>{t("project.client")}</span>
            <input
              value={client}
              placeholder={t("common.internal")}
              onChange={(event) => setClient(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>
            {t("common.save")}
          </button>
        </form>
      )}
    </article>
  );
}
