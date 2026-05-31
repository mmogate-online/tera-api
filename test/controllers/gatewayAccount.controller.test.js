"use strict";

const { describe, test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");

const controller = require("../../src/controllers/gatewayAccount.controller");
const { createRequest, createResponse, noopLogger } = require("../helpers/http");

const SECRET_KEY = "API_GATEWAY_PROXY_SECRET";

let savedSecret;

beforeEach(() => { savedSecret = process.env[SECRET_KEY]; });
afterEach(() => {
	if (savedSecret === undefined) {
		delete process.env[SECRET_KEY];
	} else {
		process.env[SECRET_KEY] = savedSecret;
	}
});

// Builds the HasRecentLoginByIp request handler (last middleware in the chain) with a fake account
// model whose findOne records the query options it received and returns `result`. sequelize.literal/fn
// return inert markers, findOne is faked, so no SQL runs (the real query semantics are covered by the
// Tier-2 container test against a live MySQL).
function buildHandler(result) {
	const calls = [];
	const modules = {
		logger: noopLogger,
		sequelize: {
			literal: value => ({ __literal: value }),
			fn: value => ({ __fn: value })
		},
		accountModel: {
			bans: { __model: "bans" },
			info: {
				findOne: async options => { calls.push(options); return result; }
			}
		}
	};
	const middlewares = controller.HasRecentLoginByIp(modules);
	return { handler: middlewares[middlewares.length - 1], calls };
}

describe("HasRecentLoginByIp", () => {
	test("rejects a wrong secret with 401 and never queries", async () => {
		process.env[SECRET_KEY] = "s3cret";
		const { handler, calls } = buildHandler(null);
		const res = createResponse();

		await handler(
			createRequest({ query: { ip: "203.0.113.7", maxAgeSeconds: "300" }, headers: { "x-api-key": "wrong" } }),
			res);

		assert.equal(res.statusCode, 401);
		assert.equal(res.body.Return, false);
		assert.equal(res.body.ReturnCode, 401);
		assert.equal(calls.length, 0);
	});

	test("queries by ip + freshness window, left-joining active bans", async () => {
		// Guards the exact fix that the Tier-2 test surfaced: a recent-login filter plus a required:false
		// LEFT JOIN to active, in-window bans (reverting to a bare `banned: null` where would drop the
		// include and fail here).
		const { handler, calls } = buildHandler(null);

		await handler(createRequest({ query: { ip: "203.0.113.7", maxAgeSeconds: "300" } }), createResponse());

		assert.equal(calls.length, 1);
		const options = calls[0];
		assert.equal(options.where.lastLoginIP, "203.0.113.7");
		assert.ok(options.where.lastLoginTime[Op.gt] !== undefined, "filters on a lastLoginTime lower bound");

		const bannedInclude = options.include[0];
		assert.equal(bannedInclude.as, "banned");
		assert.equal(bannedInclude.required, false);
		assert.equal(bannedInclude.where.active, 1);
	});
});
