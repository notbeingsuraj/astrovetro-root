# ✳ ASTROVETRO

### The art of intention. The beauty of the unseen.

**CRYSTALS · RITUALS · CELESTIAL LIVING**

<p align="center">
  <img src="https://img.shields.io/badge/PROJECT-PROPRIETARY-302D2A?style=flat-square" alt="Proprietary project" />
  <img src="https://img.shields.io/badge/DESIGN-EDITORIAL-C5A5A0?style=flat-square" alt="Editorial design" />
  <img src="https://img.shields.io/badge/PALETTE-MINERAL%20TONES-A5AA91?style=flat-square" alt="Mineral color palette" />
  <img src="https://img.shields.io/badge/STATUS-CLIENT%20PROJECT-B59A69?style=flat-square" alt="Client project" />
</p>

---

## ◈ The Vision

Astrovetro is a bespoke digital storefront inspired by the intersection of crystal culture, spiritual rituals, celestial symbolism, and contemporary luxury.

Created to feel more like an independent design house than a conventional e-commerce template, the experience brings together atmospheric art direction, product-led storytelling, considered interactions, and a refined visual identity.

Every element serves a purpose. Every color establishes a mood. Every interaction is an invitation to explore.

**An intentional digital experience, created for a distinctive brand.**

---

## ◈ The Color Story

Astrovetro embraces a broader spectrum of muted, expressive colors inspired by minerals, botanical pigments, aged metals, and celestial landscapes.

<table>
  <tr>
    <td align="center" width="16%">
      <img src="https://placehold.co/120x80/302D2A/302D2A.png" alt="Obsidian" width="100%" />
      <br/><strong>Obsidian</strong>
      <br/><code>#302D2A</code>
    </td>
    <td align="center" width="16%">
      <img src="https://placehold.co/120x80/F5F0E8/F5F0E8.png" alt="Ivory" width="100%" />
      <br/><strong>Ivory</strong>
      <br/><code>#F5F0E8</code>
    </td>
    <td align="center" width="16%">
      <img src="https://placehold.co/120x80/A5AA91/A5AA91.png" alt="Sage" width="100%" />
      <br/><strong>Sage</strong>
      <br/><code>#A5AA91</code>
    </td>
    <td align="center" width="16%">
      <img src="https://placehold.co/120x80/C5A5A0/C5A5A0.png" alt="Rose Quartz" width="100%" />
      <br/><strong>Rose Quartz</strong>
      <br/><code>#C5A5A0</code>
    </td>
    <td align="center" width="16%">
      <img src="https://placehold.co/120x80/B59A69/B59A69.png" alt="Antique Gold" width="100%" />
      <br/><strong>Antique Gold</strong>
      <br/><code>#B59A69</code>
    </td>
    <td align="center" width="16%">
      <img src="https://placehold.co/120x80/8C9EB0/8C9EB0.png" alt="Dusty Blue" width="100%" />
      <br/><strong>Dusty Blue</strong>
      <br/><code>#8C9EB0</code>
    </td>
  </tr>
</table>

Additional accents draw inspiration from amethyst violet, terracotta, smoky quartz, and deep forest green.

The result is colorful without being loud: a restrained, layered palette that creates depth while preserving the brand's sense of calm and exclusivity.

*The colors above are visual reference suggestions for the README and brand direction, not a verified inventory of the production CSS.*

---

## ◈ The Experience

### ✧ The Entrance

An immersive introduction establishes the atmosphere before the visitor enters the storefront. The experience explores the relationship between two central themes: **Crystals** and **Rituals**.

Desktop and tablet layouts use a split-screen composition with sliding transitions. On mobile, the experience prioritizes direct access to the storefront.

### ◆ The Storefront

A product-focused environment where photography, descriptions, visual hierarchy, and whitespace work together to create a more considered shopping experience.

### ❋ The Rituals

A complementary brand destination that expands Astrovetro beyond physical products and gives ritual-oriented content its own visual identity.

### ◇ The Commerce Foundation

The project is designed to accommodate a broader commerce system, including product catalogs, inventory administration, authentication, carts, orders, and payment processing as those features are implemented and integrated.

