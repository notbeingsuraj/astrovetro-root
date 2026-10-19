/* -------------------------------------------------------------------------
   Generate docs/image-review.html — the human verification sheet
   -------------------------------------------------------------------------

   The photo→product mapping was produced by CLIP zero-shot scoring, not by
   human eyes (see docs/IMAGE-MAPPING.md). This script renders every mapped
   photo, grouped by product and ordered exactly as the storefront shows them,
   next to its score/margin/runner-up, and appends the whole unassigned Image
   Library so a reviewer can assign or reject candidates (starting with the
   labradorite pendant's borderline #262) without opening the admin desk.

   The output deliberately lands in docs/, NOT public/: it embeds unassigned
   album photos and per-photo model scores, which must not ship with the
   storefront. Open it straight from disk:

     open docs/image-review.html

   Regenerate after any curation change:

     node scripts/generate-image-review.mjs
   ------------------------------------------------------------------------- */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/image-manifest.json'), 'utf8'));
const catalogue = JSON.parse(
  JSON.stringify((await import('../src/data/catalogue.js')).products)
);

const PRODUCT_DIR = path.join(ROOT, 'public/assets/img/products');
const LIBRARY_DIR = path.join(ROOT, 'public/assets/img/library');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Relative to docs/, so the file works opened straight from disk. */
const rel = (p) => '../public/assets/img/' + p;

const bySlug = new Map(catalogue.map((p) => [p.slug, p]));
const slugs = Object.keys(manifest);

/* Flagged first, then alphabetical — the reviewer's attention is the scarce
   resource, so the four uncertain products open the page. */
