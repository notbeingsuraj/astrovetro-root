/* -------------------------------------------------------------------------
   Admin desk — the application.
   -------------------------------------------------------------------------

   One page (admin.html) + this file. Every tab below talks to a real,
   server-side admin endpoint; there is no stub, no dead link and no invented
   number. Readings come from the API as-is — this file formats them, it never
   derives a metric the server did not compute.

   Conventions kept from the storefront pages: AV.qs/qsa/esc/toast, C.skeleton
   for loading shapes, C.error/C.say for failures, <dialog class="adm-dialog">
   for focused work, and .tabs/.stat-grid/.table-wrap/.btn for presentation.
   Admin-only layout (toolbars, pills, library grid) is scoped in a <style>
   block inside admin.html so the storefront CSS stays untouched.
   ------------------------------------------------------------------------- */

AV.boot();
const C = AV.customer;
const root = AV.qs('#admRoot');

const TABS = [
  ['dashboard', 'Overview'],
  ['orders', 'Orders'],
  ['products', 'Products'],
  ['categories', 'Categories'],
  ['collections', 'Collections'],
  ['rituals', 'Rituals'],
  ['inventory', 'Inventory'],
  ['movements', 'Stock Movements'],
  ['suppliers', 'Suppliers'],
  ['purchase-orders', 'Purchase Orders'],
  ['images', 'Media Library'],
  ['blog', 'Blog'],
  ['content', 'Website Content'],
  ['reports', 'Reports'],
  ['users', 'Admin Users'],
  ['audit', 'Audit Log'],
  ['settings', 'Settings'],
];

/* The order state machine, mirrored from the backend so the menu can offer only
   the moves the server will accept. The server still refuses anything invalid —
   this is a courtesy to the person clicking, not the authority. An illegal edge
   here would produce a rejected request and an error toast, so it is left out
   entirely and a terminal status simply offers no moves. */
const ORDER_STATUSES = [
  'pending', 'paid', 'processing', 'shipped', 'in_transit',
  'delivered', 'payment_failed', 'cancelled', 'refunded',
];

const TRANSITIONS = {
  pending: ['paid', 'processing', 'shipped', 'payment_failed', 'cancelled'],
  paid: ['processing', 'shipped', 'cancelled', 'refunded'],
  processing: ['shipped', 'cancelled', 'refunded'],
  shipped: ['in_transit', 'delivered'],
  in_transit: ['delivered'],
  delivered: [],
  payment_failed: ['pending', 'cancelled'],
  cancelled: [],
  refunded: [],
};

const SHIPMENT_STATUSES = [
  'label_created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned',
];

/* Labels for the internal enum values, so the desk reads as English rather than
   as snake_case column names. */
const STATUS_LABELS = {
  pending: 'Pending',
  paid: 'Paid',
  processing: 'Processing',
  shipped: 'Shipped',
  in_transit: 'In transit',
  delivered: 'Delivered',
  payment_failed: 'Payment failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  label_created: 'Label created',
  picked_up: 'Picked up',
  out_for_delivery: 'Out for delivery',
  exception: 'Exception',
  returned: 'Returned',
  cod: 'Cash on delivery',
  card: 'Card',
  upi: 'UPI',
  draft: 'Draft',
  active: 'Published',
  archived: 'Archived',
  partial: 'Part received',
  received: 'Received',
  sent: 'Sent',
  opening: 'Opening',
  receive: 'Received',
  sale: 'Sold',
  adjustment: 'Adjustment',
  write_off: 'Write-off',
  return: 'Return',
  in: 'In stock',
  low: 'Low stock',
  out: 'Out of stock',
  untracked: 'Untracked',
  customer: 'Customer',
  admin: 'Admin',
};

const label = (v) => STATUS_LABELS[v] || String(v || '').replace(/_/g, ' ');
const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const MOVEMENT_TYPES = ['opening', 'receive', 'sale', 'adjustment', 'write_off', 'return'];

/* Filters and page numbers live per tab, so switching tabs and coming back
   keeps the list you were looking at. */
const state = {
  orders: { page: 1 },
  products: { page: 1, search: '', status: '', category: '', sort: 'updatedAt', order: 'desc', needsReview: false },
  inventory: { page: 1, search: '', category: '', stockState: '', sort: 'name', order: 'asc' },
  movements: { page: 1, type: '' },
  pos: { page: 1, status: '' },
  users: { page: 1, search: '', role: '' },
  audit: { page: 1, action: '', entityType: '' },
};

let view = new URLSearchParams(location.search).get('view') || 'dashboard';

/* Categories are read by several tabs (filters, the product form, PO lines),
   so they are fetched once per navigation and refreshed after a category edit. */
let cachedCategories = null;
async function categories() {
  if (!cachedCategories) {
    cachedCategories = (await AV.api.get('/api/admin/categories')).data.items || [];
  }
  return cachedCategories;
}

/* C.error fills an element rather than returning markup, so it is pointed at a
   detached node whose HTML is then adopted into the pane. */
const fail = (pane, err) => {
  const holder = document.createElement('div');
  C.error(holder, err, { retry: () => route(pane), level: 'h2' });
  pane.innerHTML = holder.innerHTML;
  pane.querySelector('[data-retry]')?.addEventListener('click', () => route(pane));
};

/* ── Shared presentation ──────────────────────────────────────── */

const thumb = (p) =>
  p.images && p.images[0]
    ? `<img class="adm-thumb" src="${AV.esc(p.images[0])}" alt="" loading="lazy">`
    : `<span class="adm-thumb adm-thumb-blank" aria-hidden="true"></span>`;

const pill = (text, cls) => `<span class="pill ${cls}">${AV.esc(label(text))}</span>`;

const statusPill = (status) => {
  const cls = { active: 'pill-ok', draft: 'pill-muted', archived: 'pill-bad', in: 'pill-ok', low: 'pill-warn', out: 'pill-bad', untracked: 'pill-muted' }[status] || '';
  return pill(status, cls);
};

/* "4 units · In stock" or "Untracked". The number is the server's, the word is
   a mapping of the server's stockState — nothing is recomputed here. */
const stockCell = (p) =>
  p.stock == null
    ? statusPill('untracked')
    : `${AV.esc(String(p.stock))} ${pill(p.stockState, { in: 'pill-ok', low: 'pill-warn', out: 'pill-bad' }[p.stockState] || '')}`;

const valueCell = (p) => {
  if (p.stock == null) return '—';
  if (p.costPrice == null) return '<span class="muted">no cost price</span>';
  return AV.formatPrice(p.stock * p.costPrice);
};

function pager(meta, key, reload) {
  if (!meta || !meta.totalPages || meta.totalPages <= 1) return '';
  const { page, totalPages, total } = meta;
  return `<div class="adm-pager">
    <button class="btn btn-ghost btn-sm" type="button" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>← Previous</button>
    <span class="muted">Page ${page} of ${totalPages} · ${total} total</span>
    <button class="btn btn-ghost btn-sm" type="button" data-page="${page + 1}"${page >= totalPages ? ' disabled' : ''}>Next →</button>
  </div>`;
}

function wirePager(pane, key, reload) {
  AV.qsa('[data-page]', pane).forEach((b) =>
    b.addEventListener('click', () => {
      if (b.disabled) return;
      state[key].page = Number(b.dataset.page);
      reload();
    })
  );
}

/* A toolbar form whose selects and checkboxes apply themselves the moment they
   change — a filter that needs an Apply click is a filter people forget to
   press. The form submit still exists for the search box (Enter). */
function wireToolbar(pane, onApply) {
  const bar = AV.qs('[data-toolbar]', pane);
  if (!bar) return;
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    onApply(new FormData(bar));
  });
  AV.qsa('select, input[type="checkbox"]', bar).forEach((el) =>
    el.addEventListener('change', () => onApply(new FormData(bar)))
  );
}

/* One shared dialog element; every view opens its own content in it. Esc and
   the Close button both just close, and nothing is left wired to a stale body
   because each open rebuilds the markup from scratch. */
function dialog(title) {
  const dlg = AV.qs('#admDialog') || (() => {
    const d = document.createElement('dialog');
    d.id = 'admDialog';
    d.className = 'adm-dialog';
    document.body.appendChild(d);
    return d;
  })();
  dlg.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'adm-dlg-head';
  head.innerHTML = `<h2 style="font:400 var(--text-h2) var(--font-display);margin:0">${AV.esc(title)}</h2>
    <button class="btn btn-ghost btn-sm" type="button" data-close>Close</button>`;
  dlg.appendChild(head);
  const body = document.createElement('div');
  dlg.appendChild(body);
  head.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  if (!dlg.open) dlg.showModal();
  return { dlg, body };
}

/* A labelled field for the .adm-form grid. `wide` spans both columns. */
const field = (labelText, inner, { wide = false, hint = '' } = {}) =>
  `<label class="${wide ? 'wide' : ''}">${AV.esc(labelText)}${hint ? ` <span class="adm-hint">${AV.esc(hint)}</span>` : ''}${inner}</label>`;

const input = (name, attrs = '') => `<input name="${name}" ${attrs}>`;

/* Submit handlers share one shape: busy state, server call, toast or inline
   message, then a reload of whatever list the dialog belongs to. */
function onSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const msg = form.querySelector('.form-msg');
    if (btn) AV.setBusy(btn, true);
    try {
      await fn(form);
    } catch (err) {
      if (msg) C.say(msg, AV.firstErr(err), false);
      else AV.toast(AV.firstErr(err), 'err');
    } finally {
      if (btn) AV.setBusy(btn, false);
    }
  });
}

async function init() {
  const user = await AV.me();
  if (!user || user.role !== 'admin') {
    AV.seo({ title: 'Restricted', description: 'Internal dashboard.', noindex: true });
    root.innerHTML = `<div class="gate">
      <div class="eyebrow">Restricted</div>
      <h2>This desk is<br>for staff only.</h2>
      <p class="lead" style="margin:16px auto 30px">You need an administrator account to open the admin desk.</p>
      <a class="btn btn-light" href="/account.html">Back to account</a>
      <div style="margin-top:10px"><a class="btn btn-ghost" href="/home.html">Home</a></div>
    </div>`;
    return;
  }
  view = TABS.some(([k]) => k === view) ? view : 'dashboard';
  root.innerHTML = `<div class="adm-shell">
    <aside class="adm-side">
      <div class="adm-brand"><strong>Astro Vetro</strong><span>Studio</span></div>
      <nav id="admTabs" aria-label="Studio sections">${TABS.map(
        ([k, l]) => `<button class="adm-tab${k === view ? ' active' : ''}" data-view="${k}">${l}</button>`
      ).join('')}</nav>
    </aside>
    <div class="adm-main" id="admPane"></div>
  </div>`;
  const pane = AV.qs('#admPane');
  AV.qs('#admTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    history.replaceState(null, '', `/admin.html?view=${view}`);
    AV.qsa('.adm-tab').forEach((x) => x.classList.toggle('active', x === b));
    route(pane);
  });
  route(pane);
}

const VIEWS = {
  dashboard,
  orders,
  products,
  inventory,
  movements,
  categories: categoriesView,
  collections,
  rituals,
  suppliers,
  purchaseOrders,
  images: imageLibrary,
  blog,
  content,
  reports,
  users,
  audit,
  settings,
};

async function route(pane) {
  pane.innerHTML = '<div class="empty">Loading…</div>';
  pane.onclick = null; /* drop any delegated handler a previous view attached */
  try {
    await VIEWS[view](pane);
  } catch (e) {
    fail(pane, e);
  }
}

/* ── Overview ─────────────────────────────────────────────────── */
/* Three sources: the order dashboard, the inventory dashboard and the audit
   trail. Every figure printed here is a field one of those endpoints returned;
   no count is assembled client-side, because a number this page cannot trace
   to a query is a number it cannot stand behind. */
