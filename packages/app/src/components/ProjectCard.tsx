import {
  Check,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  TerminalSquare,
  X,
} from "lucide-react";
import { useState } from "react";
import { projectStatus } from "../lib/project-status";
import { formatRelative } from "../lib/time";
import type { Project, ProjectPatch } from "../types";
import { StatusBadge, statusLabel } from "./StatusBadge";

interface ProjectCardProps {
  project: Project;
  busy: boolean;
  cardIndex: number;
  active: boolean;
  onOpen(): void;
  onFocus(): void;
  onNavigate(direction: "up" | "down" | "left" | "right"): void;
  onTerminal(): void;
  onEditor(): void;
  onCopyRecap(): void;
  onAcknowledge(): void;
  onUpdate(patch: ProjectPatch): void;
  onRetry(): void;
}

export function ProjectCard({
  project,
  busy,
  cardIndex,
  active,
  onOpen,
  onFocus,
  onNavigate,
  onTerminal,
  onEditor,
  onCopyRecap,
  onAcknowledge,
  onUpdate,
  onRetry,
}: ProjectCardProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [client, setClient] = useState(project.client ?? "");
  const status = projectStatus(project);
  const session = project.latestSession;
  const summary = session?.summary;
  const openItems = summary?.openItems.length ?? 0;

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
      className="project-card"
      data-state={project.summaryState}
      data-testid={`project-card-${project.id}`}
      aria-label={`${project.name}, ${statusLabel(status)}, 最後活動 ${formatRelative(project.lastActivityAt)}`}
    >
      <button
        className="card-content"
        type="button"
        data-card-index={cardIndex}
        tabIndex={active ? 0 : -1}
        aria-current={active ? "true" : undefined}
        aria-label={`${project.name}, ${statusLabel(status)}, 最後活動 ${formatRelative(project.lastActivityAt)}`}
        onClick={onOpen}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.metaKey && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            onCopyRecap();
            return;
          }
          const direction = arrowDirection(event.key);
          if (direction) {
            event.preventDefault();
            onNavigate(direction);
            return;
          }
          if (event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <span className="card-heading">
          <StatusBadge status={status} />
          <strong>{project.name}</strong>
          {project.pinned && <Pin className="pinned-mark" aria-label="Pinned" />}
          <ChevronRight className="card-chevron" aria-hidden="true" />
        </span>
        <span className="card-meta">
          <span>{session?.tool ?? "尚無 session"}</span>
          <span aria-hidden="true">·</span>
          <span>{session?.gitBranch ?? "no branch"}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRelative(project.lastActivityAt)}</span>
        </span>

        {project.summaryState === "awaiting-summary" ? (
          <>
            <span className="card-summary">
              索引已讀取；等待背景服務完成摘要。
            </span>
            <span className="card-chip-row">
              <span className="summary-chip">等待完整摘要</span>
            </span>
          </>
        ) : (
          <>
            <span className="card-summary">
              {summary?.stateSummary ?? "這個專案目前沒有可用摘要。"}
            </span>
            <span className="card-chip-row">
              {openItems > 0 && (
                <span className="summary-chip">{openItems} open items</span>
              )}
              {summary?.nextSteps[0] && (
                <span className="next-step">
                  下一步：{summary.nextSteps[0]}
                </span>
              )}
            </span>
          </>
        )}
      </button>

      {project.summaryState === "degraded" && (
        <div className="degraded-banner" role="status">
          <span>規則式摘要 · Gateway 未設定或暫時不可用</span>
          <button type="button" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            重新整理
          </button>
        </div>
      )}

      <div className="card-actions" aria-label={`${project.name} 動作`}>
        <button type="button" disabled={busy} onClick={onTerminal}>
          <TerminalSquare aria-hidden="true" />
          Terminal
        </button>
        <button type="button" disabled={busy} onClick={onEditor}>
          <Code2 aria-hidden="true" />
          Editor
        </button>
        <button type="button" disabled={busy} onClick={onCopyRecap}>
          <Copy aria-hidden="true" />
          Recap
          <kbd>⌘↵</kbd>
        </button>
        <button
          type="button"
          disabled={busy || !summary || summary.acknowledged}
          onClick={onAcknowledge}
        >
          <Check aria-hidden="true" />
          {summary?.acknowledged ? "已處理" : "Acknowledge"}
        </button>
      </div>

      <div className="card-secondary-actions">
        <button
          className="quiet-button"
          type="button"
          disabled={busy}
          aria-label={project.pinned ? "取消置頂" : "置頂"}
          title={project.pinned ? "取消置頂" : "置頂"}
          onClick={() => onUpdate({ pinned: !project.pinned })}
        >
          {project.pinned ? <PinOff /> : <Pin />}
        </button>
        <button
          className="quiet-button"
          type="button"
          disabled={busy}
          aria-label="編輯名稱與 client"
          title="編輯名稱與 client"
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? <X /> : <Pencil />}
        </button>
        <button
          className="quiet-button"
          type="button"
          disabled={busy}
          aria-label={project.hidden ? "顯示專案" : "隱藏專案"}
          title={project.hidden ? "顯示專案" : "隱藏專案"}
          onClick={() => onUpdate({ hidden: !project.hidden })}
        >
          {project.hidden ? <Eye /> : <EyeOff />}
        </button>
      </div>

      {editing && (
        <form className="inline-editor" onSubmit={submitEdit}>
          <label>
            <span>名稱</span>
            <input
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>Client</span>
            <input
              value={client}
              placeholder="Internal"
              onChange={(event) => setClient(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>
            儲存
          </button>
        </form>
      )}
    </article>
  );
}

function arrowDirection(
  key: string,
): "up" | "down" | "left" | "right" | null {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    default:
      return null;
  }
}
