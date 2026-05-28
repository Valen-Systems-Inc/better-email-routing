# Never pay for google workspace email again!

Better Email Routing is a tiny self-hosted email client for Cloudflare Email
Routing and Cloudflare Email Service. It gives one address on your domain a real
little mailbox without paying for a full Google Workspace seat.

It is intentionally simple:

- Cloudflare Email Routing sends inbound mail to a Worker.
- The Worker stores threads and messages in D1.
- A local Node app serves the browser UI and keeps Cloudflare secrets out of the browser.
- Replies and new messages send through Cloudflare Email Service.
- Sent mail is copied back into the same D1 thread history.

You get Inbox, Sent, All Mail, Archive, Trash, search, open/read threads, reply,
mark read/unread, restore, and permanent delete.

## Why

For solo builders, side projects, private domains, and small companies, paying
for Google Workspace just to send and receive a few domain emails is absurd.
Cloudflare already owns the domain edge in a lot of setups, so this repo uses
that edge as the mail intake and storage boundary.

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
- Not attachment-complete yet. Text and HTML bodies are stored; attachment
  handling still needs to be added.

## Architecture

```text
sender
  -> Cloudflare Email Routing
  -> Worker email() handler
  -> D1 mailbox tables
  -> local Node server private proxy
  -> browser UI

browser UI
  -> local Node server
  -> Cloudflare Email Service REST API
  -> recipient
  -> Worker /api/sent
  -> D1 thread history
```

The browser only talks to the local Node server. API tokens and the Worker API
secret live in `.env` and Cloudflare Worker secrets.

## Repo Layout

- `server.js`: local HTTP server, static UI, Cloudflare send API, private Worker proxy.
- `public/`: the browser mail client.
- `worker/`: Cloudflare Email Worker and D1-backed mailbox API.
- `worker/migrations/`: D1 schema.
- `worker/src/thread-filters.js`: mailbox/search filter builder.
- `STARTUP.md`: simple setup and run instructions.

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```sh
cp .env.example .env
```

Required values:

- `CLOUDFLARE_API_TOKEN`: token with Email Sending permission.
- `CLOUDFLARE_ACCOUNT_ID`: your Cloudflare account id.
- `DEFAULT_FROM`: sender/inbox address, for example `inbox@example.com`.
- `DEFAULT_TO`: optional default compose recipient.
- `MAILBOX_WORKER_URL`: deployed Worker URL.
- `MAILBOX_API_SECRET`: shared secret used by the local server to call the Worker API.

Do not commit `.env`.

## Commands

```sh
npm start
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
