import fs from "node:fs/promises";
import path from "node:path";
import type { CommandRunner } from "./types.js";
import { systemCommandRunner } from "./command-runner.js";

export const LAUNCHD_LABEL = "com.tenten.debrief-daemon";
export const LAUNCHD_SAFE_PATH =
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

export interface LaunchdStatus {
  label: typeof LAUNCHD_LABEL;
  installed: boolean;
  running: boolean;
  pid: number | null;
  state: string | null;
  plistPath: string;
}

export interface LaunchdOptions {
  launchAgentsDir: string;
  nodeExecutablePath: string;
  daemonEntryPath: string;
  runtimePath: string | null;
  debriefHome: string;
  logDir: string;
  uid: number;
}

export class LaunchdManager {
  readonly plistPath: string;

  constructor(
    private readonly options: LaunchdOptions,
    private readonly runner: CommandRunner = systemCommandRunner,
  ) {
    this.plistPath = path.join(
      options.launchAgentsDir,
      `${LAUNCHD_LABEL}.plist`,
    );
  }

  async install(): Promise<LaunchdStatus> {
    await Promise.all([
      fs.mkdir(this.options.launchAgentsDir, {
        recursive: true,
        mode: 0o700,
      }),
      fs.mkdir(this.options.logDir, { recursive: true, mode: 0o700 }),
    ]);

    const temporaryPath = `${this.plistPath}.tmp`;
    await fs.writeFile(temporaryPath, this.renderPlist(), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, this.plistPath);

    const domain = `gui/${this.options.uid}`;
    try {
      await this.runner.run("launchctl", [
        "bootout",
        `${domain}/${LAUNCHD_LABEL}`,
      ]);
    } catch {
      // An absent previous job is the normal first-install state.
    }
    await this.runner.run("launchctl", [
      "bootstrap",
      domain,
      this.plistPath,
    ]);
    await this.runner.run("launchctl", [
      "enable",
      `${domain}/${LAUNCHD_LABEL}`,
    ]);
    await this.runner.run("launchctl", [
      "kickstart",
      "-k",
      `${domain}/${LAUNCHD_LABEL}`,
    ]);
    return this.status();
  }

  async status(): Promise<LaunchdStatus> {
    const installed = await fileExists(this.plistPath);
    try {
      const result = await this.runner.run("launchctl", [
        "print",
        `gui/${this.options.uid}/${LAUNCHD_LABEL}`,
      ]);
      const state = /^\s*state = (.+)$/m.exec(result.stdout)?.[1]?.trim() ?? null;
      const pidText = /^\s*pid = (\d+)$/m.exec(result.stdout)?.[1];
      return {
        label: LAUNCHD_LABEL,
        installed,
        running: state === "running",
        pid: pidText ? Number(pidText) : null,
        state,
        plistPath: this.plistPath,
      };
    } catch {
      return {
        label: LAUNCHD_LABEL,
        installed,
        running: false,
        pid: null,
        state: null,
        plistPath: this.plistPath,
      };
    }
  }

  async logs(lines = 100): Promise<string> {
    const entries = await fs
      .readdir(this.options.logDir, { withFileTypes: true })
      .catch(() => []);
    const files = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.startsWith("daemon-") ||
            entry.name.startsWith("launchd.")),
      )
      .map((entry) => path.join(this.options.logDir, entry.name))
      .sort();
    const chunks = await Promise.all(
      files.map(async (file) => {
        const content = await fs.readFile(file, "utf8");
        return content
          .split("\n")
          .filter(Boolean)
          .map((line) => `${path.basename(file)} ${line}`);
      }),
    );
    return chunks.flat().slice(-Math.max(1, lines)).join("\n");
  }

  renderPlist(): string {
    const stdoutPath = path.join(this.options.logDir, "launchd.stdout.log");
    const stderrPath = path.join(this.options.logDir, "launchd.stderr.log");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(this.options.nodeExecutablePath)}</string>
    <string>${xmlEscape(this.options.daemonEntryPath)}</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DEBRIEF_HOME</key>
    <string>${xmlEscape(this.options.debriefHome)}</string>
    ${
      this.options.runtimePath
        ? `<key>DEBRIEF_RUNTIME_PATH</key>
    <string>${xmlEscape(this.options.runtimePath)}</string>`
        : ""
    }
    <key>PATH</key>
    <string>${LAUNCHD_SAFE_PATH}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
