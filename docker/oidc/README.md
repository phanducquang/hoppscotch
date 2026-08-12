# Local Generic OIDC environment

This development-only Compose stack runs the Hoppscotch fork with PostgreSQL
and Keycloak. Keycloak is an OIDC test provider and is not required by the
production image.

## Prerequisites

- Docker with Compose v2
- At least 8 GB of memory available to Docker for the AIO image build
- `keycloak.local` resolving to the Docker host

Add the hostname once on the host machine:

```sh
sudo sh -c 'echo "127.0.0.1 keycloak.local" >> /etc/hosts'
```

The Compose file also maps `keycloak.local` to `host-gateway` inside the
Hoppscotch container. The browser and backend therefore use the same issuer;
no separate internal issuer URL is needed.

## Build and run

From the repository root:

```sh
docker compose -f docker/oidc/compose.yml build hoppscotch-aio
docker compose -f docker/oidc/compose.yml up -d
docker compose -f docker/oidc/compose.yml ps
```

Follow startup logs with:

```sh
docker compose -f docker/oidc/compose.yml logs -f hoppscotch-aio keycloak
```

The backend intentionally exits after onboarding or an infrastructure
configuration update so the AIO container can reload the saved settings. The
Compose service uses `restart: unless-stopped` to bring it back automatically.
If the container was created with an older version of this Compose file,
recreate it once to apply the restart policy (the image does not need rebuilding):

```sh
docker compose -f docker/oidc/compose.yml up -d --force-recreate hoppscotch-aio
```

Open:

- Hoppscotch: <http://localhost:3000>
- Hoppscotch Admin: <http://localhost:3100>
- Keycloak: <http://keycloak.local:8080>

Use the imported development user:

- Username: `oidc-user`
- Password: `password`

The Keycloak admin console uses `admin` / `admin`. The imported confidential
client is `hoppscotch`, its development secret is `change-me`, and its redirect
URI is `http://localhost:3170/v1/auth/oidc/callback`.

## Stop or reset

Stop the stack while preserving data:

```sh
docker compose -f docker/oidc/compose.yml down
```

Delete the development databases and start from a clean import:

```sh
docker compose -f docker/oidc/compose.yml down -v
```

The `down -v` command permanently removes data belonging to this development
Compose project. All credentials in this directory are intentionally insecure
and must not be used in production.
