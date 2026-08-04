# Debrief macOS App

The React webview is packaged by Tauri v2. The native app keeps SQL reads
read-only and exposes only the five allowlisted project/acknowledgement update
commands described in `AGENTS.md`.

## Background runtime

The packaged app includes a self-contained, versioned daemon runtime under its
Tauri resources. Clicking **安裝並啟動背景服務** copies that approved bundle to
`~/.debrief/runtime/<version>/` and installs or restarts only
`com.tenten.debrief-daemon`. The app does not run the scanner itself; the
background service remains the writer for the local SQLite index.

Build the runtime resource before a native build:

```sh
pnpm --filter @debrief/daemon build:runtime
```

The runtime status UI reports LaunchAgent, local-index, gateway, and summary
model readiness separately. A session already present in SQLite but without a
summary is shown as awaiting its summary, while `rules-fallback` results remain
readable and are labeled as degraded.

The macOS security button opens the fixed **Privacy & Security** settings page
only. It does not change security settings or bypass Gatekeeper. Users must make
any system-level decision themselves.

## Original turn log

The detail panel can load the latest original user/assistant turns for a session
already known to the local SQLite index. The webview sends only the session ID
and page limit; the native command resolves and validates the source path under
the matching `~/.claude/projects` or `~/.codex/sessions` root. It never accepts
an arbitrary path from React, copies transcript text into SQLite, or writes to
the source JSONL file.

The reader keeps only the latest 20 turns, excludes tool and system traffic, and
returns accepted prompt/response text without shortening it. Oversized irrelevant
lines are skipped and counted; an accepted turn or page beyond the safety limit
fails with a fixed user-facing error instead of returning partial content.

## Local verification build

```sh
pnpm --filter @debrief/app audit:tokens
pnpm --filter @debrief/app test
pnpm --filter @debrief/app test:smoke
PATH="/opt/homebrew/opt/rustup/bin:$PATH" \
  pnpm --filter @debrief/app tauri build
```

Unsigned local artifacts are written under:

- `src-tauri/target/release/bundle/macos/Debrief.app`
- `src-tauri/target/release/bundle/dmg/Debrief_0.1.0_aarch64.dmg`

## Signing and notarization handoff

Do not put certificate material, Apple IDs, team IDs, app-specific passwords,
API keys, or notary credentials in this repository.

The release owner must complete these steps on a trusted Mac:

1. Install the team's `Developer ID Application` identity in the login
   Keychain and verify it with
   `security find-identity -v -p codesigning`.
2. Rebuild the `.app` and DMG with that exact identity configured for the
   Tauri macOS bundle. Verify that the nested Node executable and native
   `better-sqlite3` addon in the daemon resource are covered by the final
   signing pass.
3. Store notarization credentials in Keychain with
   `xcrun notarytool store-credentials`; use an Apple app-specific password or
   an approved App Store Connect API key.
4. Submit the DMG with
   `xcrun notarytool submit <dmg> --keychain-profile <profile> --wait`.
5. Staple and validate the ticket with
   `xcrun stapler staple <dmg>` and `xcrun stapler validate <dmg>`.
6. Run `codesign --verify --deep --strict --verbose=2 <app>` and
   `spctl --assess --type open --context context:primary-signature -v <dmg>`
   before distribution.

Phase 4 intentionally performs none of those identity-gated steps.