async function dashboard(pane) {
  C.skeleton(pane, 4);
  try {
    const [orders, inv, audit] = await Promise.all([
      AV.api.get('/api/admin/dashboard'),
      AV.api.get('/api/admin/inventory/dashboard'),
      AV.api.get('/api/admin/audit?limit=6'),
    ]);
    const s = orders.data;
    const d = inv.data;
    const st = d.stockStates || {};
    const tracked = (st.in?.count || 0) + (st.low?.count || 0) + (st.out?.count || 0);
    const units = (st.in?.units || 0) + (st.low?.units || 0) + (st.out?.units || 0);
    const byStatus = s.byStatus || {};
    const orderRows = ORDER_STATUSES.filter((k) => byStatus[k]).map(
      (k) => `<div class="row"><span>${AV.esc(label(k))}</span><span>${byStatus[k]}</span></div>`
    );
    const stateRows = ['in', 'low', 'out', 'untracked']
      .filter((k) => st[k])
      .map(
        (k) =>
          `<div class="row"><span>${AV.esc(label(k))}</span><span>${st[k].count} ${st[k].count === 1 ? 'item' : 'items'}${st[k].units != null ? ` · ${st[k].units} units` : ''}</span></div>`
      );
    const recentMoves = (d.recentMovements || []).slice(0, 6);
    const recentAudit = (audit.data.items || []).slice(0, 6);

    pane.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="n">${s.total}</div><div class="l">Orders</div></div>
        <div class="stat-card"><div class="n">${s.unpaid}</div><div class="l">Awaiting payment</div></div>
        <div class="stat-card"><div class="n">${d.catalogue?.active ?? '—'}</div><div class="l">Products (active)</div></div>
        <div class="stat-card"><div class="n">${tracked}</div><div class="l">Items tracked</div></div>
        <div class="stat-card"><div class="n">${units}</div><div class="l">Units on hand</div></div>
        <div class="stat-card"><div class="n">${st.low?.count ?? 0}</div><div class="l">Low stock items</div></div>
        <div class="stat-card"><div class="n">${st.out?.count ?? 0}</div><div class="l">Out of stock</div></div>
        <div class="stat-card"><div class="n">${d.catalogue?.needsReview ?? 0}</div><div class="l">Awaiting photo review</div></div>
        <div class="stat-card"><div class="n">${AV.formatPrice(d.valuation?.totalCostValue || 0)}</div><div class="l">Stock value (cost)</div></div>
      </div>

      <div class="adm-two">
        <section>
          <h3>Orders by status</h3>
          ${orderRows.length ? `<div class="order-totals">${orderRows.join('')}</div>` : '<p class="note">No orders yet.</p>'}
        </section>
        <section>
          <h3>Inventory by state</h3>
          <div class="order-totals">${stateRows.join('')}</div>
          <p class="note">${d.valuation?.valuedProducts ?? 0} items costed · ${d.valuation?.uncostedProducts ?? 0} without a cost price.</p>
        </section>
      </div>

      <div class="adm-two">
        <section>
          <h3>Recent stock movements</h3>
          ${recentMoves.length
            ? `<div class="order-totals">${recentMoves
                .map(
                  (m) => `<div class="row"><span>${AV.esc(m.productName || 'Product')} · ${AV.esc(label(m.type))}</span><span>${m.quantity > 0 ? '+' : ''}${m.quantity} → ${m.balanceAfter}</span></div>`
                )
                .join('')}</div>
            <p class="note"><a href="/admin.html?view=movements">Open the stock movement ledger →</a></p>`
            : '<p class="note">No movements recorded yet.</p>'}
        </section>
        <section>
          <h3>Recent activity</h3>
          ${recentAudit.length
            ? `<div class="order-totals">${recentAudit
                .map(
                  (a) => `<div class="row"><span>${AV.esc(a.summary || a.action)}</span><span class="muted">${AV.formatDate(a.createdAt)}</span></div>`
                )
                .join('')}</div>
            <p class="note"><a href="/admin.html?view=audit">Open the audit log →</a></p>`
            : '<p class="note">Nothing recorded yet.</p>'}
        </section>
      </div>

      <div class="notice" style="margin-top:26px">Work through the tabs: fulfil orders on <b>Orders</b>, adjust counts on <b>Inventory</b>, receive supplier deliveries on <b>Purchase Orders</b>. Every stock change lands in the ledger on <b>Stock Movements</b>.</div>`;
  } catch (e) {
    fail(pane, e);
  }
}

/* ── Orders ───────────────────────────────────────────────────── */
/* Every row is keyed by the order's own id, never its order number: the status
   and shipment endpoints both take an id, and the number is display text. */
function orderRow(o) {
  return `
    <tr>
      <td><a href="/orders/${encodeURIComponent(o.orderNumber)}">${AV.esc(o.orderNumber)}</a>
        <div class="muted">${AV.formatDate(o.createdAt)}</div></td>
      <td>${AV.esc(o.customerEmail || '—')}</td>
      <td>${AV.formatPrice(o.total)}<div class="muted">${AV.esc(label(o.paymentMethod))}</div></td>
      <td>${C.statusBadge(o.status)}</td>
      <td>${C.statusBadge(o.paymentStatus)}</td>
      <td class="adm-actions"><button class="btn btn-ghost btn-sm" data-manage="${AV.esc(o.id)}">Manage</button></td>
    </tr>`;
}

async function orders(pane) {
  C.skeleton(pane, 4);
  try {
    const env = await AV.api.get(`/api/admin/orders?page=${state.orders.page}&limit=50`);
    const list = env.data?.orders || [];
    /* GET /orders is the one endpoint that keeps its pagination envelope at the
       top level rather than inside data — accept either shape. */
    const meta = env.meta || env.data?.meta;
    pane.innerHTML = list.length
      ? `${`<div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Payment</th><th></th></tr></thead>
        <tbody>${list.map(orderRow).join('')}</tbody></table></div>`}${pager(meta, 'orders', () => orders(pane))}`
      : '<div class="empty">No orders yet.</div>';

    pane.querySelector('tbody')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-manage]');
      if (!btn) return;
      manageOrder(btn.dataset.manage);
    });
    wirePager(pane, 'orders', () => orders(pane));
  } catch (e) {
    fail(pane, e);
  }
}

/* One order at a time: its legal next states, and — once it is on its way — the
   tracking details the customer will see. */
async function manageOrder(orderId) {
  const { body } = dialog('Order');
  C.loading(body, 'Loading this order…');

  let data;
  try {
    data = (await AV.api.get(`/api/admin/orders/${encodeURIComponent(orderId)}`)).data;
  } catch (err) {
    C.error(body, err, { retry: () => manageOrder(orderId), level: 'h2' });
    return;
  }

  const o = data.order;
  AV.qs('#admDialog h2').textContent = o.orderNumber;
  const moves = (TRANSITIONS[o.status] || []).map(
    (s) => `<option value="${s}"${s === o.status ? ' selected' : ''}>${AV.esc(label(s))}</option>`
  );

  body.innerHTML = `
    <p class="note">${AV.esc(o.customerEmail)} · ${C.statusBadge(o.status)} · ${C.statusBadge(o.paymentStatus)}</p>

    <h3 style="margin:24px 0 8px">Move this order on</h3>
    ${moves.length
      ? `<form id="statusForm" class="form-narrow">
          <label>New status<select name="status">${moves.join('')}</select></label>
          <label>Note <span style="color:var(--text-muted);text-transform:none;letter-spacing:0">(optional, shown on delivery)</span>
            <input name="note" maxlength="300"></label>
          <button class="btn btn-light btn-sm" type="submit">Update status</button>
          <p class="form-msg"></p>
        </form>`
      : `<p class="note">This order is ${AV.esc(label(o.status))}, which is a final state. There is nothing further to change.</p>`}

    <h3 style="margin:28px 0 8px">Tracking</h3>
    ${data.tracking ? shipmentBlock(data.tracking) : `
      <form id="shipForm" class="form-narrow">
        <label>Carrier<input name="carrier" required placeholder="Delhivery"></label>
        <label>Tracking number<input name="trackingNumber" required></label>
        <label>Tracking link <span style="color:var(--text-muted);text-transform:none;letter-spacing:0">(optional)</span>
          <input name="trackingUrl" type="url"></label>
        <label>Estimated delivery <span style="color:var(--text-muted);text-transform:none;letter-spacing:0">(optional)</span>
          <input name="estimatedDelivery" type="date"></label>
        <button class="btn btn-light btn-sm" type="submit">Attach tracking</button>
        <p class="form-msg"></p>
      </form>
      <p class="note">Attaching a tracking number is what makes the customer's tracking page show a timeline.</p>`}

    ${data.tracking ? eventForm(data.tracking) : ''}`;

  AV.qs('#statusForm', body)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const msg = e.target.querySelector('.form-msg');
    try {
      await AV.api.patch(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
        status: f.status.value,
        note: f.note.value.trim() || undefined,
      });
      AV.toast('Order status updated.', 'ok');
      AV.qs('#admDialog').close();
      orders(AV.qs('#admPane'));
    } catch (err) {
      C.say(msg, AV.firstErr(err), false);
    }
  });

  AV.qs('#shipForm', body)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const msg = e.target.querySelector('.form-msg');
    try {
      await AV.api.post(`/api/admin/orders/${encodeURIComponent(orderId)}/shipment`, {
        carrier: f.carrier.value.trim(),
        trackingNumber: f.trackingNumber.value.trim(),
        trackingUrl: f.trackingUrl.value.trim() || undefined,
        /* Sent as midnight UTC so the date the admin picked is the date stored,
           rather than being shifted by a timezone on the way in. */
        estimatedDelivery: f.estimatedDelivery.value ? new Date(`${f.estimatedDelivery.value}T00:00:00Z`).toISOString() : undefined,
      });
      AV.toast('Tracking attached.', 'ok');
      AV.qs('#admDialog').close();
      orders(AV.qs('#admPane'));
    } catch (err) {
      C.say(msg, AV.firstErr(err), false);
    }
  });

  AV.qs('#eventForm', body)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const msg = e.target.querySelector('.form-msg');
    try {
      await AV.api.post(`/api/admin/orders/${encodeURIComponent(orderId)}/tracking-events`, {
        status: f.status.value,
        title: f.title.value.trim(),
        description: f.description.value.trim() || undefined,
        location: f.location.value.trim() || undefined,
      });
      AV.toast('Tracking event added.', 'ok');
      manageOrder(orderId);
    } catch (err) {
      C.say(msg, AV.firstErr(err), false);
    }
  });
}

const shipmentBlock = (t) => `
  <p class="note">${AV.esc(t.carrier)} · ${AV.esc(t.trackingNumber)} ${C.statusBadge(t.status)}</p>
  ${t.events?.length
    ? `<ol class="track-list">${t.events.map((ev) => `
        <li><strong>${AV.esc(ev.title)}</strong>
          <div class="muted">${AV.formatDate(ev.occurredAt)}</div>
          ${ev.description ? `<div>${AV.esc(ev.description)}</div>` : ''}</li>`).join('')}</ol>`
    : '<p class="note">No events recorded yet.</p>'}`;

const eventForm = (t) => `
  <form id="eventForm" class="form-narrow" style="margin-top:18px">
    <label>Event<select name="status">${SHIPMENT_STATUSES.map(
      (s) => `<option value="${s}"${s === t.status ? ' selected' : ''}>${AV.esc(label(s))}</option>`
    ).join('')}</select></label>
    <label>Title<input name="title" required placeholder="Picked up from the studio"></label>
    <label>Description <span style="color:var(--text-muted);text-transform:none;letter-spacing:0">(optional)</span>
      <input name="description" maxlength="400"></label>
    <label>Location <span style="color:var(--text-muted);text-transform:none;letter-spacing:0">(optional)</span>
      <input name="location" maxlength="120"></label>
    <button class="btn btn-light btn-sm" type="submit">Add event</button>
    <p class="form-msg"></p>
  </form>`;

/* ── Products ─────────────────────────────────────────────────── */
/* GET/POST/PATCH /api/admin/products plus archive/restore. The list carries the
   pagination envelope inside data, next to the categories used by the filter. */
async function products(pane) {
  C.skeleton(pane, 5);
  try {
    const s = state.products;
    const qs = new URLSearchParams({
      page: String(s.page),
      limit: '50',
      sort: s.sort,
      order: s.order,
      includeCategories: 'true',
    });
    if (s.search) qs.set('search', s.search);
    if (s.status) qs.set('status', s.status);
    if (s.category) qs.set('category', s.category);
    if (s.needsReview) qs.set('needsReview', 'true');

    const env = await AV.api.get(`/api/admin/products?${qs}`);
    const items = env.data.items || [];
    const meta = env.data.meta;
    const cats = env.data.categories || [];

    pane.innerHTML = `
      <form class="adm-toolbar" data-toolbar>
        <input type="search" name="search" placeholder="Search name, SKU or slug" value="${AV.esc(s.search)}" aria-label="Search products">
        <select name="status" aria-label="Status">
          <option value="">Any status</option>
          ${['draft', 'active', 'archived'].map((v) => `<option value="${v}"${s.status === v ? ' selected' : ''}>${label(v)}</option>`).join('')}
        </select>
        <select name="category" aria-label="Category">
          <option value="">Any category</option>
          ${cats.map((c) => `<option value="${AV.esc(c.slug)}"${s.category === c.slug ? ' selected' : ''}>${AV.esc(c.name)}${c.active ? '' : ' (hidden)'}</option>`).join('')}
        </select>
        <label class="adm-check"><input type="checkbox" name="needsReview"${s.needsReview ? ' checked' : ''}> Needs photo review</label>
        <select name="sort" aria-label="Sort by">
          ${[['updatedAt', 'Recently updated'], ['name', 'Name'], ['price', 'Price'], ['stock', 'Stock']].map(
            ([v, l]) => `<option value="${v}"${s.sort === v ? ' selected' : ''}>${l}</option>`
          ).join('')}
        </select>
        <select name="order" aria-label="Sort direction">
          <option value="desc"${s.order === 'desc' ? ' selected' : ''}>Descending</option>
          <option value="asc"${s.order === 'asc' ? ' selected' : ''}>Ascending</option>
        </select>
        <span class="spacer"></span>
        <button class="btn btn-light btn-sm" type="button" data-new>+ New product</button>
      </form>

      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Status</th><th>Price</th><th>Stock</th><th>Photos</th><th></th></tr></thead>
          <tbody>${items
            .map(
              (p) => `<tr>
                <td><div class="adm-cell">${thumb(p)}<div>
                  <a href="/product.html?slug=${encodeURIComponent(p.slug)}">${AV.esc(p.name)}</a>
                  <div class="muted">${AV.esc(p.slug)}${p.needsReview ? ` · ${pill('needs review', 'pill-warn')}` : ''}</div>
                </div></div></td>
                <td>${AV.esc(fmt(p.sku))}</td>
                <td>${AV.esc(fmt(p.category))}</td>
                <td>${statusPill(p.status)}</td>
                <td>${p.salePrice != null ? `${AV.formatPrice(p.salePrice)} <span class="muted"><s>${AV.formatPrice(p.price)}</s></span>` : AV.formatPrice(p.price)}</td>
                <td>${stockCell(p)}</td>
                <td>${(p.images || []).length}</td>
                <td class="adm-actions">
                  <button class="btn btn-ghost btn-sm" data-edit="${AV.esc(p.id)}">Edit</button>
                  <button class="btn btn-ghost btn-sm" data-images="${AV.esc(p.id)}">Images</button>
                  <button class="btn btn-ghost btn-sm" data-archive="${AV.esc(p.id)}" data-name="${AV.esc(p.name)}" data-state="${p.status}">${p.status === 'archived' ? 'Restore' : 'Archive'}</button>
                  <button class="btn btn-ghost btn-sm" data-delete="${AV.esc(p.id)}" data-name="${AV.esc(p.name)}">Delete</button>
                </td>
              </tr>`
            )
            .join('')}</tbody></table></div>${pager(meta, 'products', () => products(pane))}`
        : '<div class="empty">No products match this filter.</div>'}`;

    wireToolbar(pane, (fd) => {
      state.products = {
        ...state.products,
        page: 1,
        search: String(fd.get('search') || '').trim(),
        status: String(fd.get('status') || ''),
        category: String(fd.get('category') || ''),
        needsReview: fd.get('needsReview') === 'on',
        sort: String(fd.get('sort') || 'updatedAt'),
        order: String(fd.get('order') || 'desc'),
      };
      products(pane);
    });
    wirePager(pane, 'products', () => products(pane));

    AV.qs('[data-new]', pane)?.addEventListener('click', () => productForm(null, pane));
    pane.querySelector('tbody')?.addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return productForm(edit.dataset.edit, pane);
      const imgs = e.target.closest('[data-images]');
      if (imgs) return imagesDialog(imgs.dataset.images, pane);
      const arch = e.target.closest('[data-archive]');
      if (arch) return archiveProduct(arch, pane);
      const del = e.target.closest('[data-delete]');
      if (del) return deleteProduct(del, pane);
    });
  } catch (e) {
    fail(pane, e);
  }
}

async function deleteProduct(btn, pane) {
  const sure = confirm(
    `Permanently delete “${btn.dataset.name}”? This cannot be undone. Products that appear in an order are protected and must be archived instead.`
  );
  if (!sure) return;
  AV.setBusy(btn, true);
  try {
    await AV.api.del(`/api/admin/products/${encodeURIComponent(btn.dataset.delete)}`);
    AV.toast('Product deleted.', 'ok');
    products(pane);
  } catch (err) {
    AV.toast(AV.firstErr(err), 'err');
    AV.setBusy(btn, false);
  }
}

async function archiveProduct(btn, pane) {
  const id = btn.dataset.archive;
  const name = btn.dataset.name;
  const restoring = btn.dataset.state === 'archived';
  const sure = confirm(
    restoring
      ? `Restore “${name}” to the shop?`
      : `Archive “${name}”? It disappears from the shop and its public page stops resolving. Stock and history are kept.`
  );
  if (!sure) return;
  AV.setBusy(btn, true);
  try {
    await AV.api.post(`/api/admin/products/${encodeURIComponent(id)}/${restoring ? 'restore' : 'archive'}`);
    AV.toast(restoring ? 'Product restored.' : 'Product archived.', 'ok');
    products(pane);
  } catch (err) {
    AV.toast(AV.firstErr(err), 'err');
    AV.setBusy(btn, false);
  }
}

/* Create or edit. Empty optional numbers are sent as null (clear the field),
   empty strings as undefined (leave the server's value alone on PATCH). */
