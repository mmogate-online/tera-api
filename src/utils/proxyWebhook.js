"use strict";

/**
 * Connection-gate proxy launcher-login webhook. At "Play" (GetAuthKeyAction) the portal pushes a
 * short-lived launcher grant {ip, accountId, name, authKey, ttlSeconds} to a downstream proxy that
 * gates game-server connections, so only IPs that completed a launcher login may connect. Fire-and-
 * forget: failures never block the launcher response — a proxy that also polls (pull fallback) recovers
 * a missed grant. Requires API_ARBITER_USE_IP_FROM_LAUNCHER=true so req.ip is the client's launcher IP
 * (recorded before the game client connects).
 *
 * Contract: POST the JSON body below to API_PORTAL_PROXY_WEBHOOK_URL with header X-Api-Key set to the
 * shared secret. Any proxy implementing that endpoint can consume this.
 */

const env = require("./env");
const logger = require("./logger").createLogger("ProxyWebhook");

const enabled = env.bool("API_PORTAL_PROXY_WEBHOOK_ENABLE", false);
const endpointUrl = env.string("API_PORTAL_PROXY_WEBHOOK_URL");
const secret = env.string("API_PORTAL_PROXY_WEBHOOK_SECRET", "");
const grantTtlSeconds = env.number("API_PORTAL_PROXY_WEBHOOK_GRANT_TTL", 1800);
const timeoutMs = env.number("API_PORTAL_PROXY_WEBHOOK_TIMEOUT", 2000);

/**
 * Pushes a launcher grant to the connection-gate proxy. Non-blocking; never throws.
 * @param {{ ip: string, accountId: number, name: string, authKey: string }} grant
 */
module.exports.notifyLauncherGrant = ({ ip, accountId, name, authKey }) => {
	if (!enabled || !endpointUrl) {
		return;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	fetch(endpointUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Api-Key": secret
		},
		body: JSON.stringify({
			ip,
			accountId,
			name: name || String(accountId),
			authKey,
			ttlSeconds: grantTtlSeconds
		}),
		signal: controller.signal
	}).then(response => {
		if (!response.ok) {
			logger.warn(`Launcher-grant webhook returned ${response.status} for ${ip}.`);
		}
	}).catch(err => {
		logger.error(`Launcher-grant webhook failed for ${ip}: ${err.message}`);
	}).finally(() => {
		clearTimeout(timer);
	});
};
