# Astro Vetro — Static Frontend

The Astro Vetro storefront. Static HTML/CSS/JS pages, served by a small Express
server. `/api` is same-origin, which is what lets the httpOnly session cookie
work without CORS once a backend exists.

**It runs with no database.** The catalogue is served in-process from real
product data, so the site is fully browsable on a fresh clone with nothing else
installed. Persistence — orders, bookings, accounts, contact, newsletter — is
switched off and says so, rather than pretending to succeed.

## Running

```bash
npm install
npm start                              # http://localhost:5173
PORT=5199 node server.js               # or pick a port
```

Nothing else is required. No MongoDB, no backend process, no environment
variables. Every page works, and the shop, rituals and journal render
real products.

## How the API is answered

`/api` is resolved in one of two ways, chosen at startup:

| `API_TARGET`      | Behaviour                                                        |
| ----------------- | ---------------------------------------------------------------- |
| **unset** (default) | Serve the catalogue in-process from `src/data/catalogue.js`     |
| **set**           | Reverse-proxy to the full Astro Vetro backend                    |

`API_TARGET` is genuinely optional. It used to default to
`http://localhost:5002`, which on Vercel meant every request fell through to a
socket that does not exist there and the whole catalogue came back 502. An absent
backend is now an explicit, supported mode.

### Reads and writes are not treated alike

Catalogue reads are answered. Anything needing persistence returns **503**:

```json
{
  "success": false,
  "message": "Persistent data services are not configured yet.",
  "error": {
    "code": "DATABASE_NOT_CONFIGURED",
    "message": "Persistent data services are not configured yet.",
    "endpoint": "/api/orders",
    "detail": "\"POST /api/orders\" needs a database, which this deployment does not have. ..."
  }
}
```

This covers `POST /api/orders`, `/api/bookings`, `/api/auth/*`, `/api/contact`,
`/api/newsletter/*`, `GET /api/users/me/*`, `/api/admin/stats`, and every
mutation including `DELETE`.

The 503 on writes is deliberate. Accepting an order into a JavaScript array would
tell a customer their purchase was placed when no record of it exists anywhere.
A storefront that can browse but cannot take money is honest; one that quietly
loses orders is not.

### The client knows before it asks

`GET /api/status` reports the active provider, whether a database is attached,
and whether writes are possible. The client fetches it once and caches it, so the
UI can present unavailable features as unavailable instead of firing requests
that are guaranteed to 503. `account.html` uses it to explain that accounts are
switched off, rather than showing a sign-in form that could never work. Without
this, every page load asked `/api/auth/me` and got a 503 back.

## Data: where the catalogue comes from

`src/data/catalogue.js` holds 12 products, 3 readings, 5 testimonials and 3
journal entries. This is the **real** Astro Vetro catalogue, lifted from the
backend seed (`astrovetro/server/seed/seed.js`) — not invented filler. Nothing
here is randomised or generated.

`images` is deliberately empty on every product. The seed references per-product
files such as `/product-amethyst-ring.png`, but those live in the backend's
public directory and are not served by this project. Attaching some other
crystal photograph to every product would imply a picture of that item which
does not exist, so cards fall back to the design's own gradient placeholders.
Populate `images[]` when the real photography is added here and the cards pick it
up with no other change.

## Adding MongoDB later

Nothing above needs to be undone. `src/providers/` is the seam:

```
UI  →  /api  →  src/providers/index.js  →  staticProvider  (today)
                                         →  mongoProvider   (when ready)
```

Both implement the same contract, so they are interchangeable:

```
listProducts(query)  →  { data, meta }
getProduct(slug)     →  product | null
listIntentions()     →  [{ name }]
listServices(query)  →  service[]
getService(slug)     →  service | null
listArticles(query)  →  article[]
getArticle(slug)     →  article | null
listTestimonials()   →  testimonial[]
```

To switch, implement the methods in `src/providers/mongoProvider.js` — they
already exist and already refuse. `src/providers/index.js` picks the provider
from the environment; today it warns and stays on the static catalogue even if
`DATABASE_URL` is set, so a half-configured database can never silently serve an
empty shop.

The UI does not know or care which provider answered. No page, route handler or
component changes.

If instead a **separate backend** is deployed, set `API_TARGET` and this server
proxies to it; `src/` is then bypassed entirely.

## Deploying