async function productForm(productId, pane) {
  const editing = Boolean(productId);
  const { body } = dialog(editing ? 'Edit product' : 'New product');
  C.loading(body, 'Loading…');

  let p = null;
  let cats = [];
  try {
    if (editing) p = (await AV.api.get(`/api/admin/products/${encodeURIComponent(productId)}`)).data.product;
    cats = await categories();
  } catch (err) {
    C.error(body, err, { retry: () => productForm(productId, pane), level: 'h2' });
    return;
  }

  body.innerHTML = `
    <p class="note">${editing ? 'Edits show on the shop straight away.' : 'New products start as drafts — publish them from the Status field when the photos are ready.'}</p>
    <form id="productForm" class="adm-form">
      ${field('Name', input('name', `required maxlength="160" value="${AV.esc(p?.name || '')}"`))}
      ${field('Slug', input('slug', `maxlength="120" placeholder="derived from the name"${p ? ` value="${AV.esc(p.slug)}"` : ''}`))}
      ${field('SKU', input('sku', `maxlength="80" placeholder="derived from the slug"${p ? ` value="${AV.esc(p.sku || '')}"` : ''}`))}
      ${field('Category', `${input('category', `required maxlength="80" list="catList" value="${AV.esc(p?.category || '')}"`)}<datalist id="catList">${cats.map((c) => `<option value="${AV.esc(c.name)}"></option>`).join('')}</datalist>`)}
      ${field('Price (₹)', input('price', `type="number" min="0" step="0.01" required value="${p ? p.price : ''}"`))}
      ${field('Sale price (₹)', input('salePrice', `type="number" min="0" step="0.01" placeholder="none" value="${p?.salePrice ?? ''}"`))}
      ${field('Cost price (₹)', input('costPrice', `type="number" min="0" step="0.01" placeholder="for stock valuation" value="${p?.costPrice ?? ''}"`))}
      ${field('Status', `<select name="status">${['draft', 'active', 'archived'].map(
        (v) => `<option value="${v}"${(p?.status || 'draft') === v ? ' selected' : ''}>${label(v)}</option>`
      ).join('')}</select>`)}
      ${field('Stone', input('stone', `maxlength="120" value="${AV.esc(p?.stone || '')}"`))}
      ${field('Metal', input('metal', `maxlength="120" value="${AV.esc(p?.metal || '')}"`))}
      ${field('Product type', `<select name="productType">${[['crystal', 'Crystal'], ['jewellery', 'Jewellery'], ['tarot', 'Tarot'], ['object', 'Object'], ['other', 'Other']].map(([v, l]) => `<option value="${v}"${(p?.productType || 'other') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${field('Tags', input('tags', `maxlength="300" placeholder="comma separated" value="${AV.esc((p?.tags || []).join(', '))}"`))}
      ${field('SEO title', input('seoTitle', `maxlength="70" placeholder="defaults to the product name" value="${AV.esc(p?.seoTitle || '')}"`))}
      ${field('SEO description', `<textarea name="seoDescription" rows="2" maxlength="170" placeholder="defaults to the short description">${AV.esc(p?.seoDescription || '')}</textarea>`, { wide: true })}
      ${field('Low-stock threshold', input('reorderThreshold', `type="number" min="0" step="1" placeholder="default 3" value="${p?.reorderThreshold ?? ''}"`))}
      ${field('Reorder quantity', input('reorderQuantity', `type="number" min="0" step="1" placeholder="not used yet" value="${p?.reorderQuantity ?? ''}"`))}
      ${field('Short description', `<textarea name="shortDescription" rows="2" maxlength="500">${AV.esc(p?.shortDescription || '')}</textarea>`, { wide: true })}
      ${field('Description', `<textarea name="description" rows="5" maxlength="4000">${AV.esc(p?.description || '')}</textarea>`, { wide: true })}
      ${field('Photo mapping note', `<textarea name="reviewNote" rows="2" maxlength="500" placeholder="why this product's photos need a second look">${AV.esc(p?.reviewNote || '')}</textarea>`, { wide: true })}
      <label class="adm-check"><input type="checkbox" name="featured"${p?.featured ? ' checked' : ''}> Featured on the shop</label>
      <label class="adm-check"><input type="checkbox" name="availability"${p ? (p.availability ? ' checked' : '') : ' checked'}> Available to buy</label>
      <label class="adm-check"><input type="checkbox" name="needsReview"${p?.needsReview ? ' checked' : ''}> Photos still need review</label>
      <button class="btn btn-light" type="submit">${editing ? 'Save changes' : 'Create product'}</button>
      <p class="form-msg"></p>
    </form>
    ${editing
      ? `<p class="note" style="margin-top:14px">Stock is managed on the <a href="/admin.html?view=inventory">Inventory tab</a> with counted, ledgered adjustments — not from this form.</p>`
      : ''}`;

  const form = AV.qs('#productForm', body);
  const num = (v) => (v.trim() === '' ? null : Number(v));
  onSubmit(form, async (f) => {
    const el = f.elements;
    const payload = {
      name: el.name.value.trim(),
      slug: el.slug.value.trim() || undefined,
      sku: el.sku.value.trim() || undefined,
      category: el.category.value.trim(),
      price: Number(el.price.value),
      salePrice: num(el.salePrice.value),
      costPrice: num(el.costPrice.value),
      stone: el.stone.value.trim(),
      metal: el.metal.value.trim(),
      productType: el.productType.value,
      tags: el.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
      seoTitle: el.seoTitle.value.trim(),
      seoDescription: el.seoDescription.value.trim(),
      featured: el.featured.checked,
      availability: el.availability.checked,
      status: el.status.value,
      needsReview: el.needsReview.checked,
      reviewNote: el.reviewNote.value.trim(),
      reorderThreshold: num(el.reorderThreshold.value),
      reorderQuantity: num(el.reorderQuantity.value),
      shortDescription: el.shortDescription.value.trim(),
      description: el.description.value.trim(),
    };
    if (editing) {
      await AV.api.patch(`/api/admin/products/${encodeURIComponent(productId)}`, payload);
      AV.toast('Product updated.', 'ok');
    } else {
      const created = await AV.api.post('/api/admin/products', payload);
      AV.toast(`Product created (${created.data.product.sku}). Record its first stock count on the Inventory tab.`, 'ok');
    }
    AV.qs('#admDialog').close();
    products(pane);
  });
}

/* Reorder, re-alt, replace, remove and upload — all through the images API, with
   the primary photo simply being index 0 (that is what the shop shows first). */
async function imagesDialog(productId, pane) {
  const { body } = dialog('Product images');
  C.loading(body, 'Loading…');

  let p;
  let lib;
  try {
    [p, lib] = await Promise.all([
      AV.api.get(`/api/admin/products/${encodeURIComponent(productId)}`),
      AV.api.get('/api/admin/images/library'),
    ]);
    p = p.data.product;
    lib = lib.data;
  } catch (err) {
    C.error(body, err, { retry: () => imagesDialog(productId, pane), level: 'h2' });
    return;
  }

  const imgs = [...(p.images || [])];
  const alts = [...(p.imageAlts || [])];
  while (alts.length < imgs.length) alts.push('');
  const MAX = 24;

  const options = [...(lib.unassigned || []), ...(lib.library || []).filter((i) => !(lib.unassigned || []).some((u) => u.base === i.base))]
    .map((item) => {
      const large = item.files.find((f) => f.includes('-large')) || item.files[0];
      const taken = (item.assignedTo || []).length > 0;
      return `<option value="${AV.esc(large)}">${AV.esc(item.base)}${taken ? ' (used elsewhere)' : ''}</option>`;
    })
    .join('');

  const render = () => {
    body.innerHTML = `
      <p class="note">Photo 1 is the primary image — the one the shop card and the top of the product page show. Drag-free reordering uses the arrows; alt text is what a screen reader announces.</p>
      ${imgs.length
        ? `<ol class="adm-imglist">${imgs
            .map(
              (src, i) => `<li>
              <img src="${AV.esc(src)}" alt="">
              <div class="adm-imgmeta">
                <input data-alt="${i}" maxlength="500" value="${AV.esc(alts[i] || '')}" placeholder="alt text" aria-label="Alt text for photo ${i + 1}">
                <div class="adm-actions">
                  ${i === 0 ? '<span class="pill pill-ok">Primary</span>' : `<button class="btn btn-ghost btn-sm" type="button" data-primary="${i}">Make primary</button>`}
                  <button class="btn btn-ghost btn-sm" type="button" data-up="${i}"${i === 0 ? ' disabled' : ''} aria-label="Move photo ${i + 1} up">↑</button>
                  <button class="btn btn-ghost btn-sm" type="button" data-down="${i}"${i === imgs.length - 1 ? ' disabled' : ''} aria-label="Move photo ${i + 1} down">↓</button>
                  <button class="btn btn-ghost btn-sm" type="button" data-remove="${i}">Remove</button>
                </div>
              </div>
            </li>`
            )
            .join('')}</ol>`
        : '<div class="empty" style="padding:22px">No photos yet — this product is showing the gradient art on the shop.</div>'}

      <div class="adm-toolbar" style="margin-top:18px">
        <select id="libPick" aria-label="Choose a file from the image library"${options ? '' : ' disabled'}>
          ${options || '<option>No library files</option>'}
        </select>
        <button class="btn btn-ghost btn-sm" type="button" id="libAdd"${imgs.length >= MAX ? ' disabled' : ''}>Add from library</button>
        <label class="btn btn-ghost btn-sm adm-filebtn">Upload a photo<input type="file" id="libFile" accept="image/jpeg,image/png,image/webp" hidden></label>
        <span class="muted">${imgs.length} / ${MAX}</span>
      </div>
      <div class="form-msg"></div>
      <div class="adm-actions" style="margin-top:14px">
        <button class="btn btn-light btn-sm" type="button" id="imgSave">Save changes</button>
      </div>`;

    const msg = AV.qs('.form-msg', body);
    const save = async (nextImgs, nextAlts) => {
      try {
        await AV.api.put(`/api/admin/products/${encodeURIComponent(productId)}/images`, {
          images: nextImgs,
          imageAlts: nextAlts.slice(0, nextImgs.length),
        });
        AV.toast('Images saved.', 'ok');
        imagesDialog(productId, pane);
        products(pane);
      } catch (err) {
        C.say(msg, AV.firstErr(err), false);
      }
    };

    AV.qs('#imgSave', body)?.addEventListener('click', () => {
      AV.qsa('[data-alt]', body).forEach((el) => {
        alts[Number(el.dataset.alt)] = el.value;
      });
      save(imgs, alts);
    });
    AV.qsa('[data-up]', body).forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.up);
        [imgs[i - 1], imgs[i]] = [imgs[i], imgs[i - 1]];
        [alts[i - 1], alts[i]] = [alts[i], alts[i - 1]];
        save(imgs, alts);
      })
    );
    AV.qsa('[data-down]', body).forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.down);
        [imgs[i + 1], imgs[i]] = [imgs[i], imgs[i + 1]];
        [alts[i + 1], alts[i]] = [alts[i], alts[i + 1]];
        save(imgs, alts);
      })
    );
    AV.qsa('[data-primary]', body).forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.primary);
        imgs.unshift(imgs.splice(i, 1)[0]);
        alts.unshift(alts.splice(i, 1)[0]);
        save(imgs, alts);
      })
    );
    AV.qsa('[data-remove]', body).forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.remove);
        imgs.splice(i, 1);
        alts.splice(i, 1);
        save(imgs, alts);
      })
    );
    AV.qs('#libAdd', body)?.addEventListener('click', () => {
      const pick = AV.qs('#libPick', body);
      if (!pick || imgs.includes(pick.value)) return;
      imgs.push(pick.value);
      alts.push(`${p.name} — photo ${imgs.length}`);
      save(imgs, alts);
    });
    AV.qs('#libFile', body)?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) return C.say(msg, 'That file is larger than the 12 MB upload limit.', false);
      try {
        const up = await fetch('/api/admin/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'image/jpeg' },
          credentials: 'include',
          body: file,
        });
        const json = await up.json().catch(() => null);
        if (!up.ok || !json?.success) throw new Error(json?.error?.message || `Upload failed (${up.status})`);
        imgs.push(json.data.image.large);
        alts.push(`${p.name} — photo ${imgs.length}`);
        await save(imgs, alts);
      } catch (err) {
        C.say(msg, AV.firstErr(err), false);
      }
    });
  };

  render();
}

/* ── Inventory ────────────────────────────────────────────────── */
/* The real inventory table: GET /api/admin/inventory/table. Counts change only
   through the ledger endpoints (adjust / untrack), never through a stock field
   on the product itself. */
