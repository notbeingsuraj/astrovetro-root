# Astro Vetro — Full-Stack Static Frontend

A complete live Astro Vetro storefront that keeps the original one-page design and drives it
from the Astro Vetro API. Static HTML/CSS/JS pages are served by a small Express server that
reverse-proxies `/api` to the backend (same-origin, so the httpOnly cookie works).

## Running

Prerequisites: the Astro Vetro API must be running on `http://localhost:5002`.

```bash
npm install
npm start          # serves http://localhost:5173
```

The server (`server.js`) serves `public/` and proxies every `/api` request to
`process.env.API_TARGET || 'http://localhost:5002'`.

## Pages

| Route               | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `/`                 | Landing: featured products, readings, journal, newsletter + contact |
| `/shop.html`        | Product grid with search, category, intention, sort, pagination |
| `/product.html`     | Product detail, quantity stepper, related products   |
| `/cart.html`        | Cart (localStorage), shipping rule, line editing     |
| `/checkout.html`    | Auth-gated checkout, address + payment, places order |
| `/order.html`       | Order confirmation by number                         |
| `/readings.html`    | Service offerings                                    |
| `/booking.html`     | Book a reading                                       |
| `/journal.html`     | Articles with category chips and pagination          |
| `/article.html`     | Article body                                         |
| `/account.html`     | Login/register + overview, orders, bookings, profile |
| `/admin.html`       | Admin dashboard, orders, bookings, products, subscribers, messages |
| `/legal.html`       | Shipping, returns, privacy, terms, FAQ               |

## Demo credentials

- Admin: `admin@astrovetro.com` / `Admin@2026`
- Customer: `riya@example.com` / `Customer@2026`

## Rules baked into the UI

- Free shipping on subtotals ≥ ₹1500, otherwise ₹99.
- Cart quantity capped at 99.
- Checkout requires login (redirects to `/account.html?view=login&next=/checkout.html`).
- Order items require `name`, `slug`, `price` (INR), `quantity`.

## Notes

- No static image assets ship with this build — products and journal entries use the
  gradient art blocks from the original design (`app.css`).
- The proxy uses a conditional `pathRewrite` (keeps the `/api` prefix) so cookies and
  routes work unchanged.# astrovetro-root
