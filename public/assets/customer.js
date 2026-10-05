/* ====================================================================
   ASTRO VETRO — CUSTOMER AREA
   Shared behaviour for account, bag, wishlist, checkout, orders and
   tracking.

   This file exists so those seven pages do not each reinvent the same
   four things:

     1. Turning a request into a page. Loading, empty, error and success
        are rendered by named helpers, so they look and behave identically
        everywhere and no region is ever left silently blank.
     2. Asking whether a signed-in visitor is required. One gate, one
        explanation, one way back to where they were.
     3. Rendering money and status. Both come from the server; the client
        only formats them.
     4. Deciding when it is safe to navigate. Every redirect below happens
        after the server has answered, never before.

   It adds no data layer of its own — every request goes through the
   resources in api.js, and every figure comes from one of them.
   ==================================================================== */

window.AV = window.AV || {};

AV.customer = (() => {
  /* ── Region states ────────────────────────────────────────────────
     Each helper renders into a container and returns the element it
     wrote, so callers can hold onto it. All of them escape whatever the
     server said, because an error message can contain a field name and a
     validation detail that came from user input. */

  const html = (s) => AV.esc(s);

  /* Placeholder blocks that hold the shape of the content while it loads,
     so nothing reflows when it arrives. `rows` matches the number of things
     that will appear. */
  function skeleton(target, rows = 3) {
    target.innerHTML = `<div class="av-skeleton" aria-hidden="true">${'<div class="line-lg"></div>'.repeat(rows)}</div>`;
    /* Announced once, not per block: a screen reader user needs to know
       something is coming, not to have the message repeated N times. */
    target.setAttribute('aria-busy', 'true');
    return target;
  }

  function clearBusy(target) {
    target.removeAttribute('aria-busy');
  }

  function loading(target, message = 'Loading…') {
    skeleton(target, 3);
    const live = document.createElement('p');
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    live.textContent = message;
    target.appendChild(live);
    clearBusy(target);
    return target;
  }

  /* Nothing here. A real empty state with a way forward, never a blank box —
     "you have no orders" and "the request failed" must not look alike.

     `level` exists because these states sit at two different depths. Dropped
     inside a panel that already carries an <h2> section heading, an <h3> is
     correct. Rendered as the whole page body under the <h1>, an <h3> skips a
     level, so those callers pass 'h2'. Defaulting to h3 kept that right for
     every panel and wrong for every page-level state. */
  function empty(target, { title, body, actions = [], level = 'h3' }) {
    target.innerHTML = `
      <div class="av-state">
        <${level}>${html(title)}</${level}>
        ${body ? `<p>${html(body)}</p>` : ''}
        ${actions.map((a) => `<a class="btn ${a.style || 'btn-outline'}" href="${html(a.href)}"${a.newTab ? ' target="_blank" rel="noopener"' : ''}>${html(a.label)}</a>`).join('\n        ')}
      </div>`;
    return target;
  }

  /* Something failed. Shows the server's own message where there is one,
     because "That is not your current password" is actionable and
     "Request failed (500)" is not. */
  function error(target, err, { retry = null, title = 'We could not load this', level = 'h3' } = {}) {
    const msg = err ? AV.firstErr(err) : '';
    target.innerHTML = `
      <div class="av-state av-state--error" role="alert">
        <${level}>${html(title)}</${level}>
        <p>${html(msg)}</p>
        ${retry ? '<button class="btn btn-outline" type="button" data-retry>Try again</button>' : ''}
      </div>`;
    const btn = target.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', () => retry());
    return target;
  }

  /* A 401 mid-session is not a page error: the session ended, so the
     visitor is sent to sign in and returned to this page afterwards. */
  function authLost(next) {
    const target = next || (location.pathname + location.search);
    location.href = `/account.html?view=login&next=${encodeURIComponent(target)}`;
  }

  /* ── Sign-in gate ────────────────────────────────────────────────
     Shared by every page that needs an account. The message names the
     reason, so a customer arriving from "save this piece" is told why
     signing in helps rather than just being asked to log in. */
  function gate(target, { reason, next, actions = [] }) {
    const back = next || (location.pathname + location.search);
    target.innerHTML = `
      <div class="av-gate">
        <h2>Sign in to continue.</h2>
        <p>${reason ? `${html(reason)} ` : ''}Your bag, wishlist and orders stay with your account, so nothing is lost between visits.</p>
        <a class="btn btn-light" href="/account.html?view=login&next=${encodeURIComponent(back)}">Sign in</a>
        <a class="btn btn-outline" href="/account.html?view=register&next=${encodeURIComponent(back)}">Create an account</a>
        ${actions.length ? `<p style="margin:22px 0 0">${actions.map((a) => `<a href="${html(a.href)}">${html(a.label)}</a>`).join(' · ')}</p>` : ''}
      </div>`;
    return target;
  }

  /* True when this deployment can persist anything at all. Checked before
     rendering a form that would be refused, rather than after. */
  async function needsDatabase() {
    const caps = await AV.capabilities().catch(() => null);
    return !caps || caps.database === false;
  }

  /* Explains a no-database deployment instead of showing controls that
     cannot work. Everything that needs an account is switched off there;
     the catalogue pages are unaffected. */
  function databaseUnavailable(target) {
    target.innerHTML = `
      <div class="av-state">
        <h3>Not available yet</h3>
        <p>This site is running without a database, so accounts, bags, wishlists and order history are switched off. Browsing the collection, the rituals and the journal all work as they are.</p>
        <a class="btn btn-light" href="/shop.html">Browse the collection</a>
        <a class="btn btn-outline" href="/readings.html">Book a reading</a>
      </div>`;
    return target;
  }

  /* Renders one definition-list row of a bag or an order. Kept here so every
     total block in the customer area is built the same way. */
  const totalRow = (label, value, { strong = false, free = false } = {}) =>
    `<div class="row${strong ? ' total' : ''}"><span>${AV.esc(label)}</span><span>${
      free ? '<span class="free">Free</span>' : AV.formatPrice(value)
    }</span></div>`;

  /* ── Format helpers ──────────────────────────────────────────────
     Deliberately thin. Every one of these receives a value the server
     computed; none of them derives a price, a total or a stock level. */

  /* An order or payment status as a badge. The mapping is presentation
     only — the underlying string is what the server stored, and it is
     shown as-is rather than relabelled into something more flattering. */
  function statusBadge(status) {
    const s = String(status || '');
    return `<span class="status-badge status-${html(s.toLowerCase().replace(/\s+/g, '_'))}">${html(s.replace(/_/g, ' '))}</span>`;
  }

  /* ₹1,23,456.78 — grouped the way prices are read in India. */
  const money = (n) => AV.formatPrice(n);

  /* "3 pieces" / "1 piece". Used wherever a count is shown beside a noun,
     so a single item never reads as a plural. */
  const pieces = (n) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

  /* A saved address, as one block. Used by the account list, the checkout
     picker and the order snapshot, so an address looks the same wherever
     it appears — including inside a past order, which holds its own copy. */
  function addressText(a) {
    if (!a) return '';
    return [
      a.line1,
      a.line2,
      [a.city, a.state, a.pincode].filter(Boolean).join(' '),
      a.country,
    ]
      .filter(Boolean)
      .map(html)
      .join('<br>');
  }

/* One line item in a bag or an order. `qty` is shown as a multiplier so
     "₹1,200 × 2" cannot be misread as the line total.

     The line total is printed exactly as the server sent it. It used to fall
     back to `unitPrice * quantity`, which put a price calculation in the
     browser: if the server ever priced a line the way it disagreed with — a
     rounded total, a line-level discount, a tax folded into the unit — the
     fallback would have quietly replaced the authoritative figure with a
     locally invented one. A missing value is shown as "—" rather than guessed
     at, so the absence is visible instead of filled in. */
  function orderLine(item, i) {
    const img = item.image
      ? `<div class="art has-photo" style="background-image:url('${AV.cssUrl(item.image)}')" role="img" aria-label="${html(item.name)}"></div>`
      : `<div class="art ${AV.art(i)}" role="img" aria-label="${html(item.name)}"></div>`;
    const href = item.slug ? `/product.html?slug=${encodeURIComponent(item.slug)}` : null;
    const name = href
      ? `<a href="${href}">${html(item.name)}</a>`
      : html(item.name);
    const lineTotal = item.lineTotal === undefined || item.lineTotal === null ? '—' : money(item.lineTotal);
    return `
      <div class="order-line">
        ${img}
        <div>
          <div class="nm">${name}</div>
          <div class="qt">${money(item.unitPrice)} each${item.quantity > 1 ? ` &middot; quantity ${item.quantity}` : ''}</div>
        </div>
        <div class="nm">${lineTotal}</div>
      </div>`;
  }

  /* Subtotal / shipping / total, straight from the response. Rows with a zero
     value are kept when the server sent them, because "₹0 shipping" is
     information; only absent fields are skipped, so a field the server did not
     send never appears as ₹0. Pass the grand total as `total` — it is required,
     not derived. */
  function totals(rows, { total, totalLabel = 'Total' } = {}) {
    return `
      <div class="order-totals">
        ${rows.filter((r) => r && r.value !== undefined && r.value !== null).map((r) => totalRow(r.label, r.value, r)).join('\n        ')}
        ${total !== undefined && total !== null ? totalRow(totalLabel, total, { strong: true }) : ''}
      </div>`;
  }

  /* The same figures for a bag, where the labels also carry the free-shipping
     hint. `bag` is GET /api/cart's `cart`, unmodified. */
  function bagTotals(bag) {
    const free = Number(bag.shipping) === 0;
    return totals(
      [
        { label: `Subtotal (${pieces(bag.itemCount)})`, value: bag.subtotal },
        { label: 'Shipping', value: bag.shipping, free },
        Number(bag.discount) ? { label: 'Discount', value: -Math.abs(bag.discount) } : null,
      ].filter(Boolean),
      { total: bag.total }
    );
  }

  /* ── Forms ───────────────────────────────────────────────────────
     A submit handler that reports through the page's own message area and
     keeps its button disabled while in flight, so a double submit cannot
     become two writes. Returns the parsed body on success. */

  function serialise(form) {
    const body = {};
    Array.from(form.elements).forEach((el) => {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') body[el.name] = el.checked;
      else if (el.type !== 'radio' || el.checked) body[el.name] = el.value;
    });
    return body;
  }

  /* Shows a message in the shared `.form-msg` element. */
  function say(msgEl, text, ok) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.className = `form-msg show ${ok ? 'ok' : 'err'}`;
  }

  /* Wires a form to an async submit. `run` receives the serialised body and
     must throw to report a failure; anything it resolves with is returned to
     the caller. `noValidate` is set so every message appears in the one
     place — but reportValidity still runs, so the browser's own rules are
     enforced before the request is made. */
  function onSubmit(form, run, { messageEl, button } = {}) {
    const btn = button || form.querySelector('button[type="submit"]');
    const msg = messageEl || form.querySelector('.form-msg');
    form.setAttribute('novalidate', '');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      if (msg) msg.className = 'form-msg';
      if (btn) AV.setBusy(btn, true);
      try {
        await run(serialise(form), { msg, form });
      } catch (err) {
        say(msg, AV.firstErr(err), false);
      } finally {
        if (btn) AV.setBusy(btn, false);
      }
    });
    return form;
  }

  /* ── URL state ───────────────────────────────────────────────────
     Customer pages are shareable and back-button friendly, so the current
     panel lives in the query string rather than in a variable that a
     refresh would lose. */

  function readParam(name, fallback = '') {
    return new URLSearchParams(location.search).get(name) || fallback;
  }

  /* replaceState, not pushState: switching panels should not stack a history
     entry per click and make the back button feel broken. */
  function setParams(patch, { replace = true } = {}) {
    const url = new URL(location.href);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null || v === undefined || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    });
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
  }

  /* Merges the guest bag into the new account's server bag. Called right
     after a successful sign-in or registration so a visitor who shopped
     before having an account does not silently lose what they chose. */
  async function afterSignIn() {
    await AV.mergeGuestCart().catch(() => {});
    await Promise.allSettled([AV.cart.get(), AV.wishlist.get()]);
  }

  /* Where to go after signing in. Restricted to a path on this site: an
     attacker-supplied `next` must not be able to turn this link into an
     open redirect that lands a customer on a look-alike page. */
  function safeNext(candidate, fallback = '/account.html') {
    const raw = String(candidate || '');
    if (!raw) return fallback;
    /* Reject anything that is not a plain site-absolute path. This rules out
       //evil.example, https://evil.example and //evil.example alike. */
    if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
    if (raw.startsWith('/account.html')) return fallback;
    try {
      const u = new URL(raw, location.origin);
      if (u.origin !== location.origin) return fallback;
      return u.pathname + u.search + u.hash;
    } catch (_e) {
      return fallback;
    }
  }

  /* ── Payment ─────────────────────────────────────────────────────
     Razorpay's script is loaded on demand, once per page, and the promise
     is cached so a retry after a dropped payment does not fetch it twice.
     The key id comes from the server's checkout session; nothing about the
     amount is decided here. */

  let razorpayScript = null;

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    if (razorpayScript) return razorpayScript;
    razorpayScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Payment could not be loaded.')));
      s.onerror = () => reject(new Error('Payment could not be loaded. Check your connection and try again.'));
      document.head.appendChild(s);
    });
    /* Cleared on failure so a later attempt can retry rather than inheriting a
       rejected promise forever. */
    razorpayScript.catch(() => {
      razorpayScript = null;
    });
    return razorpayScript;
  }

  /* Opens the provider dialog and resolves with its response, or rejects
     with a message written for a customer. The caller passes
     `session` verbatim — order id, key id and amount all come from the
     server's own pricing. */
  async function payWithRazorpay(session) {
    const Razorpay = await loadRazorpay();
    return new Promise((resolve, reject) => {
      const rz = new Razorpay({
        key: session.keyId,
        amount: session.amountInPaise,
        currency: session.currency || 'INR',
        order_id: session.razorpayOrderId,
        name: 'Astro Vetro',
        description: `Order ${session.orderNumber}`,
        prefill: session.prefill || {},
        notes: { orderNumber: session.orderNumber },
        theme: { color: '#18372c' },
        modal: {
          /* The dialog closing is not a failure and not a success. Resolving
             with `dismissed` lets the caller say "payment not completed" and
             leave the order alone, instead of reporting an error the customer
             did not cause. */
          ondismiss: () => resolve({ dismissed: true }),
        },
      });
      rz.on('payment.failed', (r) =>
        reject(new Error(r?.error?.description || 'That payment did not go through. You have not been charged.'))
      );
      rz.on('payment.error', (r) =>
        reject(new Error(r?.error?.description || 'That payment could not be started.'))
      );
      rz.open();
    });
  }

  /* ── Page bootstrap ──────────────────────────────────────────────
     One sequence for every customer page: boot the shared chrome, then
     hand over to the page. Returns the root element to render into. */

  /* A session that disappears mid-visit.

     Every protected page opens by asking AV.me() whether there is a session, and
     shows the sign-in gate when there is not. That covers the visitor who was
     never signed in. It does not cover the one whose session expires while the
     page is open: their next request 401s, api.js drops the cached identity, and
     without this the page renders "We could not load this" — which is both
     wrong (nothing failed that the customer did) and a dead end (there is no
     way forward from an error box).

     So a protected page turns a 401 into a redirect that carries the current
     URL, so signing in returns the customer to where they were.

     Guarded on three things, because a 401 does not always mean this:

       - the page opted in, via <body data-av-auth="required">. Without that,
         /api/auth/me's 401 would bounce every signed-out visitor in the site to
         a sign-in page, including the pages that are meant to be readable
         while signed out;
       - the 401 was not the identity probe. That request is *expected* to 401
         for anyone who is not signed in — it is how the page finds out;
       - the 401 was not a rejected password. /api/auth/login answers 401 for a
         wrong password, and that belongs in the form's error line, not in a
         redirect that throws away what they typed.

     Registered once, at module scope, so no page has to remember to call it. */
  AV.on('auth', (event) => {
    if (!event || event.user) return;
    /* reason 'signed-out' is a deliberate, successful sign-out — the page that
       asked for it navigates itself. Only an involuntary 401 is handled here. */
    if (event.reason !== 'unauthorised') return;
    if (document.body?.dataset.avAuth !== 'required') return;
    if (/^\/api\/auth\/(me|login|register|logout)/.test(event.path || '')) return;
    /* Already on the way to sign-in: redirecting again would strip the
       destination this very redirect is adding. */
    if (new URLSearchParams(location.search).get('view') === 'login') return;
    authLost();
  });

  async function start(selector, run) {
    AV.boot();
    const root = typeof selector === 'string' ? AV.qs(selector) : selector;
    try {
      await run(root);
    } catch (err) {
      /* A failure this far out means the page itself is broken, not one
         section of it. Show it rather than leaving a blank page. */
      error(root, err, { retry: () => location.reload() });
    }
    /* Focus the main heading so a keyboard or screen-reader user lands inside
       the new content instead of back at the top of the document. */
    const h = AV.qs('main h1, main h2');
    if (h) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
    return root;
  }

  return {
    skeleton,
    loading,
    empty,
    error,
    clearBusy,
    gate,
    authLost,
    needsDatabase,
    databaseUnavailable,
    statusBadge,
    money,
    pieces,
    addressText,
    orderLine,
    totals,
    totalRow,
    bagTotals,
    serialise,
    say,
    onSubmit,
    readParam,
    setParams,
    afterSignIn,
    safeNext,
    payWithRazorpay,
    loadRazorpay,
    start,
  };
})();
