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
| `/`              | Landing: cabinet intro, featured products, readings, journal, newsletter, contact |
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
| `/404.html`      | Not-found page, served with a 404 status for unknown routes   |

`/` is the only home page. `/home.html` still exists in old links and is
redirected permanently to `/`.

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
`crystal.jpg`, `about.webp`, `journal-1.jpg`. The cabinet's panel media is an
inline base64 SVG and is deliberately left untouched. Anything without a
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
