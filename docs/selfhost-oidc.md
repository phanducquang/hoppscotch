# Generic OpenID Connect authentication

Hoppscotch Community Edition can authenticate users with any
standards-compliant OpenID Connect (OIDC) provider. Keycloak is used in the
local example, but the production implementation does not contain
Keycloak-specific endpoints or behavior.

OIDC proves a user's identity. After that identity is resolved, Hoppscotch
continues to use its existing users, provider accounts, access and refresh
tokens, JWTs, cookies, authorization, and session lifecycle.

## Authentication flow

```text
Browser
  -> GET /v1/auth/oidc?redirect_uri=<Hoppscotch app or admin URL>
  -> OIDC authorization endpoint
  -> Authorization Code + PKCE
  -> GET /v1/auth/oidc/callback
  -> validate transaction, ID token, issuer, audience, state, and nonce
  -> resolve OIDC issuer + subject to a Hoppscotch user
  -> issue the normal Hoppscotch access/refresh cookies
  -> redirect to the validated Hoppscotch app or admin URL
```

The implementation uses Authorization Code Flow with PKCE S256. It does not
support implicit flow or the Resource Owner Password Credentials grant.

## Provider requirements

The provider must support:

- OpenID Connect Discovery
- Authorization Code Flow for a confidential client
- client authentication with a client ID and client secret
- PKCE using `S256`
- signed ID tokens and a published JWKS endpoint
- `state` and `nonce`

The configured issuer publishes its metadata at:

```text
{OIDC_ISSUER}/.well-known/openid-configuration
```

Hoppscotch discovers `authorization_endpoint`, `token_endpoint`,
`userinfo_endpoint`, and `jwks_uri` from this document. Do not configure or
hardcode those endpoints separately.

The discovery document's `issuer` must exactly match `OIDC_ISSUER`, including
scheme, host, port, path, and trailing-slash behavior. The same issuer URL must
be reachable from both the user's browser and the Hoppscotch backend.

## Configuration

OIDC can be configured during Admin onboarding or through the installation's
environment configuration before initial onboarding.

| Variable                      | Required | Description                                                                                                                                 |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_ALLOWED_AUTH_PROVIDERS` | Yes      | Include `OIDC`; for example, `OIDC` or `EMAIL,OIDC`.                                                                                        |
| `OIDC_ISSUER`                 | Yes      | Exact HTTP(S) issuer URL advertised by the provider. Use HTTPS in production.                                                               |
| `OIDC_CLIENT_ID`              | Yes      | Confidential client identifier.                                                                                                             |
| `OIDC_CLIENT_SECRET`          | Yes      | Confidential client secret. It is encrypted by the existing InfraConfig encryption mechanism and redacted from configuration API responses. |
| `OIDC_CALLBACK_URL`           | Yes      | Public backend callback URL ending in `/v1/auth/oidc/callback`.                                                                             |
| `OIDC_SCOPE`                  | Yes      | Space-separated scopes. It must contain `openid`; the usual value is `openid profile email`.                                                |
| `OIDC_DISPLAY_NAME`           | No       | Provider name shown by the App and Admin login buttons. Defaults to `OpenID Connect`.                                                       |

Example production configuration:

```dotenv
VITE_ALLOWED_AUTH_PROVIDERS=EMAIL,OIDC

OIDC_DISPLAY_NAME=Company SSO
OIDC_ISSUER=https://id.example.com/realms/hoppscotch
OIDC_CLIENT_ID=hoppscotch
OIDC_CLIENT_SECRET=<strong-client-secret>
OIDC_CALLBACK_URL=https://api.example.com/v1/auth/oidc/callback
OIDC_SCOPE="openid profile email"

VITE_BASE_URL=https://app.example.com
VITE_ADMIN_URL=https://admin.example.com
VITE_BACKEND_API_URL=https://api.example.com/v1
VITE_BACKEND_GQL_URL=https://api.example.com/graphql
VITE_BACKEND_WS_URL=wss://api.example.com/graphql
WHITELISTED_ORIGINS=https://app.example.com,https://admin.example.com,https://api.example.com
```

`OIDC_CLIENT_SECRET` is a backend-only value. Never use a `VITE_` prefix for it
or place it in a frontend bundle. Keep `DATA_ENCRYPTION_KEY` stable and secret;
Hoppscotch uses the existing key to protect encrypted InfraConfig values.

The provider callback and the post-login destination are different values:

- `OIDC_CALLBACK_URL` is registered with the OIDC provider and always points to
  the Hoppscotch backend.
- The `redirect_uri` query parameter on `/v1/auth/oidc` is where Hoppscotch
  sends the browser after creating the Hoppscotch session. Its origin must
  match `VITE_BASE_URL`, `VITE_ADMIN_URL`, or an HTTP(S) origin in
  `WHITELISTED_ORIGINS`.

For example:

```text
https://api.example.com/v1/auth/oidc?redirect_uri=https%3A%2F%2Fapp.example.com
```

An external destination such as `https://attacker.example.com` is rejected
before provider discovery begins.

## Keycloak client configuration

