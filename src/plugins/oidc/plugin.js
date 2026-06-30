"use strict";

/**
 * OIDC / Keycloak authentication plugin for the tera-api Admin Panel.
 *
 * Adds a "Sign in with Keycloak" option that coexists with the existing local
 * QA credential (kept as break-glass) and the dormant STEER path. Everything is
 * gated by OIDC_ENABLE: when off, this plugin is inert and the panel behaves
 * exactly as upstream.
 *
 * Auth model: confidential server-side Authorization Code + PKCE via
 * openid-client v6 and its first-party Passport strategy. Roles are read from
 * the access token (realm_access.roles) and matched against OIDC_ALLOWED_ROLES.
 * A matching user is produced as { type: "oidc", ... } which the panel's ACL
 * (admin.middlewares.js accessFunctionHandler) treats as full access, since the
 * per-function gate only applies to type === "steer".
 *
 * Wiring is via the routes.adminPanel.admin hook (admin.routes.js:368), which
 * hands us the live router and `mod` (mod.passport is the per-router passport
 * instance the login flow uses). The only core touch-points are the login-view
 * button (guarded by res.locals.oidcEnabled) and a small lazy branch in
 * admin.controller.js logoutAction that calls mod.oidcLogout for RP-logout.
 *
 * @typedef {import("../../app").modules} modules
 */

const moment = require("moment-timezone");
const { decodeJwt } = require("jose");

const env = require("../../utils/env");

const resolveTimezone = (zoneinfo, defaultTz) =>
	moment.tz.zone(zoneinfo)?.name ||
	moment.tz.zone(defaultTz)?.name ||
	"UTC";

const readRealmRoles = (accessToken, logger) => {
	if (!accessToken) {
		return [];
	}

	try {
		const payload = decodeJwt(accessToken);
		return Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
	} catch (err) {
		logger.warn(`OIDC: could not decode realm roles from access token: ${err}`);
		return [];
	}
};

module.exports = {
	routes: {
		adminPanel: {
			/**
			 * @param {import("express").Router} router
			 * @param {modules & { passport: import("passport").Authenticator }} mod
			 * @param {modules} modules
			 */
			admin: async (router, mod, modules) => {
				const logger = modules.logger;

				if (!env.bool("OIDC_ENABLE")) {
					return;
				}

				const issuer = env.string("OIDC_ISSUER");
				const clientId = env.string("OIDC_CLIENT_ID");
				const clientSecret = env.string("OIDC_CLIENT_SECRET");
				const redirectUri = env.string("OIDC_REDIRECT_URI");
				const postLogoutRedirectUri = env.string("OIDC_POST_LOGOUT_REDIRECT_URI");
				const scope = env.string("OIDC_SCOPES", "openid profile");
				const allowedRoles = env.array("OIDC_ALLOWED_ROLES", ["admin"]);
				const defaultTz = env.string("OIDC_DEFAULT_TZ", "UTC");
				const buttonLabel = env.string("OIDC_BUTTON_LABEL", "Sign in with Keycloak");

				if (!issuer || !clientId || !clientSecret || !redirectUri) {
					logger.error(
						"OIDC: enabled but missing required configuration " +
						"(OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI). " +
						"OIDC stays disabled; QA break-glass login remains available."
					);
					return;
				}

				const client = require("openid-client");
				const { Strategy } = require("openid-client/passport");

				let config;

				try {
					config = await client.discovery(new URL(issuer), clientId, clientSecret);
				} catch (err) {
					logger.error(
						`OIDC: discovery failed against ${issuer}. ` +
						`OIDC stays disabled; QA break-glass login remains available. ${err}`
					);
					return;
				}

				mod.passport.use("oidc", new Strategy(
					{ config, scope, callbackURL: redirectUri },
					(tokens, verified) => {
						try {
							const claims = tokens.claims() || {};
							const login = claims.preferred_username || claims.sub;
							const roles = readRealmRoles(tokens.access_token, logger);
							const permitted = roles.some(role => allowedRoles.includes(role));

							if (!permitted) {
								logger.warn(
									`OIDC: login denied for "${login}" ` +
									`(roles=[${roles}], allowed=[${allowedRoles}]).`
								);
								return verified(null, false, { message: "Access denied: your account lacks a required role." });
							}

							return verified(null, {
								type: "oidc",
								login,
								tz: resolveTimezone(claims.zoneinfo, defaultTz),
								roles,
								idToken: tokens.id_token,
								remember: false
							});
						} catch (err) {
							return verified(err);
						}
					}
				));

				// Exposed for admin.controller.js logoutAction to perform RP-initiated
				// end-session. Read lazily there, so undefined is harmless when OIDC is off.
				mod.oidcLogout = idToken => client.buildEndSessionUrl(config, {
					post_logout_redirect_uri: postLogoutRedirectUri || undefined,
					id_token_hint: idToken
				}).href;

				// App-level middleware (registered during plugin load, before the router
				// is mounted) so the GET /login view can render the Keycloak button.
				modules.app.use((req, res, next) => {
					res.locals.oidcEnabled = true;
					res.locals.oidcLoginUrl = "/login/oidc";
					res.locals.oidcButtonLabel = buttonLabel;
					next();
				});

				// Begin the Authorization Code + PKCE flow (strategy builds the authz
				// URL with PKCE S256 + state + nonce and 302s to Keycloak).
				router.get("/login/oidc", mod.passport.authenticate("oidc"));

				// Registered redirect URI. The strategy runs authorizationCodeGrant,
				// validating the authorization response and the ID token before the
				// verify callback fires.
				router.get("/login/oidc/callback", (req, res, next) => {
					mod.passport.authenticate("oidc", (err, user, info) => {
						if (err) {
							logger.error(err);
							return res.redirect(`/login?msg=${encodeURIComponent("OIDC login failed. Please try again.")}`);
						}

						if (!user) {
							const message = (info && info.message) || "OIDC login failed.";
							return res.redirect(`/login?msg=${encodeURIComponent(message)}`);
						}

						req.login(user, loginErr => {
							if (loginErr) {
								logger.error(loginErr);
								return res.redirect(`/login?msg=${encodeURIComponent("OIDC session error. Please try again.")}`);
							}

							return res.redirect("/home");
						});
					})(req, res, next);
				});

				logger.info(
					`OIDC: enabled (issuer=${issuer}, client=${clientId}, allowedRoles=[${allowedRoles}]).`
				);
			}
		}
	}
};
