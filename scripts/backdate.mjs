#!/usr/bin/env node
// Remet la vraie date de publication Ghost (champ ghost_published_at) comme date de publication EmDash,
// pour que les listes soient triées dans le bon ordre.
// Usage : EMDASH_URL=… EMDASH_TOKEN=… node scripts/backdate.mjs
const URL_ = process.env.EMDASH_URL.replace(/\/$/, "");
const H = { Authorization: `Bearer ${process.env.EMDASH_TOKEN}`, "Content-Type": "application/json" };
async function api(path, init = {}, tries = 4) {
	const res = await fetch(`${URL_}/_emdash/api${path}`, { ...init, headers: H });
	if (res.status >= 500 && tries > 1) {
		await new Promise((r) => setTimeout(r, 3000));
		return api(path, init, tries - 1);
	}
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.success === false) throw new Error(`${path} : ${res.status} ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
	return body.data;
}
for (const collection of ["posts", "pages"]) {
	let cursor;
	do {
		const d = await api(`/content/${collection}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
		for (const item of d.items ?? []) {
			const ghost = item.data?.ghost_published_at;
			if (!ghost || item.status !== "published") continue;
			if (item.publishedAt && Math.abs(new Date(item.publishedAt) - new Date(ghost)) < 60000) continue;
			await api(`/content/${collection}/${item.id}/publish`, { method: "POST", body: JSON.stringify({ publishedAt: new Date(ghost).toISOString() }) });
			console.log(`${collection}/${item.slug} → ${ghost.slice(0, 10)}`);
		}
		cursor = d.nextCursor;
	} while (cursor);
}
