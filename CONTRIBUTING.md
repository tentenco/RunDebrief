# Contributing to RunDebrief

Thank you for helping make coding-agent work easier to inspect and continue. Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Before opening a change

1. Search [existing issues](https://github.com/tentenco/RunDebrief/issues).
2. Describe the user problem, current behavior, expected behavior, provider, and platform.
3. Keep the change scoped to one concern.
4. Use synthetic or anonymized data in tests, screenshots, logs, and examples.
5. For security issues, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Local setup

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

Run focused checks when relevant:

```bash
pnpm --filter @debrief/core test
pnpm --filter @debrief/daemon test
pnpm --filter @debrief/app test
pnpm --filter @debrief/app test:smoke
pnpm --filter @debrief/app audit:tokens
pnpm --filter @rundebrief/landing build
```

## Code and data rules

- Keep TypeScript strict.
- Parsers remain adapters behind interfaces and must fail by logging, skipping, and continuing.
- Source histories under `~/.claude` and `~/.codex` are always read-only.
- Incremental parsing through `scan_offset` is mandatory.
- Summarizer output must validate against the product schema; deterministic fallback is required.
- Never commit credentials, real transcript text, customer data, usernames, full machine paths, or private repository identifiers.
- Fixtures for parser and UI changes must be synthetic or anonymized.
- Do not add an undisclosed network request, telemetry event, or database write.
- Keep `README.md`, `README.zh-TW.md`, and `README.zh-CN.md` in parity. Commands, links, version status, privacy boundaries, and limitations must agree.
- Run `pnpm check:public` before requesting review.

## Pull requests

- Use a conventional-commit title.
- Explain the user impact and trust/privacy impact.
- List exact verification commands and results.
- Include sanitized before/after screenshots for interface changes.
- Keep generated build output, local configuration, and signing material out of the change.
- Do not claim a release, signature, notarization, deployment, or public URL without read-back evidence.

By intentionally submitting a contribution for inclusion, you agree that it is provided under Apache License 2.0 as described in Section 5 of that license, unless you explicitly mark it “Not a Contribution.”
