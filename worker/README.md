# Better Email Routing Worker

This Cloudflare Worker receives mail for one routed address, stores it in D1,
and exposes a private JSON API for the local Better Email Routing app.

Inbound mail is only available to the app when Cloudflare calls the Worker's
`email(message, env)` handler. The Worker stores parsed text/HTML plus the raw
MIME source in D1 so future parser fixes can reprocess from local mailbox data.
It does not depend on Cloudflare as a historical mailbox API after delivery.

If `FORWARD_COPY_TO` is set, the Worker forwards a safety copy to that verified
Cloudflare Email Routing destination after storing the inbox copy.

## Responsibilities

- `email(message, env)`: receives Cloudflare Email Routing messages.
- Optional `FORWARD_COPY_TO`: forwards a safety copy after successful storage.
- `GET /api/threads`: lists mailbox threads by folder and search query.
- `GET /api/threads/:id`: returns one thread and its messages.
- `PATCH /api/threads/:id/read`: marks a thread read or unread.
- `PATCH /api/threads/:id/archive`: archives or unarchives a thread.
- `PATCH /api/threads/:id/trash`: moves a thread to Trash or restores it.
- `DELETE /api/threads/:id`: permanently deletes a thread.
- `POST /api/sent`: records outbound mail that the local app sent.

All private API routes require:

```txt
Authorization: Bearer <MAILBOX_API_SECRET>
```

## Deploy

```sh
npx wrangler d1 create better-email-routing-inbox
npx wrangler d1 migrations apply better-email-routing-inbox --remote
npx wrangler secret put MAILBOX_API_SECRET
npx wrangler deploy
```

To enable safety forwarding, set `FORWARD_COPY_TO` to a verified Email Routing
destination before deploy. Leave it empty to keep mail only in the custom inbox.

After deploy, point your Cloudflare Email Routing custom address at the Worker.
