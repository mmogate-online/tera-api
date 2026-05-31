"use strict";

/**
 * Tiny hand-rolled Express test doubles. The controllers are dependency-injected factories, so tests
 * inject fakes rather than mocking — matching the project's dependency-light style.
 */

/** A fake response that records the status code and JSON body. Chainable like Express's res. */
function createResponse() {
	const res = { statusCode: 200, body: undefined };
	res.status = code => { res.statusCode = code; return res; };
	res.json = body => { res.body = body; return res; };
	return res;
}

/** A fake request. Headers are matched case-insensitively, mirroring Express's req.get(). */
function createRequest({ query = {}, headers = {} } = {}) {
	const lowerHeaders = {};
	for (const [key, value] of Object.entries(headers)) {
		lowerHeaders[key.toLowerCase()] = value;
	}
	return {
		query,
		get: name => lowerHeaders[String(name).toLowerCase()]
	};
}

/** A no-op logger matching the shape returned by utils/logger.createLogger (any level is a no-op fn). */
const noopLogger = new Proxy({}, { get: () => () => {} });

module.exports = { createResponse, createRequest, noopLogger };
