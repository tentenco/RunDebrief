# Debrief daemon

Build the self-contained macOS runtime before packaging the Tauri App:

```sh
pnpm --filter @debrief/daemon build:runtime
```

The output is `packages/daemon/runtime-dist/`. It contains a pinned Node
executable, a matching `better-sqlite3` native binding, the bundled daemon,
FSEvents, the schema migration, and a hash manifest. Tauri maps that directory
to `Debrief.app/Contents/Resources/debrief-daemon-runtime/`.

The App invokes the resource runtime like this:

```sh
"$RESOURCE/bin/node" "$RESOURCE/dist/cli.mjs" \
  daemon install --runtime-source "$RESOURCE"
```

Install validates every hash and the Node/native ABI, stages an immutable copy
under `~/.debrief/runtime/<version>-<manifest-digest>/`, and only then replaces
or repairs `~/Library/LaunchAgents/com.tenten.debrief-daemon.plist`. A corrupt
exact-version runtime is retained beside it with a `.corrupt-*` name before the
validated replacement is activated. The LaunchAgent always points at the
staged runtime, never a repo checkout, mounted DMG, or whichever `node` happens
to be on `PATH`.

The installer only creates and controls the approved label
`com.tenten.debrief-daemon`. It uses `RunAtLoad` and `KeepAlive`, with JSON-line
daemon logs under `~/.debrief/logs/`.

The long-lived LaunchAgent delegates each incremental scan to a short-lived
child from that same validated runtime. The parent keeps the watcher and
summary pipeline alive while macOS reclaims the parser's high-water memory
after each scan. Shutdown interrupts and reaps only that exact child; file
events that arrive during a scan remain queued for the next cycle.

Status and logs can be queried through any validated packaged runtime:

```sh
"$RESOURCE/bin/node" "$RESOURCE/dist/cli.mjs" daemon status
"$RESOURCE/bin/node" "$RESOURCE/dist/cli.mjs" daemon logs --lines 100
```

If `~/.debrief/config.json` has no `gatewayUrl`, ended sessions receive a
deterministic `rules-fallback` immediately with zero network attempts. Session
discovery is metadata-first: a scan groups files by project and parses only the
newest file per project, leaving older transcripts deferred. Summary backfill
is additionally bounded to ten selected newest-per-project candidates per
daemon cycle. The watcher does not enqueue every historical JSONL at startup;
new or changed sessions continue through the normal quiet/live-process checks.

## Manual reboot check

G2 cannot reboot the host automatically. After a human-approved reboot, run:

```sh
"$RESOURCE/bin/node" "$RESOURCE/dist/cli.mjs" daemon status
launchctl print "gui/$(id -u)/com.tenten.debrief-daemon"
"$RESOURCE/bin/node" "$RESOURCE/dist/cli.mjs" daemon logs --lines 100
```

Pass when the status is `running`, the launchd printout has a live PID, and the
latest daemon JSON log contains `daemon_started` after the reboot time.

## Recovery

If the job needs to be stopped, use only the approved label:

```sh
launchctl bootout "gui/$(id -u)/com.tenten.debrief-daemon"
```

The plist can then be moved out of `~/Library/LaunchAgents/`. Do not modify any
other LaunchAgent.