async function inventory(pane) {
  C.skeleton(pane, 5);
  try {
    const s = state.inventory;
    const qs = new URLSearchParams({
      page: String(s.page),
      limit: '50',
      sort: s.sort,
      order: s.order,
    });
    if (s.search) qs.set('search', s.search);
    if (s.category) qs.set('category', s.category);
    if (s.stockState) qs.set('stockState', s.stockState);

    const [env, cats] = await Promise.all([
      AV.api.get(`/api/admin/inventory/table?${qs}`),
      categories(),
    ]);
    const items = env.data.items || [];
    const meta = env.data.meta;

    pane.innerHTML = `
      <p class="note" style="margin-bottom:14px">Every change here is a ledger entry with a reason — see <a href="/admin.html?view=movements">Stock Movements</a>. The low-stock threshold defaults to 3 when a product has none. Reserved quantities are not part of this system: stock decrements at payment, so on hand equals available.</p>
      <form class="adm-toolbar" data-toolbar>
        <input type="search" name="search" placeholder="Search name, SKU or slug" value="${AV.esc(s.search)}" aria-label="Search inventory">
        <select name="stockState" aria-label="Stock state">
          <option value="">Any state</option>
          ${['in', 'low', 'out', 'untracked'].map((v) => `<option value="${v}"${s.stockState === v ? ' selected' : ''}>${label(v)}</option>`).join('')}
        </select>
        <select name="category" aria-label="Category">
          <option value="">Any category</option>
          ${cats.map((c) => `<option value="${AV.esc(c.slug)}"${s.category === c.slug ? ' selected' : ''}>${AV.esc(c.name)}</option>`).join('')}
        </select>
        <select name="sort" aria-label="Sort by">
          ${[['name', 'Name'], ['stock', 'Stock'], ['updatedAt', 'Recently updated'], ['price', 'Price']].map(
            ([v, l]) => `<option value="${v}"${s.sort === v ? ' selected' : ''}>${l}</option>`
          ).join('')}
        </select>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="/api/admin/reports/inventory.csv" target="_blank" rel="noopener">Export CSV</a>
      </form>

      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Product</th><th>SKU</th><th>On hand</th><th>Threshold</th><th>State</th><th>Value (cost)</th><th></th></tr></thead>
          <tbody>${items
            .map(
              (p) => `<tr>
                <td><div class="adm-cell">${thumb(p)}<div>
                  <a href="/product.html?slug=${encodeURIComponent(p.slug)}">${AV.esc(p.name)}</a>
                  <div class="muted">${AV.esc(p.category)}</div>
                </div></div></td>
                <td>${AV.esc(fmt(p.sku))}</td>
                <td>${stockCell(p)}</td>
                <td>${p.reorderThreshold == null ? '<span class="muted">default</span>' : p.reorderThreshold}</td>
                <td>${statusPill(p.stockState)}</td>
                <td>${valueCell(p)}</td>
                <td class="adm-actions">
                  <button class="btn btn-ghost btn-sm" data-adjust="${AV.esc(p.id)}">Adjust</button>
                  ${p.stock != null ? `<button class="btn btn-ghost btn-sm" data-untrack="${AV.esc(p.id)}" data-name="${AV.esc(p.name)}">Stop tracking</button>` : ''}
                </td>
              </tr>`
            )
            .join('')}</tbody></table></div>${pager(meta, 'inventory', () => inventory(pane))}`
        : '<div class="empty">Nothing matches this filter.</div>'}`;

    wireToolbar(pane, (fd) => {
      state.inventory = {
        ...state.inventory,
        page: 1,
        search: String(fd.get('search') || '').trim(),
        stockState: String(fd.get('stockState') || ''),
        category: String(fd.get('category') || ''),
        sort: String(fd.get('sort') || 'name'),
      };
      inventory(pane);
    });
    wirePager(pane, 'inventory', () => inventory(pane));

    pane.querySelector('tbody')?.addEventListener('click', (e) => {
      const adj = e.target.closest('[data-adjust]');
      if (adj) return adjustDialog(adj.dataset.adjust, pane);
      const un = e.target.closest('[data-untrack]');
      if (un) return untrackDialog(un.dataset.untrack, un.dataset.name, pane);
    });
  } catch (e) {
    fail(pane, e);
  }
}

/* The stock adjustment dialog. Nothing here writes a number directly: the form
   posts an intent (set or delta, a type, a reason) and the server computes the
   balance atomically, refusing anything that would go below zero. The preview
   is advisory — the response's balanceBefore → balanceAfter is the truth. */
async function adjustDialog(productId, pane) {
  const { body } = dialog('Stock adjustment');
  C.loading(body, 'Loading…');

  let p;
  try {
    p = (await AV.api.get(`/api/admin/products/${encodeURIComponent(productId)}`)).data.product;
  } catch (err) {
    C.error(body, err, { retry: () => adjustDialog(productId, pane), level: 'h2' });
    return;
  }
  const tracked = p.stock != null;

  body.innerHTML = `
    <p class="note">${AV.esc(p.name)} · ${AV.esc(fmt(p.sku))} · currently <b>${tracked ? `${p.stock} on hand` : 'untracked'}</b></p>
    ${tracked ? '' : '<p class="note">This piece is untracked — this first count opens the ledger with an opening balance.</p>'}
    <form id="adjustForm" class="adm-form">
      ${field('Change type', `<select name="type">${(tracked
        ? ['adjustment', 'write_off', 'return', 'sale']
        : ['opening']
      )
        .map((v) => `<option value="${v}">${label(v)}</option>`)
        .join('')}</select>`, { hint: 'why the count changed' })}
      ${field('Mode', `<select name="mode">
        <option value="delta">Add / subtract</option>
        <option value="set"${tracked ? '' : ' selected'}>Set to</option>
      </select>`)}
      ${field('Quantity', input('quantity', `type="number" step="1" required placeholder="${tracked ? '-3 or +5' : 'first count'}"`), { hint: 'signed for Add / subtract' })}
      ${field('Reason', input('reason', 'required maxlength="300" placeholder="Cycle count, damage, customer return…"'), { wide: true })}
      ${field('Reference', input('reference', 'maxlength="120" placeholder="optional — PO number, ticket, courier note"'), { wide: true })}
      <p class="adm-preview wide" id="adjPreview" aria-live="polite"></p>
      <button class="btn btn-light" type="submit">Record adjustment</button>
      <p class="form-msg"></p>
    </form>`;

  const form = AV.qs('#adjustForm', body);
  const preview = AV.qs('#adjPreview', body);
  const updatePreview = () => {
    const qty = Number(form.elements.quantity.value || 0);
    const setTo = form.elements.mode.value === 'set';
    const after = p.stock == null || setTo ? qty : p.stock + qty;
    preview.textContent =
      p.stock == null
        ? `Opens the ledger at ${after}${after < 0 ? ' — cannot open below zero' : ''}.`
        : `Current ${p.stock} → ${after}${after < 0 ? ' — the server will refuse this (stock cannot go below zero)' : ''}.`;
    preview.classList.toggle('is-bad', after < 0);
  };
  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  updatePreview();

  onSubmit(form, async (f) => {
    const el = f.elements;
    const quantity = Number(el.quantity.value);
    if (el.mode.value === 'delta' && quantity === 0) throw Object.assign(new Error('Enter a non-zero change.'), { client: true });
    const out = await AV.api.post(`/api/admin/inventory/adjust/${encodeURIComponent(productId)}`, {
      mode: el.mode.value,
      quantity,
      type: el.type.value,
      reason: el.reason.value.trim(),
      reference: el.reference.value.trim() || undefined,
    });
    AV.toast(`Recorded: ${out.data.balanceBefore} → ${out.data.balanceAfter} (${label(el.type.value).toLowerCase()}).`, 'ok');
    AV.qs('#admDialog').close();
    inventory(pane);
  });
}

async function untrackDialog(productId, name, pane) {
  if (!confirm(`Stop tracking stock for “${name}”? The current count is kept in the ledger as history, but the piece shows as Untracked and further adjustments are refused until a new opening count is taken.`)) return;
  const { body } = dialog('Stop tracking stock');
  body.innerHTML = `
    <p class="note">A reason is required — untracking hides a real count, and the ledger should say why.</p>
    <form id="untrackForm" class="adm-form">
      ${field('Reason', input('reason', 'required maxlength="300" placeholder="Made to order from here on…"'), { wide: true })}
      <button class="btn btn-light" type="submit">Stop tracking</button>
      <p class="form-msg"></p>
    </form>`;
  onSubmit(AV.qs('#untrackForm', body), async (f) => {
    await AV.api.post(`/api/admin/inventory/untrack/${encodeURIComponent(productId)}`, {
      reason: f.elements.reason.value.trim(),
    });
    AV.toast('Stock is no longer tracked for this piece.', 'ok');
    AV.qs('#admDialog').close();
    inventory(pane);
  });
}

/* ── Stock movements ──────────────────────────────────────────── */
/* The ledger itself: raw StockMovement rows as the service wrote them. */
async function movements(pane) {
  C.skeleton(pane, 5);
  try {
    const s = state.movements;
    const qs = new URLSearchParams({ page: String(s.page), limit: '50' });
    if (s.type) qs.set('type', s.type);
    const env = await AV.api.get(`/api/admin/inventory/movements?${qs}`);
    const items = env.data.items || [];
    const meta = env.data.meta;

    pane.innerHTML = `
      <p class="note" style="margin-bottom:14px">Every stock change, in order, with the balance before and after, who made it and why. Rows are immutable — corrections are new entries, not edits.</p>
      <form class="adm-toolbar" data-toolbar>
        <select name="type" aria-label="Movement type">
          <option value="">All types</option>
          ${MOVEMENT_TYPES.map((v) => `<option value="${v}"${s.type === v ? ' selected' : ''}>${label(v)}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" id="movCsv" href="/api/admin/reports/movements.csv${s.type ? `?type=${s.type}` : ''}" target="_blank" rel="noopener">Export CSV</a>
      </form>

      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>When</th><th>Product</th><th>Type</th><th>Change</th><th>Balance</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>${items
            .map(
              (m) => `<tr>
                <td>${AV.formatDate(m.createdAt)}<div class="muted">${AV.formatTime ? AV.formatTime(m.createdAt) : ''}</div></td>
                <td>${AV.esc(m.productName || '—')}</td>
                <td>${pill(m.type, m.type === 'write_off' ? 'pill-bad' : m.quantity > 0 ? 'pill-ok' : '')}</td>
                <td>${m.quantity > 0 ? '+' : ''}${m.quantity}</td>
                <td>${m.balanceBefore} → ${m.balanceAfter}</td>
                <td>${AV.esc(m.reason || '—')}${m.reference ? `<div class="muted">${AV.esc(m.reference)}</div>` : ''}</td>
                <td>${AV.esc(m.actor?.name || m.actor?.email || 'system')}</td>
              </tr>`
            )
            .join('')}</tbody></table></div>${pager(meta, 'movements', () => movements(pane))}`
        : '<div class="empty">No movements yet.</div>'}`;

    wireToolbar(pane, (fd) => {
      state.movements = { page: 1, type: String(fd.get('type') || '') };
      movements(pane);
    });
    wirePager(pane, 'movements', () => movements(pane));
  } catch (e) {
    fail(pane, e);
  }
}

/* ── Categories ───────────────────────────────────────────────── */
async function categoriesView(pane) {
  C.skeleton(pane, 4);
  try {
    const items = (await AV.api.get('/api/admin/categories')).data.items || [];
    pane.innerHTML = `
      <form class="adm-toolbar" data-toolbar>
        <span class="muted">Categories drive the shop navigation and the product filter.</span>
        <span class="spacer"></span>
        <button class="btn btn-light btn-sm" type="button" data-new>+ New category</button>
      </form>
      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Category</th><th>Slug</th><th>Products</th><th>Sort</th><th>State</th><th></th></tr></thead>
          <tbody>${items
            .map(
              (c) => `<tr>
                <td>${AV.esc(c.name)}</td>
                <td class="muted">${AV.esc(c.slug)}</td>
                <td>${c.productCount ?? 0}</td>
                <td>${c.sortOrder ?? 0}</td>
                <td>${c.active ? statusPill('active') : statusPill('archived')}</td>
                <td class="adm-actions">
                  <button class="btn btn-ghost btn-sm" data-edit="${AV.esc(c.slug)}">Edit</button>
                  <button class="btn btn-ghost btn-sm" data-toggle="${AV.esc(c.slug)}" data-state="${c.active ? 'on' : 'off'}">${c.active ? 'Archive' : 'Restore'}</button>
                </td>
              </tr>`
            )
            .join('')}</tbody></table></div>`
        : '<div class="empty">No categories yet.</div>'}`;

    wireToolbar(pane, () => {}); /* the toolbar here only carries the New button */
    AV.qs('[data-new]', pane)?.addEventListener('click', () => categoryForm(null, pane));
    pane.querySelector('tbody')?.addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return categoryForm(edit.dataset.edit, pane);
      const tog = e.target.closest('[data-toggle]');
      if (!tog) return;
      const on = tog.dataset.state === 'on';
      if (!confirm(`${on ? 'Archive' : 'Restore'} this category? ${on ? 'Products keep it; it just stops appearing in navigation.' : 'It returns to navigation.'}`)) return;
      AV.setBusy(tog, true);
      try {
        await AV.api.post(`/api/admin/categories/${encodeURIComponent(tog.dataset.toggle)}/${on ? 'archive' : 'restore'}`);
        cachedCategories = null;
        AV.toast(on ? 'Category archived.' : 'Category restored.', 'ok');
        categoriesView(pane);
      } catch (err) {
        AV.toast(AV.firstErr(err), 'err');
        AV.setBusy(tog, false);
      }
    });
  } catch (e) {
    fail(pane, e);
  }
}

async function categoryForm(slug, pane) {
  const editing = Boolean(slug);
  const { body } = dialog(editing ? 'Edit category' : 'New category');
  let c = null;
  if (editing) {
    try {
      const items = (await AV.api.get('/api/admin/categories')).data.items || [];
      c = items.find((x) => x.slug === slug) || null;
    } catch (err) {
      C.error(body, err, { retry: () => categoryForm(slug, pane), level: 'h2' });
      return;
    }
  }
  body.innerHTML = `
    <form id="catForm" class="adm-form">
      ${field('Name', input('name', `required maxlength="60" value="${AV.esc(c?.name || '')}"`))}
      ${field('Slug', input('slug', `maxlength="80" placeholder="derived from the name"${editing ? ' readonly' : ''}`))}
      ${field('Sort order', input('sortOrder', `type="number" step="1" value="${c?.sortOrder ?? 0}"`))}
      ${field('Image path', input('image', `maxlength="300" placeholder="/assets/img/library/…" value="${AV.esc(c?.image || '')}"`))}
      ${field('Description', `<textarea name="description" rows="3" maxlength="1200">${AV.esc(c?.description || '')}</textarea>`, { wide: true })}
      ${field('SEO title', input('seoTitle', `maxlength="70" value="${AV.esc(c?.seoTitle || '')}"`))}
      ${field('SEO description', `<textarea name="seoDescription" rows="2" maxlength="170">${AV.esc(c?.seoDescription || '')}</textarea>`, { wide: true })}
      <label class="adm-check"><input type="checkbox" name="active"${c ? (c.active ? ' checked' : '') : ' checked'}> Visible in navigation</label>
      <button class="btn btn-light" type="submit">${editing ? 'Save' : 'Create category'}</button>
      <p class="form-msg"></p>
    </form>`;
  onSubmit(AV.qs('#catForm', body), async (f) => {
    const el = f.elements;
    const payload = {
      name: el.name.value.trim(),
      sortOrder: Number(el.sortOrder.value || 0),
      image: el.image.value.trim(),
      description: el.description.value.trim(),
      seoTitle: el.seoTitle.value.trim(),
      seoDescription: el.seoDescription.value.trim(),
      active: el.active.checked,
    };
    if (editing) {
      await AV.api.patch(`/api/admin/categories/${encodeURIComponent(slug)}`, payload);
      AV.toast('Category updated.', 'ok');
    } else {
      payload.slug = el.slug.value.trim() || undefined;
      await AV.api.post('/api/admin/categories', payload);
      AV.toast('Category created.', 'ok');
    }
    cachedCategories = null;
    AV.qs('#admDialog').close();
    categoriesView(pane);
  });
}

