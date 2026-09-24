/* Astro Vetro — shared app shell: header/footer, cart (localStorage), auth state,
   product/journal card renderers, and delegated add-to-cart behaviour. */

window.AV = window.AV || {};

(function () {
  const CART_KEY = 'av_cart';
  const USER_KEY = 'av_user';
  const nav = [
    ['Home', '/index.html'],
    ['Shop', '/shop.html'],
    ['Readings', '/readings.html'],
    ['Journal', '/journal.html'],
    ['About', '/index.html#about'],
    ['Contact', '/index.html#contact'],
  ];

  function page(file) {
    return location.pathname.replace(/^\//, '').split('?')[0].split('#')[0] === file;
  }

  function headerHTML() {
    const active = page('index.html') ? '/' : null;
    const links = nav
      .map(([label, href]) => {
        const on =
          (href === '/index.html' && page('index.html')) ||
          (href === '/shop.html' && page('shop.html')) ||
          (href === '/readings.html' && page('readings.html')) ||
          (href === '/journal.html' && page('journal.html'));
        return `<a href="${href}"${on ? ' class="on"' : ''}>${label}</a>`;
      })
      .join('');
    const initial = AV.user ? AV.user.firstName?.[0] || AV.user.email?.[0] : null;
    return `
<a href="/index.html" class="logo">Astro Vetro</a>
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
    return `
<div class="footer-grid">
  <div><div class="footer-logo">Astro Vetro</div><p>Objects, rituals and symbols for coming back to yourself.</p></div>
  <div><div class="footer-title">Navigate</div>
    <a href="/index.html">Home</a><a href="/shop.html">Shop</a><a href="/readings.html">Readings</a>
    <a href="/journal.html">Journal</a><a href="/index.html#contact">Contact</a>
  </div>
  <div><div class="footer-title">Customer</div>
    <a href="/legal.html#shipping">Shipping</a><a href="/legal.html#returns">Returns</a>
    <a href="/legal.html#faq">FAQ</a><a href="/legal.html#privacy">Privacy</a><a href="/legal.html#terms">Terms</a>
  </div>
  <div><div class="footer-title">Astro Vetro</div>
    <p>Made slowly, in small batches.</p>
    <p>&copy; 2026 Astro Vetro</p>
  </div>
</div>
<div class="footer-bottom"><span>&copy; 2026 Astro Vetro</span><span>Made slowly, in small batches</span></div>`;
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

  AV.productCard = (p, i = 0) => `
<article class="product-card">
  <a class="art-link" href="/product.html?slug=${encodeURIComponent(p.slug)}">
    <div class="art ${AV.art(i)}" role="img" aria-label="${AV.esc(p.name)}"></div>
  </a>
  <h3><a href="/product.html?slug=${encodeURIComponent(p.slug)}">${AV.esc(p.name)}</a></h3>
  <p>${AV.esc(p.shortDescription || p.stone || p.category)}</p>
  <span class="price">${AV.formatPrice(p.price)}</span>
  <span class="stock${p.availability ? '' : ' sold'}">${p.availability ? 'In stock' : 'Unavailable'}</span>
  <button class="btn btn-outline btn-sm btn-product"
    ${p.availability ? '' : 'disabled'}
    data-add data-slug="${AV.esc(p.slug)}" data-name="${AV.esc(p.name)}"
    data-price="${p.price}" data-image="${AV.esc(p.images?.[0] || '')}"
    data-availability="${p.availability}">Add to cart</button>
</article>`;

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
    const reveal = AV.qs('[data-reveal]');
    if (reveal) reveal.classList.add('ready');
  };
})();