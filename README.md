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
| `/`              | Home. On a first desktop/tablet visit it is covered by the Rituals \| Crystals door before the content is shown. |
| `/shop.html`     | Product grid with search, category, intention, sort, pagination |
| `/product.html`  | Product detail, quantity stepper, related products            |
| `/cart.html`     | Bag (localStorage), shipping rule, stock-capped quantities    |
| `/checkout.html` | Auth-gated checkout, address + payment, places the order     |
| `/order.html`    | Order confirmation by number                                  |
| `/readings.html` | Service offerings with type/format filters and sort           |
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

## The first-visit door

A first visitor on desktop or tablet sees `/` split into two halves — Rituals
on the left, Crystals on the right — before any of the page's content.
Hovering or focusing one opens it to 66% and carries the other out to 34%.
Rituals goes to `/readings.html`; Crystals goes to `/`.

It is deliberately a one-time thing and deliberately boring underneath:

- The choice is stored as `av_intro_seen=1` in `localStorage`.
- Whether to show it is decided in `<head>`, before first paint, so there is
  no flash of the home page and no layout shift. `<html data-intro="skip">`
  is the default, so a visitor without JS — or with storage blocked — goes
  straight to the home page and can never be trapped.
- Below 700px the door is `display:none` and phones never see it.
- Crystals points at `/`, and we are already on `/`, so choosing it takes the
  door down in place instead of reloading.

The motion is one `transform` on one element. Both halves are 66vw wide inside
a 132vw track; the rest position sits at `-16vw`, which leaves 50vw of each
showing and 16vw in reserve. Sliding the whole track to `0` or `-32vw` is what
opens a side and pushes the other away, so nothing in the layout tree changes
size and no photograph is rescaled. An earlier version animated the halves'
own width and measured 37fps at 1920×1080; this measures 60.

See `public/assets/doors.css`, which documents the geometry.

The overlay carries `data-clip="intentional"`. Its contents overhang the
viewport by design, so the alignment test is told to skip them. Geometry alone
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
half of the door and `crystal.jpg` the Crystals half. Anything without a
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
