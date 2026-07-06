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

Official Core Mail release builds include the public OAuth client metadata in
`app.defaults.env`, so the Connect button is available without shipping any
private Cloudflare credentials.

Cloudflare OAuth client visibility still matters. A private OAuth client can be
used by members of the Cloudflare account where that OAuth client was created.
After that user authorizes Core Mail, `memberships.read` lets the app discover
other Cloudflare accounts that same signed-in user can access. That means a
Valen-created private OAuth client can work for a Valen user who also has admin
access to a client account such as Masterflow. If the client signs in as a
separate Cloudflare user who is not a member of the OAuth client's owner
account, make the OAuth client public or create a client-owned OAuth client.

To create or rotate the Cloudflare OAuth client:

1. Create a Cloudflare OAuth client.
2. Use Authorization Code as the grant type.
3. Use `none` for token endpoint authentication. Do not put a client secret in
   the desktop app.
4. Enable PKCE with `S256`.
5. Add this redirect URI:

```txt
http://127.0.0.1:8899/api/oauth/callback
```

6. Select these scopes:

```txt
email-sending.write memberships.read user-details.read
```

7. Put the public client ID value and scopes in `app.defaults.env`.

When the user approves the app, Better Email Routing stores the access token,
refresh token, expiry, and account selection in the local app-data `.env`. If
Cloudflare returns exactly one account, the setup screen auto-fills the account
ID. If the user has access to multiple Cloudflare accounts, the setup screen
lets them pick the right one and stores that choice locally.

## Token Scope

For sending, the local app needs an API token that can call Cloudflare Email
Service's send endpoint for the target account. With OAuth enabled, this token
is obtained through Cloudflare login. Without OAuth, keep the manual API token
local to the person installing the app.

The OAuth flow uses `memberships.read` to list Cloudflare accounts available to
the signed-in user. That lets one Core Mail install work with a second account,
such as a client account, when the signed-in Cloudflare user is already a member
of that account.

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
