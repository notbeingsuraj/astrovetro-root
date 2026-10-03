# Astro Vetro — Static Frontend

The Astro Vetro storefront. Static HTML/CSS/JS pages, served by a small Express
server that reverse-proxies `/api` to the Astro Vetro backend. Keeping the API
same-origin is what lets the httpOnly session cookie work without CORS.

## Running

The backend must be reachable on `http://localhost:5002`.

```bash
npm install
npm start                              # http://localhost:5173
PORT=5199 node server.js               # or pick a port
```

`API_TARGET` overrides the backend address if it is not on port 5002.

## Deploying

**There is no build step.** `public/` is plain HTML, CSS and JS; `server.js`
serves those files as they are. `npm run build` exists only to succeed and say
so, because most hosts run `npm run build` during deploy and fail the release
if the script is missing. Do not point a host at `vite build` — there is no
Vite here and no bundler to run.

Two settings matter:

| Setting         | Value                                                    |
| --------------- | -------------------------------------------------------- |
| Build command   | `npm run build` (or leave empty)                         |
| Start command   | `npm start`                                               |
| `PORT`          | set by the host                                           |
| `API_TARGET`    | the Astro Vetro backend, e.g. `https://api.example.com`   |

Deploy this as a **Node service**, not as static files. The frontend calls
`/api/*` on its own origin and `server.js` is what proxies those calls to the
backend; a static host has no Express, so every product and service list comes
back empty and the shop renders blank. If you must deploy statically, you need
a rewrite rule sending `/api/*` to the backend — but you lose the same-origin
session cookie, which is the reason the proxy exists.

### Vercel

`vercel.json` builds `server.js` as a serverless function and routes every
request to it. Without that file Vercel assumes a static bundle, runs the build,
and then fails with `No Output Directory named "dist" found` — which is what
happens here, because there is no bundler to produce a `dist`.

Set one environment variable in the project settings:

| Variable      | Value                                                   |
| ------------- | ------------------------------------------------------- |
| `API_TARGET`  | the Astro Vetro backend, e.g. `https://api.example.com` |

**The backend must be reachable from the public internet.** Vercel runs this
somewhere that cannot see `localhost:5002` on your machine, so if the backend is
not deployed, `/api` returns 502 (`BACKEND_UNAVAILABLE`) no matter how the
frontend is configured. The homepage, shop shell and all static pages will still
render; every data-driven list will be empty.

`server.js` behaves differently in the two places, on purpose: run it locally
and it calls `app.listen()`; on Vercel it exports the app and lets the platform
own the socket, because binding a port inside a serverless function is wrong.

## Pages

| Route            | Purpose                                                     |
| ---------------- | ----------------------------------------------------------- |
| `/`              | The gateway. The entire document: ASTROVETRO, Crystals \| Rituals. Nothing else. |
| `/shop.html`     | Product grid with search, category, intention, sort, pagination |
| `/product.html`  | Product detail, quantity stepper, related products            |
| `/cart.html`     | Bag (localStorage), shipping rule, stock-capped quantities    |
| `/checkout.html` | Auth-gated checkout, address + payment, places the order     |
| `/order.html`    | Order confirmation by number                                  |
| `/crystals.html` | Crystals: how a piece is chosen, plus category tiles into the shop |
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

- Crystals → `/crystals.html`, which explains how a piece is chosen and links
  into the shop by category.
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
