# Public export procedure

RunDebrief's private development tree contains internal agent instructions, QA evidence, research, reports, and historical identifiers that are not part of the public source distribution. `.gitattributes` marks those paths with `export-ignore`.

GitHub's source browser does **not** honor `export-ignore`. Do not push this private branch or its history directly to the public repository. Create a clean export, verify it, and import that export into a new public history.

## Intended public content

The public export keeps:

- product source under `packages/`, including `packages/landing` and its public screenshots;
- English, Traditional Chinese, and Simplified Chinese README files;
- license, NOTICE, trademark, contribution, conduct, security, and changelog files;
- `.github` issue, pull-request, CI, dependency, and release configuration;
- public announcement, release notes, signing handoff, and this export procedure;
- the public-release scanner and non-internal build scripts.

It excludes internal agent instructions, specifications, QA artifacts, reports, brand/naming research, design-reference research, internal launch strategy/messaging, and the internal naming-ledger generator.

## Required gate

From the reviewed private candidate:

```bash
corepack enable
corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile
pnpm check:public
pnpm build
pnpm build:landing
pnpm test
git diff --check
```

`pnpm check:public` computes the intended archive from tracked files and `export-ignore` attributes. It must fail if required public files are missing, a forbidden internal path remains, README language navigation/parity is broken, a sensitive local path or customer identifier is found, or a high-confidence credential pattern appears.

## Create the clean archive

Use an explicit reviewed commit or signed release-candidate tag:

```bash
export RUNDEBRIEF_EXPORT_REF="<reviewed-commit-or-tag>"
git archive \
  --format=tar \
  --prefix=RunDebrief/ \
  "${RUNDEBRIEF_EXPORT_REF}" \
  > RunDebrief-public-source.tar
```

Extract the archive into a temporary directory outside the private worktree, inspect its complete file list, and rerun equivalent secret/path/link checks against the extracted files. Do not reuse the private `.git` directory.

## Public repository import

1. Initialize a new Git repository from the verified exported files.
2. Create a new public-source commit with approved author attribution.
3. Add only `https://github.com/tentenco/RunDebrief` as the public remote.
4. Push the clean public branch; never use `git push --all` from the private repository.
5. Enable branch protection, private vulnerability reporting, secret scanning/push protection where available, and the protected `release` environment.
6. Read back the public tree, README language links, license, security intake, workflows, and every public screenshot.

## Binary boundary

The source repository can be public before an installer exists. Do not publish a downloadable App until Developer ID signing, Apple notarization, stapling, checksum, native-architecture, and clean-install checks pass. Keep the GitHub Release as a draft prerelease until the authorized release owner explicitly approves publication.