**There is no build step.** `public/` is plain HTML, CSS and JS; `server.js`
serves those files as they are. `npm run build` exists only to succeed and say
so, because most hosts run `npm run build` during deploy and fail the release
if the script is missing. Do not point a host at `vite build` — there is no
Vite here and no bundler to run.

| Setting         | Value                                              |
| --------------- | -------------------------------------------------- |
| Build command   | `npm run build` (or leave empty)                   |
| Start command   | `npm start`                                        |
| `PORT`          | set by the host                                    |
| `API_TARGET`    | *optional* — the backend, when one exists          |

Deploy this as a **Node service**, not as static files. `server.js` answers
`/api/*`; a static host has no Express and every product and service list comes
back empty.

### Vercel

`vercel.json` builds `server.js` as a serverless function and routes every
request to it. Without that file Vercel assumes a static bundle, runs the build,
and then fails with `No Output Directory named "dist" found` — which is what
happens here, because there is no bundler to produce a `dist`.

**No environment variables are required.** Deploy with an empty settings page and
the site works.

`server.js` behaves differently in the two places, on purpose: run it locally
and it calls `app.listen()`; on Vercel it exports the app and lets the platform
own the socket, because binding a port inside a serverless function is wrong.

Check a deployment with:

```bash
curl https://<your-domain>/api/status
```

`"database": false` with `"provider": "static"` is the expected healthy result.

### JWT

Authentication is off in this deployment and no JWT secret is shipped or
required — not even a development one. `POST /api/auth/*` returns 503 like every
other persistence endpoint. Configure a real secret on the backend when
authentication is actually switched on; do not reuse the development value.

## The design system

Everything visual resolves to the token block at the top of
`public/assets/app.css`. That file is linked last on every page, so its
values win over `styles.css` without `!important` or a second copy of a
rule. Change a value there and the whole site moves together.

Three layers, in load order:

1. `styles.css` — brand palette, typography faces, base elements, plus the
   early landing-page composition.
2. `app.css` — the tokens, then the shared components every page uses.
3. `gateway.css` — loaded only by `/`, which shares nothing with the
   internal site.

### Tokens

| Group | Tokens |
| ----- | ------ |
| Text | `--text-primary` `--text-secondary` `--text-muted` `--text-accent` `--text-on-cream` `--text-on-cream-soft` |
| Type | `--text-display` `--text-h1` `--text-h2` `--text-h3` `--text-body` `--text-small` `--text-label` `--text-eyebrow` |
| Space | `--space-xs` `--space-sm` `--space-md` `--space-lg` `--space-xl` `--space-2xl` `--space-3xl` |
| Radius | `--radius-sm` `--radius-md` `--radius-lg` `--radius-pill` |
| Border | `--border-subtle` `--border-input` `--border-strong` |
| Motion | `--transition-fast` `--transition-normal` `--transition-slow` |
| Layout | `--page-max-width` `--page-pad` `--gutter` `--measure-lede` `--measure-h1` `--header-h` `--control-h` |
| Font | `--font-display` `--font-body` `--font-label` |

### Contrast

Text colours are chosen to a measured ratio against the dark gradient
(`--deep`, `#10261f`), and the figure is written next to each token so it
does not have to be re-derived:

| Role | Token | Ratio |
| ---- | ----- | ----- |
| Body, headings | `--text-primary` `#faf8f1` | 14.98:1 |
| Supporting copy | `--text-secondary` `#d9cbb5` | 9.98:1 |
| Captions, metadata | `--text-muted` `#9fae93` | 6.79:1 |
| Ratings, numerals | `--text-accent` `#9a9b69` | 5.51:1 |

Two colours were previously used for text on the dark background and are no
longer: `--brown` as a label colour (1.26:1 — effectively invisible) and
`--moss` for product descriptions (2.71:1, below AA). `--line` was raised
from `rgba(217,203,181,.24)` (1.81:1) so decorative hairlines are visible,
and anything interactive uses `--border-input`, which clears the 3:1 that a
control boundary needs.

### One content edge

Three containers resolve to the same left and right edge, so a logo, a
heading and a control always start on the same line:

- `--gutter` = `max(--page-pad, (100% - --page-max-width) / 2)`, used by
  `.section`, `.page`, `.page-hero`, `footer` and the newsletter. `home.html`
  puts content straight into its sections, so the gutter is what keeps it in
  line with the rest of the site.
