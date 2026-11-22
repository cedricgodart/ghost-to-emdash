#!/usr/bin/env node
// Applique les migrations EmDash sur la base D1 distante AVANT le déploiement.
// Lancé par `npm run deploy` dans Cloudflare Workers Builds, qui fournit
// CLOUDFLARE_API_TOKEN (et en général CLOUDFLARE_ACCOUNT_ID).
// Évite que le Worker tente la migration au premier chargement et reste
// bloqué sur un verrou si la requête est interrompue.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";

const LOCK_STALE_MS = 2 * 60 * 1000;

function fail(msg) {
	console.error(`[migrate-deploy] ${msg}`);
	process.exit(1);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) fail("CLOUDFLARE_API_TOKEN absent : impossible de migrer la base D1.");

// Identifiant de la base depuis wrangler.jsonc (commentaires retirés)
const raw = readFileSync("wrangler.jsonc", "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^\s*\/\/.*$/gm, "");
const dbMatch = raw.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i);
if (!dbMatch) fail("database_id introuvable dans wrangler.jsonc.");
const databaseId = dbMatch[1].toLowerCase();

let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!accountId) {
	const res = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=5", {
		headers: { Authorization: `Bearer ${token}` },
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.result?.length) fail("Impossible de déterminer l'identifiant de compte Cloudflare.");
	if (body.result.length > 1) fail("Plusieurs comptes Cloudflare : définis CLOUDFLARE_ACCOUNT_ID.");
	accountId = body.result[0].id;
}
accountId = accountId.trim().toLowerCase();

const digest = new Uint8Array(
	await webcrypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify({ kind: "d1", identity: [accountId, databaseId] })),
	),
);
const fingerprint = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");

const base = [
	"emdash",
	"migrate",
	"--wrangler-config",
	"wrangler.jsonc",
	"--account-id",
	accountId,
	"--expected-target-fingerprint",
	fingerprint,
];

function run(extra = []) {
	const r = spawnSync("npx", [...base, ...extra], {
		encoding: "utf8",
		env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
	});
	process.stdout.write(r.stdout ?? "");
	process.stderr.write(r.stderr ?? "");
	return r;
}

let r = run();
if (r.status !== 0) {
	const m = `${r.stdout}\n${r.stderr}`.match(/\(lock (\d+)\)/);
	if (m && Date.now() - Number(m[1]) > LOCK_STALE_MS) {
		console.log(`[migrate-deploy] Verrou abandonné (${m[1]}), reprise de la migration.`);
		r = run(["--take-over-lock", m[1]]);
	}
}
if (r.status !== 0) fail("La migration de la base D1 a échoué.");
console.log("[migrate-deploy] Base D1 à jour.");