Create one client in the target Keycloak realm with these settings:

| Keycloak setting           | Value                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| Client type                | `OpenID Connect`                                                          |
| Client ID                  | `hoppscotch`                                                              |
| Client authentication      | On                                                                        |
| Standard flow              | On                                                                        |
| Implicit flow              | Off                                                                       |
| Direct access grants       | Off                                                                       |
| Valid redirect URI         | `http://localhost:3170/v1/auth/oidc/callback` for local development       |
| Web origins                | `http://localhost:3000` and `http://localhost:3100` for local development |
| PKCE code challenge method | `S256`                                                                    |
| Default client scopes      | Include `profile` and `email`                                             |

Copy the secret from the client's credentials page into
`OIDC_CLIENT_SECRET`. For the example realm, use this issuer:

```text
http://keycloak.local:8080/realms/hoppscotch
```

The Keycloak user must have an email address and **Email verified** enabled for
the first Hoppscotch login. In production, replace all local URLs and example
credentials with HTTPS URLs and strong secrets.

## Reproducible local environment

The development-only Compose stack in
[`docker/oidc`](../docker/oidc/README.md) contains PostgreSQL, the Hoppscotch
AIO image, and Keycloak with an imported realm. Keycloak is not a production
dependency.

Add the shared issuer hostname on the host once:

```sh
sudo sh -c 'echo "127.0.0.1 keycloak.local" >> /etc/hosts'
```

The Compose service also maps `keycloak.local` to `host-gateway` inside the
Hoppscotch container. This makes the issuer identical from the browser and
backend; do not configure separate external and internal issuer URLs.

From the repository root, build and start the environment:

```sh
docker compose -f docker/oidc/compose.yml build hoppscotch-aio
docker compose -f docker/oidc/compose.yml up -d
docker compose -f docker/oidc/compose.yml ps
```

Follow the relevant logs:

```sh
docker compose -f docker/oidc/compose.yml logs -f hoppscotch-aio keycloak
```

The imported development configuration is:

- Hoppscotch: <http://localhost:3000>
- Hoppscotch Admin: <http://localhost:3100>
- Hoppscotch backend: <http://localhost:3170>
- Keycloak: <http://keycloak.local:8080>
- Keycloak realm: `hoppscotch`
- OIDC client ID: `hoppscotch`
- OIDC client secret: `change-me`
- OIDC test user: `oidc-user` / `password`
- Keycloak administrator: `admin` / `admin`

All credentials in `docker/oidc` are intentionally insecure and are only for
local development.

The backend intentionally exits after onboarding or an InfraConfig update so
the AIO process can reload the saved configuration. The example service has
`restart: unless-stopped`. If an older container does not restart after
onboarding, recreate it once to apply the policy:

```sh
docker compose -f docker/oidc/compose.yml up -d --force-recreate hoppscotch-aio
```

To build the supported production AIO target outside Compose:

```sh
docker build --target aio -t hoppscotch-oidc:local -f prod.Dockerfile .
```

## First login and account linking

The stable OIDC identity is the pair `iss + sub`; email is not used as the
persistent provider identity. Hoppscotch stores the provider account as:

```text
provider = oidc:<issuer>
providerAccountId = <subject>
```

On login:

1. If the issuer and subject already belong to an account, Hoppscotch logs in
   that same user.
2. Otherwise, the identity must contain a syntactically valid email and
   `email_verified=true`.
3. If that verified email already belongs to a Hoppscotch user, the OIDC
   account is linked to that user.
4. If it does not exist, Hoppscotch creates a user and provider account in one
   database transaction.
5. A missing or unverified email is rejected for first-time creation/linking.

The database work uses serializable transactions and retries expected unique
or serialization conflicts to prevent duplicate accounts during concurrent
first logins. Hoppscotch does not persist the provider's access or refresh
tokens after authentication.

After identity resolution, the normal Hoppscotch access token, refresh token,
JWT, and authentication cookies are generated. Logging out and signing in
again with the same issuer and subject reuses the same Hoppscotch user.

## Security behavior

- The authorization request uses `response_type=code`, PKCE S256, `state`, and
  `nonce`.
- ID token signatures are verified using the provider's discovered JWKS.
- Issuer, audience, nonce, and state are validated before identity resolution.
- The PKCE verifier and nonce are never placed in query parameters.
- Temporary login state is stored for at most five minutes in an AES-GCM
  encrypted, `HttpOnly`, `SameSite=Lax` cookie scoped to `/v1/auth/oidc`.
- The temporary cookie is marked `Secure` when the callback uses HTTPS or
  secure cookies are enabled.
- The temporary transaction is cleared when it is consumed, including invalid
  callbacks.
- Only explicitly configured Hoppscotch App/Admin origins can be post-login
  redirect destinations.
- Automatic email linking requires `email_verified=true`.
- Provider tokens and secrets are not logged or persisted as Hoppscotch
  provider tokens.

## Production requirements

- Use HTTPS for the App, Admin, backend callback, and issuer. Local HTTP support
  is intended for development only.
