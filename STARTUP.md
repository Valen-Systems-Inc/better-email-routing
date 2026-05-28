# Startup

## 1. Create Local Env

```sh
cp .env.example .env
```

Fill in:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `DEFAULT_FROM`
- `MAILBOX_WORKER_URL`
- `MAILBOX_API_SECRET`

## 2. Configure Worker

Edit `worker/wrangler.jsonc`:

- set `account_id`
- set `vars.INBOX_ADDRESS`
- set `d1_databases[0].database_id`

Create a D1 database if you do not already have one:

```sh
cd worker
npx wrangler d1 create better-email-routing-inbox
```

Put the returned database id into `worker/wrangler.jsonc`.

## 3. Deploy Worker

```sh
cd worker
npx wrangler d1 migrations apply better-email-routing-inbox --remote
npx wrangler secret put MAILBOX_API_SECRET
npx wrangler deploy
```

Use the deployed Worker URL as `MAILBOX_WORKER_URL` in `.env`.

## 4. Route Email To Worker

In Cloudflare Email Routing for your domain:

1. Create or edit the custom address, for example `inbox@example.com`.
2. Set the action to `Send to a Worker`.
3. Select `better-email-routing-inbox`.

## 5. Run Local App

From the repo root:

```sh
npm start
```

Open:

```txt
http://127.0.0.1:8899
```

## 6. Check It

```sh
npm run check
npm test
```
