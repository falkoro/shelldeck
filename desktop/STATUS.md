# ShellDeck Desktop Status

## Built

- Added `desktop/`, a Tauri v2 thin client named ShellDeck.
- Added a first-run/settings screen that stores a ShellDeck server URL in localStorage.
- Added a Rust reachability check for the configured server URL before navigation.
- Added a connection-error screen with Retry and Edit server URL actions.
- Added native window state persistence, tray actions, single-instance focus behavior, and updater wiring.
- Added `.github/workflows/desktop-release.yml` for tag-based Linux and Windows desktop releases.
- Added `site/`, a static Cloudflare Pages landing page with current-version download buttons backed by `latest.json`.

## Verified

- `npm install` in `desktop/` completed with no vulnerabilities.
- `npm run build` in `desktop/` completed successfully.
- `npm run latest-json` generated a valid test updater manifest from a throwaway signature file.
- `git diff --check` completed with no whitespace errors.
- `cargo fmt --check` completed successfully.
- `npm run tauri info` parsed the Tauri app and confirmed WebKitGTK 4.1 is the missing local prerequisite.
- Playwright loaded the static site at desktop and 390px widths: no console warnings/errors after localhost manifest fetches were disabled, and no horizontal overflow was detected.
- Playwright loaded the desktop settings screen through Vite at desktop and 390px widths: no console warnings/errors and no horizontal overflow was detected.
- `cargo check` in `desktop/src-tauri` could not complete on this machine because WebKitGTK 4.1 development packages are not installed locally.

## Remaining Manual Steps

- Generate the Tauri updater keypair with `npm run tauri signer generate`.
- Replace `REPLACE_WITH_TAURI_UPDATER_PUBKEY` in `desktop/src-tauri/tauri.conf.json` with the generated public key.
- Add GitHub secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `SHELLDECK_R2_BUCKET`.
- Confirm `dl.shelldeck.app` serves the R2 bucket path used by the workflow.
- Replace `site/screenshot-*.png` placeholders with real screenshots.
- Cut the first release with `git tag desktop-vX.Y.Z` and push the tag.
