# RunDebrief v0.1.0-alpha release notes — draft

[English](#english) | [繁體中文](#繁體中文) | [简体中文](#简体中文)

> **Not released:** These notes describe a release candidate. No installer, tag, checksum, signature, notarization result, or GitHub Release should be treated as existing until the release owner completes and reads back every gate.

## English

### Highlights

- Read-only local discovery for supported Claude Code and Codex histories.
- Project-first handoffs with summaries, blockers, decisions, next steps, key files, and usage evidence.
- Original user/assistant turn inspection from approved source roots.
- Search, filtering, sorting, pinning, hiding, renaming, acknowledgment, and native reopen actions.
- Deterministic fallback for ended sessions when no summary gateway is configured.
- English and Traditional Chinese App UI, light/dark themes, and keyboard/accessibility coverage.

### Privacy boundaries

- `~/.claude` and `~/.codex` remain read-only inputs.
- A separate SQLite index is stored under `~/.debrief/`.
- User-configured AI summarization can send selected run content to an OpenAI-compatible gateway.
- Optional Mem0-compatible write-back requires both `DEBRIEF_MEM0_URL` and `DEBRIEF_MEM0_USER_ID`; `DEBRIEF_MEM0_KEY` is optional. Metadata omits absolute project paths and detected project roots are redacted from summary text.
- There is no hosted sync, remote prompting, mobile control, or silent analytics in this alpha.

### Expected release assets

The fail-closed release workflow is designed to produce native Apple Silicon and Intel DMGs. Every architecture must include a matching `.sha256` file. Assets remain in a **draft prerelease** until Developer ID signature, Apple notarization, stapling, checksum, clean-install, and security checks pass.

No filenames or hashes are listed here before the workflow produces them.

### Known limitations

- The release candidate has not been published and currently has no official installer.
- macOS 12+ only; Windows and Linux have not shipped.
- Claude Code and Codex only.
- App UI languages are English and Traditional Chinese; Simplified Chinese is documentation only.
- Summaries can be incomplete or wrong; inspect source evidence, code, diffs, and tests.
- No iOS, hosted sync, notifications, approvals, or remote prompting.
- RunDebrief is the public working name while internal identifiers still use `Debrief`.

### Source verification

```bash
git clone https://github.com/tentenco/RunDebrief.git
cd RunDebrief
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
pnpm check:public
pnpm build
pnpm build:landing
pnpm test
```

### Release gate

Do not publish until the release owner verifies both architectures, confirms private vulnerability reporting, runs a clean-account install, and records public Release read-back. Never ask users to bypass Gatekeeper.

## 繁體中文

### 重點功能

- 以唯讀方式探索受支援的本機 Claude Code 與 Codex 歷史。
- 以專案為中心的 handoff，包含摘要、阻塞、決策、下一步、關鍵檔案與 token 使用證據。
- 從核准的來源路徑檢視原始 user／assistant turns。
- 搜尋、篩選、排序、置頂、隱藏、重新命名、標記處理與原生重開動作。
- 未設定 summary gateway 時，為已結束的 session 提供 deterministic fallback。
- English／繁體中文 App UI、明暗主題，以及 keyboard／accessibility coverage。

### 隱私邊界

- `~/.claude` 與 `~/.codex` 維持唯讀來源。
- 獨立 SQLite index 儲存在 `~/.debrief/`。
- 使用者指定的 AI 摘要可將選取的 run 內容送到 OpenAI-compatible gateway。
- 選用的 Mem0-compatible write-back 必須同時設定 `DEBRIEF_MEM0_URL` 與 `DEBRIEF_MEM0_USER_ID`；`DEBRIEF_MEM0_KEY` 是選用項。Metadata 不含 absolute project path，摘要也會 redact 偵測到的 project root。
- 此 alpha 沒有 hosted sync、remote prompting、mobile control 或隱性 analytics。

### 預期 Release assets

Fail-closed release workflow 預計產生原生 Apple Silicon 與 Intel DMG。每個架構都必須附上對應的 `.sha256` 檔案。Developer ID 簽章、Apple 公證、stapling、checksum、clean-install 與安全檢查全部通過前，assets 必須維持在 **draft prerelease**。

Workflow 尚未實際產出前，本文件不預先填寫檔名或 hash。

### 已知限制

- Release candidate 尚未發布，目前沒有官方安裝檔。
- 僅支援 macOS 12+；Windows 與 Linux 尚未發布。
- 僅支援 Claude Code 與 Codex。
- App UI 語言為 English 與繁體中文；簡體中文只提供文件。
- 摘要可能不完整或錯誤；仍須檢查來源證據、程式碼、diff 與測試。
- 尚無 iOS、hosted sync、notifications、approvals 或 remote prompting。
- RunDebrief 是公開工作名稱，內部 identifiers 仍使用 `Debrief`。

### 原始碼驗證

```bash
git clone https://github.com/tentenco/RunDebrief.git
cd RunDebrief
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
pnpm check:public
pnpm build
pnpm build:landing
pnpm test
```

### 發布 Gate

Release owner 驗證兩種架構、確認 private vulnerability reporting、完成 clean-account install 並記錄公開 Release read-back 前，不得發布。不得要求使用者繞過 Gatekeeper。

## 简体中文

### 重点功能

- 以只读方式发现受支持的本地 Claude Code 与 Codex 历史。
- 以项目为中心的 handoff，包括摘要、阻塞项、决策、下一步、关键文件与 token 使用证据。
- 从获准的来源路径检查原始 user／assistant turns。
- 搜索、筛选、排序、置顶、隐藏、重命名、确认处理与原生重新打开操作。
- 未配置 summary gateway 时，为已结束的 session 提供 deterministic fallback。
- English／繁体中文 App UI、浅色／深色主题，以及 keyboard／accessibility coverage。

### 隐私边界

- `~/.claude` 与 `~/.codex` 保持为只读来源。
- 独立 SQLite index 存储在 `~/.debrief/`。
- 用户配置的 AI 摘要可以把选取的 run 内容发送到 OpenAI-compatible gateway。
- 可选的 Mem0-compatible write-back 必须同时配置 `DEBRIEF_MEM0_URL` 与 `DEBRIEF_MEM0_USER_ID`；`DEBRIEF_MEM0_KEY` 为可选项。Metadata 不包含 absolute project path，摘要也会 redact 检测到的 project root。
- 此 alpha 没有 hosted sync、remote prompting、mobile control 或隐性 analytics。

### 预期 Release assets

Fail-closed release workflow 计划生成原生 Apple Silicon 与 Intel DMG。每种架构都必须附带对应的 `.sha256` 文件。在 Developer ID 签名、Apple 公证、stapling、checksum、clean-install 与安全检查全部通过前，assets 必须保持为 **draft prerelease**。

Workflow 尚未实际产出前，本文件不预先填写文件名或 hash。

### 已知限制

- Release candidate 尚未发布，目前没有官方安装包。
- 仅支持 macOS 12+；Windows 与 Linux 尚未发布。
- 仅支持 Claude Code 与 Codex。
- App UI 语言为 English 与繁体中文；简体中文只提供文档。
- 摘要可能不完整或错误；仍须检查来源证据、代码、diff 与测试。
- 尚无 iOS、hosted sync、notifications、approvals 或 remote prompting。
- RunDebrief 是公开工作名称，内部 identifiers 仍使用 `Debrief`。

### 源代码验证

```bash
git clone https://github.com/tentenco/RunDebrief.git
cd RunDebrief
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
pnpm check:public
pnpm build
pnpm build:landing
pnpm test
```

### 发布 Gate

Release owner 验证两种架构、确认 private vulnerability reporting、完成 clean-account install 并记录公开 Release read-back 前，不得发布。不得要求用户绕过 Gatekeeper。
