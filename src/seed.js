"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

// Load /app/.env as a fallback for manual runs outside compose.
// When invoked via the db-seed compose service, env vars are already injected.
const ENV_FILE = "/app/.env";
if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) {
            process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
        }
    }
}

const SHARE_DB_DIR = path.join(__dirname, "..", "share", "db");

const log = (...args) => console.log("[seed]", ...args);
const errLog = (...args) => console.error("[seed]", ...args);

(async () => {
    const required = ["DB_HOST", "DB_USERNAME", "DB_PASSWORD", "DB_DATABASE"];
    for (const key of required) {
        if (!process.env[key]) {
            errLog(`missing env var ${key} — cannot run`);
            process.exit(1);
        }
    }

    const files = fs.readdirSync(SHARE_DB_DIR)
        .filter(f => f.endsWith(".sql"))
        .sort();

    if (files.length === 0) {
        log("no .sql files found in share/db — nothing to do");
        process.exit(0);
    }

    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || "3306", 10),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        multipleStatements: true,
        connectTimeout: 10000
    });

    for (const file of files) {
        const sqlPath = path.join(SHARE_DB_DIR, file);
        const sql = fs.readFileSync(sqlPath, "utf8");
        log(`applying ${file} (${sql.length} bytes)`);
        await conn.query(sql);
    }

    await conn.end();
    log("done");
    process.exit(0);
})().catch(err => {
    errLog("FAILED", err.message || err);
    process.exit(1);
});