const rank = (slug) => (manifest[slug].needsReview ? 0 : 1);
const ordered = [...slugs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

const mappedCount = slugs.reduce((n, s) => n + (manifest[s].photos?.length || 0), 0);
const flagged = slugs.filter((s) => manifest[s].needsReview);

const libraryFiles = fs
  .readdirSync(LIBRARY_DIR)
  .filter((f) => f.endsWith('-large.webp'))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

/* Every album index already mapped to a product — those cannot be candidates
   for anything else, so the library view marks them as taken. */
const mappedAlbum = new Map();
for (const slug of slugs) for (const ph of manifest[slug].photos || []) mappedAlbum.set(ph.albumIndex, slug);

const productSections = ordered
  .map((slug) => {
    const meta = manifest[slug];
    const product = bySlug.get(slug) || { name: slug, price: '—' };
    const photos = meta.photos || [];

    const cells = photos.length
      ? photos
          .map((ph) => {
            const file = `${ph.n}-large.webp`;
            const exists = fs.existsSync(path.join(PRODUCT_DIR, slug, file));
            const alt = (product.imageAlts || [])[ph.n - 1] || '';
            return `<figure class="card${ph.primary ? ' primary' : ''}">
  ${exists ? `<img src="${rel(`products/${slug}/${file}`)}" alt="${esc(alt)}" loading="lazy">` : '<div class="missing">FILE MISSING</div>'}
  <figcaption>
    <b>#${ph.n}</b>${ph.primary ? ' · PRIMARY' : ''} · album <b>#${ph.albumIndex}</b><br>
    score <b>${ph.score}</b> · margin <b>${ph.margin}</b><br>
    <span class="muted">runner-up: ${esc(ph.runnerUp || '—')}</span>
  </figcaption>
</figure>`;
          })
          .join('\n')
      : `<p class="empty">No photo assigned — the storefront renders the gradient art on purpose.</p>`;

    const note = meta.needsReview
      ? `<p class="flag">⚠ <b>needsReview</b> — ${esc(meta.note || 'Photo mapping needs human review.')}</p>`
      : '';

    return `<section class="${meta.needsReview ? 'flagged' : ''}" id="${esc(slug)}">
  <h2>${esc(product.name)} <code>${esc(slug)}</code>${meta.needsReview ? ' <span class="badge">needs review</span>' : ''}</h2>
  ${note}
  <div class="grid">${cells}</div>
</section>`;
  })
  .join('\n');

const libraryCells = libraryFiles
  .map((f) => {
    const albumIndex = parseInt(f, 10);
    const takenBy = mappedAlbum.get(albumIndex);
    return `<figure class="card lib${takenBy ? ' taken' : ''}">
  <img src="${rel(`library/${f}`)}" alt="unassigned album photo ${albumIndex}" loading="lazy">
  <figcaption>
    <b>#${albumIndex}</b>
    ${takenBy ? `<br><span class="muted">mapped → ${esc(takenBy)}</span>` : '<br><span class="free">unassigned</span>'}
  </figcaption>
</figure>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Astrovetro — image verification sheet</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.5 -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f5f0e8; color: #302d2a; }
  header { position: sticky; top: 0; background: #302d2a; color: #f5f0e8; padding: 14px 24px; z-index: 5; }
  header h1 { margin: 0; font-size: 18px; letter-spacing: .04em; }
  header p { margin: 4px 0 0; font-size: 13px; opacity: .85; }
  nav { background: #e8e0d4; padding: 8px 24px; position: sticky; top: 72px; z-index: 4; font-size: 13px; }
  nav a { margin-right: 10px; color: #302d2a; }
  main { padding: 24px; max-width: 1280px; margin: 0 auto; }
  section { margin-bottom: 40px; }
  section.flagged { border-left: 4px solid #b59a69; padding-left: 16px; }
  h2 { font-size: 17px; margin: 0 0 8px; }
  h2 code { font-size: 12px; color: #6b675f; font-weight: 400; }
  .badge { background: #b59a69; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 10px; vertical-align: middle; }
  .flag { background: #f3e6cd; border: 1px solid #d8bf8d; padding: 8px 12px; border-radius: 6px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
  .card { margin: 0; background: #fff; border: 1px solid #ddd2c0; border-radius: 8px; overflow: hidden; }
  .card.primary { outline: 2px solid #a5aa91; }
  .card.taken { opacity: .45; }
  .card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: #eee; }
  .card figcaption { padding: 8px 10px; font-size: 12px; line-height: 1.45; }
  .muted { color: #7a756c; }
  .free { color: #4a7c46; font-weight: 600; }
  .missing { aspect-ratio: 1; display: grid; place-items: center; background: #f8d7d7; color: #8a2a2a; font-size: 12px; }
  .empty { color: #7a756c; font-style: italic; }
  .howto { background: #fff; border: 1px solid #ddd2c0; border-radius: 8px; padding: 14px 18px; margin-bottom: 28px; font-size: 14px; }
  .howto ol { margin: 8px 0 0; padding-left: 20px; }
  h3 { margin: 32px 0 12px; font-size: 15px; }
</style>
</head>
<body>
<header>
  <h1>ASTROVETRO · IMAGE VERIFICATION SHEET</h1>
  <p>${mappedCount} mapped photos across ${slugs.length} products · ${flagged.length} flagged · ${libraryFiles.length} unassigned library photos — generated ${new Date().toISOString().slice(0, 10)}</p>
</header>
<nav>
  ${ordered.map((s) => `<a href="#${esc(s)}">${esc((bySlug.get(s) || {}).name || s)}</a>`).join('')}
  <a href="#library"><b>Image Library ↓</b></a>
</nav>
<main>
  <div class="howto">
    <b>What to check</b> — every photo below was matched by model scoring, not by eye.
    <ol>
      <li>Each photo must show the item its product name claims. A wrong photo is worse than none.</li>
      <li>Flagged sections (gold bar) are the uncertain ones — start there.</li>
      <li><b>labradorite-pendant</b> has no photo; its borderline candidate is library <b>#262</b> — scroll to the Image Library, look at #262, then assign or reject it in the admin desk (Products → Images, or Image Library).</li>
      <li>Amethyst ring and carnelian pendant have only 2 photos each — the library below may hold better angles.</li>
      <li>Photo #1 in each set is the PRIMARY shown first on the product page.</li>
    </ol>
  </div>
  ${productSections}
  <h3 id="library">Image Library — ${libraryFiles.length} unassigned photos <span class="muted">(dimmed = already mapped to a product)</span></h3>
  <div class="grid">${libraryCells}</div>
</main>
</body>
</html>
`;

const out = path.join(ROOT, 'docs/image-review.html');
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(process.cwd(), out)} — ${mappedCount} mapped photos, ${libraryFiles.length} library photos, ${flagged.length} flagged products.`);
