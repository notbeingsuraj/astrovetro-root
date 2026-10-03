/* Astro Vetro — API client. Talks to the backend through the same-origin /api proxy.
   Every backend response uses the envelope: { success, message, data, meta }. */

window.AV = window.AV || {};

(async function () {
  async function request(method, path, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
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
      throw e;
    }
    return data;
  }

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
        caps = Object.assign({ reachable: true, database: false, writable: false }, env && env.data);
        return caps;
      })
      .catch(() => {
        caps = { reachable: false, provider: 'unknown', database: false, writable: false };
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
  AV.toast = (msg, type = 'ok') => {
    let wrap = AV.qs('.toast-wrap') || (() => {
      const d = document.createElement('div');
      d.className = 'toast-wrap';
      document.body.appendChild(d);
      return d;
    })();
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    wrap.appendChild(t);
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
})();