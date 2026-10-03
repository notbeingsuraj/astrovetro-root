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

## Pages

| Route            | Purpose                                                     |
| ---------------- | ----------------------------------------------------------- |
| `/`              | Landing. Opens with the Crystals \| Rituals gateway, then the full home page. |
| `/shop.html`     | Product grid with search, category, intention, sort, pagination |
| `/product.html`  | Product detail, quantity stepper, related products            |
| `/cart.html`     | Bag (localStorage), shipping rule, stock-capped quantities    |
| `/checkout.html` | Auth-gated checkout, address + payment, places the order     |
| `/order.html`    | Order confirmation by number                                  |
| `/crystals.html` | Crystals: how a piece is chosen, plus category tiles into the shop |
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

`/` is the only home page. `/home.html` still exists in old links and is
redirected permanently to `/`.

## The Crystals | Rituals gateway

`/` opens on a split hero — **Crystals** on the left, **Rituals** on the right —
and the home page continues below it. It is the first thing in the document
flow, not an overlay: there is no stored state, no first-visit gate, and no
breakpoint at which it disappears. Phones get the same gateway with the two
panels stacked, and everything still lands above the fold.

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

The hero is `calc(100svh - var(--header-h))` because the header is sticky but
in-flow — without the subtraction the hero is always one header taller than
the viewport. `--header-h` is the single source of truth for that height.

See `public/assets/doors.css`, which documents the geometry.

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