- `--page-max-width` (1240px) on `.wrap` and `.header-inner`.
- `--page-pad` — `clamp(20px, 4vw, 56px)`, then 32px at ≤768px and 22px at
  ≤560px.

### A before B

`.section-title` is a block, not a flex row. The heading establishes the
section and any `.section-note` follows underneath it in the same column,
capped at `--measure-lede`. Previously they sat side by side
(`justify-content: space-between`), which made the two compete for the same
horizontal space and read at the same weight.

### Columns that respond to their container

`.form-grid` uses `repeat(auto-fit, minmax(220px, 1fr))` rather than a fixed
`1fr 1fr`, so a form drops to one column based on the width it actually has
instead of on a viewport guess. Section grids use `minmax(0, 1fr)` tracks,
because a grid track's automatic minimum is its content's min-content width
and a form control has a large one — without `minmax(0, …)` a track cannot
narrow below it and pushes the page sideways.

### Page headers

Every internal page shares one shape: eyebrow → H1 → lede → controls →
content. The lede is capped at `--measure-lede` so a supporting line never
runs the full width. Shop has no breadcrumb or eyebrow; its `.page-hero` is
marked `--bare` so the heading is the first thing after the header and no
compensating gap is left behind.

### Reduced motion

`@media (prefers-reduced-motion: reduce)` in `app.css` resolves animation and
transition durations to `0s`. It is `0s` and not `.01ms` on purpose: the
`a11y` and `gateway` suites assert the computed duration is exactly zero.

## Pages

| Route            | Purpose                                                     |
| ---------------- | ----------------------------------------------------------- |
| `/`              | The gateway. The entire document: ASTROVETRO, Crystals \| Rituals. Nothing else. |
| `/shop.html`     | Product grid with search, category, intention, sort, pagination |
| `/product.html`  | Product detail, quantity stepper, related products            |
| `/cart.html`     | Bag (localStorage), shipping rule, stock-capped quantities    |
| `/checkout.html` | Auth-gated checkout, address + payment, places the order     |
| `/order.html`    | Order confirmation by number                                  |
| `/crystals.html` | **Forwards to `/shop.html`** (301). There is no crystals page.   |
| `/home.html`     | The home page: intro, intentions, products, rituals, practice, about, journal, newsletter, contact |
| `/readings.html` | Rituals: what you can book → top sellers → ritual experience → tarot |
| `/booking.html`  | Book a reading                                               |
| `/journal.html`  | Articles with category chips and pagination                   |
| `/article.html`  | Article body                                                  |
| `/account.html`  | Login/register, orders, bookings, profile                    |
| `/admin.html`    | Admin dashboard: orders, bookings, products, subscribers, messages |
| `/legal.html`    | Shipping, returns, privacy, terms, FAQ                       |
| `/about.html`    | Why Astro Vetro exists, sourcing, how readings are held     |
| `/contact.html`  | Contact form, direct email, where else to find help         |
| `/404.html`      | Not-found page, served with a 404 status for unknown routes   |

`/` is the gateway, not the home page. The home page is `/home.html`, which is
the only way back to it — via the wordmark, the Home nav item, or the "← Home"
link on every internal page. `/home` without the extension redirects to
`/home.html`. Nothing links to `/` except as the entry point itself.

## The gateway

`/` is the whole entry experience, and it is deliberately as small as it can
be: the wordmark **ASTROVETRO** and two panels, **Crystals** on the left and
**Rituals** on the right. There is no header, no nav, no footer, no page
content, and no scroll — not "content below the fold", none at all. The
document is locked to the viewport and refuses wheel, keyboard and touch
scrolling. Phones get the same gateway with the two panels stacked.

It is not an overlay and not a first-visit gate. There is no stored state: the
same three words are shown to everyone on every visit, and the real home page
is never rendered behind it, so there is nothing to flash and nothing to
remember.

- Crystals → `/shop.html`. The panel keeps the word CRYSTALS because the
  gateway's three words are fixed, but there is no separate crystals page: the
  collection *is* the shop, so the panel goes there and `/crystals.html` and
  `/crystals` both forward there too. Naming a page that does not exist would
  make the gateway's one promise a lie.
- Rituals → `/readings.html`, which runs the intended path in order: the
  rituals shop, top selling pieces, view more products, the ritual experience,
  and tarot last. Tarot has no entry in the nav or footer; it is reached
  through Rituals.
