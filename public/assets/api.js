/* Astro Vetro — the one place the browser talks to the backend.

   Every backend response uses the envelope: { success, message, data, meta }, so
   `request` unwraps nothing and the resource modules below hand callers the
   `data` value directly.

   This module is the only file allowed to call `fetch`. Customer pages go
   through AV.cart / AV.wishlist / AV.orders / etc., which means:

     - one definition of what an error looks like;
     - one place that knows a 401 means "signed out", so no page has to invent
       its own reaction;
     - one subscriber list, so the header cart badge can react to a cart change
       on any page instead of every component polling for it.

   Nothing here computes money. Totals, stock and payment state are whatever the
   server returned; the client only renders them.
*/

window.AV = window.AV || {};

(async function () {
  /* Emitted whenever the server cart or wishlist changes, so a badge anywhere in
     the document updates from one request rather than each component fetching
     its own copy. Payload is the authoritative collection from the API. */
  const listeners = { cart: new Set(), wishlist: new Set(), auth: new Set() };
  AV.on = (channel, fn) => {
    const set = listeners[channel];
    if (!set) throw new Error(`Unknown channel: ${channel}`);
    set.add(fn);
    return () => set.delete(fn);
  };
  AV.emit = (channel, payload) => listeners[channel]?.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      /* A subscriber that throws must not stop the others, and must never
         surface as an unhandled rejection on a page that otherwise worked. */
      console.error(`[av] ${channel} subscriber failed`, err);
    }
  });

  /* Set while a request is 401-ing, so a burst of parallel calls from one page
     triggers a single sign-out/redirect rather than one per call. */
  let handlingUnauthorised = false;

  async function request(method, path, body, opts = {}) {
    const headers = opts.headers || {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const init = { method, credentials: 'include', headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    /* Idempotency-Key is sent as a header so a retried POST cannot become a
       second order. The backend treats a replay as the original response. */
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    let res;
    try {
      res = await fetch(path, init);
    } catch (_e) {
      const e = new Error('Could not reach the server. Is it running?');
      e.code = 'NETWORK';
      throw e;
    }

    let data = null;
    try {
      data = await res.json();
    } catch (_e) {
      /* non-JSON response */
    }

    if (!res.ok || !data || data.success === false) {
      const errInfo = (data && data.error) || {};
      const e = new Error(errInfo.message || data?.message || `Request failed (${res.status})`);
      e.code = errInfo.code || 'ERROR';
      e.status = res.status;
      e.details = errInfo.details;

      /* 401 means the session is gone or expired — an expired cookie, a revoked
         token, or a password change. Cached identity is now a lie, so it is
         dropped once here rather than left to look signed-in. Retrying is
         pointless: the same cookie would fail again.

         The path travels with the event so the customer pages can tell a lost
         session from a rejected password. `AV.me()` probes /api/auth/me and
         expects a 401 from every signed-out visitor — that is the normal answer,
         not a session that expired — and /api/auth/login answers 401 for a wrong
         password, which must be shown as a form error rather than turned into a
         redirect. Only a 401 from anything else means a session that was there
         has gone. */
      if (res.status === 401 && !handlingUnauthorised) {
        handlingUnauthorised = true;
        AV.setUser?.(null);
        AV.emit('auth', { user: null, reason: 'unauthorised', path });
        /* Released on a later turn, not synchronously. Resetting in the same
           tick meant the flag was already false when the next response of the
           same burst was handled, so every parallel 401 re-ran the whole signed-
           out path. */
        setTimeout(() => {
          handlingUnauthorised = false;
        }, 0);
      }

      /* 503 DATABASE_NOT_CONFIGURED is the no-database deployment, not a
         failure. `code` lets a page show "not available yet" instead of an
         error, without treating it as an outage. */
      throw e;
    }

    return data;
  }

  /* Raw verbs, kept for the catalogue and the pages that already use them. */
  AV.api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
  };

  /* What this deployment can actually do -----------------------------------
     GET /api/status reports the active data provider, whether a database is
     attached, and whether writes are possible. It is fetched once and cached.

     Why this exists: without it, every page load asks /api/auth/me and gets a
     503 back, which is honest but pointless - it cannot succeed on a deployment
     with no database. One cheap 200 tells the client which features are real,
     so the UI can present them as unavailable instead of offering controls
     that are guaranteed to fail.

     A failed probe is treated as "no database": an API we cannot reach can
     certainly not serve accounts, and the catalogue pages degrade on their own
     regardless. */
  let caps = null;
  let capsPending = null;

  AV.capabilities = function () {
    if (caps) return Promise.resolve(caps);
    if (capsPending) return capsPending;
    capsPending = request('GET', '/api/status')
      .then((env) => {
        caps = Object.assign({ reachable: true, database: false, writable: false, paymentsLive: false }, env && env.data);
        return caps;
      })
      .catch(() => {
        caps = { reachable: false, provider: 'unknown', database: false, writable: false, paymentsLive: false };
        return caps;
      })
      .finally(() => {
        capsPending = null;
      });
    return capsPending;
  };

  /* True when an endpoint that needs persistence would be refused. */
  AV.needsDatabase = async (code) => {
    const c = await AV.capabilities();
    if (c.database) return false;
    return !code || code === 'DATABASE_NOT_CONFIGURED';
  };

  /* Convenience helpers --------------------------------------------------- */
  AV.qs = (sel, root) => (root || document).querySelector(sel);
  AV.qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  AV.esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  AV.pirate = (s) =>
    String(s ?? '')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .toLowerCase();

  /* For a value interpolated into a CSS url('…') inside a style attribute.

     AV.esc is not enough here, and the reason is worth stating: AV.esc turns a
     single quote into &#39;, and the HTML parser decodes that back to a real
     quote before the CSS is parsed. So a crafted image value could close the
     url() and append declarations of its own. Not script execution — the modern
     engines block javascript: URLs in CSS — but CSS injection into a style
     attribute nonetheless.

     Anything that could end the url(), start a new declaration or begin an
     escape sequence is dropped. A URL that survives this is a plain absolute
     path or https URL, which is all a product image ever is. */
  AV.cssUrl = (u) =>
    String(u ?? '')
      .replace(/["'()\\<>]/g, '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim();

  AV.formatPrice = (n) => `\u20b9${Number(n || 0).toLocaleString('en-IN')}`;
  AV.formatDate = (iso) => {
    if (!iso) return '\u2014';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '\u2014'
      : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  AV.formatTime = (iso) => {
    if (!iso) return '\u2014';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '\u2014'
      : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };
  AV.firstErr = (err) => {
    if (!err) return 'Something went wrong.';
    if (Array.isArray(err.details) && err.details.length) {
      return err.details.map((x) => x.message || JSON.stringify(x)).join(' ');
    }
    return err.message || 'Something went wrong.';
  };
  /* Toasts are the only feedback on a good number of account actions — an
     address saved, a default changed, a sign-out. With no live region they
     existed only for sighted users, so every one of those confirmations was
     silent to a screen reader. The region is created empty and announced,
     and each toast carries role="status" so its own removal is also
     announced rather than leaving a stale line behind. */
  AV.toast = (msg, type = 'ok') => {
    let wrap = AV.qs('.toast-wrap');
    /* A live region has to be in the document *before* the text goes in, or
       assistive tech sees only the finished node and stays silent. So a newly
       created region gets one frame to register before anything is added. */
    const fresh = !wrap;
    if (fresh) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      wrap.setAttribute('role', 'status');
      wrap.setAttribute('aria-live', 'polite');
      wrap.setAttribute('aria-atomic', 'false');
      document.body.appendChild(wrap);
    }
    const add = () => {
      const t = document.createElement('div');
      t.className = `toast ${type}`;
      t.setAttribute('role', 'status');
      t.textContent = msg;
      wrap.appendChild(t);
      setTimeout(() => {
        t.style.opacity = '0';
        t.style.transition = 'opacity .3s ease';
        setTimeout(() => t.remove(), 320);
      }, 3200);
    };
    if (fresh) requestAnimationFrame(add);
    else add();
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity .3s ease';
      setTimeout(() => t.remove(), 320);
    }, 3200);
  };
  AV.setBusy = (btn, busy, text) => {
    if (!btn) return;
    if (busy) {
      btn.dataset.avText = btn.textContent;
      btn.textContent = 'Working\u2026';
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.avText || text || 'Submit';
      btn.disabled = false;
    }
  };
  /* ── Commerce resources ───────────────────────────────────────────────
     One function per backend route, and the only place a customer page needs
     to know a URL. Names mirror the backend routes so the contract is checkable
     by reading both files side by side.

     Every function returns `data` — the useful part of the envelope — rather
     than the envelope, because no page has any business reaching into `meta`.
     Cart-shaped results additionally broadcast, which is what keeps the header
     badge correct after an add, a quantity change or a checkout. */

  const unwrap = (env) => env?.data;
  const broadcastCart = (env) => {
    const cart = unwrap(env);
    if (cart?.cart) AV.emit('cart', cart.cart);
    return cart;
  };

  /* The server bag. Raw resource access — pages should use AV.bag in store.js,
     which decides between this and the guest bag rather than each page deciding
     for itself. */
  AV.cart = {
    /* GET /api/cart — the authoritative bag. Totals in this object are computed
       by the server from live product prices and stock. */
    get: async () => broadcastCart(await request('GET', '/api/cart')),

    /* POST /api/cart/items { productId, quantity }
       productId is the database id from the catalogue, never a slug: the server
       resolves the slug-or-id question itself and is the only thing that decides
       what a line costs. */
    add: async (productId, quantity = 1) => {
      const env = await request('POST', '/api/cart/items', { productId, quantity });
      return broadcastCart(env);
    },

    /* PATCH /api/cart/items/:productId { quantity } */
    setQuantity: async (productId, quantity) => {
      const env = await request('PATCH', `/api/cart/items/${encodeURIComponent(productId)}`, { quantity });
      return broadcastCart(env);
    },

    remove: async (productId) => broadcastCart(await request('DELETE', `/api/cart/items/${encodeURIComponent(productId)}`)),
    clear: async () => broadcastCart(await request('DELETE', '/api/cart')),
  };

  AV.wishlist = {
    get: async () => {
      const data = unwrap(await request('GET', '/api/wishlist'));
      if (data?.wishlist) AV.emit('wishlist', data.wishlist);
      return data?.wishlist ?? { items: [], count: 0 };
    },
    add: async (productId) => {
      const data = unwrap(await request('POST', `/api/wishlist/${encodeURIComponent(productId)}`));
      if (data?.wishlist) AV.emit('wishlist', data.wishlist);
      return data?.wishlist ?? { items: [], count: 0 };
    },
    remove: async (productId) => {
      const data = unwrap(await request('DELETE', `/api/wishlist/${encodeURIComponent(productId)}`));
      if (data?.wishlist) AV.emit('wishlist', data.wishlist);
      return data?.wishlist ?? { items: [], count: 0 };
    },
    /* POST /api/wishlist/:productId/move-to-cart
       The backend decides whether the item stays saved. It only unsaves once the
       cart add has actually succeeded, so a sold-out piece is never lost from
       both lists. This does not second-guess that: it takes whatever comes back. */
    moveToCart: async (productId, quantity = 1) => {
      const data = unwrap(
        await request('POST', `/api/wishlist/${encodeURIComponent(productId)}/move-to-cart`, { quantity })
      );
      if (data?.cart) AV.emit('cart', data.cart);
      if (data?.wishlist) AV.emit('wishlist', data.wishlist);
      return data;
    },
  };

  AV.addresses = {
    list: async () => unwrap(await request('GET', '/api/me/addresses')) ?? { addresses: [], count: 0 },
    create: async (address) => unwrap(await request('POST', '/api/me/addresses', address))?.address,
    update: async (addressId, patch) =>
      unwrap(await request('PATCH', `/api/me/addresses/${encodeURIComponent(addressId)}`, patch))?.address,
    /* Default is set by the server and read back from its response. The page
       re-renders from that response rather than flipping a class locally, so the
       UI cannot claim a default the database did not accept. */
    setDefault: async (addressId) =>
      unwrap(await request('POST', `/api/me/addresses/${encodeURIComponent(addressId)}/default`))?.address,
    remove: async (addressId) => unwrap(await request('DELETE', `/api/me/addresses/${encodeURIComponent(addressId)}`)),
  };

  AV.orders = {
    /* GET /api/orders — the signed-in customer's history. The server scopes this
       to the session; there is no user id to pass and none is accepted.

       `meta` is carried alongside `orders` rather than dropped, because paging a
       list needs `hasMore`: without it a page that happens to hold exactly the
       page size is indistinguishable from the last one. */
    list: async (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      const env = await request('GET', `/api/orders${qs ? `?${qs}` : ''}`);
      return { ...(unwrap(env) ?? { orders: [], trackable: false }), meta: env.meta ?? null };
    },
    /* GET /api/orders/:orderId — one order, by its own request. Deliberately
       not "list then filter": that would fetch every order a customer has ever
       placed just to render one. */
    get: async (orderId) => unwrap(await request('GET', `/api/orders/${encodeURIComponent(orderId)}`))?.order,
    /* GET /api/orders/:orderId/tracking */
    tracking: async (orderId) => unwrap(await request('GET', `/api/orders/${encodeURIComponent(orderId)}/tracking`)),
  };

  AV.account = {
    /* GET /api/me — the account aggregate: identity, counts, default address and
       latest order, in one request, so the dashboard is never a page of
       separately-loaded panels that can disagree with each other. */
    summary: async () => unwrap(await request('GET', '/api/me')),
    updateProfile: async (patch) => unwrap(await request('PATCH', '/api/me', patch))?.user,
    changePassword: async (currentPassword, newPassword) =>
      unwrap(await request('POST', '/api/me/password', { currentPassword, newPassword })),
  };

  AV.auth = {
    login: async (email, password) => {
      const data = unwrap(await request('POST', '/api/auth/login', { email, password }));
      if (data?.user) {
        AV.setUser?.(data.user);
        AV.emit('auth', { user: data.user, reason: 'signed-in' });
      }
      return data?.user ?? null;
    },
    /* `phone` is optional in the schema and only used to prefill a later
       address, so it is sent when known and omitted otherwise. */
    register: async (name, email, password, phone) => {
      const body = { name, email, password };
      if (phone) body.phone = phone;
      const data = unwrap(await request('POST', '/api/auth/register', body));
      if (data?.user) {
        AV.setUser?.(data.user);
        AV.emit('auth', { user: data.user, reason: 'signed-in' });
      }
      return data?.user ?? null;
    },
    logout: async () => {
      await request('POST', '/api/auth/logout');
      AV.setUser?.(null);
      AV.emit('auth', { user: null, reason: 'signed-out' });
    },
  };

  AV.checkout = {
    /* POST /api/checkout/cod — places the order. No items, no prices, no
       totals: the server reads the customer's own cart and prices it. An
       idempotency key is generated per attempt so a double-click or a retry
       after a dropped response cannot become a second order. */
    cod: async (payload, idempotencyKey) => {
      /* A caller-supplied key is honoured so every retry of one attempt carries
         the same token. Generating a fresh key per call would turn a retry after
         a dropped response into a second order. */
      const env = await request('POST', '/api/checkout/cod', payload, {
        idempotencyKey: idempotencyKey || AV.newIdempotencyKey(),
      });
      const data = unwrap(env);
      /* The server empties the bag on success. Broadcasting keeps the header
         badge honest on the confirmation page it is about to navigate to. */
      if (data?.order) AV.emit('cart', { itemCount: 0, lines: [] });
      return data?.order ?? null;
    },

    /* POST /api/checkout/session — creates the provider order and returns only
       what the Razorpay script legitimately needs: keyId, the order id, and the
       amount the SERVER calculated. The amount is passed through to Razorpay,
       never computed here. */
    session: async (payload, idempotencyKey) => {
      /* Same rule as COD: reuse the caller's key when given one. The session is
         what creates the provider order, so a key minted per call would leave a
         retry with a second pending order behind the first. */
      const key = idempotencyKey || AV.newIdempotencyKey();
      const data = unwrap(await request('POST', '/api/checkout/session', payload, { idempotencyKey: key }));
      return { ...(data ?? {}), idempotencyKey: key };
    },

    /* POST /api/checkout/confirm — the only thing that decides whether an order
       is paid. The browser never asserts payment succeeded; it hands over the
       provider's response and the server verifies the signature. */
    confirm: async (payload, idempotencyKey) => {
      const env = await request('POST', '/api/checkout/confirm', payload, { idempotencyKey });
      const data = unwrap(env);
      if (data?.order?.paymentStatus === 'paid') AV.emit('cart', { itemCount: 0, lines: [] });
      return data?.order ?? null;
    },
  };

  /* One key per checkout attempt, reused across the retries of that attempt.
     crypto.randomUUID is available in every browser that supports the rest of
     this site; the fallback is for the rare case it is not. */
  AV.newIdempotencyKey = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

  /* Whether this deployment can take a payment at all, from /api/status.
     Checked so checkout can offer cash on delivery and explain why card is
     absent, rather than rendering a payment step that cannot complete. */
  AV.paymentsAvailable = async () => {
    const caps = await AV.capabilities().catch(() => null);
    return Boolean(caps && caps.paymentsLive);
  };
})();
