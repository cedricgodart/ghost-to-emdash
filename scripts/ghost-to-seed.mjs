// Convertit des contenus Ghost (export JSON) en entrées de seed EmDash (Portable Text).
// Usage : SITE_URL=https://example.com [BYLINE=auteur] node scripts/ghost-to-seed.mjs <export-ghost.json> [slug1,slug2,...] > converted.json
// Sans liste de slugs, tous les contenus de l'export sont convertis.
import fs from "node:fs";
import { parseDocument } from "htmlparser2";
import render from "dom-serializer";
import { htmlToPortableText } from "@emdash-cms/gutenberg-to-portable-text";

const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");
if (!SITE) {
	console.error("Définis SITE_URL (ex. SITE_URL=https://example.com), l'adresse publique de ton site Ghost.");
	process.exit(1);
}
const BYLINE = process.env.BYLINE || ""; // identifiant de l'auteur dans le seed EmDash (facultatif)
const [, , exportPath, slugList] = process.argv;
const data = JSON.parse(fs.readFileSync(exportPath, "utf8")).data;
const wanted = new Set((slugList || "").split(",").filter(Boolean));

const metaByPost = Object.fromEntries((data.posts_meta || []).map((m) => [m.post_id, m]));
const tagsById = Object.fromEntries((data.tags || []).map((t) => [t.id, t]));
const tagsByPost = {};
for (const pt of data.posts_tags || []) {
	(tagsByPost[pt.post_id] ||= []).push({ order: pt.sort_order || 0, tag: tagsById[pt.tag_id] });
}

let keyCounter = 0;
const key = () => `k${(++keyCounter).toString(36)}`;
const abs = (u) => (u || "").replaceAll("__GHOST_URL__", SITE);
// Ghost sert l'original quand on retire /size/wNNN/
const original = (u) => abs(u).replace(/\/content\/images\/size\/w\d+(h\d+)?\//, "/content/images/");
const fileName = (u) => decodeURIComponent(u.split("/").pop().split("?")[0]);
const cls = (el) => (el.attribs?.class || "").split(/\s+/);
const hasClass = (el, c) => cls(el).includes(c);
const text = (el) =>
	!el ? "" : el.type === "text" ? el.data : (el.children || []).map(text).join("");
const find = (el, pred) => {
	for (const c of el.children || []) {
		if (c.type === "tag" && pred(c)) return c;
		const r = find(c, pred);
		if (r) return r;
	}
	return null;
};
const findAll = (el, pred, acc = []) => {
	for (const c of el.children || []) {
		if (c.type === "tag" && pred(c)) acc.push(c);
		findAll(c, pred, acc);
	}
	return acc;
};
const inner = (el) => (el ? render(el.children || [], { decodeEntities: false }) : "");

function mediaImage(src, alt, caption) {
	const url = original(src);
	const block = { _type: "image", _key: key(), asset: { $media: { url, alt: alt || "", filename: fileName(url) } } };
	if (alt) block.alt = alt;
	if (caption) block.caption = caption;
	return block;
}

// Nettoie le HTML d'une carte pour un bloc HTML en ligne (attributs style, svg et boutons retirés).
function cleanCardHtml(html) {
	return abs(html)
		.replace(/\sstyle="[^"]*"/g, "")
		.replace(/<svg[\s\S]*?<\/svg>/g, "")
		.replace(/<button[^>]*>([\s\S]*?)<\/button>/g, "$1");
}

function htmlBlock(html) {
	return { _type: "htmlBlock", _key: key(), html: html.trim() };
}

function convertCard(el) {
	const c = cls(el);
	if (c.includes("kg-image-card")) {
		const img = find(el, (n) => n.name === "img");
		const cap = find(el, (n) => n.name === "figcaption");
		return img ? [mediaImage(img.attribs.src, img.attribs.alt, cap ? text(cap).trim() : "")] : [];
	}
	if (c.includes("kg-gallery-card")) {
		const imgs = findAll(el, (n) => n.name === "img");
		const cap = find(el, (n) => n.name === "figcaption");
		const block = {
			_type: "gallery",
			_key: key(),
			images: imgs.map((i) => mediaImage(i.attribs.src, i.attribs.alt, "")),
		};
		const out = [block];
		if (cap) out.push(...htmlToPortableText(`<p><em>${inner(cap)}</em></p>`));
		return out;
	}
	if (c.includes("kg-embed-card")) {
		const iframe = find(el, (n) => n.name === "iframe");
		if (!iframe) return [htmlBlock(cleanCardHtml(render(el)))];
		const src = abs(iframe.attribs.src).replaceAll("&amp;", "&");
		const yt = src.match(/youtube\.com\/embed\/([\w-]+)/);
		if (yt) return [{ _type: "embed", _key: key(), url: `https://www.youtube.com/watch?v=${yt[1]}`, provider: "youtube" }];
		return [
			{
				_type: "iframe",
				_key: key(),
				src,
				title: iframe.attribs.title || "Contenu intégré",
				height: Number.parseInt(iframe.attribs.height, 10) || 352,
				allow: iframe.attribs.allow || "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
			},
		];
	}
	if (c.includes("kg-video-card")) {
		const v = find(el, (n) => n.name === "video");
		const url = abs(v?.attribs.src || "");
		return url ? [{ _type: "video", _key: key(), asset: { _ref: url, url, provider: "external" } }] : [];
	}
	if (c.includes("kg-audio-card")) {
		const a = find(el, (n) => n.name === "audio");
		const url = abs(a?.attribs.src || "");
		return url ? [{ _type: "embed", _key: key(), url }] : [];
	}
	if (c.includes("kg-toggle-card")) {
		const q = find(el, (n) => hasClass(n, "kg-toggle-heading-text"));
		const a = find(el, (n) => hasClass(n, "kg-toggle-content"));
		return [
			htmlBlock(
				`<div class="kg-toggle-card" data-kg-toggle-state="close"><h3 class="kg-toggle-heading-text">${cleanCardHtml(inner(q)).replace(/<\/?span[^>]*>/g, "")}</h3><div class="kg-toggle-content">${cleanCardHtml(inner(a))}</div></div>`,
			),
		];
	}
	if (c.includes("kg-signup-card") || c.includes("kg-email-cta-card")) return []; // formulaires d'inscription Ghost : à remplacer par ceux du thème EmDash
	// callout, bookmark, product, button, header, cta... : bloc HTML stylé par le thème
	return [htmlBlock(cleanCardHtml(render(el, { decodeEntities: false })))];
}

function convertHtml(rawHtml, warnings) {
	// Les apostrophes droites dans alt="" coupent le texte dans le convertisseur : on passe en apostrophe typographique.
	const html = abs(rawHtml)
		.replace(/alt="([^"]*)"/g, (_, a) => `alt="${a.replaceAll("'", "’")}"`)
		// <details>/<summary> sont retirés par le nettoyage HTML d'EmDash : on les convertit en bloc dépliable
		.replace(
			/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
			(_, sum, body) =>
				`<div class="kg-toggle-card cg-more" data-kg-toggle-state="close"><h3 class="kg-toggle-heading-text">${sum.trim()}</h3><div class="kg-toggle-content">${body}</div></div>`,
		);
	const doc = parseDocument(html, { decodeEntities: false });
	const out = [];
	let buffer = [];
	let inHtmlCard = false;
	let cardBuffer = [];
	const flush = () => {
		if (buffer.length) {
			out.push(...htmlToPortableText(buffer.join("")));
			buffer = [];
		}
	};
	for (const node of doc.children) {
		if (node.type === "comment") {
			if (/kg-card-begin:\s*html/.test(node.data)) {
				flush();
				inHtmlCard = true;
				cardBuffer = [];
			} else if (/kg-card-end:\s*html/.test(node.data)) {
				let h = cardBuffer.join("");
				const styles = [...h.matchAll(/<style[\s\S]*?<\/style>/g)].length;
				if (styles) warnings.push(`carte HTML : ${styles} bloc(s) <style> retiré(s), styles à reprendre dans le thème`);
				h = h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
				if (h.trim()) out.push(htmlBlock(h));
				inHtmlCard = false;
			}
			continue;
		}
		const piece = render(node, { decodeEntities: false });
		if (inHtmlCard) {
			cardBuffer.push(piece);
			continue;
		}
		if (node.type === "tag" && hasClass(node, "kg-card")) {
			flush();
			out.push(...convertCard(node));
			continue;
		}
		buffer.push(piece);
	}
	flush();
	return out;
}

