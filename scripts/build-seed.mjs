// Construit seed/seed.json : modèle de contenu équivalent à Ghost (articles, pages, tags)
// + contenus convertis par ghost-to-seed.mjs.
// À lancer à la racine d'un projet EmDash qui contient déjà seed/seed.json (celui du modèle de départ).
// Usage : SITE_NAME="Mon site" [SITE_TAGLINE="…"] [AUTHOR_NAME="Prénom Nom" BYLINE=auteur] \
//         node scripts/build-seed.mjs converted.json
import fs from "node:fs";

const converted = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const seed = JSON.parse(fs.readFileSync("seed/seed.json", "utf8"));

const commonFields = [
	{ slug: "title", label: "Titre", type: "string", required: true, searchable: true },
	{ slug: "excerpt", label: "Chapô (300 caractères max)", type: "text" },
	{ slug: "featured_image", label: "Image à la une", type: "image" },
	{ slug: "content", label: "Contenu", type: "portableText", searchable: true },
	{ slug: "seo_title", label: "Titre Google (si le panneau SEO est vide)", type: "string" },
	{ slug: "seo_description", label: "Description Google (si le panneau SEO est vide)", type: "text" },
	{ slug: "og_title", label: "Titre de partage (Facebook, LinkedIn, X)", type: "string" },
	{ slug: "og_description", label: "Description de partage", type: "text" },
	{ slug: "jsonld", label: "Code dans <head> (JSON-LD…)", type: "text" },
	{ slug: "code_footer", label: "Code en bas de page (easter egg…)", type: "text" },
	{ slug: "ghost_published_at", label: "Date de publication d'origine (Ghost)", type: "string" },
];

const SITE_NAME = process.env.SITE_NAME || "Mon site";
const AUTHOR_NAME = process.env.AUTHOR_NAME || "";
const BYLINE = process.env.BYLINE || "";
seed.meta = { name: SITE_NAME, description: process.env.SITE_TAGLINE || "", author: AUTHOR_NAME };
seed.settings = { title: SITE_NAME, tagline: process.env.SITE_TAGLINE || "" };
seed.collections = [
	{
		slug: "posts",
		label: "Articles",
		labelSingular: "Article",
		urlPattern: "/{slug}/",
		supports: ["drafts", "revisions", "preview", "scheduling", "search", "seo"],
		commentsEnabled: false,
		fields: [...commonFields, { slug: "featured", label: "Article mis en avant", type: "boolean" }],
	},
	{
		slug: "pages",
		label: "Pages",
		labelSingular: "Page",
		urlPattern: "/{slug}/",
		supports: ["drafts", "revisions", "preview", "search", "seo"],
		fields: commonFields,
	},
];
seed.taxonomies = [
	{
		name: "tag",
		label: "Tags",
		labelSingular: "Tag",
		hierarchical: false,
		collections: ["posts"],
		terms: Object.entries(converted.terms).map(([slug, label]) => ({ slug, label })),
	},
	{
		name: "category",
		label: "Catégories",
		labelSingular: "Catégorie",
		hierarchical: true,
		collections: ["posts"],
		terms: [],
	},
];
// Auteur unique, repris par ghost-to-seed.mjs (variable BYLINE). Ajoute d'autres auteurs au besoin.
seed.bylines = BYLINE ? [{ id: BYLINE, slug: BYLINE, displayName: AUTHOR_NAME || BYLINE }] : [];
// Les menus Ghost ne sont pas dans l'export JSON : à recréer ici ou dans l'admin EmDash.
seed.menus = [{ name: "primary", label: "Navigation principale", items: [{ type: "custom", label: "Blog", url: "/blog/" }] }];
seed.widgetAreas = (seed.widgetAreas || []).map((a) => ({
	...a,
	widgets: (a.widgets || []).filter((w) => !["core:categories"].includes(w.componentId)).map((w) => ({
		...w,
		title: { "core:search": "Recherche", "core:tags": "Tags", "core:recent-posts": "Derniers articles" }[w.componentId] ?? w.title,
	})),
}));
seed.sections = [];
seed.content = { posts: converted.posts, pages: converted.pages };

fs.writeFileSync("seed/seed.json", JSON.stringify(seed, null, "\t"));
console.log(`seed : ${converted.posts.length} articles, ${converted.pages.length} pages, ${seed.taxonomies[0].terms.length} tags`);