- Hovering or focusing a panel opens it to 66% and carries the other out to
  34%. Each panel is a plain link filling its own box, so a tap lands on it
  directly and nothing depends on hover.
- `Space` is wired up explicitly. A link fires on `Enter` but not `Space`, and
  the gateway is meant to be operable like a button.

### Geometry

The motion is one `transform` on one element. Both panels are half of a track
that is 132% of the hero's width, so each is 66% of the visible width, with
16% of reserve on its outer side. Three offsets on that track — `-12.1212%`,
`0`, `-24.2424%` — are the rest position and the two open positions, which
puts the seam exactly on the centre in every state.

The offsets are percentages of the track's own width rather than `vw` units on
purpose: `100vw` includes the width of a classic scrollbar, so a `vw`-sized
track is always wider than the space it has to fill and the seam lands a
scrollbar-width left of centre. Sizing off the hero makes it exact either way.

Nothing in the layout tree changes size when a panel opens, so the browser
never re-lays-out or re-paints the two full-viewport photographs, and each
label travels with its panel. An earlier version animated the panels' own
width and measured 37fps at 1920×1080; this measures 60.

The viewport lock is `min-height: 100svh; height: 100dvh` on `.gateway`, plus
`overflow: hidden` and `overscroll-behavior: none` on both `html` and `body`.
`height: 100%` on the root is what makes the `overflow: hidden` bite — without
a definite height on both, the document still grows to fit its content and the
bars come back. Plain `100vh` is not used anywhere: on a phone it includes the
area behind the URL bar, which is what pushes the second panel out of frame and
hands the user a scrollbar. The hero then takes the space left under the
wordmark with `flex: 1; min-height: 0`, so no viewport arithmetic inside it can
be invalidated by the browser's chrome.

That scroll lock is safe only because `public/assets/gateway.css` is loaded by
the gateway and nothing else. Every other page keeps scrolling normally. If you
add that stylesheet elsewhere, move the lock with it.

See `public/assets/gateway.css`, which documents the geometry and the two
subtleties worth preserving: the track must stay absolutely positioned (return
it to the flow and its `flex: 0 0 50%` panels collapse to zero height, taking
the whole entry screen with them), and the two label offsets are not symmetric
— Crystals keeps its reserve on the right, Rituals on the left.

The hero carries `data-clip="intentional"`. Its track overhangs the viewport by
design, so the alignment test is told to skip it. Geometry alone
cannot distinguish that from content accidentally cut off — both look identical
to an overflow check, and guessing wrong once hid a newsletter form that really
was being clipped. Keep the attribute if you restructure the markup.

About and Contact live at `/about.html` and `/contact.html`.

## Rules baked into the UI

- Free shipping on subtotals ≥ ₹1500, otherwise ₹99. The threshold lives in
  `AV.SHIPPING` so the bag and the checkout can never disagree.
- Bag quantity is capped at 99, and at the reported stock when the API
  provides it. The bag re-checks stock on load and drops anything gone.
- Checkout requires login (redirects to `/account.html?view=login&next=…`).
- Order items require `name`, `slug`, `price` (INR), `quantity`.
- Every form validates client-side before calling the API, so an empty address
  or a malformed pincode never reaches the backend.

## Assets

Four original images ship in `public/assets/img/`: `hero-bg.jpg`,
`crystal.jpg`, `about.webp`, `journal-1.jpg`. `hero-bg.jpg` backs the Rituals
panel of the gateway and `crystal.jpg` the Crystals panel. Anything without a
photograph falls back to the original gradient art blocks, and products fall
back to a gradient when the API has no image. No stock photography is
hotlinked.

## SEO

Each page ships its own title, description, canonical, Open Graph and Twitter
tags. Data-driven pages (product, article, booking, order, account) rewrite
them at runtime through `AV.seo()`.

`og:url` and `canonical` are currently relative paths. Set them to absolute
URLs once the production origin is known — some social scrapers ignore
relative values.

## Notes

- The proxy uses a conditional `pathRewrite` that keeps the `/api` prefix, so
  cookies and routes work unchanged.
- Unknown routes return the 404 page with a 404 status. Requests that look
  like a file (they carry an extension) get a bare 404 instead, so a broken
  `<script>` or `<img>` never receives a page of HTML.
