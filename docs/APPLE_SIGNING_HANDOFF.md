# Apple Developer ID signing and notarization handoff

This runbook is for the authorized release owner. It does not grant an agent permission to access an Apple signing identity, create credentials, or publish a GitHub Release.

## Current status

- `v0.1.0-alpha` is a release candidate, not a published release.
- `.github/workflows/release.yml` creates only a **draft prerelease**.
- The workflow uses native `macos-15` arm64 and `macos-15-intel` x86_64 runners.
- Missing credentials, a non-tag ref, runner/target mismatch, failed signing, failed notarization, or missing artifacts stops the job.

## Owner prerequisites

The release owner needs:

1. an active Apple Developer Program membership;
2. a valid `Developer ID Application` certificate and private key exported as a password-protected `.p12`;
3. the exact signing identity reported by `security find-identity -v -p codesigning`;
4. an Apple ID with an app-specific password authorized for notarization;
5. the Apple Developer Team ID;
6. admin access to the GitHub `release` environment and repository Actions secrets;
7. an existing reviewed semver tag, such as `v0.1.0-alpha`.

## Required GitHub environment secrets

Store these only in the protected GitHub environment named `release`:

| Secret | Required value |
|---|---|
| `APPLE_CERTIFICATE` | Base64 encoding of the password-protected Developer ID `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting that `.p12` |
| `APPLE_SIGNING_IDENTITY` | Exact `Developer ID Application: ... (TEAMID)` identity |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_PASSWORD` | Apple app-specific password, not the account password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

`GITHUB_TOKEN` is supplied by GitHub Actions. Do not create or store a replacement token unless a separately reviewed workflow requires it.

Never put certificate material, passwords, Team IDs, Apple IDs, API keys, or notary credentials in source files, workflow inputs, logs, issue comments, artifacts, or chat.

## Repository protections

Before running the workflow:

- require approval for the `release` environment;
- restrict environment deployment branches/tags;
- protect the release tag and default branch;
- enable private vulnerability reporting;
- confirm `pnpm check:public`, CI, tests, and clean-export review are green;
- complete the dependency-license review and include every notice required by bundled JavaScript, Node, native, and Rust dependencies;
- confirm release notes still say the candidate is unpublished;
- confirm the tag points to the reviewed commit.

## Run the workflow

1. Open **Actions → Draft macOS prerelease → Run workflow**.
2. Enter an existing semver tag such as `v0.1.0-alpha`.
3. Approve the protected `release` environment.
4. Wait for both native architectures to finish.
5. Keep the GitHub Release in draft state.

The workflow imports the `.p12` into an ephemeral keychain, builds via `tauri-apps/tauri-action@v1`, asks Tauri to sign and notarize, uploads native assets, generates `.sha256` files, and deletes ephemeral signing material at job end.

## Required verification

For every architecture, download the draft assets to a trusted clean Mac and record the results without exposing credentials.

### Check the checksum

```bash
shasum -a 256 -c <asset-name>.sha256
```

### Inspect the DMG and App without bypassing Gatekeeper

```bash
hdiutil attach -readonly <asset-name>.dmg
codesign --verify --deep --strict --verbose=2 /Volumes/<volume-name>/Debrief.app
spctl --assess --type execute --verbose=4 /Volumes/<volume-name>/Debrief.app
spctl --assess --type open --context context:primary-signature --verbose=4 <asset-name>.dmg
xcrun stapler validate <asset-name>.dmg
hdiutil detach /Volumes/<volume-name>
```

Replace bracketed values with the actual draft artifact names. Do not use `xattr -d`, `spctl --master-disable`, Control-click bypasses, ad-hoc resigning, or any other Gatekeeper workaround.

### Clean-account acceptance

On a clean macOS account for each supported architecture:

1. download from the draft Release using an authenticated maintainer account;
2. confirm the checksum before opening the DMG;
3. drag the App to `/Applications` and launch it normally;
4. verify the displayed publisher and absence of an unidentified-developer warning;
5. verify first-run permission guidance without granting broader access than needed;
6. verify source histories remain read-only;
7. verify the background job uses only `com.tenten.debrief-daemon`;
8. verify uninstall/recovery instructions;
9. record App version, architecture, commit/tag, checksum, signature assessment, notarization/stapling result, and test timestamp.

## Publish gate

The owner may publish only when all of the following are true:

- both architecture jobs succeeded;
- every checksum matches;
- Developer ID signature verification passes for the App and nested runtime content;
- Apple notarization and stapler validation pass;
- Gatekeeper assessment passes without bypasses;
- clean-account acceptance passes on Apple Silicon and Intel;
- release notes, known limitations, license, security channel, and download links are correct;
- bundled third-party license texts and notices have been reviewed and are present in the distributed App;
- public read-back is planned immediately after publication.

Publishing the draft is a separate, explicit owner action. Workflow success alone is not approval.

## Rollback and credential response

If any pre-publication check fails:

1. leave the Release as a draft;
2. remove the failed draft assets from consideration;
3. fix the source or workflow on a new reviewed commit;
4. create a new release-candidate tag rather than silently replacing a published tag;
5. rerun both architectures and all acceptance checks.

If signing material or notarization credentials may have leaked:

1. stop the workflow and keep the Release unpublished;
2. revoke or rotate the affected certificate, app-specific password, and GitHub secrets;
3. review Actions logs and artifacts for exposure;
4. report the incident through the private security channel;
5. do not resume until the security owner approves the new credential set.

If a published release later proves unsafe, unpublish or clearly withdraw the affected assets, post a security notice through the official channel, rotate credentials when relevant, and publish a new immutable version only after the full gate passes again.