/* ── Suppliers ────────────────────────────────────────────────── */
async function suppliers(pane) {
  C.skeleton(pane, 4);
  try {
    const items = (await AV.api.get('/api/admin/suppliers?includeArchived=true')).data.items || [];
    pane.innerHTML = `
      <form class="adm-toolbar" data-toolbar>
        <span class="muted">Suppliers are who purchase orders are addressed to. Archived suppliers keep their history but cannot receive new orders.</span>
        <span class="spacer"></span>
        <button class="btn btn-light btn-sm" type="button" data-new>+ New supplier</button>
      </form>
      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Supplier</th><th>Code</th><th>Contact</th><th>State</th><th></th></tr></thead>
          <tbody>${items
            .map(
              (s) => `<tr>
                <td><strong>${AV.esc(s.name)}</strong>${s.address ? `<div class="muted">${AV.esc(s.address.slice(0, 80))}</div>` : ''}</td>
                <td>${AV.esc(fmt(s.code))}</td>
                <td>${AV.esc(fmt(s.email))}${s.phone ? `<div class="muted">${AV.esc(s.phone)}</div>` : ''}</td>
                <td>${s.status === 'archived' ? statusPill('archived') : statusPill('active')}</td>
                <td class="adm-actions">
                  <button class="btn btn-ghost btn-sm" data-edit="${AV.esc(s._id)}">Edit</button>
                  <button class="btn btn-ghost btn-sm" data-toggle="${AV.esc(s._id)}" data-state="${s.status === 'archived' ? 'off' : 'on'}" data-name="${AV.esc(s.name)}">${s.status === 'archived' ? 'Restore' : 'Archive'}</button>
                </td>
              </tr>`
            )
            .join('')}</tbody></table></div>`
        : '<div class="empty">No suppliers yet.<div style="margin-top:16px"><button class="btn btn-light btn-sm" type="button" data-new>+ Add the first supplier</button></div></div>'}`;

    wireToolbar(pane, () => {});
    AV.qsa('[data-new]', pane).forEach((b) => b.addEventListener('click', () => supplierForm(null, pane)));
    pane.querySelector('tbody')?.addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return supplierForm(edit.dataset.edit, pane);
      const tog = e.target.closest('[data-toggle]');
      if (!tog) return;
      const on = tog.dataset.state === 'on';
      if (!confirm(`${on ? 'Archive' : 'Restore'} “${tog.dataset.name}”? ${on ? 'Existing purchase orders keep their history; new ones cannot be opened for this supplier until it is restored.' : ''}`)) return;
      AV.setBusy(tog, true);
      try {
        await AV.api.post(`/api/admin/suppliers/${encodeURIComponent(tog.dataset.toggle)}/${on ? 'archive' : 'restore'}`);
        AV.toast(on ? 'Supplier archived.' : 'Supplier restored.', 'ok');
        suppliers(pane);
      } catch (err) {
        AV.toast(AV.firstErr(err), 'err');
        AV.setBusy(tog, false);
      }
    });
  } catch (e) {
    fail(pane, e);
  }
}

async function supplierForm(supplierId, pane) {
  const editing = Boolean(supplierId);
  const { body } = dialog(editing ? 'Edit supplier' : 'New supplier');
  let s = null;
  if (editing) {
    try {
      s = (await AV.api.get(`/api/admin/suppliers/${encodeURIComponent(supplierId)}`)).data.supplier;
    } catch (err) {
      C.error(body, err, { retry: () => supplierForm(supplierId, pane), level: 'h2' });
      return;
    }
  }
  body.innerHTML = `
    <form id="supForm" class="adm-form">
      ${field('Name', input('name', `required maxlength="120" value="${AV.esc(s?.name || '')}"`))}
      ${field('Code', input('code', `maxlength="40" placeholder="short internal code" value="${AV.esc(s?.code || '')}"`))}
      ${field('Email', input('email', `type="email" maxlength="160" value="${AV.esc(s?.email || '')}"`))}
      ${field('Phone', input('phone', `maxlength="40" value="${AV.esc(s?.phone || '')}"`))}
      ${field('Address', `<textarea name="address" rows="2" maxlength="400">${AV.esc(s?.address || '')}</textarea>`, { wide: true })}
      ${field('Notes', `<textarea name="notes" rows="3" maxlength="2000">${AV.esc(s?.notes || '')}</textarea>`, { wide: true })}
      <button class="btn btn-light" type="submit">${editing ? 'Save' : 'Create supplier'}</button>
      <p class="form-msg"></p>
    </form>`;
  onSubmit(AV.qs('#supForm', body), async (f) => {
    const el = f.elements;
    const payload = {
      name: el.name.value.trim(),
      code: el.code.value.trim() || undefined,
      email: el.email.value.trim(),
      phone: el.phone.value.trim(),
      address: el.address.value.trim(),
      notes: el.notes.value.trim(),
    };
    if (editing) {
      await AV.api.patch(`/api/admin/suppliers/${encodeURIComponent(supplierId)}`, payload);
      AV.toast('Supplier updated.', 'ok');
    } else {
      await AV.api.post('/api/admin/suppliers', payload);
      AV.toast('Supplier created.', 'ok');
    }
    AV.qs('#admDialog').close();
    suppliers(pane);
  });
}

/* ── Purchase orders ──────────────────────────────────────────── */
async function purchaseOrders(pane) {
  C.skeleton(pane, 4);
  try {
    const s = state.pos;
    const qs = new URLSearchParams({ page: String(s.page), limit: '50' });
    if (s.status) qs.set('status', s.status);
    const env = await AV.api.get(`/api/admin/purchase-orders?${qs}`);
    const items = env.data.items || [];
    const meta = env.data.meta;

    pane.innerHTML = `
      <p class="note" style="margin-bottom:14px">A draft order changes nothing; stock rises only when a receipt is recorded against a sent order — and the same receipt submitted twice is replayed, never counted twice.</p>
      <form class="adm-toolbar" data-toolbar>
        <select name="status" aria-label="Status">
          <option value="">Any status</option>
          ${['draft', 'sent', 'partial', 'received', 'cancelled'].map((v) => `<option value="${v}"${s.status === v ? ' selected' : ''}>${label(v)}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <button class="btn btn-light btn-sm" type="button" data-new>+ New purchase order</button>
      </form>

      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Order</th><th>Supplier</th><th>Lines</th><th>Ordered value</th><th>Expected</th><th>Status</th><th></th></tr></thead>
          <tbody>${items
            .map((po) => {
              const ordered = (po.lines || []).reduce((a, l) => a + l.orderedQuantity * l.unitCost, 0);
              return `<tr>
                <td><strong>${AV.esc(po.poNumber)}</strong><div class="muted">${AV.formatDate(po.createdAt)}</div></td>
                <td>${AV.esc(po.supplier?.name || '—')}${po.supplier?.code ? `<div class="muted">${AV.esc(po.supplier.code)}</div>` : ''}</td>
                <td>${(po.lines || []).length}</td>
                <td>${AV.formatPrice(ordered)}</td>
                <td>${po.expectedDate ? AV.formatDate(po.expectedDate) : '—'}</td>
                <td>${statusPill(po.status)}</td>
                <td class="adm-actions"><button class="btn btn-ghost btn-sm" data-open="${AV.esc(po._id)}">Open</button></td>
              </tr>`;
            })
            .join('')}</tbody></table></div>${pager(meta, 'pos', () => purchaseOrders(pane))}`
        : '<div class="empty">No purchase orders yet.<div style="margin-top:16px"><button class="btn btn-light btn-sm" type="button" data-new>+ Raise the first one</button></div></div>'}`;

    wireToolbar(pane, (fd) => {
      state.pos = { page: 1, status: String(fd.get('status') || '') };
      purchaseOrders(pane);
    });
    wirePager(pane, 'pos', () => purchaseOrders(pane));
    AV.qsa('[data-new]', pane).forEach((b) => b.addEventListener('click', () => poForm(null, pane)));
    pane.querySelector('tbody')?.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      if (open) poDetail(open.dataset.open, pane);
    });
  } catch (e) {
    fail(pane, e);
  }
}

/* Draft creation and draft editing share this form: supplier, then dynamic
   lines of product / quantity / unit cost. Only a draft can be edited, which
   the server enforces — this form simply never appears for a sent order. */
async function poForm(poId, pane) {
  const editing = Boolean(poId);
  const { body } = dialog(editing ? 'Edit draft order' : 'New purchase order');
  C.loading(body, 'Loading…');

  let suppliers;
  let products;
  let po = null;
  try {
    const [supRes, prodRes] = await Promise.all([
      AV.api.get('/api/admin/suppliers'),
      AV.api.get('/api/admin/products?limit=200&sort=name&order=asc'),
    ]);
    suppliers = supRes.data.items || [];
    products = prodRes.data.items || [];
    if (editing) po = (await AV.api.get(`/api/admin/purchase-orders/${encodeURIComponent(poId)}`)).data.purchaseOrder;
  } catch (err) {
    C.error(body, err, { retry: () => poForm(poId, pane), level: 'h2' });
    return;
  }

  if (!suppliers.length) {
    body.innerHTML = `<div class="empty">A purchase order needs a supplier first.<div style="margin-top:16px"><a class="btn btn-light btn-sm" href="/admin.html?view=suppliers">Add a supplier</a></div></div>`;
    return;
  }

  const productOptions = (selected) =>
    products.map((p) => `<option value="${AV.esc(p.id)}"${p.id === selected ? ' selected' : ''}>${AV.esc(p.name)} · ${AV.esc(p.sku || p.slug)}</option>`).join('');

  const lineRow = (l = {}) => `
    <div class="adm-line" data-line>
      <select name="productId" aria-label="Product" required>${productOptions(l.product)}</select>
      <input name="orderedQuantity" type="number" min="1" step="1" required placeholder="Qty" value="${l.orderedQuantity ?? ''}" aria-label="Ordered quantity">
      <input name="unitCost" type="number" min="0" step="0.01" required placeholder="Unit cost ₹" value="${l.unitCost ?? ''}" aria-label="Unit cost">
      <button class="btn btn-ghost btn-sm" type="button" data-rmline aria-label="Remove line">×</button>
    </div>`;

  const initialLines = editing
    ? po.lines.map((l) => ({ product: l.product, orderedQuantity: l.orderedQuantity, unitCost: l.unitCost }))
    : [{}, {}];

  body.innerHTML = `
    <form id="poForm" class="adm-form">
      ${field('Supplier', `<select name="supplierId" required>${suppliers
        .map((s) => `<option value="${AV.esc(s._id)}"${editing && po.supplier?._id === s._id ? ' selected' : ''}>${AV.esc(s.name)}</option>`)
        .join('')}</select>`)}
      ${field('Expected date', input('expectedDate', `type="date" value="${editing && po.expectedDate ? new Date(po.expectedDate).toISOString().slice(0, 10) : ''}"`))}
      <div class="wide">
        <div class="adm-linelabel">Line items</div>
        <div id="poLines">${initialLines.map(lineRow).join('')}</div>
        <button class="btn btn-ghost btn-sm" type="button" id="addLine" style="margin-top:8px">+ Add line</button>
      </div>
      ${field('Notes', `<textarea name="notes" rows="2" maxlength="2000">${AV.esc(po?.notes || '')}</textarea>`, { wide: true })}
      <button class="btn btn-light" type="submit">${editing ? 'Save draft' : 'Create draft'}</button>
      <p class="form-msg"></p>
    </form>
    <p class="note" style="margin-top:14px">Creating a draft changes no stock. Goods are counted in when the order is sent and received.</p>`;

  const linesBox = AV.qs('#poLines', body);
  AV.qs('#addLine', body).addEventListener('click', () => {
    linesBox.insertAdjacentHTML('beforeend', lineRow());
  });
  linesBox.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rmline]');
    if (rm && AV.qsa('[data-line]', linesBox).length > 1) rm.closest('[data-line]').remove();
  });

  onSubmit(AV.qs('#poForm', body), async (f) => {
    const el = f.elements;
    const lines = AV.qsa('[data-line]', linesBox).map((row) => ({
      productId: row.querySelector('[name="productId"]').value,
      orderedQuantity: Number(row.querySelector('[name="orderedQuantity"]').value),
      unitCost: Number(row.querySelector('[name="unitCost"]').value),
    }));
    const payload = {
      supplierId: el.supplierId.value,
      lines,
      expectedDate: el.expectedDate.value ? new Date(`${el.expectedDate.value}T00:00:00Z`).toISOString() : null,
      notes: el.notes.value.trim(),
    };
    if (editing) {
      await AV.api.patch(`/api/admin/purchase-orders/${encodeURIComponent(poId)}`, payload);
      AV.toast('Draft updated.', 'ok');
      AV.qs('#admDialog').close();
      purchaseOrders(pane);
      poDetail(poId, pane);
    } else {
      const created = await AV.api.post('/api/admin/purchase-orders', payload);
      AV.toast(`${created.data.purchaseOrder.poNumber} created as a draft.`, 'ok');
      AV.qs('#admDialog').close();
      purchaseOrders(pane);
    }
  });
}

/* The order's full page: lines against what has arrived, receipts so far, and
   the moves this status allows. Actions re-open this same view when done. */
async function poDetail(poId, pane) {
  const { body } = dialog('Purchase order');
  C.loading(body, 'Loading…');

  let po;
  let receipts;
  try {
    const poRes = await AV.api.get(`/api/admin/purchase-orders/${encodeURIComponent(poId)}`);
    po = poRes.data.purchaseOrder;
    receipts = (await AV.api.get(`/api/admin/purchase-orders/${encodeURIComponent(poId)}/receipts`)).data.items || [];
  } catch (err) {
    C.error(body, err, { retry: () => poDetail(poId, pane), level: 'h2' });
    return;
  }

  AV.qs('#admDialog h2').textContent = po.poNumber;
  const orderedValue = (po.lines || []).reduce((a, l) => a + l.orderedQuantity * l.unitCost, 0);
  const outstanding = (l) => Math.max(0, l.orderedQuantity - l.receivedQuantity);

  body.innerHTML = `
    <p class="note">${AV.esc(po.supplier?.name || '—')} · ${statusPill(po.status)} · ordered ${AV.formatDate(po.createdAt)}${po.expectedDate ? ` · expected ${AV.formatDate(po.expectedDate)}` : ''}</p>
    ${po.notes ? `<p class="note">${AV.esc(po.notes)}</p>` : ''}

    <div class="table-wrap" style="margin-top:14px"><table>
      <thead><tr><th>Item</th><th>SKU</th><th>Ordered</th><th>Received</th><th>Outstanding</th><th>Unit cost</th><th>Line total</th></tr></thead>
      <tbody>${(po.lines || [])
        .map(
          (l) => `<tr>
            <td>${AV.esc(l.name)}</td>
            <td class="muted">${AV.esc(l.sku || '—')}</td>
            <td>${l.orderedQuantity}</td>
            <td>${l.receivedQuantity}</td>
            <td>${outstanding(l) ? outstanding(l) : '<span class="pill pill-ok">complete</span>'}</td>
            <td>${AV.formatPrice(l.unitCost)}</td>
            <td>${AV.formatPrice(l.orderedQuantity * l.unitCost)}</td>
          </tr>`
        )
        .join('')}</tbody>
      <tfoot><tr><td colspan="6"><strong>Ordered value</strong></td><td><strong>${AV.formatPrice(orderedValue)}</strong></td></tr></tfoot>
    </table></div>

    <div class="adm-actions" style="margin-top:16px">
      ${po.status === 'draft' ? `
        <button class="btn btn-ghost btn-sm" data-act="edit">Edit draft</button>
        <button class="btn btn-light btn-sm" data-act="send">Send to supplier</button>
        <button class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button>` : ''}
      ${['sent', 'partial'].includes(po.status) ? `
        <button class="btn btn-light btn-sm" data-act="receive">Record a delivery</button>
        <button class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button>` : ''}
    </div>
    <div class="form-msg" style="margin-top:8px"></div>

    <h3 style="margin:26px 0 8px">Receipt history</h3>
    ${receipts.length
      ? `<div class="order-totals">${receipts
          .map(
            (r) => `<div class="row"><span>${AV.formatDate(r.receivedAt)} · ${(r.lines || [])
              .map((l) => `${l.quantityReceived} × ${AV.esc(l.name || l.sku || 'item')}`)
              .join(', ')}${r.note ? ` <span class="muted">${AV.esc(r.note)}</span>` : ''}</span><span>${AV.esc(r.receivedByEmail || 'system')}</span></div>`
          )
          .join('')}</div>`
      : '<p class="note">Nothing received yet.</p>'}`;

  const msg = AV.qs('.form-msg', body);
  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'edit') return poForm(poId, pane);
    if (act === 'receive') return receiveDialog(po, pane);

    const wanted = { send: 'Send this order to the supplier? Stock still will not move until a delivery is recorded.', cancel: 'Cancel this order? Draft or sent, it stops here — nothing received so far is undone.' }[act];
    if (wanted && !confirm(wanted)) return;
    AV.setBusy(btn, true);
    try {
      await AV.api.post(`/api/admin/purchase-orders/${encodeURIComponent(poId)}/${act}`);
      AV.toast(act === 'send' ? 'Order sent.' : 'Order cancelled.', 'ok');
      purchaseOrders(pane);
      poDetail(poId, pane);
    } catch (err) {
      C.say(msg, AV.firstErr(err), false);
      AV.setBusy(btn, false);
    }
  });
}

/* Receiving: one quantity per outstanding line, one idempotency key for the
   whole receipt. The key is generated per dialog open, so a double-click (or a
   retry after a flaky response) replays the first receipt instead of counting
   the goods twice. */
function receiveDialog(po, pane) {
  const { body, dlg } = dialog(`Receive against ${po.poNumber}`);
  const key = AV.newIdempotencyKey();
  const lines = (po.lines || []).filter((l) => l.orderedQuantity - l.receivedQuantity > 0);

  if (!lines.length) {
    body.innerHTML = '<div class="empty">Every line on this order has arrived in full.</div>';
    return;
  }

  body.innerHTML = `
    <p class="note">Enter what physically arrived on each line. Partial deliveries are normal — the order stays open until the outstanding quantities reach zero.</p>
    <form id="recvForm" class="adm-form">
      ${lines
        .map(
          (l, i) => field(
            `${l.name} — outstanding ${l.orderedQuantity - l.receivedQuantity}`,
            input(`qty-${i}`, `type="number" min="0" max="${l.orderedQuantity - l.receivedQuantity}" step="1" value="${l.orderedQuantity - l.receivedQuantity}" data-lineid="${AV.esc(l._id)}"`),
            { hint: '0 skips this line' }
          )
        )
        .join('')}
      ${field('Delivery note', input('note', 'maxlength="500" placeholder="optional — packing slip, condition…"'), { wide: true })}
      <button class="btn btn-light" type="submit">Record delivery</button>
      <p class="form-msg"></p>
    </form>`;

  onSubmit(AV.qs('#recvForm', body), async (f) => {
    const picked = lines
      .map((l, i) => ({
        lineId: l._id,
        quantityReceived: Number(f.elements[`qty-${i}`].value || 0),
      }))
      .filter((x) => x.quantityReceived > 0);
    if (!picked.length) throw Object.assign(new Error('Enter at least one quantity above zero.'), { client: true });

    const out = await AV.api.post(`/api/admin/purchase-orders/${encodeURIComponent(po._id)}/receive`, {
      lines: picked,
      idempotencyKey: key,
      note: f.elements.note.value.trim(),
    });
    AV.toast(
      out.data.replayed ? 'That delivery was already recorded — showing the original receipt.' : 'Delivery recorded and stock raised.',
      'ok'
    );
    dlg.close();
    purchaseOrders(pane);
  });
}

/* ── Image library ────────────────────────────────────────────── */
/* Files on disk plus what references them. Deleting a file a product points at
   is refused by the server (409) — the UI surfaces that message rather than
   pretending the delete worked. */
async function imageLibrary(pane) {
  C.skeleton(pane, 5);
  try {
    const data = (await AV.api.get('/api/admin/images/library')).data;
    const unassigned = data.unassigned || [];
    const assigned = (data.library || []).filter((i) => !(unassigned || []).some((u) => u.base === i.base));
    const products = (await AV.api.get('/api/admin/products?limit=200&sort=name&order=asc')).data.items || [];

    const card = (item) => {
      const large = item.files.find((f) => f.includes('-large')) || item.files[0];
      const uses = item.assignedTo || [];
      return `<div class="adm-lib-card" data-base="${AV.esc(item.base)}">
        <img src="${AV.esc(large)}" alt="${AV.esc(item.base)}" loading="lazy">
        <div class="meta">${AV.esc(item.base)}${
          uses.length
            ? `<div class="adm-assigned">${uses.map((u) => `<span class="pill pill-ok">${AV.esc(u.name || 'product')} #${(u.index ?? 0) + 1}</span>`).join('')}</div>`
            : '<div class="muted">unassigned</div>'
        }</div>
        <div class="acts">
          <button class="btn btn-ghost btn-sm" data-assign="${AV.esc(large)}">Assign…</button>
          <button class="btn btn-ghost btn-sm" data-del="${AV.esc(large)}">Delete</button>
        </div>
      </div>`;
    };

    pane.innerHTML = `
      <form class="adm-toolbar" data-toolbar>
        <label class="btn btn-light btn-sm adm-filebtn">Upload image<input type="file" id="libUpload" accept="image/jpeg,image/png,image/webp" hidden></label>
        <span class="muted">${(data.library || []).length} files · ${unassigned.length} unassigned · JPEG, PNG or WebP up to 12 MB</span>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="/admin.html?view=products">Manage per-product photos →</a>
      </form>
      <div class="form-msg" id="libMsg"></div>

      ${unassigned.length ? `<h3 style="margin:18px 0 10px">Unassigned</h3><div class="adm-lib-grid">${unassigned.map(card).join('')}</div>` : ''}
      <h3 style="margin:${unassigned.length ? '26px' : '18px'} 0 10px">All files</h3>
      ${(data.library || []).length ? `<div class="adm-lib-grid">${assigned.map(card).join('')}</div>` : '<div class="empty">The library is empty.</div>'}`;

    wireToolbar(pane, () => {});
    const msg = AV.qs('#libMsg', pane);

    AV.qs('#libUpload', pane)?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) return C.say(msg, 'That file is larger than the 12 MB upload limit.', false);
      try {
        const up = await fetch('/api/admin/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'image/jpeg' },
          credentials: 'include',
          body: file,
        });
        const json = await up.json().catch(() => null);
        if (!up.ok || !json?.success) throw new Error(json?.error?.message || `Upload failed (${up.status})`);
        AV.toast('Uploaded. It is ready to assign to a product.', 'ok');
        imageLibrary(pane);
      } catch (err) {
        C.say(msg, AV.firstErr(err), false);
      }
    });

    /* Assigned on the pane element itself, which survives innerHTML swaps:
       using addEventListener here would stack one handler per visit. */
    pane.onclick = async (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!confirm('Delete this file from disk? Any product that still points at it would show a broken image, so referenced files are refused by the server.')) return;
        AV.setBusy(del, true);
        try {
          const out = await AV.api.del(`/api/admin/images/file?path=${encodeURIComponent(del.dataset.del)}`);
          AV.toast(`Deleted ${out.data.deleted} file(s).`, 'ok');
          imageLibrary(pane);
        } catch (err) {
          C.say(msg, AV.firstErr(err), false);
          AV.setBusy(del, false);
        }
        return;
      }
      const assign = e.target.closest('[data-assign]');
      if (assign) assignDialog(assign.dataset.assign, products, pane);
    };
  } catch (e) {
    fail(pane, e);
  }
}

function assignDialog(path, products, pane) {
  const { body } = dialog('Assign to product');
  if (!products.length) {
    body.innerHTML = '<div class="empty">Create a product first.</div>';
    return;
  }
  body.innerHTML = `
    <p class="note">${AV.esc(path.split('/').pop())}</p>
    <form id="assignForm" class="adm-form">
      ${field('Product', `<select name="productId">${products
        .map((p) => `<option value="${AV.esc(p.id)}">${AV.esc(p.name)} (${(p.images || []).length} photos)</option>`)
        .join('')}</select>`)}
      ${field('Alt text', input('alt', 'maxlength="500" placeholder="what the photo shows"'))}
      <button class="btn btn-light" type="submit">Add to this product</button>
      <p class="form-msg"></p>
    </form>
    <p class="note" style="margin-top:12px">The photo joins the end of the product's list; set it as primary from the product's Images dialog.</p>`;
  onSubmit(AV.qs('#assignForm', body), async (f) => {
    const productId = f.elements.productId.value;
    await AV.api.post(`/api/admin/products/${encodeURIComponent(productId)}/images`, {
      paths: [path],
      alts: [f.elements.alt.value.trim() || undefined],
    });
    AV.toast('Assigned.', 'ok');
    AV.qs('#admDialog').close();
    imageLibrary(pane);
  });
}

/* ── Reports ──────────────────────────────────────────────────── */
/* Four real exports. The links carry the current selections and download with
   the session cookie like any same-origin navigation; the server escapes every
   cell so a product called =HYPERLINK(…) opens as text, not as a formula. */
async function reports(pane) {
  C.skeleton(pane, 3);
  try {
    pane.innerHTML = `
      <p class="note" style="margin-bottom:20px">CSV exports open in any spreadsheet. Leading =, +, − and @ are neutralised on the way out, so a hostile product name cannot become a live formula in someone's workbook.</p>
      <div class="adm-reports">
        <section class="adm-report">
          <h3>Products</h3>
          <p class="note">Catalogue rows: SKU, name, slug, category, status, prices, stock, photo review flag.</p>
          <label class="adm-reportfield">Status
            <select id="repStatus">
              <option value="">All statuses</option>
              ${['draft', 'active', 'archived'].map((v) => `<option value="${v}">${label(v)}</option>`).join('')}
            </select>
          </label>
          <a class="btn btn-ghost btn-sm" id="repProducts" href="/api/admin/reports/products.csv" target="_blank" rel="noopener">Download products.csv</a>
        </section>
        <section class="adm-report">
          <h3>Inventory</h3>
          <p class="note">Every product with on-hand count, cost price, cost-basis value and stock state.</p>
          <a class="btn btn-ghost btn-sm" href="/api/admin/reports/inventory.csv" target="_blank" rel="noopener">Download inventory.csv</a>
        </section>
        <section class="adm-report">
          <h3>Stock movements</h3>
          <p class="note">The ledger with a date window, for a stock-take period or a supplier audit.</p>
          <div class="adm-reportrow">
            <label class="adm-reportfield">From<input type="date" id="repFrom"></label>
            <label class="adm-reportfield">To<input type="date" id="repTo"></label>
            <label class="adm-reportfield">Type
              <select id="repType">
                <option value="">All types</option>
                ${MOVEMENT_TYPES.map((v) => `<option value="${v}">${label(v)}</option>`).join('')}
              </select>
            </label>
          </div>
          <a class="btn btn-ghost btn-sm" id="repMovements" href="/api/admin/reports/movements.csv" target="_blank" rel="noopener">Download movements.csv</a>
        </section>
        <section class="adm-report">
          <h3>Orders</h3>
          <p class="note">All orders with totals, payment and fulfilment status.</p>
          <a class="btn btn-ghost btn-sm" href="/api/admin/reports/orders.csv" target="_blank" rel="noopener">Download orders.csv</a>
        </section>
      </div>`;

    const repStatus = AV.qs('#repStatus', pane);
    const repProducts = AV.qs('#repProducts', pane);
    repStatus.addEventListener('change', () => {
      repProducts.href = `/api/admin/reports/products.csv${repStatus.value ? `?status=${repStatus.value}` : ''}`;
    });

    const repFrom = AV.qs('#repFrom', pane);
    const repTo = AV.qs('#repTo', pane);
    const repType = AV.qs('#repType', pane);
    const repMovements = AV.qs('#repMovements', pane);
    const rebuildMovements = () => {
      const qs = new URLSearchParams();
      if (repType.value) qs.set('type', repType.value);
      if (repFrom.value) qs.set('from', `${repFrom.value}T00:00:00.000Z`);
      if (repTo.value) qs.set('to', `${repTo.value}T23:59:59.999Z`);
      const s = qs.toString();
      repMovements.href = `/api/admin/reports/movements.csv${s ? `?${s}` : ''}`;
    };
    [repFrom, repTo, repType].forEach((el) => el.addEventListener('change', rebuildMovements));
  } catch (e) {
    fail(pane, e);
  }
}

/* ── Admin users ──────────────────────────────────────────────── */
/* Roles only: the last administrator cannot be demoted (the server refuses it),
   and passwords are deliberately out of scope here — they are changed by the
   account owner or the create-admin script, never by a list page. */
async function users(pane) {
  C.skeleton(pane, 4);
  try {
    const s = state.users;
    const qs = new URLSearchParams({ page: String(s.page), limit: '50' });
    if (s.search) qs.set('search', s.search);
    if (s.role) qs.set('role', s.role);
    const env = await AV.api.get(`/api/admin/users?${qs}`);
    const items = env.data.items || [];
    const meta = env.data.meta;

    pane.innerHTML = `
      <p class="note" style="margin-bottom:14px">Who can open this desk. Role changes take effect on the person's next request; passwords are never changed from this page.</p>
      <form class="adm-toolbar" data-toolbar>
        <input type="search" name="search" placeholder="Search name or email" value="${AV.esc(s.search)}" aria-label="Search users">
        <select name="role" aria-label="Role">
          <option value="">Any role</option>
          ${['admin', 'customer'].map((v) => `<option value="${v}"${s.role === v ? ' selected' : ''}>${label(v)}</option>`).join('')}
        </select>
      </form>

      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>${items
            .map(
              (u) => `<tr>
                <td>${AV.esc(u.name || '—')}</td>
                <td>${AV.esc(u.email)}</td>
                <td>${statusPill(u.role)}</td>
                <td>${u.createdAt ? AV.formatDate(u.createdAt) : '—'}</td>
                <td>${u.lastLoginAt ? AV.formatDate(u.lastLoginAt) : '<span class="muted">never</span>'}</td>
                <td class="adm-actions"><button class="btn btn-ghost btn-sm" data-role="${AV.esc(u.id)}" data-next="${u.role === 'admin' ? 'customer' : 'admin'}" data-name="${AV.esc(u.email)}">${u.role === 'admin' ? 'Make customer' : 'Make admin'}</button></td>
              </tr>`
            )
            .join('')}</tbody></table></div>${pager(meta, 'users', () => users(pane))}`
        : '<div class="empty">No users match.</div>'}`;

    wireToolbar(pane, (fd) => {
      state.users = { page: 1, search: String(fd.get('search') || '').trim(), role: String(fd.get('role') || '') };
      users(pane);
    });
    wirePager(pane, 'users', () => users(pane));

    pane.querySelector('tbody')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-role]');
      if (!btn) return;
      const next = btn.dataset.next;
      if (!confirm(`${next === 'admin' ? 'Give' : 'Remove'} ${btn.dataset.name} ${next === 'admin' ? 'administrator rights?' : 'administrator rights? They keep their account as a customer.'}`)) return;
      AV.setBusy(btn, true);
      try {
        await AV.api.patch(`/api/admin/users/${encodeURIComponent(btn.dataset.role)}/role`, { role: next });
        AV.toast('Role updated.', 'ok');
        users(pane);
      } catch (err) {
        AV.toast(AV.firstErr(err), 'err');
        AV.setBusy(btn, false);
      }
    });
  } catch (e) {
    fail(pane, e);
  }
}

