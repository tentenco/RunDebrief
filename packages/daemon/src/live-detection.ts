import path from "node:path";
import type {
  Clock,
  CommandRunner,
  DaemonLogger,
  DebriefDatabase,
  LiveProject,
  LiveStatusProvider,
} from "./types.js";
import { systemClock } from "./types.js";
import { systemCommandRunner } from "./command-runner.js";

interface ProjectRow {
  id: number;
  path: string;
}

interface TmuxPane {
  cwd: string;
  target: string;
  tool: "claude-code" | "codex" | null;
}

export class LiveProcessDetector implements LiveStatusProvider {
  private readonly liveProjectIds = new Set<number>();

  constructor(
    private readonly db: DebriefDatabase,
    private readonly logger: DaemonLogger,
    private readonly runner: CommandRunner = systemCommandRunner,
    private readonly clock: Clock = systemClock,
  ) {}

  async poll(): Promise<LiveProject[]> {
    const projects = this.db
      .prepare("SELECT id, path FROM projects ORDER BY length(path) DESC")
      .all() as ProjectRow[];
    const live = new Map<number, LiveProject>();

    for (const process of await this.agentProcesses()) {
      const cwd = await this.processCwd(process.pid);
      if (!cwd) continue;
      const project = matchProject(cwd, projects);
      if (!project) continue;
      live.set(project.id, {
        projectId: project.id,
        projectPath: project.path,
        pid: process.pid,
        tool: process.tool,
        tmuxTarget: null,
      });
    }

    for (const pane of await this.tmuxPanes()) {
      const project = matchProject(pane.cwd, projects);
      if (!project) continue;
      const existing = live.get(project.id);
      if (existing) {
        if (!existing.tmuxTarget) existing.tmuxTarget = pane.target;
      } else if (pane.tool) {
        live.set(project.id, {
          projectId: project.id,
          projectPath: project.path,
          pid: null,
          tool: pane.tool,
          tmuxTarget: pane.target,
        });
      }
    }

    const values = [...live.values()];
    const persist = this.db.transaction(() => {
      this.db.prepare("DELETE FROM live_status").run();
      const insert = this.db.prepare(
        `INSERT INTO live_status (
           project_id, pid, tool, tmux_target, detected_at
         ) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const status of values) {
        insert.run(
          status.projectId,
          status.pid,
          status.tool,
          status.tmuxTarget,
          this.clock.now().toISOString(),
        );
      }
    });
    persist();

    this.liveProjectIds.clear();
    for (const status of values) this.liveProjectIds.add(status.projectId);
    this.logger.debug(
      { event: "live_status_polled", liveProjects: values.length },
      "Live agent status refreshed",
    );
    return values;
  }

  isProjectLive(projectId: number): boolean {
    return this.liveProjectIds.has(projectId);
  }

  private async agentProcesses(): Promise<
    Array<{ pid: number; tool: "claude-code" | "codex" }>
  > {
    try {
      const result = await this.runner.run(
        "ps",
        ["-axo", "pid=,command="],
        { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const processes: Array<{
        pid: number;
        tool: "claude-code" | "codex";
      }> = [];
      for (const line of result.stdout.split("\n")) {
        const match = /^\s*(\d+)\s+(.+)$/.exec(line);
        if (!match?.[1] || !match[2]) continue;
        const tool = detectTool(match[2]);
        if (!tool) continue;
        processes.push({ pid: Number(match[1]), tool });
      }
      return processes;
    } catch (error) {
      this.logger.warn(
        {
          event: "process_poll_failed",
          reason: error instanceof Error ? error.message : String(error),
        },
        "Process detection failed; continuing daemon cycle",
      );
      return [];
    }
  }

  private async processCwd(pid: number): Promise<string | null> {
    try {
      const result = await this.runner.run(
        "lsof",
        ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
        { timeout: 10_000, maxBuffer: 256 * 1024 },
      );
      const cwd = result.stdout
        .split("\n")
        .find((line) => line.startsWith("n"))
        ?.slice(1)
        .trim();
      return cwd || null;
    } catch (error) {
      this.logger.debug(
        {
          event: "process_cwd_unavailable",
          pid,
          reason: error instanceof Error ? error.message : String(error),
        },
        "Could not resolve process cwd",
      );
      return null;
    }
  }

  private async tmuxPanes(): Promise<TmuxPane[]> {
    try {
      const result = await this.runner.run(
        "tmux",
        [
          "list-panes",
          "-a",
          "-F",
          "#{pane_current_path}\t#{session_name}:#{window_index}.#{pane_index}\t#{pane_current_command}",
        ],
        { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
      );
      return result.stdout
        .split("\n")
        .map((line) => line.split("\t"))
        .filter(
          (parts): parts is [string, string, string] =>
            parts.length === 3 && Boolean(parts[0] && parts[1]),
        )
        .map(([cwd, target, command]) => ({
          cwd,
          target,
          tool: detectTool(command),
        }));
    } catch (error) {
      this.logger.debug(
        {
          event: "tmux_poll_unavailable",
          reason: error instanceof Error ? error.message : String(error),
        },
        "No tmux panes detected",
      );
      return [];
    }
  }
}

function detectTool(command: string): "claude-code" | "codex" | null {
  const normalized = command.toLowerCase();
  if (/(^|[\/\s])claude(?:\s|$)/.test(normalized)) return "claude-code";
  if (/(^|[\/\s])codex(?:\s|$)/.test(normalized)) return "codex";
  return null;
}

function matchProject(cwd: string, projects: ProjectRow[]): ProjectRow | null {
  const resolvedCwd = path.resolve(cwd);
  for (const project of projects) {
    const resolvedProject = path.resolve(project.path);
    if (
      resolvedCwd === resolvedProject ||
      resolvedCwd.startsWith(`${resolvedProject}${path.sep}`)
    ) {
      return project;
    }
  }
  return null;
}