- Register the exact `OIDC_CALLBACK_URL` with the provider. Avoid wildcards.
- Ensure secure cookies resolve to enabled. An HTTPS `VITE_BASE_URL` makes
  Hoppscotch derive secure-cookie behavior during InfraConfig initialization.
- Use a strong client secret and protect `DATA_ENCRYPTION_KEY`. Do not change
  the encryption key after encrypted InfraConfig data has been written.
- Use a trusted certificate chain. Do not disable TLS verification.
- Configure the reverse proxy to preserve the public host and scheme, and set
  `TRUST_PROXY` according to the deployment topology.
- Every backend instance must use the same database and encryption
  configuration so it reads the same generated session secret and InfraConfig.
- Allow backend egress to the issuer's discovery, token, UserInfo (when used),
  and JWKS endpoints.
- Configure user claims or scopes so first-time users receive a verified email.

## Troubleshooting

### Discovery failed

Read the discovery document from the host:

```sh
curl -fsS "$OIDC_ISSUER/.well-known/openid-configuration"
```

For the local Compose stack, verify resolution from the backend container too:

```sh
docker compose -f docker/oidc/compose.yml exec hoppscotch-aio \
  node -e 'fetch(process.env.OIDC_ISSUER + "/.well-known/openid-configuration").then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() }).then(m => console.log(m.issuer)).catch(e => { console.error(e.message); process.exit(1) })'
```

Check DNS, container routing, provider readiness, firewall rules, and the TLS
certificate chain. The document must contain the exact issuer plus
`authorization_endpoint`, `token_endpoint`, and `jwks_uri`.

### Redirect URI mismatch at the provider

Confirm that all of these values are identical:

- the provider's registered valid redirect URI
- `OIDC_CALLBACK_URL`
- the public scheme, hostname, port, and `/v1/auth/oidc/callback` path

Do not register the App URL (`:3000`) as the backend callback (`:3170`). The App
URL belongs in the login endpoint's post-login `redirect_uri` parameter.

### Hoppscotch rejects the post-login redirect

The destination's origin must match `VITE_BASE_URL`, `VITE_ADMIN_URL`, or an
HTTP(S) origin in `WHITELISTED_ORIGINS`. Match scheme, hostname, and port. Paths
and query strings are accepted only after the origin matches.

### Issuer mismatch

Compare the configured value with the discovery response's `issuer`. They must
match exactly. A common Docker error is using `localhost` for the browser and a
container service name for the backend. Use one hostname, such as
`keycloak.local`, from both environments. Do not use separate browser/backend
issuer URLs.

### Invalid or missing state, nonce, or transaction

The transaction expires after five minutes and is single-use. Start one fresh
login, complete it in the same browser, and avoid starting concurrent logins in
multiple tabs because the newest transaction cookie replaces the previous one.
If necessary, clear the backend's OIDC transaction cookie and retry.

Also check that:

- the browser accepts cookies for the backend host
- HTTP/HTTPS and hostnames do not change during the flow
- the reverse proxy does not strip cookies
- production callbacks use HTTPS so `Secure` cookies can be returned
- the provider and application hosts have reasonably synchronized clocks

Never bypass state, nonce, or ID token validation to work around this error.

### First login reports that a verified email is required

Request the `email` scope, make the user's email available to the client, and
ensure the provider returns `email_verified=true` in the ID token or UserInfo
response. In Keycloak, set **Email verified** for the user and make sure the
`email` client scope is assigned. Hoppscotch intentionally does not link an
unverified email because doing so could allow account takeover.

### Client authentication or token exchange fails

Confirm the client is confidential, client authentication and Standard Flow
are enabled, the secret matches `OIDC_CLIENT_SECRET`, PKCE S256 is supported,
and Direct Access Grants/implicit flow are not being used. Saving a replacement
secret through Admin stores it encrypted and configuration APIs return a
redacted value.

### OIDC button is not shown

Ensure `VITE_ALLOWED_AUTH_PROVIDERS` includes uppercase `OIDC`, the complete
OIDC configuration validates, and the backend/AIO service has restarted after
onboarding or an InfraConfig update. `EMAIL,OIDC` enables both providers.

## Manual end-to-end verification

1. Start PostgreSQL.
2. Start Keycloak and wait for the realm to become ready.
3. Start or build the Hoppscotch AIO service.
4. Configure the issuer, client ID, client secret, callback, scopes, display
   name, allowed provider, and Hoppscotch origins through onboarding or
   environment configuration.
5. Open <http://localhost:3000>.
6. Click **Continue with Keycloak**.
7. Sign in as `oidc-user` / `password` in the development realm.
8. Confirm the browser returns through `/v1/auth/oidc/callback` to Hoppscotch.
9. Confirm the user is authenticated and the profile email is
   `oidc-user@example.com`.
10. Log out, then sign in through Keycloak again.
11. Confirm the same Hoppscotch user is reused and no duplicate provider account
    is created.

The backend flow can also be started directly:

```text
http://localhost:3170/v1/auth/oidc?redirect_uri=http%3A%2F%2Flocalhost%3A3000
```

For Admin, use `http://localhost:3100` as the encoded post-login destination.
