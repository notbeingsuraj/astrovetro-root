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
  /* Nav order follows the gateway: the two experiences come first, the shop
     is the catalogue behind them, then the supporting pages. There is no
     Tarot item — tarot lives inside Rituals at /readings.html#tarot and is
     reached through there, not from the top of the page. */
  /* The gateway at "/" carries no navigation, so this is the only way back to
     the homepage. "Home" is the full page at /home.html, not the gateway. */
  /* Crystals is not listed here: it is no longer a page of its own and forwards
     to the shop, so a "Crystals" entry would only promise a destination that
     does not exist. The collection is reached through Shop, and the gateway's
     Crystals panel goes there too. */
  const nav = [
    ['Home', '/home.html'],
    ['Rituals', '/readings.html'],
    ['Shop', '/shop.html'],
    ['Journal', '/journal.html'],
    ['About', '/about.html'],
    ['Contact', '/contact.html'],
  ];

  function page(file) {
    return location.pathname.replace(/^\//, '').split('?')[0].split('#')[0] === file;
  }

  /* ── Header icon set ──────────────────────────────────────────────────
     One drawn language, not four borrowed glyphs. The search/wishlist/bag
     controls were unicode characters (U+2315, U+2661, U+2667) chosen for
     whatever the visitor's font happened to render, so their weight, optical
     size and centring all shifted with the platform — and the account control
     fell back to a filled circle with an initial, which read as a heavier,
     louder control than its three neighbours.

     All four are now inline SVG on one 24px grid, stroked in currentColor at
     the same weight, so the row holds together and inherits the header's
     colour. Inlining also means no icon font, no extra request, and no
     layout shift on load.

     The icons are decorative: the control that wraps each one carries the
     accessible name, so every glyph is aria-hidden and unfocusable. */
  const ICON = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8 20 20"/>',
    heart: '<path d="M12 20.4S4.4 15.6 4.4 10.6A4.5 4.5 0 0 1 12 7.6a4.5 4.5 0 0 1 7.6 3c0 5-7.6 9.8-7.6 9.8Z"/>',
    bag: '<path d="M5.6 8.4h12.8l-.85 11.1a1.6 1.6 0 0 1-1.6 1.5H8.05a1.6 1.6 0 0 1-1.6-1.5Z"/><path d="M9.3 8.4V6.6a2.7 2.7 0 0 1 5.4 0v1.8"/>',
    /* Account: a large circular outline with a minimal head-and-shoulders
       silhouette inside it, drawn on the same 24px grid at the same weight as
       the other three. Thin stroke, no fill, no gradient, no detail that does
       not survive at 20px. */
    account: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="9.9" r="2.5"/><path d="M6.6 17.3a5.9 5.9 0 0 1 10.8 0"/>',
    /* The mobile nav toggle shares the set, so the collapsed header is the
       same icon language as the expanded one rather than a lone text glyph. */
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  const icon = (name) =>
    `<svg class="icon-glyph" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;

  function headerHTML() {
    const links = nav
      .map(([label, href]) => {
        const on =
          (href === '/home.html' && page('home.html')) ||
          (href === '/readings.html' && page('readings.html')) ||
          (href === '/shop.html' && page('shop.html')) ||
          (href === '/journal.html' && page('journal.html'));
        return `<a href="${href}"${on ? ' class="on"' : ''}>${label}</a>`;
      })
      .join('');
    /* The backend returns `name`, so the initial is taken from whichever field
       is present. A stale cached user must not decide the header's appearance —
       this re-renders on the auth channel once the real session is known.
       It now only names the control in its title; the glyph is the same
       outline account icon either way, so signing in does not change the
       shape of the header row. */
    const initial = AV.user?.name?.[0] ?? AV.user?.email?.[0] ?? null;
    /* .header-inner carries the same max-width and padding as the page body,
       so the logo starts on the same vertical line as every page heading. */
    return `
<div class="header-inner">
<a href="/home.html" class="logo">Astro Vetro</a>
<button class="icon menu" id="menuBtn" aria-label="Menu" aria-expanded="false" aria-controls="siteNav">${icon('menu')}</button>
<nav id="siteNav">${links}</nav>
<div class="header-actions">
  <a class="icon" href="/shop.html?focus=1" aria-label="Search" title="Search">${icon('search')}</a>
  <a class="icon" href="/wishlist.html" aria-label="Saved pieces" title="Saved pieces">${icon('heart')}<span class="cart-badge" data-wishlist-badge></span></a>
  <a class="icon" href="/cart.html" aria-label="Bag" title="Your bag">${icon('bag')}<span class="cart-badge" data-cart-badge></span></a>
  <a class="icon" href="${AV.user ? '/account.html' : '/account.html?view=login'}" aria-label="Account"
     ${initial ? `title="Account \u2014 ${AV.esc(initial)}"` : 'title="Account"'}>${icon('account')}</a>
</div>
</div>`;
  }

  function footerHTML() {
    const y = new Date().getFullYear();
    /* Every link here is a real route. "Your bookings" pointed at an account
       view that no longer exists and led nowhere, so it is gone rather than
       left as a dead promise. */
    return `
<div class="footer-grid">
  <div>
    <div class="footer-logo">Astro Vetro</div>
    <p>Objects, rituals and symbols for coming back to yourself.</p>
  </div>
  <div>
    <div class="footer-title">Navigate</div>
    <a href="/home.html">Home</a>
    <a href="/readings.html">Rituals</a>
    <a href="/shop.html">Shop</a>
    <a href="/journal.html">Journal</a>
    <a href="/about.html">About</a>
    <a href="/contact.html">Contact</a>
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
    <div class="footer-title">Customer</div>
    <a href="/cart.html">Your bag</a>
    <a href="/wishlist.html">Saved pieces</a>
    <a href="/account.html">Your account</a>
    <a href="/orders.html">Order history</a>
    <a href="/account.html?view=addresses">Saved addresses</a>
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
    /* The nav toggle. Both the initial paint and the post-auth re-render below
       wire this, so the aria state is driven from one place rather than left to
       drift out of sync with the class it describes. */
    const setNavOpen = (open) => {
      AV.qs('#siteNav')?.classList.toggle('mobile-open', open);
      AV.qs('#menuBtn')?.setAttribute('aria-expanded', String(open));
    };
    const wireNavToggle = () => {
      AV.qs('#menuBtn')?.addEventListener('click', () =>
        setNavOpen(!AV.qs('#siteNav')?.classList.contains('mobile-open')));
    };
    wireNavToggle();
    AV.qs('#siteNav')?.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', () => setNavOpen(false)));
    /* Escape closes the panel and returns focus to the control that opened it,
       so a keyboard visitor is not stranded inside the collapsed nav. */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!AV.qs('#siteNav')?.classList.contains('mobile-open')) return;
      setNavOpen(false);
      AV.qs('#menuBtn')?.focus();
    });
    renderBadge();

    /* Delegated so every add-to-cart button on any page works without each
       page wiring its own listener. `await` matters: the button is disabled for
       the duration, because a signed-in customer's bag is a server document
       and two rapid clicks must not race into two adds. */
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-add]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.avBusy === '1') return;
      btn.dataset.avBusy = '1';
      const wasDisabled = btn.disabled;
      btn.disabled = true;
      try {
        /* Every field a guest bag line needs is read here. Passing only id and
           slug left a guest's saved line with no name, a price of 0 and no
           stock, because productIdFor is not the only thing AV.bag.add does. */
        const ok = await AV.bag.add(
          {
            id: btn.dataset.productId || null,
            slug: btn.dataset.slug,
            name: btn.dataset.name,
            price: btn.dataset.price,
            image: btn.dataset.image || null,
            stock: btn.dataset.stock,
          },
          Number(btn.dataset.qty || 1)
        );
        if (ok) {
          AV.toast(`Added \u201c${btn.dataset.name}\u201d to your bag.`, 'ok');
          /* Any other card for the same piece is now also "in the bag", e.g. the
             featured rail and the grid can show the same product. */
          document.querySelectorAll(`.btn-product[data-slug="${CSS.escape(btn.dataset.slug)}"]`)
            .forEach(markBtnInBag);
          AV.markInCart();
        }
      } finally {
        delete btn.dataset.avBusy;
        /* Restored only if the button was usable to begin with; a sold-out
           button must stay disabled after a failed add. */
        if (!wasDisabled) btn.disabled = false;
      }
    });

    /* ── Shared commerce state ────────────────────────────────────────────
       The header badge and every page on the site read from one subscription
       rather than each calling GET /api/cart on load. The API layer broadcasts
       whenever an authoritative cart arrives. */
    AV.on('cart', (cart) => {
      AV.setCartCache(cart);
      renderBadge();
    });
    AV.on('wishlist', (list) => {
      AV.setWishlistCache(list);
      renderBadge();
    });
    /* Identity can change after the header was rendered (session restored, or a
       sign-out from a customer page). Re-render so the avatar and the account
       link cannot be left showing the previous state. */
    /* Any page that renders product cards shows saved state from one cache read
       rather than a request per card. */
    AV.markSaved = function markSaved() {
      const saved = new Set((wishCache?.items || []).map((i) => String(i.productId)));
      document.querySelectorAll('[data-save]').forEach((b) => {
        const on = saved.has(String(b.dataset.save));
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('saved', on);
      });
    };
    /* Save-to-wishlist, delegated like add-to-cart so every card works without
       per-page wiring. aria-pressed carries the state, so the change is announced
       rather than being signalled by colour alone. */
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-save]');
      if (!btn || btn.dataset.avBusy === '1') return;
      btn.dataset.avBusy = '1';
      btn.disabled = true;
      try {
        await AV.toggleSaved(btn);
      } finally {
        delete btn.dataset.avBusy;
        btn.disabled = false;
      }
    });

    AV.on('auth', () => {
      const h = AV.qs('#siteHeader');
      if (h && !h.dataset.avLocked) {
        h.innerHTML = headerHTML();
        wireNavToggle();
      }
      AV.markInCart();
      AV.markSaved();
    });
  }

  /* ── Cart ─────────────────────────────────────────────────────────────
     Two carts, one interface.

     A signed-in customer's bag is a server document. Prices, stock and totals
     on it are computed by the backend, and nothing in this file may override
     them. Before signing in there is no account to attach a bag to, so a guest
     bag is kept locally and merged into the server bag on sign-in.

     AV.bag is the only interface a page uses. It dispatches to whichever cart
     applies, so no page has to know whether the visitor is signed in, and the
     server/guest split is decided in exactly one place.

     The local bag is a staging area, not an authority: the merge re-prices
     everything server-side, so a price that changed while signed out is corrected
     at sign-in rather than carried through. */
  const WISH_KEY = 'av_wishlist';

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

  /* Mirror of the last authoritative cart the API layer saw. The header badge
     reads this so it never triggers a request of its own. */
  let cartCache = null;
  let wishCache = null;
  AV.setCartCache = (cart) => {
    cartCache = cart;
  };
  AV.setWishlistCache = (list) => {
    wishCache = list;
  };
  AV.cachedCart = () => cartCache;
  AV.cachedWishlist = () => wishCache;
  /* A cached count from a previous session must not outlive a sign-out. */
  AV.clearCommerceCache = () => {
    cartCache = null;
    wishCache = null;
  };

  const signedIn = () => Boolean(AV.user);

  /* Total quantity, from whichever bag applies. */
  AV.cartCount = () => {
    if (signedIn()) {
      const n = Number(cartCache?.itemCount);
      if (Number.isFinite(n)) return n;
    }
    return readCart().reduce((n, i) => n + i.quantity, 0);
  };
  AV.wishlistCount = () => {
    const n = Number(wishCache?.count);
    return Number.isFinite(n) ? n : 0;
  };

  /* Resolves a product to the id the server cart is keyed by.
     Cards carry data-product-id from the catalogue, so no lookup is needed; the
     slug is a fallback for a button rendered before the catalogue loaded. */
  async function productIdFor({ id, slug }) {
    if (id) return id;
    if (!slug) return null;
    const env = await AV.api.get(`/api/products/${encodeURIComponent(slug)}`);
    return env?.data?.id || null;
  }

  /* The one entry point for "put this in my bag". Returns true when the item is
     in the bag afterwards — for a guest that means locally, for a customer it
     means the server confirmed it. */
  AV.bag = {
    async add(product, qty = 1) {
      const quantity = Math.max(1, Number(qty) || 1);

      if (signedIn()) {
        const productId = await productIdFor(product);
        if (!productId) {
          AV.toast('We could not identify that piece.', 'err');
          return false;
        }
        try {
          await AV.cart.add(productId, quantity);
          return true;
        } catch (err) {
          /* Stock and availability are the server's call. Its message is shown
             verbatim rather than replaced with something friendlier but wrong. */
          AV.toast(AV.firstErr(err), 'err');
          return false;
        }
      }

      return addToCartLocal(product, quantity);
    },

    async setQuantity(product, qty) {
      const quantity = Number(qty);
      /* Guarded here as well as on the buttons: a stepper that reaches 0 removes
         the line rather than storing a zero-quantity one, which the backend would
         reject anyway. */
      if (!Number.isFinite(quantity) || quantity < 1) return this.remove(product);

      if (signedIn()) {
        const productId = await productIdFor(product);
        if (!productId) return false;
        try {
          await AV.cart.setQuantity(productId, quantity);
          return true;
        } catch (err) {
          AV.toast(AV.firstErr(err), 'err');
          return false;
        }
      }
      return setLocalQty(product.slug, quantity);
    },

    async remove(product) {
      if (signedIn()) {
        const productId = await productIdFor(product);
        if (!productId) return false;
        try {
          await AV.cart.remove(productId);
          return true;
        } catch (err) {
          AV.toast(AV.firstErr(err), 'err');
          return false;
        }
      }
      writeCart(readCart().filter((i) => i.slug !== product.slug));
      return true;
    },

    async clear() {
      if (signedIn()) {
        try {
          await AV.cart.clear();
        } catch (err) {
          AV.toast(AV.firstErr(err), 'err');
          return false;
        }
      }
      writeCart([]);
      return true;
    },

    /* The bag to render. A customer always gets the server's, so every figure on
       screen is authoritative. A guest gets the local bag plus the shipping
       figures this site has always shown, clearly derived locally because there
       is no account yet to price them against. */
    async load() {
      if (signedIn()) {
        const { cart } = await AV.cart.get();
        return { ...cart, authoritative: true };
      }
      return { ...localCartView(), authoritative: false };
    },
  };

  /* ── Guest bag ─────────────────────────────────────────────────────────
     Local only, and only while signed out. Prices are display values copied
     from the catalogue; the server re-prices everything at checkout, so these
     are never treated as an order total. */
  /* A guest's cap on one line. Only a piece known to be sold out gets 0; an
     unknown stock count gets a generous ceiling so a static catalogue page
     that never received a stock figure can still be shopped. Collapsing 0 into
     the fallback made a genuinely sold-out piece look buyable to a guest. */
  const UNKNOWN_STOCK_CAP = 99;

  const stockOf = (p) => {
    const raw = p && p.stock;
    if (raw === undefined || raw === null || raw === '') return UNKNOWN_STOCK_CAP;
    const s = Number(raw);
    if (!Number.isFinite(s)) return UNKNOWN_STOCK_CAP;
    return Math.max(0, Math.floor(s));
  };

  function addToCartLocal(p, qty) {
    const product = typeof p === 'string' ? { slug: p } : p;
    const c = readCart();
    const found = c.find((i) => i.slug === product.slug);
    const want = (found ? found.quantity : 0) + (qty || 1);
    const cap = stockOf(product);
    if (want > cap) {
      AV.toast(cap === 0 ? `${product.name} has sold out.` : `Only ${cap} of ${product.name} left \u2014 that is all we have.`);
      return false;
    }
    if (found) {
      found.quantity = Math.min(cap, want);
      /* Never trust a stored price over the catalogue's current one. */
      if (Number.isFinite(Number(product.price))) found.price = Number(product.price);
    } else {
      c.push({
        slug: product.slug,
        name: product.name || product.slug,
        price: Number(product.price) || 0,
        image: product.image || null,
        stock: stockOf(product),
        quantity: qty || 1,
      });
    }
    writeCart(c);
    return true;
  }

  function setLocalQty(slug, qty) {
    const c = readCart();
    const i = c.find((x) => x.slug === slug);
    if (!i) return false;
    const cap = Number.isFinite(i.stock) && i.stock > 0 ? i.stock : 99;
    i.quantity = Math.max(1, Math.min(cap, qty));
    writeCart(c);
    return true;
  }

  /* A guest bag shaped like the server's, so cart.html renders one structure
     whichever bag it is showing. `authoritative: false` is what lets the page
     label the difference instead of implying these are final figures. */
  function localCartView() {
    const items = readCart();
    const subtotal = items.reduce((n, i) => n + i.price * i.quantity, 0);
    const shipping = AV.shippingFor(subtotal);
    return {
      lines: items.map((i) => ({
        productId: null,
        slug: i.slug,
        name: i.name,
        image: i.image,
        unitPrice: i.price,
        quantity: i.quantity,
        lineTotal: i.price * i.quantity,
        inStock: i.stock === undefined || i.stock > 0,
        maxQuantity: Number.isFinite(i.stock) && i.stock > 0 ? i.stock : 99,
      })),
      subtotal,
      discount: 0,
      shipping,
      tax: 0,
      total: subtotal + shipping,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      issues: [],
      freeShippingThreshold: AV.SHIPPING.freeAbove,
      amountToFreeShipping: Math.max(0, AV.SHIPPING.freeAbove - subtotal),
      currency: 'INR',
      authoritative: false,
    };
  }
  AV.localCart = readCart;

  /* Saves or unsaves one product, whichever the button currently says.
     Shared by the card hearts (via delegation) and the product page button, so
     the account requirement, the busy guard and the error toast behave the same
     everywhere. The authoritative list comes back from the API and drives the
     button state — the button is never assumed to have succeeded.

     The wishlist belongs to an account, so a signed-out visitor is sent to sign
     in rather than shown a save that would not persist. `next` returns them to
     the page they were on. */
  AV.toggleSaved = async function toggleSaved(btn, productId) {
    if (!btn) return false;
    const id = productId || btn.dataset.save;
    if (!id) return false;

    if (!AV.user) {
      AV.toast('Sign in to save pieces to your wishlist.', 'err');
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      setTimeout(() => {
        window.location.href = `/account.html?view=login&next=${next}`;
      }, 900);
      return false;
    }

    const wasSaved = btn.getAttribute('aria-pressed') === 'true';
    try {
      const list = wasSaved
        ? await AV.wishlist.remove(id)
        : await AV.wishlist.add(id);
      AV.markSaved();
      AV.toast(wasSaved ? 'Removed from your wishlist.' : 'Saved to your wishlist.', 'ok');
      return list.items?.some?.((i) => String(i.productId) === String(id)) ?? !wasSaved;
    } catch (err) {
      AV.toast(AV.firstErr(err), 'err');
      return false;
    }
  };

  /* Header badges. Reads the shared caches — never requests anything — so a badge
     is correct from the first cart response and costs nothing on other pages. */
  function renderBadge() {
    const n = AV.cartCount();
    AV.qsa('[data-cart-badge]').forEach((b) => {
      b.textContent = n || '';
      /* Hidden rather than showing "0": an empty-bag badge reads as an error. */
      b.style.display = n ? 'grid' : 'none';
    });
    const w = AV.wishlistCount();
    AV.qsa('[data-wishlist-badge]').forEach((b) => {
      b.textContent = w || '';
      b.style.display = w ? 'grid' : 'none';
    });
  }

  /* Folds the guest bag into the account's server bag. Called once, immediately
     after a successful sign-in, so a visitor who shopped before creating an
     account does not silently lose their bag.

     Sequential rather than parallel: each add re-prices the cart server-side, and
     firing them together would race those writes and drop lines. Failures are
     reported but do not block the sign-in — an account that could not be merged
     is recoverable, a sign-in that hangs because of it is not. */
  AV.mergeGuestCart = async () => {
    const items = readCart();
    if (!items.length) return { merged: 0, failed: 0 };

    let merged = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const productId = await productIdFor({ slug: item.slug });
        if (!productId) {
          failed += 1;
          continue;
        }
        await AV.cart.add(productId, item.quantity);
        merged += 1;
      } catch (_err) {
        failed += 1;
      }
    }
    /* Cleared either way: a line that could not be merged has already been
       refused by the server, and keeping it would re-attempt it on every
       future sign-in. */
    writeCart([]);
    if (merged) AV.toast(`${merged} saved ${merged === 1 ? 'piece' : 'pieces'} moved into your bag.`);
    if (failed) AV.toast(`${failed} could not be moved and ${failed === 1 ? 'is' : 'are'} no longer available.`, 'err');
    return { merged, failed };
  };

  /* Marks a single add-to-cart button as already containing its product. */
  function markBtnInBag(btn) {
    if (!btn) return;
    const inBag = signedIn()
      ? (cartCache?.lines || []).some((l) => l.slug === btn.dataset.slug)
      : readCart().some((i) => i.slug === btn.dataset.slug);
    btn.classList.toggle('in-bag', inBag);
    const label = btn.dataset.label || (btn.dataset.label = btn.textContent.trim());
    btn.textContent = inBag ? 'Add another' : label;
  }
  /* Re-applies the in-bag label across every product card on the page. */
  AV.markInCart = function markInCart() {
    document.querySelectorAll('.btn-product[data-slug]').forEach(markBtnInBag);
  };

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
  /* Who am I, from the session cookie alone — no token is stored in JS, so a
     stale localStorage copy can never authorise anything.

     Memoised for the page's lifetime: the header, every product card state and
     every customer panel need the same answer, and asking the server N times
     would be N chances to disagree. `AV.refreshMe()` forces a fresh read after
     sign-in or sign-out. */
  let mePromise = null;
  AV.me = async function me() {
    if (mePromise) return mePromise;

    /* Ask what this deployment supports before asking who we are. On a
       deployment with no database /api/auth/me is guaranteed to 503, so the
       probe turns a guaranteed failure on every page load into a single
       cached 200 - and returns "signed out" without the pointless round trip. */
    const caps = await AV.capabilities().catch(() => null);
    if (caps && caps.database === false) {
      AV.setUser(null);
      mePromise = Promise.resolve(null);
      return null;
    }

    mePromise = AV.api
      .get('/api/auth/me')
      .then((env) => {
        /* The envelope is { data: { user } }, so the public object is one level
           down. Taking data directly would store a wrapper and every consumer
           would read `.user.user`. */
        const user = env.data?.user ?? null;
        AV.setUser(user);
        return user;
      })
      .catch(() => {
        /* Signed out is the normal answer for most visitors, not an error worth
           surfacing, so it resolves to null rather than throwing. */
        AV.setUser(null);
        return null;
      });
    return mePromise;
  };

  /* Invalidates the memoised identity. Used after login, register and logout,
     where the cookie changed and the previous answer is by definition wrong. */
  AV.refreshMe = function refreshMe() {
    mePromise = null;
    return AV.me();
  };
  AV.requireAuth = async () => (await AV.me()) !== null;
  AV.isAdmin = () => !!AV.user && AV.user.role === 'admin';

  /* Given name, for greetings and address defaults.
     The account has one `name` field, not separate first/last names, so this is a
     display helper only — nothing may write it back as a name. */
  AV.givenName = (u) => String(u?.name || '').trim().split(/\s+/)[0] || '';

  /* ── Card renderers ───────────────────────────────────────────────── */
  AV.art = (i) => `a${((i % 8) + 1)}`;

  /* Placeholder shown while data is in flight, so grids are never blank. */
  AV.skeletonCards = (n = 4, kind = 'product') => {
    let out = '';
    for (let i = 0; i < n; i += 1) out += `<div class="skeleton skeleton-${kind}"></div>`;
    return out;
  };

  AV.productCard = (p, i = 0) => {
    /* Sold out if the catalogue says so, or if it reports a stock count of
       zero. Checking availability alone let a piece with stock 0 render an
       enabled "Add to cart" button. */
    const stock = Number(p.stock);
    const inStock = p.availability !== false && !(Number.isFinite(stock) && stock <= 0);
    const img = p.images?.[0];
    /* data-product-id carries the catalogue id so a signed-in customer's bag is
       keyed by id, exactly as the server keys it. The slug is retained for a
       guest and for the URL, and the click handler resolves one to the other. */
    const pid = p.id ?? p._id ?? '';
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
  <div class="card-actions">
    <button class="btn btn-outline btn-sm btn-product"
      ${inStock ? '' : 'disabled'}
      data-add data-product-id="${AV.esc(pid)}" data-slug="${AV.esc(p.slug)}"
      data-name="${AV.esc(p.name)}" data-price="${p.price}" data-image="${AV.esc(img || '')}"
      data-stock="${p.stock ?? ''}" data-availability="${inStock}">Add to cart</button>
    <button class="icon icon-save" data-save="${AV.esc(pid)}" data-slug="${AV.esc(p.slug)}"
      aria-pressed="false" aria-label="Save ${AV.esc(p.name)}" title="Save to wishlist">\u2661</button>
  </div>
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

  /* ── Document head ─────────────────────────────────────────────────── */
  /* Page-level SEO is authored in each HTML file; this only fills in the tags
     that must stay in step with the live route, and keeps a single source of
     truth for the social image. */
  const SITE = 'Astro Vetro';
  const DEFAULT_OG = '/assets/img/og-card.svg';
  AV.SITE_NAME = SITE;

  const setMeta = (attr, key, content) => {
    if (!content) return;
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  /* absolute() so canonical/og:url are correct regardless of the current path */
  AV.absolute = (href) => {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    return new URL(href, location.origin).href;
  };

  /* Call after setting document.title and the description. */
  AV.seo = ({ title, description, image, url, type = 'website', noindex = false }) => {
    const full = title ? (title.includes(SITE) ? title : `${title} — ${SITE}`) : SITE;
    document.title = full;
    if (description) setMeta('name', 'description', description);
    setMeta('name', 'robots', noindex ? 'noindex,follow' : 'index,follow');
    setMeta('property', 'og:site_name', SITE);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:title', full);
    if (description) setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', AV.absolute(url || location.pathname + location.search));
    setMeta('property', 'og:image', AV.absolute(image || DEFAULT_OG));
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', full);
    if (description) setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', AV.absolute(image || DEFAULT_OG));
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', AV.absolute(url || location.pathname + location.search));
  };

  /* ── Boot ─────────────────────────────────────────────────────────── */
  AV.boot = (opts = {}) => {
    mount(opts.chrome);
    revealAll();
    /* One pair of requests per page load, shared by every consumer via the
       caches: the header badges, the product-card "in bag" and "saved" states,
       and any customer page that opens on this document. Deliberately not
       awaited — the page above the header must never wait on commerce data, and
       a failure here is non-fatal because each customer page re-requests what it
       needs and handles its own error state. */
    hydrate();
  };

  /* Fills the cart and wishlist caches once per page load, so the header badges
     and the card states are right on a signed-in visitor's first paint.

     Identity is resolved first because AV.user starts as a localStorage hint
     that may be stale: a signed-out visitor must end up with empty caches, and a
     visitor whose session exists but was never cached locally must still get
     their badges. AV.me() short-circuits on a no-database deployment, so this
     costs nothing there.

     Silent by design. An anonymous visitor ends with no caches, and their guest
     bag is already in localStorage. */
  async function hydrate() {
    const user = await AV.me().catch(() => null);
    if (!user) {
      /* Confirmed signed out: drop anything a previous session left cached so a
         stale count cannot be shown to someone who is not signed in. */
      AV.clearCommerceCache();
      renderBadge();
      return;
    }
    await Promise.allSettled([AV.cart.get(), AV.wishlist.get()]);
  }

  /* `.js-load` and `[data-reveal]` start at opacity:0 so that server-rendered
     markup never flashes before its data arrives. Both selectors must be
     released, otherwise the containers stay invisible forever. */
  function revealAll(scope) {
    const root = scope || document;
    root.querySelectorAll('.js-load, [data-reveal]').forEach((el) => el.classList.add('ready'));
  }
  AV.reveal = revealAll;
})();