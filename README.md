# ghost-to-emdash

Scripts pour migrer un site [Ghost](https://ghost.org) vers [EmDash](https://github.com/emdash-cms/emdash), le CMS basé sur Astro, en conservant les articles, les pages, les tags, les images, les dates de publication et les adresses.

*[English version below](#english)*

## D'où viennent ces scripts

Ces scripts ont servi à migrer [cedric.fm](https://cedric.fm) de Ghost vers EmDash (hébergé sur Cloudflare) en novembre 2026.

**Ils ont été écrits par Claude, l'assistant IA d'Anthropic**, au fil de cette migration, que [Cédric Godart](https://cedric.fm/bio/) a pilotée, testée et validée sur son propre site. Il les met à disposition tels quels, pour faire gagner du temps à d'autres personnes qui quittent Ghost.

Ils ont fonctionné pour un site d'environ 60 articles et pages. Ils ne sont pas un outil officiel, ni maintenu activement : relis-les, teste-les sur une copie, et adapte-les à ton cas.

## Ce que fait chaque script

| Script | Rôle |
|---|---|
| `scripts/ghost-to-seed.mjs` | Convertit l'export JSON de Ghost en contenus EmDash (Portable Text) : texte, images, galeries, vidéos YouTube, cartes Ghost (encadrés, boutons, aperçus de liens), blocs dépliables, métadonnées SEO et code injecté. |
| `scripts/build-seed.mjs` | Construit le fichier `seed/seed.json` d'EmDash : collections Articles et Pages équivalentes à Ghost, tags, auteur, et les contenus convertis. |
| `scripts/push-entry.mjs` | Variante sans seed : pousse les contenus convertis vers une instance EmDash déjà en ligne, en téléversant chaque image dans la médiathèque. |
| `scripts/backdate.mjs` | Rétablit les dates de publication d'origine de Ghost, pour que les listes restent dans le bon ordre. |
| `scripts/rehost-ghost-images.mjs` | Rapatrie dans la médiathèque EmDash les images encore hébergées par Ghost, et corrige les adresses dans les contenus. |
| `scripts/migrate-deploy.mjs` | Pour Cloudflare : applique les migrations de la base D1 avant chaque déploiement, et reprend un verrou abandonné. |

## Prérequis

- Node.js 22 ou plus récent
- un projet EmDash (le modèle de départ suffit), avec son `seed/seed.json`
- l'export JSON de Ghost : *Settings → Advanced → Import/Export → Export your content*
- pour `push-entry`, `backdate` et `rehost-ghost-images` : l'adresse de ton instance EmDash et un jeton d'API (`EMDASH_URL`, `EMDASH_TOKEN`)
- pour les icônes `.ico` (refusées par la médiathèque) : Python 3 avec Pillow, utilisé pour les convertir en PNG

Installe les dépendances dans ton projet EmDash :

```sh
npm install htmlparser2 dom-serializer @emdash-cms/gutenberg-to-portable-text
```

## Marche à suivre

Les commandes se lancent à la racine de ton projet EmDash, après y avoir copié le dossier `scripts/`.

**1. Convertir l'export Ghost**

```sh
SITE_URL=https://example.com BYLINE=auteur \
  node scripts/ghost-to-seed.mjs ghost-export.json > converted.json
```

Pour tester d'abord sur quelques contenus, ajoute une liste de slugs : `… ghost-export.json premier-article,a-propos > converted.json`.
Le fichier `converted.json` contient aussi une liste d'avertissements par contenu (styles retirés des cartes HTML, par exemple).

**2a. Nouveau site : construire le seed**

```sh
SITE_NAME="Mon site" SITE_TAGLINE="Ma description" AUTHOR_NAME="Prénom Nom" BYLINE=auteur \
  node scripts/build-seed.mjs converted.json
```

Puis initialise EmDash avec ce seed, comme le décrit sa documentation.

**2b. Site EmDash déjà en ligne : pousser les contenus**

```sh
EMDASH_URL=https://example.com EMDASH_TOKEN=… \
  node scripts/push-entry.mjs converted.json [--draft]
```

Les contenus déjà présents (même slug) sont ignorés : le script peut être relancé sans créer de doublons.

**3. Rétablir les dates d'origine**

```sh
EMDASH_URL=https://example.com EMDASH_TOKEN=… node scripts/backdate.mjs
```

**4. Rapatrier les dernières images Ghost**

```sh
EMDASH_URL=https://example.com EMDASH_TOKEN=… \
GHOST_URL=https://ton-site.ghost.io SITE_DOMAIN=example.com \
  node scripts/rehost-ghost-images.mjs
```

**5. Sur Cloudflare : migrations avant déploiement**

Dans `package.json` : `"deploy": "node scripts/migrate-deploy.mjs && wrangler deploy"`. Le script lit l'identifiant de la base dans `wrangler.jsonc` et utilise `CLOUDFLARE_API_TOKEN` (fourni par Workers Builds).

## Ce qu'il faut savoir

- **Adresses** : les collections utilisent le modèle `/{slug}/`, comme Ghost par défaut. Les adresses des articles et des pages ne changent donc pas, et aucune redirection n'est nécessaire pour eux. Les pages de tags et d'auteurs de Ghost (`/tag/…`, `/author/…`) peuvent, elles, demander des redirections.
- **Images** : Ghost sert des versions retaillées (`/size/w600/`). Le script récupère toujours l'original.
- **Textes alternatifs** : les apostrophes droites dans les attributs `alt` coupaient le texte lors de la conversion. Elles sont remplacées par des apostrophes typographiques.
- **Blocs dépliables** : EmDash retire les balises `<details>` et `<summary>`. Elles sont converties en blocs dépliables au format des cartes Ghost.
- **Cartes HTML** : les blocs `<style>` qu'elles contiennent sont retirés, et signalés dans les avertissements. Leur style est à reprendre dans le thème.
- **Cartes Ghost** (encadrés, boutons, aperçus de liens, produits) : elles sont conservées en blocs HTML et doivent être stylées par le thème. Les images des aperçus de liens gardent leur texte alternatif vide, comme dans Ghost.
- **Formulaires d'inscription Ghost** : ils sont retirés, car ils ne fonctionnent plus hors de Ghost.
- **Abonnés** : les membres Ghost ne sont pas concernés par ces scripts. Leur export contient des données personnelles : traite-le à part, avec ton outil d'e-mailing et dans le respect du RGPD.

## Licence

- Code : [MIT](LICENSE)
- Ce README : [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.fr)

---

<a id="english"></a>

# English

Scripts to migrate a [Ghost](https://ghost.org) site to [EmDash](https://github.com/emdash-cms/emdash), the Astro-based CMS, keeping posts, pages, tags, images, publication dates and URLs.

## Where these scripts come from

They were used to migrate [cedric.fm](https://cedric.fm) from Ghost to EmDash (hosted on Cloudflare) in November 2026.

**They were written by Claude, Anthropic's AI assistant**, during that migration, which [Cédric Godart](https://cedric.fm/bio/) led, tested and validated on his own site. He shares them as is, to save time for others leaving Ghost.

They worked for a site of about 60 posts and pages. They are not an official tool and are not actively maintained: read them, test them on a copy, and adapt them to your case.

## What each script does

| Script | Purpose |
|---|---|
| `scripts/ghost-to-seed.mjs` | Converts the Ghost JSON export into EmDash content (Portable Text): text, images, galleries, YouTube videos, Ghost cards (callouts, buttons, bookmarks), toggles, SEO metadata and code injection. |
| `scripts/build-seed.mjs` | Builds EmDash's `seed/seed.json`: Ghost-like Posts and Pages collections, tags, author, and the converted content. |
| `scripts/push-entry.mjs` | Alternative without a seed: pushes converted content to a live EmDash instance, uploading every image to the media library. |
| `scripts/backdate.mjs` | Restores Ghost's original publication dates, so lists stay in the right order. |
| `scripts/rehost-ghost-images.mjs` | Moves images still hosted by Ghost into the EmDash media library and fixes their URLs in the content. |
| `scripts/migrate-deploy.mjs` | For Cloudflare: applies D1 database migrations before each deploy and takes over a stale lock. |

## Requirements

- Node.js 22 or later
- an EmDash project (the starter template is enough), with its `seed/seed.json`
- the Ghost JSON export: *Settings → Advanced → Import/Export → Export your content*
- for `push-entry`, `backdate` and `rehost-ghost-images`: your EmDash URL and an API token (`EMDASH_URL`, `EMDASH_TOKEN`)
- for `.ico` icons (rejected by the media library): Python 3 with Pillow, used to convert them to PNG

```sh
npm install htmlparser2 dom-serializer @emdash-cms/gutenberg-to-portable-text
```

## Steps

Run the commands at the root of your EmDash project, after copying the `scripts/` folder into it.

```sh
# 1. Convert the Ghost export (add a comma-separated list of slugs to test on a few items first)
SITE_URL=https://example.com BYLINE=author node scripts/ghost-to-seed.mjs ghost-export.json > converted.json

# 2a. New site: build the seed
SITE_NAME="My site" SITE_TAGLINE="…" AUTHOR_NAME="First Last" BYLINE=author node scripts/build-seed.mjs converted.json

# 2b. Live EmDash site: push the content (existing slugs are skipped)
EMDASH_URL=https://example.com EMDASH_TOKEN=… node scripts/push-entry.mjs converted.json [--draft]

# 3. Restore the original dates
EMDASH_URL=https://example.com EMDASH_TOKEN=… node scripts/backdate.mjs

# 4. Move the remaining Ghost images
EMDASH_URL=https://example.com EMDASH_TOKEN=… GHOST_URL=https://your-site.ghost.io SITE_DOMAIN=example.com node scripts/rehost-ghost-images.mjs
```

On Cloudflare, set `"deploy": "node scripts/migrate-deploy.mjs && wrangler deploy"` in `package.json`.

Script comments and messages are in French. The notes in the French section above (URLs, image sizes, alt text, toggles, HTML cards, signup forms, members) apply in the same way.

## License

- Code: [MIT](LICENSE)
- This README: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