const result = { posts: [], pages: [], terms: {}, warnings: {} };
for (const p of data.posts) {
	if (wanted.size && !wanted.has(p.slug)) continue;
	const meta = metaByPost[p.id] || {};
	const warnings = [];
	const tags = (tagsByPost[p.id] || [])
		.sort((a, b) => a.order - b.order)
		.map((x) => x.tag)
		.filter((t) => t && t.visibility !== "internal" && !t.slug.startsWith("hash-"));
	for (const t of tags) result.terms[t.slug] = t.name;

	const entry = {
		id: `ghost-${p.slug}`,
		slug: p.slug,
		status: p.status === "published" ? "published" : "draft",
		data: {
			title: p.title,
			content: convertHtml(p.html || "", warnings),
			excerpt: p.custom_excerpt || "",
			seo_title: meta.meta_title || "",
			seo_description: meta.meta_description || "",
			og_title: meta.og_title || "",
			og_description: meta.og_description || "",
			ghost_published_at: p.published_at || "",
			jsonld: p.codeinjection_head || "",
			code_footer: p.codeinjection_foot || "",
		},
	};
	if (p.feature_image) {
		entry.data.featured_image = {
			$media: {
				url: original(p.feature_image),
				alt: meta.feature_image_alt || p.title,
				filename: fileName(original(p.feature_image)),
				...(meta.feature_image_caption ? { caption: meta.feature_image_caption.replace(/<[^>]+>/g, "") } : {}),
			},
		};
	}
	if (p.type === "post") {
		entry.data.featured = Boolean(p.featured);
		entry.taxonomies = { tag: tags.map((t) => t.slug) };
		if (BYLINE) entry.bylines = [{ byline: BYLINE }];
		result.posts.push(entry);
	} else {
		result.pages.push(entry);
	}
	if (warnings.length) result.warnings[p.slug] = warnings;
}
process.stdout.write(JSON.stringify(result, null, "\t"));