---

## ◈ Technology Stack

Astrovetro combines a lightweight customer-facing web experience with a separately developed server-side application.

### Frontend Technologies

| Technology | Purpose |
|:--|:--|
| HTML5 | Semantic structure and page content |
| CSS3 | Layout, styling, responsive design, and transitions |
| JavaScript | Interactive behavior and client-side logic |

### Backend & Data Infrastructure

| Technology | Purpose |
|:--|:--|
| Node.js | Server-side JavaScript runtime |
| Express | HTTP routing and API infrastructure, where configured |
| MongoDB | Intended persistent data storage |
| Mongoose | MongoDB object modeling, where configured |
| JWT / cookie-based authentication | Authentication infrastructure in the backend |
| Razorpay | Payment integration groundwork, where configured |

### Development & Deployment

| Technology | Purpose |
|:--|:--|
| Git | Version control |
| GitHub | Repository hosting and collaboration |
| Vercel | Deployment platform and serverless configuration |
| `vercel.json` | Deployment and routing configuration |

*The technologies listed above reflect the project's known implementation and development direction. Actual integration and production availability must be verified against the current repository.*

---

## ◈ Architecture

```text
                         ASTROVETRO
                             │
              ┌──────────────┴──────────────┐
              │                             │
         CRYSTALS                        RITUALS
              │                             │
              └──────────────┬──────────────┘
                             │
                    STOREFRONT EXPERIENCE
                     HTML · CSS · JS
                             │
                       API INTEGRATION
                             │
                     NODE.JS / EXPRESS
                             │
                 ┌───────────┴───────────┐
                 │                       │
             COMMERCE                 DATA LAYER
                 │                       │
         Auth · Orders · Admin     MongoDB / Mongoose
                 │
          Payment Integration
```

The architecture separates presentation from server-side business logic. This allows the visual experience to evolve independently while backend capabilities are progressively integrated.

---

## ◈ Repository Structure

```text
Astrovetro-production/
├── public/                     # static storefront, served as-is by server.js
│   ├── index.html … shop, product, cart, checkout,
│   │   account, orders, admin, … (21 pages)
│   └── assets/
│       ├── api.js              # fetch wrapper (auth, CSRF, JSON, errors)
│       ├── store.js            # storefront rendering
│       ├── customer.js         # account / orders
│       ├── admin.js            # admin desk logic (13 modules)
│       ├── app.css, styles.css, doors.css, gateway.css
│       └── img/                # local photography (products/, library/)
├── src/
│   ├── api/  routes/  controllers/   # HTTP layer + validation schemas
│   ├── models/  services/  middleware/  # domain, stock ledger, auth/CSRF/rate-limit
│   ├── db/ (connect, seed)  providers/  payments/
│   └── data/catalogue.js       # static catalogue (pre-database reader)
├── scripts/                    # create-admin, migrate:catalogue, migrate:users
├── tests/                      # node --test suite (self-booting, isolated DB)
├── docs/                       # IMAGE-MAPPING.md, image-manifest.json
├── server.js                   # express app (PORT, default 5173)
└── vercel.json
```

---

## ◈ Development

### Requirements

- Node.js and npm, where applicable.
- Git.
- Access to the authorized project repository.
- Environment configuration for any server-side integrations.

### Setup

```bash
git clone <AUTHORIZED_REPOSITORY_URL>
cd <PROJECT_DIRECTORY>
npm install
```

Requirements beyond npm: a local MongoDB (`mongodb://127.0.0.1:27017/astrovetro`
by default; set `MONGODB_URI` / `.env` to override) and, for the first
administrator, a terminal to type the password into.

```bash
# First boot on an empty database: seeds the catalogue automatically.
npm start                      # storefront + API on http://localhost:5173

# One-time, on databases created before image integration:
npm run migrate:catalogue      # non-destructive: real photos, SKUs, review flags,
                               # categories, opening stock ledger entries

# One-time: create the first admin login (no admin password is seeded, on purpose)
node scripts/create-admin.mjs you@example.com
```

