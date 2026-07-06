# Never pay for google workspace email again!

Core Mail is the downloadable app in this Better Email Routing repo: a tiny
self-hosted email client for Cloudflare Email Routing and Cloudflare Email
Service. It gives one address on your domain a real little mailbox without
paying for a full Google Workspace seat.

It is intentionally simple:

- Cloudflare Email Routing sends inbound mail to a Worker.
- The Worker stores threads and messages in D1.
- The Worker can optionally forward a safety copy to another verified address.
- A local app serves the browser UI and keeps Cloudflare secrets out of the browser.
- Replies and new messages send through Cloudflare Email Service.
- Sent mail is copied back into the same D1 thread history.

You get Inbox, Sent, All Mail, Archive, Trash, search, open/read threads,
reply, reply-all, quick triage filters, selectable thread rows, bulk cleanup,
mark read/unread, restore, and permanent delete.

## Why

For solo builders, side projects, private domains, and small companies, paying
for Google Workspace just to send and receive a few domain emails is absurd.
Cloudflare already owns the domain edge in a lot of setups, so this repo uses
that edge as the mail intake and storage boundary.

This project is free forever. It is built for people who want domain email
without renting another heavy workspace account.

Also: you can't trust Google. Not with pricing, product stability, privacy
incentives, or whether the thing you rely on will still behave the same next
year. Own the boring parts when you can.

## What This Is For

- A personal domain inbox.
- A company alias that should be isolated from your main Gmail.
- A lightweight support/contact inbox.
- A local-first mail console for Cloudflare Email Service.
- A starting point for building your own custom email workflows.

## What This Is Not

- Not a Gmail clone.
- Not an IMAP/SMTP server.
- Not a bulk email or marketing system.
- Not a full attachment archive yet. Text, HTML, and attachment metadata are
  surfaced; downloadable binary attachment storage is not included.

## Architecture

```text
sender
  -> Cloudflare Email Routing
  -> Worker email() handler
  -> D1 mailbox tables
  -> optional safety forward
  -> local Node server private proxy
  -> browser UI

browser UI
  -> local Node server
  -> Cloudflare Email Service REST API
  -> recipient
  -> Worker /api/sent
  -> D1 thread history
```

The browser only talks to the local server. API tokens and the Worker API
secret live in local app config and Cloudflare Worker secrets.

## Downloadable Mac App

The repo can run as either a developer web app or a packaged macOS app.

- `npm start` runs the local web app at `http://127.0.0.1:8899`.
- `npm run app:dev` opens the same app in the desktop shell.
- `npm run app:dmg` builds a `.dmg` and `.zip` in `release/`.

The desktop app stores its real config in the user's macOS app data directory,
not inside the app bundle and not inside this repo. First launch opens the app
with a Setup button where the user can paste the sender address, Cloudflare
account ID, mailbox Worker URL, and mailbox API secret. Client-friendly builds
can include a public Cloudflare OAuth client ID so the Setup panel can open
Cloudflare login instead of asking the user to paste an Email Service API token.

See `docs/RELEASE.md` for the CDN release and `valen-systems.com/downloads`
download flow. Packaged builds include a Check updates button that reads the
Valen CDN manifest at `https://downloads.valen-systems.com/better-email-routing/latest.json`
unless `BETTER_EMAIL_ROUTING_UPDATE_MANIFEST_URL` points at a staging manifest.

## Inbound Storage

Cloudflare Email Routing gives the Worker the raw MIME email during the
`email(message, env)` event. The Worker parses that event once, stores the
displayable text/HTML in D1, and also keeps the raw source so future parser
fixes can reprocess a message from the inbox's own storage.

Rows created before raw-source storage existed may only have headers and a raw
byte size. Those older messages cannot be reconstructed later from Cloudflare;
the receiving Worker has to store what it needs at delivery time.

## Safety Forwarding

Set `FORWARD_COPY_TO` in the Worker environment to forward every accepted
inbound email to a verified Cloudflare Email Routing destination after the
Worker stores the inbox copy. This is a recovery path while the custom mailbox
is still maturing, not the intended long-term user experience.

The goal is for Core Mail to render, send, receive, thread, and preserve email
well enough that this safety forward can be removed.

## Repo Layout

- `server.js`: local HTTP server, static UI, Cloudflare send API, private Worker proxy.
- `electron/`: macOS app shell for downloadable releases.
- `public/`: the browser mail client.
- `worker/`: Cloudflare Email Worker and D1-backed mailbox API.
- `worker/migrations/`: D1 schema.
- `worker/src/thread-filters.js`: mailbox/search filter builder.
- `STARTUP.md`: simple setup and run instructions.
- `docs/RELEASE.md`: DMG, signing, notarization, and tools-page publishing notes.
- `docs/CLOUDFLARE_SETUP.md`: Cloudflare login, manual token fallback, routing, and Worker setup.

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```sh
cp .env.example .env
```

Required values for repo-based development:

- `CLOUDFLARE_API_TOKEN`: token with Email Sending permission, unless using Cloudflare OAuth.
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account id.
- `DEFAULT_FROM`: sender/inbox address, for example `inbox@example.com`.
- `DEFAULT_TO`: optional default compose recipient.
- `MAILBOX_WORKER_URL`: deployed Worker URL.
- `MAILBOX_API_SECRET`: shared secret used by the local server to call the Worker API.

Optional desktop OAuth values:

- `CLOUDFLARE_OAUTH_CLIENT_ID`: public Cloudflare OAuth client id.
- `CLOUDFLARE_OAUTH_REDIRECT_URI`: defaults to `http://127.0.0.1:8899/api/oauth/callback`.
- `CLOUDFLARE_OAUTH_SCOPES`: optional space-separated OAuth scopes requested at authorization time.
- `BETTER_EMAIL_ROUTING_UPDATE_MANIFEST_URL`: optional staging update manifest URL.

Worker values:

- `INBOX_ADDRESS`: routed mailbox address.
- `MAX_RAW_SIZE`: maximum inbound MIME size stored by the Worker.
- `FORWARD_COPY_TO`: optional verified destination for safety copies.

Do not commit `.env`.

In the packaged Mac app, use the in-app Setup panel instead. The app writes the
same values to a local user-data `.env` outside the installed application.

## Commands

```sh
npm start
npm run app:dev
npm run app:dmg
npm run check
npm test
```

Open the app at:

```txt
http://127.0.0.1:8899
```

## Security Notes

- `.env`, local sent-history data, screenshots, and browser automation artifacts
  are gitignored.
- The Worker API requires `Authorization: Bearer <MAILBOX_API_SECRET>`.
- `preview_urls` are disabled in `worker/wrangler.jsonc`.
- The app blocks cross-origin browser API calls to the local server.
