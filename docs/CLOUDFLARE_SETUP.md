# Cloudflare Setup

Better Email Routing uses two Cloudflare pieces:

- Email Routing sends inbound mail to the mailbox Worker.
- Email Service sends outbound messages from the local app.

## Current Setup

Use the in-app Setup button and fill in:

- Sender address, for example `info@example.com`.
- Cloudflare account ID.
- Connect Cloudflare, or use an Email Service API token as the manual fallback.
- Mailbox Worker URL.
- Mailbox API secret.
- Optional default recipient.

Secrets are written to a local `.env` in the user's app data directory. They are
not written into the app bundle, the public repo, or browser storage.

## Cloudflare Login

The Mac app now supports Cloudflare OAuth with Authorization Code + PKCE. That
is the flow Cloudflare documents for desktop apps because the app can prove the
login request with a code verifier without embedding a client secret.

To enable the Connect button in a release build:

1. Create a Cloudflare OAuth client.
2. Use Authorization Code as the grant type.
3. Use `none` for token endpoint authentication. Do not put a client secret in
   the desktop app.
4. Enable PKCE with `S256`.
5. Add this redirect URI:

```txt
http://127.0.0.1:8899/api/oauth/callback
```

6. Put the public client ID in the release config as
   `CLOUDFLARE_OAUTH_CLIENT_ID`.
7. Add any requested scopes to `CLOUDFLARE_OAUTH_SCOPES` if the client requires
   them at authorization time.

When the user approves the app, Better Email Routing stores the access token,
refresh token, expiry, and account selection in the local app-data `.env`. If
Cloudflare returns exactly one account, the setup screen auto-fills the account
ID.

## Token Scope

For sending, the local app needs an API token that can call Cloudflare Email
Service's send endpoint for the target account. With OAuth enabled, this token
is obtained through Cloudflare login. Without OAuth, keep the manual API token
local to the person installing the app.

For the mailbox API, the local app sends `Authorization: Bearer
<MAILBOX_API_SECRET>` to the Worker. The same secret must be set as a Worker
secret.

## Routing

In Cloudflare Email Routing:

1. Create the custom address.
2. Set the action to send mail to the Better Email Routing Worker.
3. Keep an optional safety-forward address while testing.

The Worker stores displayable text/HTML, raw MIME where available, metadata,
thread state, and sent-message records in D1.

Useful docs:

- https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/
- https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/
- https://developers.cloudflare.com/fundamentals/oauth/authorizing-an-application/
- https://developers.cloudflare.com/email-service/
- https://developers.cloudflare.com/email-service/get-started/send-emails/
- https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
- https://developers.cloudflare.com/email-service/api/route-emails/email-handler/
