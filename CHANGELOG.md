# Changelog

All notable changes to RunDebrief are documented here. The project retains existing `Debrief` package and runtime identifiers until a separately reviewed migration is approved.

## [Unreleased]

### Changed

- Public-release preparation remains in progress.
- The source repository is public; no signed installer, notarized DMG, or binary release is claimed by this entry.

## [0.1.0-alpha] — release candidate, not published

### Added

- Read-only local discovery for supported Claude Code and Codex histories.
- Project-first desktop views, structured summaries, blockers, next steps, key files, and original-turn inspection.
- English, Traditional Chinese, and Simplified Chinese app interfaces with light and dark themes.
- Deterministic summary fallback when no AI gateway is configured.
- Apache-2.0 license, NOTICE, contribution guide, Code of Conduct, security policy, and issue/PR templates.
- English, Traditional Chinese, and Simplified Chinese documentation with shared release and privacy boundaries.
- Public-export validation, CI checks, and a fail-closed draft macOS prerelease workflow.

### Known limitations

- The release candidate is not a published release and has no official downloadable installer.
- Developer ID signing, Apple notarization, stapling, checksums, clean-account installation, and public read-back remain required.
- macOS is the only target platform; the native release matrix covers Apple Silicon and Intel.
- The app UI supports English, Traditional Chinese, and Simplified Chinese; other UI languages are not included.
- Only Claude Code and Codex adapters are included.
- No iOS app, hosted synchronization, push notification, approval flow, or remote prompting is included.
- AI summaries can be incomplete or incorrect and must remain inspectable against source evidence.
- User-configured gateway and optional Mem0-compatible integrations cross the local network boundary as described in `README.md` and `SECURITY.md`.

### Security

- Binary publication remains blocked until signing, notarization, checksum, and clean-install gates pass.
