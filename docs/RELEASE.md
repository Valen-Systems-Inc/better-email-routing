# Release A Downloadable Mac App

This project is structured so a client can download a DMG, drag the app into
Applications, open it, and enter Cloudflare settings through the in-app Setup
panel.

## Build Locally

```sh
npm ci
npm run check
npm test
npm run app:dmg
```

Artifacts are written to `release/`:

- `Better Email Routing-<version>-<arch>.dmg`
- `Better Email Routing-<version>-<arch>.zip`

The DMG is the file to publish for normal Mac users.

## Publish On GitHub

1. Bump `package.json` version.
2. Create a tag such as `v1.0.1`.
3. Push the tag.
4. Let the `release-macos` workflow build the app artifact.
5. Upload the DMG to the GitHub Release if the workflow did not attach it.

## Link From valen-systems.com/tools

The tools page should link to the latest GitHub Release DMG:

```txt
https://github.com/Valen-Systems-Inc/better-email-routing/releases/latest
```

For a direct download button, update the link after each release to the DMG
asset URL from that release.

## Signing And Notarization

Unsigned builds are useful for internal testing, but public Mac downloads should
be signed and notarized before clients use them.

Needed Apple items:

- Apple Developer account.
- Developer ID Application certificate.
- App-specific password or App Store Connect API key.
- `electron-builder` signing/notarization environment variables in GitHub
  Actions.

Until those secrets are configured, macOS may show a Gatekeeper warning on first
open. That is expected for unsigned internet downloads and is not the final
client distribution state.

## Local Config Boundary

The desktop app starts the local server on `127.0.0.1` with a random port and
sets the app home to Electron's `userData` directory. User secrets and sent
history stay in that local app-data directory. They are not packaged into the
DMG.