/* ── Audit log ────────────────────────────────────────────────── */
async function audit(pane) {
  C.skeleton(pane, 5);
  try {
    const s = state.audit;
    const qs = new URLSearchParams({ page: String(s.page), limit: '50' });
    if (s.action) qs.set('action', s.action);
    if (s.entityType) qs.set('entityType', s.entityType);
    const env = await AV.api.get(`/api/admin/audit?${qs}`);
    const items = env.data.items || [];
    const meta = env.data.meta;

    pane.innerHTML = `
      <p class="note" style="margin-bottom:14px">Who did what, when — product edits, stock movements, order transitions, user role changes. Inventory entries are best-effort (a write that fails after the stock change still leaves the stock correct); product operations are recorded strictly.</p>
      <form class="adm-toolbar" data-toolbar>
        <input type="search" name="action" placeholder="Exact action, e.g. product.create" value="${AV.esc(s.action)}" aria-label="Action">
        <select name="entityType" aria-label="Entity type">
          <option value="">Any entity</option>
          ${['product', 'order', 'category', 'supplier', 'purchaseOrder', 'user', 'image'].map(
            (v) => `<option value="${v}"${s.entityType === v ? ' selected' : ''}>${label(v)}</option>`
          ).join('')}
        </select>
      </form>

      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Summary</th></tr></thead>
          <tbody>${items
            .map(
              (a) => `<tr>
                <td>${AV.formatDate(a.createdAt)}<div class="muted">${AV.formatTime ? AV.formatTime(a.createdAt) : ''}</div></td>
                <td>${AV.esc(a.actor?.name || a.actor?.email || 'system')}</td>
                <td><span class="pill">${AV.esc(a.action)}</span></td>
                <td>${AV.esc(label(a.entity?.type || '—'))}${a.entity?.label ? `<div class="muted">${AV.esc(a.entity.label)}</div>` : ''}</td>
                <td>${AV.esc(a.summary || '—')}</td>
              </tr>`
            )
            .join('')}</tbody></table></div>${pager(meta, 'audit', () => audit(pane))}`
        : '<div class="empty">Nothing recorded for this filter.</div>'}`;

    wireToolbar(pane, (fd) => {
      state.audit = {
        page: 1,
        action: String(fd.get('action') || '').trim(),
        entityType: String(fd.get('entityType') || ''),
      };
      audit(pane);
    });
    wirePager(pane, 'audit', () => audit(pane));
  } catch (e) {
    fail(pane, e);
  }
}

/* ── Settings ─────────────────────────────────────────────────── */
/* Read-only by design: these values describe what the server enforces, and the
   page reports them rather than offering controls that would have to lie. */
async function settings(pane) {
  C.skeleton(pane, 3);
  try {
    const s = (await AV.api.get('/api/admin/settings')).data;
    const row = (k, v) => `<div class="row"><span>${AV.esc(k)}</span><span>${v}</span></div>`;
    pane.innerHTML = `
      <p class="note" style="margin-bottom:18px">Served by the API. These are the values the server actually applies — changing behaviour means changing the configuration, not this page.</p>
      <div class="adm-two">
        <section>
          <h3>Inventory</h3>
          <div class="order-totals">
            ${row('Low-stock default', `${s.lowStockDefault} units — used when a product sets no threshold`)}
            ${row('Valuation basis', 'Cost price (products without a cost price are excluded, never counted as zero)')}
            ${row('Reserved stock', s.reservedStock.supported ? 'Supported' : 'Not supported')}
          </div>
          ${s.reservedStock.note ? `<p class="note">${AV.esc(s.reservedStock.note)}</p>` : ''}
        </section>
        <section>
          <h3>Images</h3>
          <div class="order-totals">
            ${row('Accepted types', (s.acceptedImageTypes || []).join(', '))}
            ${row('Max upload', `${s.maxUploadMB} MB`)}
            ${row('Storage', '/assets/img/ on this server — originals kept, no hotlinking')}
          </div>
        </section>
      </div>
      <div class="adm-two">
        <section>
          <h3>Session & access</h3>
          <div class="order-totals">
            ${row('Mechanism', AV.esc(s.auth?.mechanism || '—'))}
            ${row('Login limit', AV.esc(s.auth?.rateLimits?.login || '—'))}
            ${row('Sign-up limit', AV.esc(s.auth?.rateLimits?.register || '—'))}
          </div>
        </section>
        <section>
          <h3>Currency</h3>
          <div class="order-totals">
            ${row('Store currency', AV.esc(s.currency || '—'))}
          </div>
          <p class="note">Prices are stored as plain numbers and formatted ₹ en-IN on the way out.</p>
        </section>
      </div>`;
  } catch (e) {
    fail(pane, e);
  }
}

/* ── Collections ──────────────────────────────────────────────── */
/* Merchandising groups. Membership is edited here and stored on the collection
   itself (the server is the only writer), so the product form does not carry a
   second, divergent list. */
async function collections(pane) {
  C.skeleton(pane, 4);
  try {
    const env = await AV.api.get('/api/admin/collections?includeArchived=true');
    const items = env.data.items || [];
    pane.innerHTML = `
      <div class="adm-toolbar">
        <p class="note" style="margin:0">Collections are shelves, not categories. A product can sit in several.</p>
        <span class="spacer"></span>
        <button class="btn btn-light btn-sm" type="button" data-new>+ New collection</button>
      </div>
      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Collection</th><th>Link</th><th>Products</th><th>Status</th><th>Featured</th><th></th></tr></thead>
          <tbody>${items.map((c) => `<tr>
            <td>${AV.esc(c.name)}<div class="muted">${AV.esc(c.description || '')}</div></td>
            <td>${AV.esc(c.slug)}</td>
            <td>${c.productCount}</td>
            <td>${statusPill(c.active ? 'active' : 'archived')}</td>
            <td>${c.featured ? '<span class="pill pill-ok">Featured</span>' : '<span class="muted">—</span>'}</td>
            <td class="adm-actions">
              <button class="btn btn-ghost btn-sm" data-edit="${AV.esc(c.id)}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-members="${AV.esc(c.id)}">Products</button>
              <button class="btn btn-ghost btn-sm" data-toggle="${AV.esc(c.id)}" data-on="${c.active}">${c.active ? 'Archive' : 'Restore'}</button>
              <button class="btn btn-ghost btn-sm" data-delete="${AV.esc(c.id)}" data-name="${AV.esc(c.name)}">Delete</button>
            </td>
          </tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No collections yet.</div>'}`;

    AV.qs('[data-new]', pane)?.addEventListener('click', () => collectionForm(null, pane));
    pane.querySelector('tbody')?.addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return collectionForm(edit.dataset.edit, pane);
      const members = e.target.closest('[data-members]');
      if (members) return collectionProducts(members.dataset.members, pane);
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const on = toggle.dataset.on === 'true';
        toggle.disabled = true;
        try {
          await AV.api.post(`/api/admin/collections/${encodeURIComponent(toggle.dataset.toggle)}/${on ? 'archive' : 'restore'}`);
          AV.toast(on ? 'Collection archived.' : 'Collection restored.', 'ok');
          collections(pane);
        } catch (err) {
          AV.toast(AV.firstErr(err), 'err');
          toggle.disabled = false;
        }
        return;
      }
      const del = e.target.closest('[data-delete]');
      if (del) {
        if (!confirm(`Delete “${del.dataset.name}”? A collection holding products cannot be deleted — archive it instead.`)) return;
        del.disabled = true;
        try {
          await AV.api.del(`/api/admin/collections/${encodeURIComponent(del.dataset.delete)}`);
          AV.toast('Collection deleted.', 'ok');
          collections(pane);
        } catch (err) {
          if (err.status === 409) return reassignCollection(del.dataset.delete, del.dataset.name, pane);
          AV.toast(AV.firstErr(err), 'err');
          del.disabled = false;
        }
      }
    });
  } catch (e) {
    fail(pane, e);
  }
}

