#!/usr/bin/env node
// Pousse des entrées converties (sortie de ghost-to-seed.mjs) vers une instance EmDash :
// télécharge chaque image $media, la téléverse dans la médiathèque, puis crée l'entrée.
// Usage : EMDASH_URL=… EMDASH_TOKEN=… node scripts/push-entry.mjs converted.json [--draft] [--terms-only]
// --terms-only : n'importe rien, pose seulement les étiquettes sur des entrées déjà créées.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [file, ...flags] = process.argv.slice(2);
const URL_ = process.env.EMDASH_URL;
const TOKEN = process.env.EMDASH_TOKEN;
if (!file || !URL_ || !TOKEN) {
	console.error("Usage : EMDASH_URL=… EMDASH_TOKEN=… node scripts/push-entry.mjs converted.json");
	process.exit(1);
}
const draft = flags.includes("--draft");
const conv = JSON.parse(readFileSync(file, "utf8"));
const dir = mkdtempSync(join(tmpdir(), "emdash-push-"));
const cache = new Map();
const missing = [];

function cli(args) {
	return execFileSync("npx", ["emdash", ...args, "-u", URL_, "-t", TOKEN, "--json"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: 64 * 1024 * 1024,
	});
}


async function api(path, init = {}) {
	const res = await fetch(`${URL_.replace(/\/$/, "")}/_emdash/api${path}`, {
		...init,
		headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.success === false) throw new Error(`API ${path} : ${res.status} ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
	return body.data;
}

const termCache = new Map();
async function termId(taxonomy, slug, label) {
	if (!termCache.has(taxonomy)) {
		const d = await api(`/taxonomies/${taxonomy}/terms`);
		termCache.set(taxonomy, new Map((d.terms ?? []).map((t) => [t.slug, t.id])));
	}
	const m = termCache.get(taxonomy);
	if (!m.has(slug)) {
		const t = await api(`/taxonomies/${taxonomy}/terms`, { method: "POST", body: JSON.stringify({ slug, label: label || slug }) });
		const id = t.term?.id ?? t.id;
		console.error(`  étiquette créée : ${taxonomy}/${slug}`);
		m.set(slug, id);
	}
	return m.get(slug);
}

async function setTerms(collection, entryId, taxonomies) {
	for (const [taxonomy, slugs] of Object.entries(taxonomies ?? {})) {
		if (!slugs?.length) continue;
		const ids = [];
		for (const slug of slugs) ids.push(await termId(taxonomy, slug, conv.terms?.[slug]));
		await api(`/content/${collection}/${entryId}/terms/${taxonomy}`, { method: "POST", body: JSON.stringify({ termIds: ids }) });
		console.error(`  étiquettes ${taxonomy} : ${slugs.join(", ")}`);
	}
}

async function upload(m) {
	const key = m.url ?? m.file;
	if (cache.has(key)) return cache.get(key);
	let path = m.file;
	if (!path) {
		const res = await fetch(m.url.replaceAll("&amp;", "&"));
		if (!res.ok) {
			console.error(`  ⚠ image introuvable (${res.status}), ignorée : ${m.url}`);
			missing.push(m.url);
			cache.set(key, null);
			return null;
		}
		const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif", "image/svg+xml": ".svg" }[(res.headers.get("content-type") || "").split(";")[0].trim()] || ".jpg";
		let name = (m.filename || key.split("/").pop().split("?")[0] || "image").replace(/[^\w.\-]+/g, "-");
		if (!/\.(jpe?g|png|webp|gif|avif|svg)$/i.test(name)) name += ext;
		path = join(dir, name);
		writeFileSync(path, Buffer.from(await res.arrayBuffer()));
	}
	const args = ["media", "upload", path];
	if (m.alt) args.push("--alt", m.alt);
	if (m.caption) args.push("--caption", m.caption);
	let item;
	try {
		const out = cli(args);
		item = JSON.parse(out.slice(out.indexOf("{")));
	} catch (err) {
		console.error(`  ⚠ téléversement impossible, image ignorée : ${key}`);
		missing.push(key);
		cache.set(key, null);
		return null;
	}
	console.error(`  image ${item.filename} → ${item.id}`);
	cache.set(key, item);
	return item;
}

async function imageField(v) {
	if (!v?.$media) return v;
	const it = await upload(v.$media);
	if (!it) return null;
	return {
		provider: "local",
		id: it.id,
		alt: v.$media.alt ?? it.alt ?? "",
		...(v.$media.caption ? { caption: v.$media.caption } : {}),
		width: it.width,
		height: it.height,
		mimeType: it.mimeType,
		filename: it.filename,
		meta: { storageKey: it.storageKey },
	};
}

async function blocks(arr) {
	const drop = new Set();
	for (const b of arr ?? []) {
		if (b._type === "image" && b.asset?.$media) {
			const m = b.asset.$media;
			const it = await upload(m);
			if (!it) { drop.add(b); continue; }
			b.asset = { _type: "reference", _ref: it.id, url: it.url, provider: "local" };
			b.alt ??= m.alt;
			if (m.caption && !b.caption) b.caption = m.caption;
			b.width ??= it.width;
			b.height ??= it.height;
		}
		if (b._type === "gallery" && Array.isArray(b.images)) b.images = await blocks(b.images.map((i) => ((i._type ??= "image"), i)));
	}
	return (arr ?? []).filter((b) => !drop.has(b));
}

for (const [collection, list] of [["pages", conv.pages ?? []], ["posts", conv.posts ?? []]]) {
	for (const e of list) {
		console.error(`→ ${collection}/${e.slug}`);
		if (!flags.includes("--terms-only")) {
			try {
				cli(["content", "get", collection, e.slug]);
				console.error("  déjà présent, ignoré");
				continue;
			} catch {}
		}
		if (flags.includes("--terms-only")) {
			const out = cli(["content", "get", collection, e.slug]);
			const r = JSON.parse(out.slice(out.indexOf("{")));
			await setTerms(collection, r.id ?? r.data?.id, e.taxonomies ?? e.data.taxonomies);
			continue;
		}
		const data = { ...e.data };
		data.featured_image = await imageField(data.featured_image);
		data.content = await blocks(data.content);
		delete data.taxonomies;

		delete data.bylines;
		const payload = join(dir, `${e.slug}.json`);
		writeFileSync(payload, JSON.stringify(data));
		const args = ["content", "create", collection, "--file", payload, "--slug", e.slug];
		if (draft) args.push("--draft");
		const out = cli(args);
		const r = JSON.parse(out.slice(out.indexOf("{")));
		const id = r.id ?? r.data?.id ?? r.item?.id;
		console.error(`  créé : ${id ?? "ok"} (${r.status ?? r.data?.status ?? ""})`);
		if (id) await setTerms(collection, id, e.taxonomies ?? e.data.taxonomies);
		if (id && !draft && e.data.ghost_published_at) {
			await api(`/content/${collection}/${id}/publish`, { method: "POST", body: JSON.stringify({ publishedAt: new Date(e.data.ghost_published_at).toISOString() }) });
			console.error(`  date de publication : ${e.data.ghost_published_at.slice(0, 10)}`);
		}
	}
}

if (missing.length) console.error(`\n${missing.length} image(s) introuvable(s), ignorée(s) :\n${missing.join("\n")}`);
