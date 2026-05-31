"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const MODULE_PATH = require.resolve("../../src/utils/proxyWebhook");

const ENV_KEYS = [
	"API_PORTAL_PROXY_WEBHOOK_ENABLE",
	"API_PORTAL_PROXY_WEBHOOK_URL",
	"API_PORTAL_PROXY_WEBHOOK_SECRET",
	"API_PORTAL_PROXY_WEBHOOK_GRANT_TTL",
	"API_PORTAL_PROXY_WEBHOOK_TIMEOUT"
];

let savedEnv;
let savedFetch;

beforeEach(() => {
	savedEnv = {};
	for (const key of ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
	savedFetch = global.fetch;
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = savedEnv[key];
		}
	}
	global.fetch = savedFetch;
	delete require.cache[MODULE_PATH];
});

// proxyWebhook reads its config into module-level consts at require time, so reset all webhook env,
// apply this load's values, then (re)require from a cleared cache.
function load(env) {
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) {
			process.env[key] = String(value);
		}
	}
	delete require.cache[MODULE_PATH];
	return require(MODULE_PATH);
}

// Lets the fire-and-forget fetch promise settle (clearing its abort timer) before assert/teardown.
const flush = () => new Promise(resolve => setImmediate(resolve));

const grant = { ip: "203.0.113.7", accountId: 42, name: "hero", authKey: "key-1" };

test("does not call fetch when disabled or unconfigured", async () => {
	let calls = 0;
	global.fetch = async () => { calls++; return { ok: true }; };

	// Master switch off (even with a URL present).
	load({ API_PORTAL_PROXY_WEBHOOK_ENABLE: "false", API_PORTAL_PROXY_WEBHOOK_URL: "http://proxy/grant" })
		.notifyLauncherGrant(grant);
	// Enabled but no endpoint URL configured.
	load({ API_PORTAL_PROXY_WEBHOOK_ENABLE: "true" })
		.notifyLauncherGrant(grant);
	await flush();

	assert.equal(calls, 0);
});

test("posts the grant with the shared secret and the expected body", async () => {
	let captured;
	global.fetch = async (url, options) => { captured = { url, options }; return { ok: true }; };

	const webhook = load({
		API_PORTAL_PROXY_WEBHOOK_ENABLE: "true",
		API_PORTAL_PROXY_WEBHOOK_URL: "http://proxy/api/v1/ip-access/launcher-grants",
		API_PORTAL_PROXY_WEBHOOK_SECRET: "s3cret",
		API_PORTAL_PROXY_WEBHOOK_GRANT_TTL: "1800"
	});
	webhook.notifyLauncherGrant(grant);
	await flush();

	assert.equal(captured.url, "http://proxy/api/v1/ip-access/launcher-grants");
	assert.equal(captured.options.method, "POST");
	assert.equal(captured.options.headers["X-Api-Key"], "s3cret");
	assert.equal(captured.options.headers["Content-Type"], "application/json");
	assert.deepEqual(JSON.parse(captured.options.body), {
		ip: "203.0.113.7",
		accountId: 42,
		name: "hero",
		authKey: "key-1",
		ttlSeconds: 1800
	});
});

test("swallows a rejected fetch without surfacing an unhandled rejection", async () => {
	global.fetch = async () => { throw new Error("connection refused"); };

	const webhook = load({
		API_PORTAL_PROXY_WEBHOOK_ENABLE: "true",
		API_PORTAL_PROXY_WEBHOOK_URL: "http://proxy/grant"
	});

	// The resilience contract: a webhook failure must be handled by the function's own .catch so the
	// launcher response never blocks/breaks. A synchronous "doesNotThrow" alone wouldn't prove this
	// (the call never awaits), so assert that NO unhandledRejection escapes either.
	const unhandled = [];
	const onUnhandled = reason => unhandled.push(reason);
	process.on("unhandledRejection", onUnhandled);
	try {
		assert.doesNotThrow(() => webhook.notifyLauncherGrant(grant));
		await flush();
		await flush(); // give any unhandled rejection a turn of the loop to surface
		assert.equal(unhandled.length, 0, "the rejection must be caught inside notifyLauncherGrant");
	} finally {
		process.removeListener("unhandledRejection", onUnhandled);
	}
});