/* Deleting a collection that still holds products is refused by the server
   unless a destination is named. This dialog is that destination: the products
   move (union, never duplicated) and then the empty collection is deleted. */
async function reassignCollection(id, name, pane) {
  const { body } = dialog('Move products, then delete');
  C.loading(body, 'Loading…');
  let items;
  try {
    items = (await AV.api.get('/api/admin/collections?includeArchived=true')).data.items.filter((c) => c.id !== id);
  } catch (err) {
    C.error(body, err, { retry: () => reassignCollection(id, name, pane), level: 'h2' });
    return;
  }
  if (!items.length) {
    body.innerHTML = `<p class="note">“${AV.esc(name)}” still holds products, and there is no other collection to move them into. Archive it instead.</p>
      <button class="btn btn-light" type="button" data-close>Close</button>`;
    AV.qs('[data-close]', body)?.addEventListener('click', () => AV.qs('#admDialog').close());
    return;
  }
  body.innerHTML = `
    <p class="note">“${AV.esc(name)}” still holds products. Choose the collection they should move into; existing memberships there are kept.</p>
    <form id="reassignForm" class="adm-form">
      ${field('Move products to', `<select name="target">${items.map((c) => `<option value="${AV.esc(c.id)}">${AV.esc(c.name)}${c.active ? '' : ' (archived)'}</option>`).join('')}</select>`)}
      <button class="btn btn-light" type="submit">Move products and delete</button>
      <p class="form-msg"></p>
    </form>`;
  onSubmit(AV.qs('#reassignForm', body), async (f) => {
    const target = f.elements.target.value;
    await AV.api.del(`/api/admin/collections/${encodeURIComponent(id)}?reassignTo=${encodeURIComponent(target)}`);
    AV.toast('Products moved and collection deleted.', 'ok');
    AV.qs('#admDialog').close();
    collections(pane);
  });
}

async function collectionForm(id, pane) {
  const editing = Boolean(id);
  const { body } = dialog(editing ? 'Edit collection' : 'New collection');
  C.loading(body, 'Loading…');
  let c = null;
  try {
    if (editing) c = (await AV.api.get(`/api/admin/collections/${encodeURIComponent(id)}`)).data.collection;
  } catch (err) {
    C.error(body, err, { retry: () => collectionForm(id, pane), level: 'h2' });
    return;
  }
  body.innerHTML = `
    <form id="collectionForm" class="adm-form">
      ${field('Name', input('name', `required maxlength="120" value="${AV.esc(c?.name || '')}"`))}
      ${field('Link', input('slug', `maxlength="120" placeholder="derived from the name" value="${AV.esc(c?.slug || '')}"`))}
      ${field('Cover image path', input('image', `maxlength="300" placeholder="/assets/img/library/…" value="${AV.esc(c?.image || '')}"`))}
      ${field('Sort order', input('sortOrder', `type="number" step="1" value="${c?.sortOrder ?? 0}"`))}
      ${field('Description', `<textarea name="description" rows="3" maxlength="2000">${AV.esc(c?.description || '')}</textarea>`, { wide: true })}
      ${field('SEO title', input('seoTitle', `maxlength="70" value="${AV.esc(c?.seoTitle || '')}"`))}
      ${field('SEO description', input('seoDescription', `maxlength="170" value="${AV.esc(c?.seoDescription || '')}"`))}
      <label class="adm-check"><input type="checkbox" name="active"${!c || c.active ? ' checked' : ''}> Visible on the storefront</label>
      <label class="adm-check"><input type="checkbox" name="featured"${c?.featured ? ' checked' : ''}> Featured</label>
      <button class="btn btn-light" type="submit">${editing ? 'Save collection' : 'Create collection'}</button>
      <p class="form-msg"></p>
    </form>`;
  onSubmit(AV.qs('#collectionForm', body), async (f) => {
    const el = f.elements;
    const payload = {
      name: el.name.value.trim(),
      slug: el.slug.value.trim() || undefined,
      image: el.image.value.trim(),
      sortOrder: Number(el.sortOrder.value || 0),
      description: el.description.value.trim(),
      seoTitle: el.seoTitle.value.trim(),
      seoDescription: el.seoDescription.value.trim(),
      active: el.active.checked,
      featured: el.featured.checked,
    };
    if (editing) await AV.api.patch(`/api/admin/collections/${encodeURIComponent(id)}`, payload);
    else await AV.api.post('/api/admin/collections', payload);
    AV.toast(editing ? 'Collection updated.' : 'Collection created.', 'ok');
    AV.qs('#admDialog').close();
    collections(pane);
  });
}

async function collectionProducts(id, pane) {
  const { body } = dialog('Collection products');
  C.loading(body, 'Loading…');
  let detail;
  let products;
  try {
    [detail, products] = await Promise.all([
      AV.api.get(`/api/admin/collections/${encodeURIComponent(id)}`),
      AV.api.get('/api/admin/products?limit=200&sort=name&order=asc'),
    ]);
  } catch (err) {
    C.error(body, err, { retry: () => collectionProducts(id, pane), level: 'h2' });
    return;
  }
  const chosen = new Set(detail.data.collection.products || []);
  body.innerHTML = `
    <p class="note">Tick the products that belong in “${AV.esc(detail.data.collection.name)}”. A product can be in more than one collection.</p>
    <form id="membersForm" class="adm-form">
      <div class="wide" style="display:grid;gap:8px;max-height:50vh;overflow:auto">
        ${(products.data.items || []).map((p) => `<label class="adm-check"><input type="checkbox" name="product" value="${AV.esc(p.id)}"${chosen.has(p.id) ? ' checked' : ''}> ${AV.esc(p.name)} <span class="muted">${AV.esc(p.status)}</span></label>`).join('') || '<div class="empty">No products.</div>'}
      </div>
      <button class="btn btn-light" type="submit">Save membership</button>
      <p class="form-msg"></p>
    </form>`;
  onSubmit(AV.qs('#membersForm', body), async (f) => {
    const ids = [...f.querySelectorAll('input[name="product"]:checked')].map((x) => x.value);
    await AV.api.put(`/api/admin/collections/${encodeURIComponent(id)}/products`, { products: ids });
    AV.toast('Membership saved.', 'ok');
    AV.qs('#admDialog').close();
    collections(pane);
  });
}

/* ── Rituals ──────────────────────────────────────────────────── */
async function rituals(pane) {
  C.skeleton(pane, 4);
  try {
    const env = await AV.api.get('/api/admin/rituals?limit=100');
    const items = env.data.items || [];
    pane.innerHTML = `
      <div class="adm-toolbar">
        <p class="note" style="margin:0">Plain-text rituals: title, materials and numbered steps. Drafts never reach the storefront.</p>
        <span class="spacer"></span>
        <button class="btn btn-light btn-sm" type="button" data-new>+ New ritual</button>
      </div>
      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Ritual</th><th>Purpose</th><th>Duration</th><th>Steps</th><th>Status</th><th></th></tr></thead>
          <tbody>${items.map((r) => `<tr>
            <td><a href="/rituals/${encodeURIComponent(r.slug)}" target="_blank" rel="noopener">${AV.esc(r.title)}</a><div class="muted">${AV.esc(r.slug)}</div></td>
            <td>${AV.esc(fmt(r.purpose))}</td>
            <td>${AV.esc(fmt(r.duration))}</td>
            <td>${(r.steps || []).length}</td>
            <td>${statusPill(r.status)}</td>
            <td class="adm-actions">
              <button class="btn btn-ghost btn-sm" data-edit="${AV.esc(r.id)}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-toggle="${AV.esc(r.id)}" data-state="${r.status}">${r.status === 'archived' ? 'Restore' : 'Archive'}</button>
              <button class="btn btn-ghost btn-sm" data-delete="${AV.esc(r.id)}" data-name="${AV.esc(r.title)}">Delete</button>
            </td>
          </tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No rituals yet. Create the first one.</div>'}`;
    AV.qs('[data-new]', pane)?.addEventListener('click', () => ritualForm(null, pane));
    pane.querySelector('tbody')?.addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return ritualForm(edit.dataset.edit, pane);
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const archived = toggle.dataset.state === 'archived';
        toggle.disabled = true;
        try {
          await AV.api.post(`/api/admin/rituals/${encodeURIComponent(toggle.dataset.toggle)}/${archived ? 'restore' : 'archive'}`);
          AV.toast(archived ? 'Ritual restored to draft.' : 'Ritual archived.', 'ok');
          rituals(pane);
        } catch (err) {
          AV.toast(AV.firstErr(err), 'err');
          toggle.disabled = false;
        }
        return;
      }
      const del = e.target.closest('[data-delete]');
      if (del) {
        if (!confirm(`Permanently delete “${del.dataset.name}”? Archive it instead if you may want it later.`)) return;
        del.disabled = true;
        try {
          await AV.api.del(`/api/admin/rituals/${encodeURIComponent(del.dataset.delete)}`);
          AV.toast('Ritual deleted.', 'ok');
          rituals(pane);
        } catch (err) {
          AV.toast(AV.firstErr(err), 'err');
          del.disabled = false;
        }
      }
    });
  } catch (e) {
    fail(pane, e);
  }
}

