# Release Core Mail As A Downloadable Mac App

This project is structured so a client can download a DMG, drag the app into
Applications, open it, and enter Cloudflare settings through the in-app Setup
panel.

## Build Locally

```sh
npm ci
npm run check
npm test
npm run tauri:dmg
```

Artifacts are written to `src-tauri/target/release/bundle/`:

- `src-tauri/target/release/bundle/dmg/Core Mail_<version>_aarch64.dmg`
- `src-tauri/target/release/bundle/macos/Core Mail.app`

The DMG is the file to publish for normal Mac users. Keep each published build
under a versioned CDN path so older installers do not change after release.
Electron scripts remain in the repository as a fallback, but the client-facing
release path is Tauri because the app bundle and DMG are substantially lighter.

## Publish On The Valen CDN

1. Bump `package.json` version.
2. Run `npm run tauri:dmg`.
3. Upload the DMG to a versioned R2 path, for example:

```txt
https://downloads.valen-systems.com/better-email-routing/releases/v1.0.6/Core-Mail-1.0.6-aarch64.dmg
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

Client-friendly builds should include a Cloudflare OAuth client ID value so the
Setup panel can open Cloudflare login instead of asking the client to paste an
API token. The client ID value is safe to ship, but the OAuth client's
Cloudflare visibility may still be private unless it has been promoted to
public.

Register this redirect URI on the Cloudflare OAuth client:

```txt
http://127.0.0.1:8899/api/oauth/callback
```

Official release builds ship the public OAuth metadata in `app.defaults.env`.
The client ID is public. Do not ship a client secret, account ID, sender
address, API token, mailbox URL, mailbox secret, access token, or refresh token
in the desktop app.

If this private OAuth client was created under the Valen Cloudflare account, it
works for a signed-in Cloudflare user who is a Valen account member and also has
access to the target client account. For a client signing in as their own
separate Cloudflare user, either make the OAuth client public after domain
verification or create a client-owned OAuth client and rebuild with that client
ID.

Current release scopes:

```txt
email-sending.write memberships.read user-details.read
```

## Signing And Notarization

Unsigned builds are useful for internal testing, but public Mac downloads should
be signed and notarized before clients use them.

Needed Apple items:

- Apple Developer account.
- Developer ID Application certificate.
- App-specific password or App Store Connect API key.
- Tauri signing/notarization environment variables in GitHub Actions.

Until those secrets are configured, macOS may show a Gatekeeper warning on first
open. That is expected for unsigned internet downloads and is not the final
client distribution state.

## Local Config Boundary

The desktop app starts the bundled Node sidecar on `127.0.0.1:8899` by default
so the Cloudflare OAuth callback is stable. It sets the app home to the macOS
application data directory. User secrets and sent history stay in that local
app-data directory. They are not packaged into the DMG.
