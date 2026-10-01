/* Astro Vetro — shared app shell: header/footer, cart (localStorage), auth state,
   product/journal card renderers, and delegated add-to-cart behaviour. */

window.AV = window.AV || {};

(function () {
  const CART_KEY = 'av_cart';
  const USER_KEY = 'av_user';

  /* Shipping rules live here so the bag and the checkout can never disagree. */
  const SHIPPING = { freeAbove: 1500, flat: 99 };
  AV.SHIPPING = SHIPPING;
  AV.shippingFor = (subtotal) =>
    subtotal >= SHIPPING.freeAbove || subtotal === 0 ? 0 : SHIPPING.flat;
  const nav = [
    ['Home', '/home.html'],
    ['Shop', '/shop.html'],
    ['Readings', '/readings.html'],
    ['Journal', '/journal.html'],
    ['About', '/home.html#about'],
    ['Contact', '/home.html#contact'],
  ];

  function page(file) {
    return location.pathname.replace(/^\//, '').split('?')[0].split('#')[0] === file;
  }

  function headerHTML() {
    const active = page('home.html') ? '/' : null;
    const links = nav
      .map(([label, href]) => {
        const on =
          (href === '/home.html' && page('home.html')) ||
          (href === '/shop.html' && page('shop.html')) ||
          (href === '/readings.html' && page('readings.html')) ||
          (href === '/journal.html' && page('journal.html'));
        return `<a href="${href}"${on ? ' class="on"' : ''}>${label}</a>`;
      })
      .join('');
    const initial = AV.user ? AV.user.firstName?.[0] || AV.user.email?.[0] : null;
    return `
<a href="/home.html" class="logo">Astro Vetro</a>
<button class="icon menu" id="menuBtn" aria-label="Menu">\u2630</button>
<nav id="siteNav">${links}</nav>
<div class="header-actions">
  <a class="icon" href="/shop.html?focus=1" aria-label="Search">\u2315</a>
  <a class="icon" href="/cart.html" aria-label="Bag">\u2667<span class="cart-badge" data-cart-badge></span></a>
  <a class="icon" href="${AV.user ? '/account.html' : '/account.html?view=login'}" aria-label="Account">
    ${initial ? `<span class="avatar">${AV.esc(initial.toUpperCase())}</span>` : '\u25ef'}
  </a>
</div>`;
  }

  function footerHTML() {
    const y = new Date().getFullYear();
    return `
<div class="footer-grid">
  <div>
    <div class="footer-logo">Astro Vetro</div>
    <p>Objects, rituals and symbols for coming back to yourself.</p>
  </div>
  <div>
    <div class="footer-title">Navigate</div>
    <a href="/home.html">Home</a>
    <a href="/shop.html">Shop</a>
    <a href="/readings.html">Readings</a>
    <a href="/journal.html">Journal</a>
    <a href="/home.html#about">About</a>
    <a href="/home.html#contact">Contact</a>
  </div>
  <div>
    <div class="footer-title">Customer</div>
    <a href="/legal.html#shipping">Shipping</a>
    <a href="/legal.html#returns">Returns</a>
    <a href="/legal.html#faq">FAQ</a>
    <a href="/legal.html#privacy">Privacy</a>
    <a href="/legal.html#terms">Terms</a>
  </div>
  <div>
    <div class="footer-title">Orders</div>
    <a href="/cart.html">Your bag</a>
    <a href="/account.html">Your account</a>
    <a href="/account.html?view=orders">Order history</a>
    <a href="/account.html?view=bookings">Your bookings</a>
  </div>
</div>
<div class="footer-bottom">
  <span>&copy; ${y} Astro Vetro</span>
  <span>Made slowly, in small batches</span>
</div>`;
  }

  function mount(chrome) {
    const h = AV.qs('#siteHeader');
    const f = AV.qs('#siteFooter');
    if (chrome !== false) {
      if (h) {
        h.classList.add('site-header');
        h.innerHTML = headerHTML();
      }
      if (f) {
        f.innerHTML = footerHTML();
      }
    }
    const menuBtn = AV.qs('#menuBtn');
    const nv = AV.qs('#siteNav');
    menuBtn?.addEventListener('click', () => nv.classList.toggle('mobile-open'));
    nv?.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => nv.classList.remove('mobile-open')));
    renderBadge();
    // delegated add-to-cart
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-add]');
      if (!btn || btn.disabled) return;
      addToCart({
        slug: btn.dataset.slug,
        name: btn.dataset.name,
        price: Number(btn.dataset.price || 0),
        image: btn.dataset.image || null,
        availability: btn.dataset.availability !== 'false',
      }, Number(btn.dataset.qty || 1));
      AV.toast(`Added \u201c${btn.dataset.name}\u201d to your bag.`, 'ok');
      /* Any other card for the same piece is now also "in the bag", e.g. the
         featured rail and the grid can show the same product. */
      document.querySelectorAll(`.btn-product[data-slug="${CSS.escape(btn.dataset.slug)}"]`)
        .forEach(markBtnInBag);
      AV.markInCart();
    });
  }

  /* ── Cart ─────────────────────────────────────────────────────────── */
  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function writeCart(c) {
    localStorage.setItem(CART_KEY, JSON.stringify(c));
    renderBadge();
  }
  AV.getCart = readCart;
  AV.cartCount = () => readCart().reduce((n, i) => n + i.quantity, 0);
  AV.cartSubtotal = () => readCart().reduce((n, i) => n + i.price * i.quantity, 0);
  AV.addToCart = addToCart;

  /* Marks a single add-to-cart button as already containing its product. */
  function markBtnInBag(btn) {
    if (!btn) return;
    const has = readCart().some((i) => i.slug === btn.dataset.slug);
    btn.classList.toggle('in-bag', has);
    const label = btn.dataset.label || (btn.dataset.label = btn.textContent.trim());
    btn.textContent = has ? 'Add another' : label;
  }
  /* Re-applies the in-bag label across every product card on the page. */
  AV.markInCart = function markInCart() {
    document.querySelectorAll('.btn-product[data-slug]').forEach(markBtnInBag);
  };
  function addToCart(p, qty) {
    const c = readCart();
    const found = c.find((i) => i.slug === p.slug);
    if (found) {
      found.quantity = Math.min(99, found.quantity + (qty || 1));
      found.price = p.price;
    } else {
      c.push({ slug: p.slug, name: p.name, price: p.price, image: p.image || null, quantity: qty || 1 });
    }
    writeCart(c);
  }
  AV.setCartQty = (slug, qty) => {
    const c = readCart();
    const i = c.find((x) => x.slug === slug);
    if (i) i.quantity = Math.max(1, Math.min(99, qty));
    writeCart(c);
  };
  AV.removeFromCart = (slug) => {
    writeCart(readCart().filter((i) => i.slug !== slug));
  };
  AV.clearCart = () => writeCart([]);

  function renderBadge() {
    const n = AV.cartCount();
    AV.qsa('[data-cart-badge]').forEach((b) => {
      b.textContent = n;
      b.style.display = n ? 'grid' : 'none';
    });
  }

  /* ── Auth ─────────────────────────────────────────────────────────── */
  AV.user = null;
  try {
    const u = localStorage.getItem(USER_KEY);
    AV.user = u ? JSON.parse(u) : null;
  } catch {
    AV.user = null;
  }
  AV.setUser = (u) => {
    AV.user = u || null;
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  };
  AV.me = async () => {
    try {
      const env = await AV.api.get('/api/auth/me');
      AV.setUser(env.data);
      return env.data;
    } catch {
      AV.setUser(null);
      return null;
    }
  };
  AV.requireAuth = async () => (await AV.me()) !== null;
  AV.isAdmin = () => !!AV.user && AV.user.role === 'admin';

  /* ── Card renderers ───────────────────────────────────────────────── */
  AV.art = (i) => `a${((i % 8) + 1)}`;

  /* Placeholder shown while data is in flight, so grids are never blank. */
  AV.skeletonCards = (n = 4, kind = 'product') => {
    let out = '';
    for (let i = 0; i < n; i += 1) out += `<div class="skeleton skeleton-${kind}"></div>`;
    return out;
  };

  AV.productCard = (p, i = 0) => {
    const inStock = p.availability !== false;
    const img = p.images?.[0];
    /* Real photography when the catalogue has it, otherwise the design's own
       gradient art block so the grid is never broken by a missing file. */
    const art = img
      ? `<div class="art has-photo" style="background-image:url('${AV.esc(img)}')" role="img" aria-label="${AV.esc(p.name)}"></div>`
      : `<div class="art ${AV.art(i)}" role="img" aria-label="${AV.esc(p.name)}"></div>`;
    const href = `/product.html?slug=${encodeURIComponent(p.slug)}`;
    const meta = [p.stone, p.metal].filter(Boolean).join(' · ') || p.category || '';
    return `
<article class="product-card">
  <a class="art-link" href="${href}">${art}</a>
  <h3><a href="${href}">${AV.esc(p.name)}</a></h3>
  <p>${AV.esc(p.shortDescription || meta)}</p>
  ${p.rating ? `<span class="rating" aria-label="Rated ${p.rating} out of 5">${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))}</span>` : ''}
  <span class="price">${AV.formatPrice(p.price)}</span>
  <span class="stock${inStock ? '' : ' sold'}">${inStock ? 'In stock' : 'Unavailable'}</span>
  <button class="btn btn-outline btn-sm btn-product"
    ${inStock ? '' : 'disabled'}
    data-add data-slug="${AV.esc(p.slug)}" data-name="${AV.esc(p.name)}"
    data-price="${p.price}" data-image="${AV.esc(img || '')}"
    data-availability="${inStock}">Add to cart</button>
</article>`;
  };

  AV.journalCard = (a, i = 0) => `
<article class="journal-card">
  <a href="/article.html?slug=${encodeURIComponent(a.slug)}">
    <div class="journal-img ${i === 0 ? 'j1' : i === 1 ? 'j2' : 'j3'}" role="img" aria-label="${AV.esc(a.title)}"></div>
  </a>
  <small>${AV.esc(a.category || 'Journal')} \u00b7 ${a.readingTime || ''} min read</small>
  <h3><a href="/article.html?slug=${encodeURIComponent(a.slug)}">${AV.esc(a.title)}</a></h3>
</article>`;

  /* ── Boot ─────────────────────────────────────────────────────────── */
  AV.boot = (opts = {}) => {
    mount(opts.chrome);
    revealAll();
  };

  /* `.js-load` and `[data-reveal]` start at opacity:0 so that server-rendered
     markup never flashes before its data arrives. Both selectors must be
     released, otherwise the containers stay invisible forever. */
  function revealAll(scope) {
    const root = scope || document;
    root.querySelectorAll('.js-load, [data-reveal]').forEach((el) => el.classList.add('ready'));
  }
  AV.reveal = revealAll;
})();