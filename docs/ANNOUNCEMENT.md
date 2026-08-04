# RunDebrief open-source announcement draft

[English](#english) | [繁體中文](#繁體中文) | [简体中文](#简体中文)

> **Draft status:** Publish this source-launch announcement only after the repository and private vulnerability reporting are publicly verified. A signed installer is not required for the source launch; keep the no-download wording until binary signing and notarization pass.

## English

### Know what every coding agent did. Pick up exactly where it left off.

Coding agents can finish a lot of work. Their context still disappears into terminal tabs, provider-specific histories, and long transcripts.

**RunDebrief is now open source.** It is a macOS continuity layer for Claude Code and Codex that reads supported local histories without modifying them, groups runs by project, turns each run into an actionable handoff, and keeps the original user and assistant turns close enough to inspect when a summary needs verification.

RunDebrief is deliberately not another editor, terminal, agent launcher, or remote-control bypass. The current alpha focuses on one job: understand what happened, find the blocker or next step, and continue from evidence while preserving the underlying agent's permission model.

What the alpha includes:

- read-only discovery of supported Claude Code and Codex histories;
- project-first summaries, blockers, decisions, next steps, key files, and usage evidence;
- original-turn inspection from approved local source roots;
- search, filters, project organization, and launch shortcuts;
- deterministic local fallback when no AI summary gateway is configured;
- English and Traditional Chinese app interfaces;
- Apache-2.0 source.

The privacy boundary is explicit. Source histories stay read-only. AI summarization can send selected content to a gateway configured by the user. Optional Mem0-compatible write-back requires both an endpoint and user ID; its credential is optional, absolute project paths are omitted from metadata, and detected project roots are redacted from summary text. There is no hosted sync or silent analytics in this alpha.

There is no official signed or notarized installer yet, and the Simplified Chinese translation is documentation only—not an App UI language. The `v0.1.0-alpha` binary will be published separately only after Developer ID signing, Apple notarization, checksums, and clean-install QA pass.

Follow the source candidate, limitations, and contribution guide at [github.com/tentenco/RunDebrief](https://github.com/tentenco/RunDebrief). Report non-security problems through [GitHub Issues](https://github.com/tentenco/RunDebrief/issues); use private vulnerability reporting for security issues.

### Short social version

RunDebrief is now open source: a read-only macOS continuity layer for Claude Code and Codex. Review agent runs, inspect the evidence, and resume with context. Apache-2.0 source is public; a signed/notarized installer is not available yet. https://github.com/tentenco/RunDebrief

## 繁體中文

### 掌握每個程式開發 Agent 做了什麼，精準接續未完工作。

程式開發 Agent 可以完成大量工作，但脈絡仍會散落在 Terminal 分頁、各家供應商的歷史記錄與冗長 transcript 裡。

**RunDebrief 現已開源。** 它是一個支援 Claude Code 與 Codex 的 macOS continuity layer，能以唯讀方式整理受支援的本機歷史、依專案彙整 run、把每次工作轉成可執行的 handoff，並保留原始 user／assistant turns，讓摘要需要查證時仍有證據可循。

RunDebrief 刻意不成為另一個編輯器、Terminal、Agent launcher 或繞過權限的遠端控制工具。目前 alpha 專注在一件事：理解發生了什麼、找到阻塞或下一步，並在保留底層 Agent 權限模型的前提下，從證據繼續工作。

Alpha 目前包含：

- 唯讀探索受支援的 Claude Code 與 Codex 歷史；
- 以專案為中心的摘要、阻塞、決策、下一步、關鍵檔案與 token 使用證據；
- 從核准的本機來源路徑檢視原始 turns；
- 搜尋、篩選、專案整理與開啟工作捷徑；
- 未設定 AI summary gateway 時使用 deterministic local fallback；
- English 與繁體中文 App 介面；
- Apache-2.0 原始碼。

隱私邊界會清楚揭露。來源歷史保持唯讀；AI 摘要可將選取內容送到使用者指定的 gateway；選用的 Mem0-compatible write-back 必須同時設定 endpoint 與 user ID，credential 可省略，metadata 不送 absolute project path，摘要也會 redact 偵測到的 project root。此 alpha 沒有 hosted sync 或隱性 analytics。

目前沒有官方簽章或 Apple 公證的安裝檔；簡體中文版本也只提供文件翻譯，並非 App UI 語言。`v0.1.0-alpha` binary 會在 Developer ID 簽章、Apple 公證、checksums 與 clean-install QA 通過後另行發布。

原始碼候選、限制與貢獻方式整理在 [github.com/tentenco/RunDebrief](https://github.com/tentenco/RunDebrief)。非安全性問題請使用 [GitHub Issues](https://github.com/tentenco/RunDebrief/issues)；安全性問題請使用 private vulnerability reporting。

### 社群短版

RunDebrief 現已開源：支援 Claude Code 與 Codex、以唯讀方式運作的 macOS continuity layer。檢視 Agent runs、查證原始證據，再帶著脈絡接續工作。Apache-2.0 source 已公開；目前尚無 signed/notarized installer。https://github.com/tentenco/RunDebrief

## 简体中文

### 掌握每个编程 Agent 做了什么，准确接续未完成的工作。

编程 Agent 可以完成大量工作，但上下文仍会散落在终端标签页、各家提供商的历史记录和冗长 transcript 中。

**RunDebrief 现已开源。** 它是一个支持 Claude Code 与 Codex 的 macOS continuity layer，能够以只读方式整理受支持的本地历史、按项目汇总 run、把每次工作转成可执行的 handoff，并保留原始 user／assistant turns，让摘要需要核验时仍有证据可查。

RunDebrief 刻意不成为另一个编辑器、终端、Agent launcher 或绕过权限的远程控制工具。当前 alpha 专注于一件事：理解发生了什么、找到阻塞项或下一步，并在保留底层 Agent 权限模型的前提下，从证据继续工作。

Alpha 当前包括：

- 只读发现受支持的 Claude Code 与 Codex 历史；
- 以项目为中心的摘要、阻塞项、决策、下一步、关键文件与 token 使用证据；
- 从获准的本地来源路径检查原始 turns；
- 搜索、筛选、项目整理与打开工作快捷方式；
- 未配置 AI summary gateway 时使用 deterministic local fallback；
- English 与繁体中文 App 界面；
- Apache-2.0 源代码。

隐私边界会清楚披露。来源历史保持只读；AI 摘要可以把选取内容发送到用户配置的 gateway；可选的 Mem0-compatible write-back 必须同时配置 endpoint 与 user ID，credential 可省略，metadata 不发送 absolute project path，摘要也会 redact 检测到的 project root。此 alpha 没有 hosted sync 或隐性 analytics。

目前没有官方签名或 Apple 公证的安装包；简体中文版本也只提供文档翻译，并不是 App UI 语言。`v0.1.0-alpha` binary 会在 Developer ID 签名、Apple 公证、checksums 与 clean-install QA 通过后另行发布。

源代码候选、限制和贡献方式整理在 [github.com/tentenco/RunDebrief](https://github.com/tentenco/RunDebrief)。非安全问题请使用 [GitHub Issues](https://github.com/tentenco/RunDebrief/issues)；安全问题请使用 private vulnerability reporting。

### 社交短版

RunDebrief 现已开源：支持 Claude Code 与 Codex、以只读方式运行的 macOS continuity layer。查看 Agent runs、核验原始证据，再带着上下文接续工作。Apache-2.0 source 已公开；目前尚无 signed/notarized installer。https://github.com/tentenco/RunDebrief
