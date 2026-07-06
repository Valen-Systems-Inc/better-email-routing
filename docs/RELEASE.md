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

The DMG is the file to publish for normal Mac users. Keep each published build
under a versioned CDN path so older installers do not change after release.

## Publish On The Valen CDN

1. Bump `package.json` version.
2. Run `npm run app:dmg`.
3. Upload the DMG and ZIP to a versioned R2 path, for example:

```txt
https://downloads.valen-systems.com/better-email-routing/releases/v1.0.2/Better-Email-Routing-1.0.2-arm64.dmg
```

4. Update these mutable CDN manifests:

```txt
https://downloads.valen-systems.com/better-email-routing/latest.json
https://downloads.valen-systems.com/better-email-routing/latest-mac.yml
```

The in-app Check updates button reads `latest.json` through the local server.
Set `BETTER_EMAIL_ROUTING_UPDATE_MANIFEST_URL` only when testing a staging
manifest.

## Link From valen-systems.com/downloads

The public downloads page should link to the latest CDN DMG:

```txt
https://downloads.valen-systems.com/better-email-routing/latest.json
```

For a direct download button, use the `files.dmg` URL inside `latest.json`.

## Cloudflare Connect Button

Client-friendly builds should include a public Cloudflare OAuth client ID so the
Setup panel can open Cloudflare login instead of asking the client to paste an
API token.

Register this redirect URI on the Cloudflare OAuth client:

```txt
http://127.0.0.1:8899/api/oauth/callback
```

Set `CLOUDFLARE_OAUTH_CLIENT_ID` in the build or local app config. The client
ID is public. Do not ship a client secret in the desktop app.

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

The desktop app starts the local server on `127.0.0.1:8899` by default so the
Cloudflare OAuth callback is stable. It sets the app home to Electron's
`userData` directory. User secrets and sent history stay in that local app-data
directory. They are not packaged into the DMG.
