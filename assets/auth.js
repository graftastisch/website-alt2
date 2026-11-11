'use strict';
/* ==========================================================
   Gemeinsames Login für alle Seiten dieser Website (Supabase Auth)

   Einbinden (Pfad je nach Ordner):
     <script src="../assets/config.js"></script>
     <script src="../assets/auth.js"></script>
     <script>Auth.guard('../login/');</script>      ← schützt die Seite

   Danach stehen bereit:
     Auth.session()            aktuelle Sitzung oder null
     Auth.username()           Nutzername der Sitzung
     Auth.token()              gültiges Zugangs-Token (wird bei Bedarf erneuert) – für Aufrufe an Supabase
     Auth.login(name, pw)      anmelden (Name ohne "@" wird zu name@LOGIN_EMAIL_DOMAIN)
     Auth.logout()             abmelden
     Auth.changePassword(pw)   Passwort ändern
   Die Sitzung liegt im localStorage dieser Website – ein Login gilt also für alle Seiten darunter.
   ========================================================== */
(() => {
  const URL_ = String(window.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const KEY = String(window.SUPABASE_KEY || '').trim();
  const DOMAIN = String(window.LOGIN_EMAIL_DOMAIN || 'graftastisch.app').trim();
  const STORE = 'graftastisch-session';
  const ENABLED = !!(URL_ && KEY);

  class AuthError extends Error {
    constructor(message, code, status) { super(message); this.code = code; this.status = status || 0; }
  }

  // Sitzung speichern (localStorage; Notlösung im Arbeitsspeicher, falls der Browser das blockiert)
  let mem = null;
  const read = () => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s && s.access_token && s.refresh_token) return s;
    } catch { /* ignorieren */ }
    return mem && mem.access_token ? mem : null;
  };
  const write = s => {
    mem = s;
    try { if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE); } catch { /* ignorieren */ }
  };

  async function call(path, { method = 'POST', body, token } = {}) {
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    else if (KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + KEY;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let r;
    try {
      r = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal, cache: 'no-store' });
    } catch {
      throw new AuthError('Keine Verbindung zum Server.', 'network');
    } finally { clearTimeout(timer); }
    let data = null;
    try { data = await r.json(); } catch { /* leere Antwort */ }
    if (!r.ok) {
      const d = data || {};
      throw new AuthError(d.msg || d.error_description || d.message || `Fehler ${r.status}`, d.error_code || d.error || 'error', r.status);
    }
    return data;
  }

  const toSession = (d, prev) => ({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: Date.now() + (d.expires_in ? d.expires_in * 1000 : 3600 * 1000),
    user: d.user ? { id: d.user.id, email: d.user.email } : (prev && prev.user) || null,
  });

  function toEmail(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) throw new AuthError('Bitte Nutzernamen eingeben.', 'empty_username');
    if (n.includes('@')) return n;
    if (!/^[a-z0-9._-]+$/.test(n)) throw new AuthError('Ungültiger Nutzername.', 'invalid_username');
    return `${n}@${DOMAIN}`;
  }

  let refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    const s = read();
    if (!s) return Promise.reject(new AuthError('Nicht angemeldet.', 'no_session'));
    refreshing = call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } })
      .then(d => { const n = toSession(d, s); write(n); return n; })
      .catch(e => {
        if (e.status >= 400 && e.status < 500) write(null);   // Erneuerung abgelehnt → abgemeldet
        throw e;
      })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  async function token() {
    let s = read();
    if (!s) throw new AuthError('Nicht angemeldet.', 'no_session');
    if (s.expires_at - Date.now() < 60000) s = await refresh();
    return s.access_token;
  }

  async function login(name, password) {
    const email = toEmail(name);
    if (!password) throw new AuthError('Bitte Passwort eingeben.', 'empty_password');
    const d = await call('/auth/v1/token?grant_type=password', { body: { email, password } });
    const s = toSession(d);
    write(s);
    return s;
  }

  async function logout() {
    const s = read();
    write(null);
    if (s) { try { await call('/auth/v1/logout?scope=local', { token: s.access_token }); } catch { /* Sitzung ist lokal schon beendet */ } }
  }

  async function changePassword(password) {
    return call('/auth/v1/user', { method: 'PUT', token: await token(), body: { password } });
  }

  const username = () => {
    const s = read();
    const mail = (s && s.user && s.user.email) || '';
    return mail.endsWith('@' + DOMAIN) ? mail.slice(0, -(DOMAIN.length + 1)) : mail;
  };

  // Seite schützen: ohne Sitzung sofort zum Login (danach zurück zur ursprünglichen Seite)
  function guard(loginUrl) {
    if (!ENABLED || read()) return true;
    document.documentElement.style.visibility = 'hidden';
    location.replace(`${loginUrl}?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
    return false;
  }

  window.Auth = { enabled: ENABLED, session: read, username, token, refresh, login, logout, changePassword, guard, AuthError };
})();
