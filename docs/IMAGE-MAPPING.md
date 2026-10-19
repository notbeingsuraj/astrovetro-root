# Image Mapping — Astro Vetro

How the studio album became storefront photography, what the scores mean, and
what still needs a human eye.

## Source

- **Album:** [Astrovetro product photos (Google Photos)](https://photos.google.com/share/AF1QipNOMsTGErVlmHGFmI_xH6jXHuyQ76zmIeIP9tGZ_2BOAm0udUWpNUBctaOKIx2TsA?key=Tmw4aE9IU0U5dmNhTHdWSVRickdXN2l6LXJzRHhR) — 300 photos.
- All photos used by the site were **downloaded once and stored locally** under
  `public/assets/img/products/{slug}/` (77 `{n}-large.webp` + 77 `{n}-thumb.webp`,
  45 MB) and `public/assets/img/library/` (84 unassigned photos, 168 files).
  **Nothing is ever hotlinked**; the album URL above is provenance only. This is
  enforced by `tests/storefront-pages.test.mjs` ("no page hotlinks Google
  Photos or other temporary image hosts").
- The machine-readable record of every decision is `docs/image-manifest.json`.

## Method

Each product's name and category were classified against every album photo with
**CLIP zero-shot matching** (the photo is scored against all 13 candidate
labels — the 12 products plus `other-packaging` / `other-crystal-not-listed` /
`other-jewelry-not-listed` / `other-tarot` buckets — and assigned to its best
label). Photos assigned to a product were kept in descending score order.

**No photo was substituted, invented, or re-assigned by hand to make a product
look complete.** Where the model was not confident, the product either carries a
`needsReview` flag (photo shown, flagged for a human) or no photo at all
(labradorite-pendant).

### Reading the scores

| Field | Meaning |
| --- | --- |
| `score` | CLIP probability that the photo belongs to *this* product (its winning label). |
| `margin` | `score` minus the runner-up label — how decisively it beat the second choice. |
| `runnerUp` | The second-best label and its score, e.g. `clear-quartz-point(0.11)`. |
| `albumIndex` | 0-based position of the photo in the album listing (`photos.json`); `sourceKey` is the album's own photo key. |

A large margin over another *product* label means "almost certainly this item".
A runner-up of `other-packaging` or `other-crystal-not-listed` is less
alarming (it just means "a crystal, unidentifiable"), while a runner-up naming a
*different product* with a close score is the dangerous case.

### When `needsReview` is set

1. **Too few photos** — a product with fewer than 3 confident matches is
   flagged even when every kept photo scores well (more candidates may exist
   among the 84 unassigned library photos).
2. **Weak primary** — the primary photo scores low *and* narrowly beats a
   runner-up (see pyrite-cluster below).
3. **No match at all** — the product gets an empty `images[]` on purpose so the
   storefront renders its placeholder gradient instead of a possibly-wrong
   photograph (labradorite-pendant).

## Summary

| Product | Photos | Primary | Score | Margin | Runner-up | Flag |
| --- | ---: | --- | ---: | ---: | --- | --- |
| Amethyst Ring (`amethyst-ring`) | 2 | #138 | 0.952 | 0.938 | lepidolite-tumble(0.01) | **needsReview** |
| Pyrite Cluster (`pyrite-cluster`) | 1 | #161 | 0.495 | 0.135 | other-packaging(0.36) | **needsReview** |
| Citrine Tower (`citrine-tower`) | 6 | #43 | 0.946 | 0.945 | clear-quartz-point(0.00) | ok |
| Rose Quartz Bracelet (`rose-quartz-bracelet`) | 11 | #100 | 0.887 | 0.887 | other-crystal-not-listed(0.00) | ok |
| Raw Black Tourmaline Ring (`raw-black-tourmaline-ring`) | 7 | #265 | 0.656 | 0.47 | black-obsidian-tumble(0.19) | ok |
| Carnelian Pendant (`carnelian-pendant`) | 2 | #208 | 0.871 | 0.858 | citrine-tower(0.01) | **needsReview** |
| Moonstone Pendant (`moonstone-pendant`) | 5 | #91 | 0.829 | 0.812 | labradorite-pendant(0.02) | ok |
| Clear Quartz Point (`clear-quartz-point`) | 11 | #200 | 0.972 | 0.954 | moonstone-pendant(0.02) | ok |
| Tiger's Eye Bracelet (`tigers-eye-bracelet`) | 4 | #147 | 0.994 | 0.994 | other-jewelry-not-listed(0.00) | ok |
| Lepidolite Tumble (`lepidolite-tumble`) | 10 | #213 | 0.838 | 0.798 | black-obsidian-tumble(0.04) | ok |
| Black Obsidian Tumble (`black-obsidian-tumble`) | 18 | #123 | 0.894 | 0.876 | lepidolite-tumble(0.02) | ok |
| Labradorite Pendant (`labradorite-pendant`) | 0 | — | — | — | — | **needsReview** |

Totals: **12 products · 77 photos mapped · 84 photos unassigned · 4 products flagged for review.**
A photo's store file is `/assets/img/products/{slug}/{n}-large.webp` (with an
automatic `-thumb.webp` sibling for the strip), where `n` is its position in
the tables below.

## Per-product detail

### Amethyst Ring (`amethyst-ring`)

> **needsReview:** Only 2 confident photos matched; more candidates may exist in the Image Library.

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/amethyst-ring/1-large.webp` | #138 | 0.952 | 0.938 | lepidolite-tumble(0.01) |
| 2 | `/amethyst-ring/2-large.webp` | #40 | 0.848 | 0.791 | lepidolite-tumble(0.06) |

### Pyrite Cluster (`pyrite-cluster`)

> **needsReview:** Only 1 confident photo matched; more candidates may exist in the Image Library.

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/pyrite-cluster/1-large.webp` | #161 | 0.495 | 0.135 | other-packaging(0.36) |

### Citrine Tower (`citrine-tower`)

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/citrine-tower/1-large.webp` | #43 | 0.946 | 0.945 | clear-quartz-point(0.00) |
| 2 | `/citrine-tower/2-large.webp` | #41 | 0.743 | 0.632 | clear-quartz-point(0.11) |
| 3 | `/citrine-tower/3-large.webp` | #144 | 0.527 | 0.335 | clear-quartz-point(0.19) |
| 4 | `/citrine-tower/4-large.webp` | #230 | 0.476 | 0.291 | carnelian-pendant(0.18) |
| 5 | `/citrine-tower/5-large.webp` | #87 | 0.476 | 0.313 | other-packaging(0.16) |
| 6 | `/citrine-tower/6-large.webp` | #39 | 0.457 | 0.26 | rose-quartz-bracelet(0.20) |

### Rose Quartz Bracelet (`rose-quartz-bracelet`)

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/rose-quartz-bracelet/1-large.webp` | #100 | 0.887 | 0.887 | other-crystal-not-listed(0.00) |
| 2 | `/rose-quartz-bracelet/2-large.webp` | #151 | 0.878 | 0.875 | other-jewelry-not-listed(0.00) |
| 3 | `/rose-quartz-bracelet/3-large.webp` | #31 | 0.864 | 0.86 | other-crystal-not-listed(0.00) |
| 4 | `/rose-quartz-bracelet/4-large.webp` | #154 | 0.742 | 0.705 | tigers-eye-bracelet(0.04) |
| 5 | `/rose-quartz-bracelet/5-large.webp` | #27 | 0.615 | 0.609 | tigers-eye-bracelet(0.01) |
| 6 | `/rose-quartz-bracelet/6-large.webp` | #146 | 0.607 | 0.605 | carnelian-pendant(0.00) |
| 7 | `/rose-quartz-bracelet/7-large.webp` | #156 | 0.569 | 0.257 | clear-quartz-point(0.31) |
| 8 | `/rose-quartz-bracelet/8-large.webp` | #150 | 0.547 | 0.537 | other-jewelry-not-listed(0.01) |
| 9 | `/rose-quartz-bracelet/9-large.webp` | #24 | 0.531 | 0.298 | lepidolite-tumble(0.23) |
| 10 | `/rose-quartz-bracelet/10-large.webp` | #16 | 0.524 | 0.441 | black-obsidian-tumble(0.08) |
| 11 | `/rose-quartz-bracelet/11-large.webp` | #268 | 0.523 | 0.39 | lepidolite-tumble(0.13) |

### Raw Black Tourmaline Ring (`raw-black-tourmaline-ring`)

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/raw-black-tourmaline-ring/1-large.webp` | #265 | 0.656 | 0.47 | black-obsidian-tumble(0.19) |
| 2 | `/raw-black-tourmaline-ring/2-large.webp` | #225 | 0.652 | 0.512 | black-obsidian-tumble(0.14) |
| 3 | `/raw-black-tourmaline-ring/3-large.webp` | #258 | 0.622 | 0.501 | black-obsidian-tumble(0.12) |
| 4 | `/raw-black-tourmaline-ring/4-large.webp` | #187 | 0.519 | 0.242 | black-obsidian-tumble(0.28) |
| 5 | `/raw-black-tourmaline-ring/5-large.webp` | #266 | 0.506 | 0.28 | black-obsidian-tumble(0.23) |
| 6 | `/raw-black-tourmaline-ring/6-large.webp` | #219 | 0.496 | 0.248 | black-obsidian-tumble(0.25) |
| 7 | `/raw-black-tourmaline-ring/7-large.webp` | #193 | 0.479 | 0.231 | tigers-eye-bracelet(0.25) |

### Carnelian Pendant (`carnelian-pendant`)

> **needsReview:** Only 2 confident photos matched; more candidates may exist in the Image Library.

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/carnelian-pendant/1-large.webp` | #208 | 0.871 | 0.858 | citrine-tower(0.01) |
| 2 | `/carnelian-pendant/2-large.webp` | #234 | 0.707 | 0.63 | black-obsidian-tumble(0.08) |

### Moonstone Pendant (`moonstone-pendant`)

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/moonstone-pendant/1-large.webp` | #91 | 0.829 | 0.812 | labradorite-pendant(0.02) |
| 2 | `/moonstone-pendant/2-large.webp` | #253 | 0.807 | 0.763 | clear-quartz-point(0.04) |
| 3 | `/moonstone-pendant/3-large.webp` | #244 | 0.729 | 0.673 | carnelian-pendant(0.06) |
| 4 | `/moonstone-pendant/4-large.webp` | #211 | 0.48 | 0.339 | other-jewelry-not-listed(0.14) |
| 5 | `/moonstone-pendant/5-large.webp` | #249 | 0.474 | 0.199 | labradorite-pendant(0.28) |

### Clear Quartz Point (`clear-quartz-point`)

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/clear-quartz-point/1-large.webp` | #200 | 0.972 | 0.954 | moonstone-pendant(0.02) |
| 2 | `/clear-quartz-point/2-large.webp` | #274 | 0.934 | 0.919 | lepidolite-tumble(0.02) |
| 3 | `/clear-quartz-point/3-large.webp` | #143 | 0.892 | 0.851 | pyrite-cluster(0.04) |
| 4 | `/clear-quartz-point/4-large.webp` | #141 | 0.818 | 0.729 | citrine-tower(0.09) |
| 5 | `/clear-quartz-point/5-large.webp` | #140 | 0.771 | 0.66 | other-packaging(0.11) |
| 6 | `/clear-quartz-point/6-large.webp` | #272 | 0.765 | 0.726 | lepidolite-tumble(0.04) |
| 7 | `/clear-quartz-point/7-large.webp` | #160 | 0.742 | 0.656 | other-packaging(0.09) |
| 8 | `/clear-quartz-point/8-large.webp` | #142 | 0.688 | 0.584 | other-crystal-not-listed(0.10) |
| 9 | `/clear-quartz-point/9-large.webp` | #246 | 0.65 | 0.613 | moonstone-pendant(0.04) |
| 10 | `/clear-quartz-point/10-large.webp` | #202 | 0.613 | 0.472 | other-packaging(0.14) |
| 11 | `/clear-quartz-point/11-large.webp` | #273 | 0.491 | 0.383 | black-obsidian-tumble(0.11) |

### Tiger's Eye Bracelet (`tigers-eye-bracelet`)

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/tigers-eye-bracelet/1-large.webp` | #147 | 0.994 | 0.994 | other-jewelry-not-listed(0.00) |
| 2 | `/tigers-eye-bracelet/2-large.webp` | #97 | 0.972 | 0.968 | citrine-tower(0.00) |
| 3 | `/tigers-eye-bracelet/3-large.webp` | #26 | 0.967 | 0.966 | other-jewelry-not-listed(0.00) |
| 4 | `/tigers-eye-bracelet/4-large.webp` | #30 | 0.527 | 0.406 | rose-quartz-bracelet(0.12) |

### Lepidolite Tumble (`lepidolite-tumble`)

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/lepidolite-tumble/1-large.webp` | #213 | 0.838 | 0.798 | black-obsidian-tumble(0.04) |
| 2 | `/lepidolite-tumble/2-large.webp` | #1 | 0.792 | 0.762 | black-obsidian-tumble(0.03) |
| 3 | `/lepidolite-tumble/3-large.webp` | #111 | 0.694 | 0.603 | clear-quartz-point(0.09) |
| 4 | `/lepidolite-tumble/4-large.webp` | #5 | 0.686 | 0.68 | clear-quartz-point(0.01) |
| 5 | `/lepidolite-tumble/5-large.webp` | #14 | 0.678 | 0.595 | rose-quartz-bracelet(0.08) |
| 6 | `/lepidolite-tumble/6-large.webp` | #206 | 0.678 | 0.565 | other-crystal-not-listed(0.11) |
| 7 | `/lepidolite-tumble/7-large.webp` | #239 | 0.575 | 0.48 | amethyst-ring(0.10) |
| 8 | `/lepidolite-tumble/8-large.webp` | #20 | 0.559 | 0.458 | other-jewelry-not-listed(0.10) |
| 9 | `/lepidolite-tumble/9-large.webp` | #8 | 0.533 | 0.525 | black-obsidian-tumble(0.01) |
| 10 | `/lepidolite-tumble/10-large.webp` | #281 | 0.477 | 0.3 | other-crystal-not-listed(0.18) |

### Black Obsidian Tumble (`black-obsidian-tumble`)

| # | File | Album | Score | Margin | Runner-up |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 **(primary)** | `/black-obsidian-tumble/1-large.webp` | #123 | 0.894 | 0.876 | lepidolite-tumble(0.02) |
| 2 | `/black-obsidian-tumble/2-large.webp` | #101 | 0.739 | 0.65 | lepidolite-tumble(0.09) |
| 3 | `/black-obsidian-tumble/3-large.webp` | #248 | 0.733 | 0.619 | clear-quartz-point(0.11) |
| 4 | `/black-obsidian-tumble/4-large.webp` | #226 | 0.713 | 0.466 | raw-black-tourmaline-ring(0.25) |
| 5 | `/black-obsidian-tumble/5-large.webp` | #279 | 0.698 | 0.62 | raw-black-tourmaline-ring(0.08) |
| 6 | `/black-obsidian-tumble/6-large.webp` | #205 | 0.688 | 0.559 | raw-black-tourmaline-ring(0.13) |
| 7 | `/black-obsidian-tumble/7-large.webp` | #227 | 0.654 | 0.57 | raw-black-tourmaline-ring(0.08) |
| 8 | `/black-obsidian-tumble/8-large.webp` | #4 | 0.631 | 0.517 | raw-black-tourmaline-ring(0.11) |
| 9 | `/black-obsidian-tumble/9-large.webp` | #7 | 0.629 | 0.445 | other-packaging(0.18) |
| 10 | `/black-obsidian-tumble/10-large.webp` | #114 | 0.61 | 0.483 | citrine-tower(0.13) |
| 11 | `/black-obsidian-tumble/11-large.webp` | #139 | 0.586 | 0.525 | raw-black-tourmaline-ring(0.06) |
| 12 | `/black-obsidian-tumble/12-large.webp` | #261 | 0.566 | 0.369 | pyrite-cluster(0.20) |
| 13 | `/black-obsidian-tumble/13-large.webp` | #212 | 0.563 | 0.386 | raw-black-tourmaline-ring(0.18) |
| 14 | `/black-obsidian-tumble/14-large.webp` | #220 | 0.555 | 0.382 | raw-black-tourmaline-ring(0.17) |
| 15 | `/black-obsidian-tumble/15-large.webp` | #286 | 0.544 | 0.376 | carnelian-pendant(0.17) |
| 16 | `/black-obsidian-tumble/16-large.webp` | #103 | 0.523 | 0.405 | other-tarot(0.12) |
| 17 | `/black-obsidian-tumble/17-large.webp` | #218 | 0.487 | 0.211 | raw-black-tourmaline-ring(0.28) |
| 18 | `/black-obsidian-tumble/18-large.webp` | #192 | 0.466 | 0.33 | carnelian-pendant(0.14) |

### Labradorite Pendant (`labradorite-pendant`)

> **needsReview:** No confident match in the album; the product keeps its gradient art until a photo is assigned manually. One borderline candidate (#262) sits unassigned in the Image Library.

No photo was matched. The product renders its placeholder gradient.

## Unresolved mappings — manual review checklist

These are the honest gaps. None of them was papered over.

> **Easiest way to review them all:** run `node scripts/generate-image-review.mjs`,
> then open `docs/image-review.html`. It renders every mapped photo next to its
> score and runner-up, flags the four uncertain products, and appends the whole
> unassigned Image Library (starting with labradorite candidate **#262**) — so
> the whole checklist above can be completed in one page, without opening the
> admin desk. The page lives in `docs/`, never in `public/`: it embeds
> unassigned album photos and model scores that must not ship with the storefront.

1. **labradorite-pendant — no photo (blocking).**
   The album has no photo the model trusts. The product ships with an empty
   `images[]` and renders the gradient art. One borderline candidate exists:
   **album photo #262** (`262-large.webp`, sitting unassigned in
   `/assets/img/library/`). Review it at the admin desk → **Image Library** →
   assign it to the product if it is genuinely the labradorite pendant, or
   upload a correct photo there.
2. **pyrite-cluster — weak primary (review).**
   Its single photo (#161) scores 0.495 with only a 0.135 margin over
   `other-packaging(0.36)`. It is shown but flagged. If it is not the pyrite
   cluster, remove or replace it from the product's Images dialog.
3. **amethyst-ring & carnelian-pendant — thin coverage (review).**
   Only 2 confident photos each; both kept photos score well, but ~84 unassigned
   library photos may hold better angles. Check the Image Library for extras.
4. **Visual verification of all 77 matches.**
   Matching was done by model scoring, not by human eyes. Open each product page
   (or the admin Products → Images dialog) and confirm the photo shows the item
   the name claims.

### How to fix a mapping (no code changes needed)

- **Reassign / add / remove a photo:** admin desk → **Products** → open a
  product → **Images** dialog (reorder, set primary, edit alt text, pull from
  the Image Library, or upload).
- **Upload new photos:** admin desk → **Image Library** → Upload (validated by
  magic bytes; files land outside the product directories and are assigned to a
  product explicitly).
- Alt text lives next to each photo (`imageAlts`, parallel to `images`) and is
  editable in the same dialog.

## Enforcement

`tests/catalogue-assets.test.mjs` verifies on every run that every referenced
file exists, that all files live in the product's own directory, that no file is
claimed by two products, that `imageAlts` runs parallel to `images`, and that
labradorite-pendant is the only intentional photo-less product.
`tests/storefront-pages.test.mjs` asserts nothing hotlinks Google Photos.

The full raw data — including original dimensions and file sizes for every
photo — is in `docs/image-manifest.json`.
