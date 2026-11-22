#!/usr/bin/env node
// Rapatrie dans la médiathèque EmDash les images encore référencées en <ton-site>/content/images/…
// (anciens fichiers Ghost), en les téléchargeant depuis le site Ghost d'origine, puis corrige les contenus.
// Usage : EMDASH_URL=… EMDASH_TOKEN=… GHOST_URL=https://xxx.ghost.io SITE_DOMAIN=example.com node scripts/rehost-ghost-images.mjs
// SITE_DOMAIN : ton domaine public, tel qu'il apparaît dans les anciennes adresses d'images Ghost.
import { writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.env.EMDASH_URL.replace(/\/$/, "");
const TOKEN = process.env.EMDASH_TOKEN;
const GHOST = process.env.GHOST_URL.replace(/\/$/, "");
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "X-EmDash-Request": "1" };
const DOMAIN = (process.env.SITE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
if (!DOMAIN) { console.error("Définis SITE_DOMAIN (ex. example.com)."); process.exit(1); }
const esc = DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE = new RegExp(String.raw`https?:\/\/(?:(?:www\.)?${esc}|storage\.ghost\.io\/c\/[^"'\\\s)<>]*?)\/content\/images\/[^"'\\\s)<>]+`, "g");
const dir = mkdtempSync(join(tmpdir(), "rehost-"));

async function api(p, init = {}, tries = 4) {
	const r = await fetch(`${URL_}/_emdash/api${p}`, { ...init, headers: H });
	if (r.status >= 500 && tries > 1) { await new Promise((s) => setTimeout(s, 3000)); return api(p, init, tries - 1); }
	const j = await r.json().catch(() => ({}));
	if (!r.ok || j.success === false) throw new Error(`${p} ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
	return j.data;
}

const cache = new Map();
const failed = [];
async function rehost(url) {
	if (cache.has(url)) return cache.get(url);
	const path = new URL(url).pathname.replace(/\/size\/w\d+\//, "/").replace(/^\/c\/[^/]+\/[^/]+\/[^/]+/, "");
	let result = null;
	try {
		const src = url.includes("storage.ghost.io") ? url.replace(/\/size\/w\d+\//, "/") : GHOST + path;
		const res = await fetch(src, { redirect: "follow" });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico", "image/svg+xml": ".svg" }[(res.headers.get("content-type") || "").split(";")[0]] || "";
		let name = decodeURIComponent(path.split("/").pop()).replace(/[^\w.\-]+/g, "-");
		if (/\.ico$/i.test(name) || ext === ".ico") {
			// la médiathèque refuse les .ico : conversion en PNG
			const ico = join(dir, `${cache.size}-${name}`);
			writeFileSync(ico, Buffer.from(await res.arrayBuffer()));
			const png = ico.replace(/\.ico$/i, "") + ".png";
			execFileSync("python3", ["-c", "import sys;from PIL import Image;im=Image.open(sys.argv[1]);im.save(sys.argv[2])", ico, png]);
			const out = execFileSync("npx", ["emdash", "media", "upload", png, "-u", URL_, "-t", TOKEN, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
			result = JSON.parse(out.slice(out.indexOf("{"))).url;
		} else {
			if (!/\.(jpe?g|png|webp|gif|svg|avif)$/i.test(name)) name += ext || ".jpg";
			const file = join(dir, `${cache.size}-${name}`);
			writeFileSync(file, Buffer.from(await res.arrayBuffer()));
			const out = execFileSync("npx", ["emdash", "media", "upload", file, "-u", URL_, "-t", TOKEN, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
			result = JSON.parse(out.slice(out.indexOf("{"))).url;
		}
	} catch (e) {
		failed.push(`${url} (${e.message.split("\n")[0]})`);
	}
	cache.set(url, result);
	return result;
}

let entries = 0, replaced = 0;
for (const coll of ["posts", "pages"]) {
	let cursor;
	do {
		const d = await api(`/content/${coll}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
		for (const it of d.items) {
			const full = await api(`/content/${coll}/${it.id}`);
			let s = JSON.stringify(full.item.data);
			const urls = [...new Set(s.match(RE) ?? [])];
			if (!urls.length) continue;
			let n = 0;
			for (const u of urls) {
				const nu = await rehost(u);
				if (nu) { s = s.split(u).join(nu); n++; }
			}
			if (!n) continue;
			await api(`/content/${coll}/${it.id}`, { method: "PUT", body: JSON.stringify({ data: JSON.parse(s), _rev: full._rev }) });
			if (full.item.status === "published") await api(`/content/${coll}/${it.id}/publish`, { method: "POST", body: JSON.stringify(full.item.publishedAt ? { publishedAt: full.item.publishedAt } : {}) });
			entries++; replaced += n;
			console.log(`${coll}/${it.slug} : ${n}/${urls.length}`);
		}
		cursor = d.nextCursor;
	} while (cursor);
}
console.log(`\n${replaced} adresses corrigées dans ${entries} contenus.`);
if (failed.length) console.log(`${failed.length} échec(s) :\n${failed.join("\n")}`);
