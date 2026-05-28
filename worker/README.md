# Better Email Routing Worker

This Cloudflare Worker receives mail for one routed address, stores it in D1,
and exposes a private JSON API for the local Better Email Routing app.

## Responsibilities

- `email(message, env)`: receives Cloudflare Email Routing messages.
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

After deploy, point your Cloudflare Email Routing custom address at the Worker.
