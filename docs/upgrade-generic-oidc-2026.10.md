# Upgrade Generic OIDC to the 2026.10.1 OSS baseline

This update merges `main` at `55908a76a1d0555c9bbb5d74244c14173df95b06`
into the Generic OIDC implementation at
`69e75a26690c1691678b4b860adfbd3ba5541665`. It retains the existing OIDC
configuration, identity linking, session handling, Admin onboarding and
Settings, and the public callback cookie path used by subpath deployments.

The OSS update includes the unified REST/GraphQL workspace, dataset collection
runs, GraphQL mock examples, and dependency/runtime updates. The history UI
uses the new upstream workspace implementation. The backend keeps
`openid-client@6.8.4` together with the updated upstream dependencies.
Its lockfile entry uses upstream's `jose@6.2.10`, which satisfies the client's
dependency range, rather than retaining a reference to the removed 6.2.3 entry.

## Integration validation

The following checks were completed on Node 24.22.1 during integration:

| Check | Result |
| --- | --- |
| Frozen lockfile installation | Passed with pnpm 10.34.5 |
| Backend suite | 22 suites, 839 tests passed |
| Shared frontend suite | 106 files, 2,078 tests passed, 2 skipped |
| Admin OIDC Settings | 11 tests passed |
| Shared frontend typecheck | Passed |
| Backend and Admin production builds | Passed |
| Shared data, kernel, sandbox and GraphQL editor builds | Passed |
| PostgreSQL upgrade fixture | 22 migrations applied; existing OIDC identity/config and personal/team saved examples retained |
| Node 24 OIDC runtime check | Actual discovery/JWKS, PKCE and signed ID token exchange, public callback cookie path, Admin redirect, session tokens, verified-email linking and concurrent identity resolution passed |

The protocol runtime check used a temporary local provider and PostgreSQL 15.19;
it does not replace browser testing against the deployment's actual provider.
The full backend lint reports 118 existing errors; comparison with the `main`
baseline (126 errors) found no new lint errors. Avoid unrelated formatting
changes as part of this upgrade.

Docker is unavailable in the integration environment. AIO image execution,
Keycloak browser login, and the actual HTTPS ingress/CA configuration remain
deployment checks. Review the PR's current CI status separately from these
local results.

## Before deploying

1. Save the current image tag/digest and deployment configuration.
2. Back up PostgreSQL and verify the backup can be restored into a separate
   database. Export important collections before testing the new workspace.
3. Keep `DATA_ENCRYPTION_KEY` and the existing InfraConfig/session values.
   Changing the encryption key prevents decryption of the saved OIDC secret.
4. Test with a database copy, the actual public URL layout, and the same
   trusted CA configuration as the intended deployment.

## Database migration

Use the new backend image to inspect and apply the supplied migrations:

```sh
pnpm exec prisma migrate status
pnpm exec prisma migrate deploy
```

Run these commands from the backend working directory with `DATABASE_URL`
pointing at the intended database. Use `migrate deploy`, not `db push` or
`migrate reset`, for an existing installation.

The new `20260713090000_mock_server_gql_examples` migration replaces
`sync_mock_examples()` and recomputes the projection for saved examples in
`UserRequest` and `TeamRequest`. It adds GraphQL operation name/type to the
projection. The backfill updates rows with nonempty response objects; measure
its duration on representative data before scheduling production deployment.
Prisma relation-field renames in the OSS schema do not require recreating
the existing user or account tables.

## Verification

- Run the backend test suite and
  `pnpm --dir packages/hoppscotch-sh-admin run test:oidc`.
- Build the backend, shared packages, App, Admin, and the production AIO image.
  The unit-test workflow uses Node 22; the production Dockerfile uses Node 24,
  so the container must also be exercised on its own runtime.
- Complete OIDC login from both App and Admin. Confirm an existing identity
  retains its Hoppscotch UID and a non-admin user cannot access Admin.
- Save OIDC Settings with the secret blank, confirm the stored secret still
  works after restart, then test replacing it with another valid secret.
- Test refresh/logout, existing authentication providers, personal/team
  collections, history, reload/sync, REST and GraphQL examples, and dataset
  collection runs.
- For `ENABLE_SUBPATH_BASED_ACCESS=true`, verify `/admin`,
  `/backend/v1/auth/oidc/callback`, the OIDC transaction cookie path, and the
  final post-login redirect through the public HTTPS reverse proxy.

See [Generic OIDC self-hosting](selfhost-oidc.md) for provider configuration
and the Keycloak development stack. That stack is a development fixture;
production DNS, CA, ingress, and database data must be checked separately.

## Rollback

Keep writes paused while assessing rollback. Reverting only the image does
not reverse database backfills or browser workspace changes. Restore the
database backup into a separate instance first and verify it with the old
image/configuration. If a restore is needed, account for writes made after
the backup and follow the deployment's database recovery procedure. Do not
edit applied migration checksums or reset a production database.