async function ritualForm(id, pane) {
  const editing = Boolean(id);
  const { body } = dialog(editing ? 'Edit ritual' : 'New ritual');
  C.loading(body, 'Loading…');
  let r = null;
  let products = [];
  try {
    if (editing) r = (await AV.api.get(`/api/admin/rituals/${encodeURIComponent(id)}`)).data.ritual;
    products = (await AV.api.get('/api/admin/products?limit=200&sort=name&order=asc')).data.items || [];
  } catch (err) {
    C.error(body, err, { retry: () => ritualForm(id, pane), level: 'h2' });
    return;
  }
  const related = new Set((r?.relatedProducts || []).map((p) => p.id));
  const steps = (r?.steps || []).map((s) => `${s.title ? s.title + ' | ' : ''}${s.body}`).join('\n');

  body.innerHTML = `
    <p class="note">Plain text only — HTML is refused by the server. Materials go one per line. Steps go one per line as <code>Title | Body</code>. Do not promise medical results or guaranteed outcomes; the server refuses those claims.</p>
    <form id="ritualForm" class="adm-form">
      ${field('Title', input('title', `required maxlength="160" value="${AV.esc(r?.title || '')}"`))}
      ${field('Link', input('slug', `maxlength="160" placeholder="derived from the title" value="${AV.esc(r?.slug || '')}"`))}
      ${field('Purpose', input('purpose', `maxlength="160" placeholder="Grounding, clarity, rest…" value="${AV.esc(r?.purpose || '')}"`))}
      ${field('Duration', input('duration', `maxlength="80" placeholder="10 minutes" value="${AV.esc(r?.duration || '')}"`))}
      ${field('Status', `<select name="status">${['draft', 'active', 'archived'].map((v) => `<option value="${v}"${(r?.status || 'draft') === v ? ' selected' : ''}>${label(v)}</option>`).join('')}</select>`)}
      ${field('Intro', `<textarea name="intro" rows="2" maxlength="500" class="wide">${AV.esc(r?.intro || '')}</textarea>`, { wide: true })}
      ${field('Description', `<textarea name="description" rows="5" maxlength="6000">${AV.esc(r?.description || '')}</textarea>`, { wide: true })}
      ${field('Preparation', `<textarea name="preparation" rows="3" maxlength="2000">${AV.esc(r?.preparation || '')}</textarea>`, { wide: true })}
      ${field('Materials (one per line)', `<textarea name="materials" rows="4">${AV.esc((r?.materials || []).join('\n'))}</textarea>`)}
      ${field('Tags (one per line)', `<textarea name="tags" rows="4">${AV.esc((r?.tags || []).join('\n'))}</textarea>`)}
      ${field('Steps (Title | Body, one per line)', `<textarea name="steps" rows="7">${AV.esc(steps)}</textarea>`, { wide: true })}
      ${field('Image paths (one per line)', `<textarea name="images" rows="3" placeholder="/assets/img/library/…">${AV.esc((r?.images || []).join('\n'))}</textarea>`, { wide: true })}
      ${field('Image alt text (one per line)', `<textarea name="imageAlts" rows="2">${AV.esc((r?.imageAlts || []).join('\n'))}</textarea>`, { wide: true })}
      ${field('Related collections (slugs, comma separated)', input('relatedCollections', `maxlength="300" value="${AV.esc((r?.relatedCollections || []).join(', '))}"`), { wide: true })}
      ${field('Linked product', `<select name="linkedProduct"><option value="">None</option>${products.map((p) => `<option value="${AV.esc(p.id)}"${r?.linkedProduct?.id === p.id ? ' selected' : ''}>${AV.esc(p.name)}</option>`).join('')}</select>`)}
      ${field('Related products', `<div style="display:grid;gap:6px;max-height:160px;overflow:auto">${products.map((p) => `<label class="adm-check"><input type="checkbox" name="related" value="${AV.esc(p.id)}"${related.has(p.id) ? ' checked' : ''}> ${AV.esc(p.name)}</label>`).join('') || '<span class="muted">No products.</span>'}</div>`)}
      ${field('SEO title', input('seoTitle', `maxlength="70" value="${AV.esc(r?.seoTitle || '')}"`))}
      ${field('SEO description', input('seoDescription', `maxlength="170" value="${AV.esc(r?.seoDescription || '')}"`))}
      <label class="adm-check"><input type="checkbox" name="featured"${r?.featured ? ' checked' : ''}> Featured</label>
      <button class="btn btn-light" type="submit">${editing ? 'Save ritual' : 'Create ritual'}</button>
      <p class="form-msg"></p>
    </form>`;

  onSubmit(AV.qs('#ritualForm', body), async (f) => {
    const el = f.elements;
    const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
    const payload = {
      title: el.title.value.trim(),
      slug: el.slug.value.trim() || undefined,
      purpose: el.purpose.value.trim(),
      duration: el.duration.value.trim(),
      status: el.status.value,
      intro: el.intro.value.trim(),
      description: el.description.value.trim(),
      preparation: el.preparation.value.trim(),
      materials: lines(el.materials.value),
      tags: lines(el.tags.value),
      steps: lines(el.steps.value).map((line) => {
        const [title, ...rest] = line.split('|');
        return rest.length ? { title: title.trim(), body: rest.join('|').trim() } : { title: '', body: line };
      }),
      images: lines(el.images.value),
      imageAlts: lines(el.imageAlts.value),
      relatedCollections: el.relatedCollections.value.split(',').map((x) => x.trim()).filter(Boolean),
      relatedProducts: [...f.querySelectorAll('input[name="related"]:checked')].map((x) => x.value),
      linkedProduct: el.linkedProduct.value || null,
      seoTitle: el.seoTitle.value.trim(),
      seoDescription: el.seoDescription.value.trim(),
      featured: el.featured.checked,
    };
    if (editing) await AV.api.patch(`/api/admin/rituals/${encodeURIComponent(id)}`, payload);
    else await AV.api.post('/api/admin/rituals', payload);
    AV.toast(editing ? 'Ritual updated.' : 'Ritual created.', 'ok');
    AV.qs('#admDialog').close();
    rituals(pane);
  });
}

/* ── Blog ─────────────────────────────────────────────────────── */
async function blog(pane) {
  C.skeleton(pane, 4);
  try {
    const env = await AV.api.get('/api/admin/blog?limit=100');
    const items = env.data.items || [];
    pane.innerHTML = `
      <div class="adm-toolbar">
        <p class="note" style="margin:0">Journal posts. Drafts are private; published posts drive /journal and /article.</p>
        <span class="spacer"></span>
        <button class="btn btn-light btn-sm" type="button" data-new>+ New post</button>
      </div>
      ${items.length
        ? `<div class="table-wrap"><table>
          <thead><tr><th>Post</th><th>Category</th><th>Published</th><th>Status</th><th></th></tr></thead>
          <tbody>${items.map((p) => `<tr>
            <td>${AV.esc(p.title)}<div class="muted">${AV.esc(p.slug)}</div></td>
            <td>${AV.esc(fmt(p.category))}</td>
            <td>${p.publishedAt ? AV.formatDate(p.publishedAt) : '<span class="muted">Unpublished</span>'}</td>
            <td>${statusPill(p.status)}</td>
            <td class="adm-actions">
              <button class="btn btn-ghost btn-sm" data-edit="${AV.esc(p.id)}">Edit</button>
              <button class="btn btn-ghost btn-sm" data-toggle="${AV.esc(p.id)}" data-state="${p.status}">${p.status === 'archived' ? 'Restore' : 'Archive'}</button>
              <button class="btn btn-ghost btn-sm" data-delete="${AV.esc(p.id)}" data-name="${AV.esc(p.title)}">Delete</button>
            </td>
          </tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No journal posts yet.</div>'}`;
    AV.qs('[data-new]', pane)?.addEventListener('click', () => blogForm(null, pane));
    pane.querySelector('tbody')?.addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit]');
      if (edit) return blogForm(edit.dataset.edit, pane);
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const archived = toggle.dataset.state === 'archived';
        toggle.disabled = true;
        try {
          await AV.api.post(`/api/admin/blog/${encodeURIComponent(toggle.dataset.toggle)}/${archived ? 'restore' : 'archive'}`);
          AV.toast(archived ? 'Post restored to draft.' : 'Post archived.', 'ok');
          blog(pane);
        } catch (err) {
          AV.toast(AV.firstErr(err), 'err');
          toggle.disabled = false;
        }
        return;
      }
      const del = e.target.closest('[data-delete]');
      if (del) {
        if (!confirm(`Permanently delete “${del.dataset.name}”?`)) return;
        del.disabled = true;
        try {
          await AV.api.del(`/api/admin/blog/${encodeURIComponent(del.dataset.delete)}`);
          AV.toast('Post deleted.', 'ok');
          blog(pane);
        } catch (err) {
          AV.toast(AV.firstErr(err), 'err');
          del.disabled = false;
        }
      }
    });
  } catch (e) {
    fail(pane, e);
  }
}

async function blogForm(id, pane) {
  const editing = Boolean(id);
  const { body } = dialog(editing ? 'Edit journal post' : 'New journal post');
  C.loading(body, 'Loading…');
  let p = null;
  try {
    if (editing) p = (await AV.api.get(`/api/admin/blog/${encodeURIComponent(id)}`)).data.post;
  } catch (err) {
    C.error(body, err, { retry: () => blogForm(id, pane), level: 'h2' });
    return;
  }
  body.innerHTML = `
    <p class="note">Plain text only. Separate paragraphs with a blank line.</p>
    <form id="blogForm" class="adm-form">
      ${field('Title', input('title', `required maxlength="200" value="${AV.esc(p?.title || '')}"`))}
      ${field('Link', input('slug', `maxlength="200" placeholder="derived from the title" value="${AV.esc(p?.slug || '')}"`))}
      ${field('Category', input('category', `maxlength="80" value="${AV.esc(p?.category || 'journal')}"`))}
      ${field('Status', `<select name="status">${['draft', 'active', 'archived'].map((v) => `<option value="${v}"${(p?.status || 'draft') === v ? ' selected' : ''}>${label(v)}</option>`).join('')}</select>`)}
      ${field('Author', input('author', `maxlength="120" value="${AV.esc(p?.author || 'Astro Vetro')}"`))}
      ${field('Cover image path', input('image', `maxlength="300" placeholder="/assets/img/library/…" value="${AV.esc(p?.image || '')}"`))}
      ${field('Cover alt text', input('imageAlt', `maxlength="300" value="${AV.esc(p?.imageAlt || '')}"`))}
      ${field('Tags (comma separated)', input('tags', `maxlength="300" value="${AV.esc((p?.tags || []).join(', '))}"`))}
      ${field('Excerpt', `<textarea name="excerpt" rows="3" maxlength="500">${AV.esc(p?.excerpt || '')}</textarea>`, { wide: true })}
      ${field('Content', `<textarea name="content" rows="12" maxlength="40000">${AV.esc(p?.content || '')}</textarea>`, { wide: true })}
      ${field('SEO title', input('seoTitle', `maxlength="70" value="${AV.esc(p?.seoTitle || '')}"`))}
      ${field('SEO description', input('seoDescription', `maxlength="170" value="${AV.esc(p?.seoDescription || '')}"`))}
      <label class="adm-check"><input type="checkbox" name="featured"${p?.featured ? ' checked' : ''}> Featured</label>
      <button class="btn btn-light" type="submit">${editing ? 'Save post' : 'Create post'}</button>
      <p class="form-msg"></p>
    </form>`;
  onSubmit(AV.qs('#blogForm', body), async (f) => {
    const el = f.elements;
    const payload = {
      title: el.title.value.trim(),
      slug: el.slug.value.trim() || undefined,
      category: el.category.value.trim(),
      status: el.status.value,
      author: el.author.value.trim(),
      image: el.image.value.trim(),
      imageAlt: el.imageAlt.value.trim(),
      tags: el.tags.value.split(',').map((x) => x.trim()).filter(Boolean),
      excerpt: el.excerpt.value.trim(),
      content: el.content.value.trim(),
      seoTitle: el.seoTitle.value.trim(),
      seoDescription: el.seoDescription.value.trim(),
      featured: el.featured.checked,
    };
    if (editing) await AV.api.patch(`/api/admin/blog/${encodeURIComponent(id)}`, payload);
    else await AV.api.post('/api/admin/blog', payload);
    AV.toast(editing ? 'Post updated.' : 'Post created.', 'ok');
    AV.qs('#admDialog').close();
    blog(pane);
  });
}

/* ── Website content ──────────────────────────────────────────── */
async function content(pane) {
  C.skeleton(pane, 4);
  try {
    const c = (await AV.api.get('/api/admin/content/homepage')).data.content;
    const h = c.homepage || {};
    const contact = c.contact || {};
    pane.innerHTML = `
      <p class="note" style="margin-bottom:16px">Fixed homepage placements. Plain text only; changes appear on <a href="/home.html" target="_blank" rel="noopener">the home page</a> immediately.</p>
      <form id="contentForm" class="adm-form">
        <h3 class="wide">Hero</h3>
        ${field('Eyebrow', input('heroEyebrow', `maxlength="80" value="${AV.esc(h.heroEyebrow || '')}"`))}
        ${field('Title', input('heroTitle', `maxlength="160" value="${AV.esc(h.heroTitle || '')}"`))}
        ${field('Intro', `<textarea name="heroIntro" rows="4" maxlength="1200">${AV.esc(h.heroIntro || '')}</textarea>`, { wide: true })}
        <h3 class="wide">Collection section</h3>
        ${field('Eyebrow', input('productsEyebrow', `maxlength="80" value="${AV.esc(h.productsEyebrow || '')}"`))}
        ${field('Title', input('productsTitle', `maxlength="160" value="${AV.esc(h.productsTitle || '')}"`))}
        <h3 class="wide">Rituals section</h3>
        ${field('Eyebrow', input('ritualsEyebrow', `maxlength="80" value="${AV.esc(h.ritualsEyebrow || '')}"`))}
        ${field('Title', input('ritualsTitle', `maxlength="160" value="${AV.esc(h.ritualsTitle || '')}"`))}
        ${field('Body', `<textarea name="ritualsBody" rows="4" maxlength="1200">${AV.esc(h.ritualsBody || '')}</textarea>`, { wide: true })}
        ${field('Button label', input('ritualsCtaLabel', `maxlength="60" value="${AV.esc(h.ritualsCtaLabel || '')}"`))}
        ${field('Button link', input('ritualsCtaHref', `maxlength="300" placeholder="/rituals" value="${AV.esc(h.ritualsCtaHref || '')}"`))}
        <h3 class="wide">Journal section</h3>
        ${field('Eyebrow', input('journalEyebrow', `maxlength="80" value="${AV.esc(h.journalEyebrow || '')}"`))}
        ${field('Title', input('journalTitle', `maxlength="160" value="${AV.esc(h.journalTitle || '')}"`))}
        <h3 class="wide">Announcement & SEO</h3>
        ${field('Announcement', input('announcement', `maxlength="200" value="${AV.esc(h.announcement || '')}"`))}
        ${field('SEO title', input('seoTitle', `maxlength="70" value="${AV.esc(h.seoTitle || '')}"`))}
        ${field('SEO description', `<textarea name="seoDescription" rows="2" maxlength="170">${AV.esc(h.seoDescription || '')}</textarea>`, { wide: true })}
        <label class="adm-check"><input type="checkbox" name="announcementActive"${h.announcementActive ? ' checked' : ''}> Show announcement bar</label>
        <h3 class="wide">Contact details</h3>
        ${field('Email', input('contactEmail', `type="email" maxlength="160" value="${AV.esc(contact.email || '')}"`))}
        ${field('Phone', input('contactPhone', `maxlength="40" value="${AV.esc(contact.phone || '')}"`))}
        ${field('Address', input('contactAddress', `maxlength="300" value="${AV.esc(contact.address || '')}"`))}
        ${field('Hours', input('contactHours', `maxlength="160" value="${AV.esc(contact.hours || '')}"`))}
        <button class="btn btn-light" type="submit">Save homepage content</button>
        <p class="form-msg"></p>
      </form>`;
    onSubmit(AV.qs('#contentForm', pane), async (f) => {
      const el = f.elements;
      const payload = {
        homepage: {
          heroEyebrow: el.heroEyebrow.value.trim(),
          heroTitle: el.heroTitle.value.trim(),
          heroIntro: el.heroIntro.value.trim(),
          productsEyebrow: el.productsEyebrow.value.trim(),
          productsTitle: el.productsTitle.value.trim(),
          ritualsEyebrow: el.ritualsEyebrow.value.trim(),
          ritualsTitle: el.ritualsTitle.value.trim(),
          ritualsBody: el.ritualsBody.value.trim(),
          ritualsCtaLabel: el.ritualsCtaLabel.value.trim(),
          ritualsCtaHref: el.ritualsCtaHref.value.trim(),
          journalEyebrow: el.journalEyebrow.value.trim(),
          journalTitle: el.journalTitle.value.trim(),
          announcement: el.announcement.value.trim(),
          announcementActive: el.announcementActive.checked,
          seoTitle: el.seoTitle.value.trim(),
          seoDescription: el.seoDescription.value.trim(),
        },
        contact: {
          email: el.contactEmail.value.trim(),
          phone: el.contactPhone.value.trim(),
          address: el.contactAddress.value.trim(),
          hours: el.contactHours.value.trim(),
        },
      };
      await AV.api.put('/api/admin/content/homepage', payload);
      AV.toast('Homepage content saved.', 'ok');
      content(pane);
    });
  } catch (e) {
    fail(pane, e);
  }
}

init();
