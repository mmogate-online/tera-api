# OIDC plugin (Admin Panel)

Adds OpenID Connect (e.g. Keycloak) login to the Admin Panel as an option that
coexists with the local QA credential (break-glass) and the legacy STEER path.
Confidential, server-side Authorization Code + PKCE via
[`openid-client`](https://github.com/panva/openid-client) v6 and its Passport
strategy.

Gated entirely by `OIDC_ENABLE`: when off, the plugin is inert and the Admin
Panel behaves exactly as upstream. Any initialization error (missing config,
provider unreachable) is caught and logged, leaving the QA login usable.

## Configuration

All via environment variables (see the root `.env.example`):
`OIDC_ENABLE`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
`OIDC_REDIRECT_URI`, `OIDC_POST_LOGOUT_REDIRECT_URI`, `OIDC_SCOPES`,
`OIDC_ALLOWED_ROLES`, `OIDC_DEFAULT_TZ`.

Roles are read from the validated `id_token` (`realm_access.roles`), falling
back to the access token if absent, and matched against `OIDC_ALLOWED_ROLES`
(no role name is hardcoded). A matching user gets full panel access. Add a
realm-role mapper that emits `realm_access.roles` into the id_token for the
validated path.

## Provider client

Register a confidential client with: standard flow on, direct access grants off,
PKCE (S256) enforced, the redirect URI `<host>/login/oidc/callback`, and the
post-logout redirect `<host>/login`.

## Integration points

Self-contained except for three small, upstream-safe edits to core (all inert
when `OIDC_ENABLE` is off): the "Sign in with Keycloak" button in
`src/views/adminLogin.ejs`, an RP-logout branch in `admin.controller.js`
(`logoutAction`), and the env-driven session-cookie block in
`src/routes/admin/admin.routes.js`. Everything else lives in this plugin via the
`routes.adminPanel.admin` hook.
