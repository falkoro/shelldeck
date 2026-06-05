# ShellDeck Desktop Build Notes

ShellDeck Desktop is a Tauri v2 thin client. It does not bundle or start the ShellDeck server; it opens a user-configured server URL in a persistent desktop webview.

## Prerequisites

- Node.js 22+ and npm.
- Rust stable.
- Linux GUI build packages when building locally: `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `curl`, `wget`, and `file`.
- No local secret files are required for unsigned local checks.

## Install and Check Locally

```sh
cd desktop
npm ci
npm run build
```

If the Linux WebKitGTK development package is installed, also run:

```sh
cd desktop/src-tauri
cargo check
```

To build local Linux bundles:

```sh
cd desktop
npm run tauri build -- --bundles appimage,deb
```

## Updater Keypair

Generate the Tauri updater keypair once:

```sh
cd desktop
npm run tauri signer generate
```

Keep the private key out of the repo. Put only the public key in `src-tauri/tauri.conf.json`, replacing `REPLACE_WITH_TAURI_UPDATER_PUBKEY`.

Store the private key and password in GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## Release Secrets

The release workflow also expects Cloudflare R2 credentials by secret name:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `SHELLDECK_R2_BUCKET`

The R2 bucket must serve `https://dl.shelldeck.app/desktop/...` through its custom domain. No R2 credential value belongs in this repo.

## Cut a Release

1. Update the desktop version in `desktop/package.json`, `desktop/src-tauri/Cargo.toml`, and `desktop/src-tauri/tauri.conf.json`.
2. Make sure the updater public key placeholder has been replaced with the generated public key.
3. Commit the version change.
4. Tag the release:

```sh
git tag desktop-vX.Y.Z
git push origin feat/shelldeck-desktop
git push origin desktop-vX.Y.Z
```

The tag triggers `.github/workflows/desktop-release.yml`. It builds Linux AppImage and `.deb` bundles on `ubuntu-latest`, builds the Windows NSIS installer on `windows-latest`, signs updater artifacts with the Tauri signing secrets, writes per-target `latest.json`, uploads artifacts to R2, and attaches them to the GitHub Release.

Windows code signing is intentionally skipped in v1, so Windows may show a SmartScreen warning until Authenticode signing is added.

