# Security policy

RunDebrief handles local coding-agent histories and can send selected data to endpoints explicitly configured by the user. Treat source histories, local paths, summaries, and configuration as sensitive.

## Release status

`v0.1.0-alpha` is a release candidate and has not been published. There is no supported signed or notarized public binary yet.

| Version | Support status |
|---|---|
| `main` | Source development; security fixes are best effort until the first public release |
| `v0.1.0-alpha` | Release candidate; not yet published or supported as a binary |

## Reporting a vulnerability

Do not open a public issue or include real transcript content, API keys, local paths, or exploit details in public.

Use [GitHub private vulnerability reporting](https://github.com/tentenco/RunDebrief/security/advisories/new) as the required confidential reporting channel. If the channel is temporarily unavailable, use [Tenten's contact form](https://tenten.co/contact) to request a secure follow-up channel; do not paste vulnerability details into the form.

The maintainer response target is an initial private acknowledgment within three business days. This is a target, not a service-level guarantee.

## High-priority areas

- writes or path traversal into `~/.claude` or `~/.codex`;
- arbitrary file reads outside approved source roots;
- credentials, transcripts, project paths, or customer identifiers appearing in logs or public artifacts;
- unexpected or undisclosed network calls;
- bypass of the documented desktop database-write allowlist;
- launchd changes outside `com.tenten.debrief-daemon`;
- unsafe runtime package replacement or failed hash verification;
- signing, notarization, update, or release-asset integrity failures;
- future remote actions that bypass the underlying agent's permission gate.

## Current trust boundaries

- Transcript discovery and parsing are local and read-only toward supported source histories.
- The local SQLite index and documented project preferences are separate from those source histories.
- Summarization can send selected run content to the OpenAI-compatible gateway configured in `~/.debrief/config.json` or environment variables.
- Optional Mem0-compatible write-back occurs only when both `DEBRIEF_MEM0_URL` and `DEBRIEF_MEM0_USER_ID` are configured; `DEBRIEF_MEM0_KEY` is optional. Outbound metadata contains project name, session ID, and source rather than the absolute project path, and detected absolute project roots are redacted from summary text.
- The alpha has no hosted synchronization, remote prompting, or mobile-control surface.
- No release is trusted merely because a build completed. A public macOS artifact must pass Developer ID signature, Apple notarization, stapling, checksum, clean-install, and public read-back checks.

## Release verification

Only artifacts attached to [the official GitHub Releases page](https://github.com/tentenco/RunDebrief/releases) are candidates for official distribution. Until a release is published with matching checksum files and documented signature/notarization evidence, wait or build from reviewed source. RunDebrief does not recommend bypassing Gatekeeper.
