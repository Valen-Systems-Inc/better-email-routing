# Cloudflare Setup

Better Email Routing uses two Cloudflare pieces:

- Email Routing sends inbound mail to the mailbox Worker.
- Email Service sends outbound messages from the local app.

## Current Setup

Use the in-app Setup button and fill in:

- Sender address, for example `info@example.com`.
- Cloudflare account ID.
- Email Service API token.
- Mailbox Worker URL.
- Mailbox API secret.
- Optional default recipient.

Secrets are written to a local `.env` in the user's app data directory. They are
not written into the app bundle, the public repo, or browser storage.

## Token Scope

For sending, the local app needs an API token that can call Cloudflare Email
Service's send endpoint for the target account. Keep this token local to the
person installing the app.

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

## Future OAuth Flow

Cloudflare supports OAuth clients for third-party integrations. A future release
can replace manual token entry with:

1. The app opens a Cloudflare OAuth authorization URL.
2. The user grants limited Cloudflare scopes.
3. The app receives the callback on localhost.
4. The app stores the returned token in local user data.
5. The setup panel checks whether Email Routing, Worker, D1, and Email Service
   are connected.

Until that OAuth client is registered and reviewed, manual token setup is the
reliable path.

Useful docs:

- https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/
- https://developers.cloudflare.com/email-service/
- https://developers.cloudflare.com/email-service/get-started/send-emails/
- https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
- https://developers.cloudflare.com/email-service/api/route-emails/email-handler/