Sign in at `/account.html`, then open `/admin.html` for the admin desk.

### Admin desk

`public/admin.html` (shell) + `public/assets/admin.js` (logic) render a
dashboard with thirteen modules — Overview, Orders, Products, Inventory, Stock
Movements, Categories, Suppliers, Purchase Orders, Image Library, Reports,
Admin Users, Audit Log, Settings — all talking to the session-guarded
`/api/admin/*` API. Authorization, stock atomicity and CSV/export safety are
enforced server-side; the desk never holds privileged logic of its own.

### Tests

```bash
npm test
```

`node --test tests/` boots its own server instances on dedicated ports against
an isolated `astrovetro_test` database (dropped in teardown), so the suite
needs MongoDB running but never touches development data. The suite covers
authorization (401/403), catalogue asset integrity, inventory concurrency
(no negative stock), order/PO/category/supplier flows, CSV injection safety,
and static wiring of the admin desk (every tab has a renderer, every API path
exists).

### Security

- Keep credentials and API keys out of version control.
- Validate all administrative actions on the server.
- Enforce authorization for inventory and order operations.
- Validate payment status on the server rather than trusting client-side responses.
- Avoid exposing database credentials or privileged endpoints in browser code.

---

## ◈ Roadmap

The following items represent potential development priorities, not claims of completed functionality.

- [x] Connect verified product imagery and descriptions — *mapped and stored locally; 4 of 12 products still await human photo verification (see `docs/IMAGE-MAPPING.md`)*.
- [x] Integrate the product catalog with persistent data.
- [x] Implement inventory tracking and stock adjustments.
- [x] Build a secure administrative dashboard.
- [ ] Connect cart, checkout, and order management.
- [ ] Verify payment processing and order reconciliation.
- [ ] Improve error handling, accessibility, and responsive performance.
- [ ] Document deployment and production configuration.

---

## ◈ Proprietary Rights & Legal Disclaimer

**Copyright © 2026 Astrovetro and/or its lawful rights holders. All rights reserved.**

Astrovetro is a proprietary, commissioned client project. The source code, website design, visual identity, layouts, original graphics, product presentation, written content, documentation, and other original project materials are protected by applicable intellectual property laws to the extent permitted by law.

### No Open-Source License

This repository is provided for authorized project access and maintenance only. It is **not released under an open-source license**. No rights are granted to the public to use, copy, modify, distribute, sublicense, publish, sell, or commercially exploit this project or its contents.

Without prior written authorization from the applicable rights holder, you may not:

- Copy or reproduce the website or substantial portions of its source code.
- Republish, redistribute, or make derivative versions of the project.
- Reuse its original designs, branding, copy, graphics, or other proprietary assets.
- Deploy, resell, sublicense, or commercially exploit the project.
- Remove or alter copyright notices or proprietary attribution.
- Use private project materials beyond the scope of an expressly authorized engagement.

### Client Ownership & Third-Party Materials

Ownership of commissioned work is determined by the applicable client agreement, assignment, and governing law. The presence of this notice does not independently transfer ownership of any material.

Third-party libraries, frameworks, fonts, images, and other assets remain subject to their respective owners' rights and license terms. This notice does not override those terms or claim ownership over third-party materials.

### Disclaimer

The project is provided for authorized development, maintenance, and operational purposes. Unless expressly agreed in writing, no representation is made that the software is error-free, uninterrupted, secure in every environment, or fit for a particular purpose.

Unauthorized use may violate applicable intellectual property laws and contractual obligations. Rights holders reserve any remedies available under applicable law.

**For permissions, licensing inquiries, or authorized reuse, obtain written approval from the relevant rights holder before proceeding.**

---

## ◈ The Closing Note

Astrovetro is more than a storefront. It is a considered expression of a brand built around material beauty, symbolism, and intentional living.

Its digital foundation is designed to grow with the business while preserving what makes the experience distinct: clarity, atmosphere, and attention to detail.

**ASTROVETRO**

*An intentional world, built one detail at a time.*

---

<sub>PROPRIETARY CLIENT PROJECT · ALL RIGHTS RESERVED · 2026</sub>
