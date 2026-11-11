'use strict';
/* ==========================================================
   Wochenplan – Logik
   Alles läuft im Browser; gespeichert wird in IndexedDB
   (dort passen auch Bilder und Videos hinein).
   ========================================================== */
(() => {
  // ---------- Konstanten ----------
  const START_H = 6;          // Plan beginnt um 06:00
  const END_H = 23;           // Plan endet um 23:00
  const ROW = 56;             // Höhe einer Stunde in px
  const SNAP = 5;             // Einrasten in Minuten
  const ROWS = END_H - START_H;
  const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const DAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const SWATCHES = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#5ac8fa', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#8e8e93'];

  const DEFAULT_TEMPLATES = [
    { id: 'event', name: 'Termin', emoji: '📅', color: '#007aff', dur: 60 },
    { id: 'sport', name: 'Sport',  emoji: '🏃', color: '#34c759', dur: 60 },
  ];

  const NONE_TPL = { id: 'none', name: 'Keine Kategorie', emoji: '📌', color: '#8e8e93', dur: 60 };

  const state = { events: [], customTemplates: [], overrides: {} };
  const todayIdx = (new Date().getDay() + 6) % 7;

  // ---------- Helfer ----------
  const $ = (s, r = document) => r.querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const fmt = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const toMin = s => { const [a, b] = String(s).split(':').map(Number); return a * 60 + b; };
  const fmtDur = d => d < 60 ? `${d} Min.` : `${String(d / 60).replace('.', ',')} Std.`;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const allTemplates = () => [...DEFAULT_TEMPLATES.map(t => ({ ...t, ...(state.overrides[t.id] || {}) })), ...state.customTemplates];
  const snap = t => ({ id: t.id, name: t.name, emoji: t.emoji, color: t.color });
  // Aktuelle Darstellung eines Termins: folgt seiner Feldart, solange diese existiert
  const tplOf = ev => { const t = [...allTemplates(), NONE_TPL].find(x => x.id === ev.tpl.id); return t ? snap(t) : ev.tpl; };

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid);
    }
    return e;
  }

  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status', text: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), 2800);
  }

  // ---------- Speicherung ----------
  // Mit Datenbank-Zugang (assets/config.js) liegen alle Daten in Supabase und jedes Gerät
  // sieht dasselbe. Ohne Zugang bleibt alles lokal im Browser (IndexedDB).
  // IndexedDB dient mit Zugang zusätzlich als Zwischenspeicher, damit der Plan sofort da ist.
  const SB_URL = String(window.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const SB_KEY = String(window.SUPABASE_KEY || '').trim();
  const REMOTE = !!(SB_URL && SB_KEY);
  const BUCKET = 'plan-media';
  const MAX_FILE_MB = REMOTE ? 50 : 150;   // Free-Tier von Supabase: 50 MB pro Datei
  const SYNC_MS = 15000;                   // Abgleich alle 15 Sekunden (zusätzlich beim Zurückkehren zum Tab)

  const DB_NAME = 'wochenplan', STORE = 'kv';
  const openDb = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  async function load() {
    try {
      const db = await openDb();
      return await new Promise((res, rej) => {
        const q = db.transaction(STORE).objectStore(STORE).get('state');
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    } catch { return null; }
  }
  let saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const db = await openDb();
        await new Promise((res, rej) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ events: state.events, customTemplates: state.customTemplates, overrides: state.overrides }, 'state');
          tx.oncomplete = res;
          tx.onerror = tx.onabort = () => rej(tx.error);
        });
      } catch {
        if (!REMOTE) toast('Speichern im Browser nicht möglich (Speicher voll oder privater Modus).');
      }
    }, 150);
  }

  // ---------- Datenbank (Supabase, nur REST – keine Bibliothek nötig) ----------
  const STATUS_TEXT = { ok: 'Synchronisiert', busy: 'Synchronisiere …', err: 'Keine Verbindung', local: 'Nur auf diesem Gerät' };
  function setStatus(s) {
    const el = $('#syncState');
    if (!el) return;
    el.dataset.state = s;
    el.textContent = STATUS_TEXT[s] || '';
  }

  function goLogin() {
    location.replace('../login/?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
  }
  // Sitzung ungültig (abgemeldet oder abgelaufen) → zum Login; bei reinen Netzwerkfehlern nicht
  const sessionLost = e => e && (e.code === 'no_session' || (e.status >= 400 && e.status < 500));

  async function api(path, { method = 'GET', body, prefer, raw } = {}, retry = true) {
    let token;
    try { token = await Auth.token(); }
    catch (e) { if (sessionLost(e)) goLogin(); throw e; }
    const headers = { apikey: SB_KEY, Authorization: 'Bearer ' + token };
    if (prefer) headers.Prefer = prefer;
    let payload = raw;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), raw ? 180000 : 15000);
    try {
      const r = await fetch(SB_URL + path, { method, headers, body: payload, signal: ctrl.signal, cache: 'no-store' });
      if (r.status === 401 && retry) {   // Token abgelaufen? Einmal erneuern und wiederholen
        try { await Auth.refresh(); } catch (e) { if (sessionLost(e)) goLogin(); throw e; }
        return await api(path, { method, body, prefer, raw }, false);
      }
      if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 300)}`);
      return (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
    } finally { clearTimeout(timer); }
  }

  const encPath = p => p.split('/').map(encodeURIComponent).join('/');
  const safeName = n => String(n || 'datei').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(-60) || 'datei';
  // Der Speicher ist privat: Bilder/Videos werden über signierte Links (1 Std. gültig) geladen
  const signed = new Map();   // Pfad → { url, exp }
  async function signPaths(paths) {
    const need = [...new Set(paths)].filter(p => { const s = signed.get(p); return !s || s.exp - Date.now() < 300000; });
    if (!need.length) return;
    const res = await api(`/storage/v1/object/sign/${BUCKET}`, { method: 'POST', body: { expiresIn: 3600, paths: need } });
    need.forEach((p, i) => {
      const r = (res || [])[i];
      if (r && r.signedURL && !r.error) signed.set(p, { url: `${SB_URL}/storage/v1${r.signedURL}`, exp: Date.now() + 3600 * 1000 });
    });
  }
  function mediaSrc(m) {
    if (m.blob) return urlOf(m.blob);
    const s = signed.get(m.path);
    return s ? s.url : '';
  }

  async function uploadFile(path, blob, name) {
    const fd = new FormData();
    fd.append('cacheControl', '31536000');
    fd.append('', blob, name);   // genau wie die offizielle Supabase-Bibliothek
    await api(`/storage/v1/object/${BUCKET}/${encPath(path)}`, { method: 'POST', raw: fd });
  }
  function removeFiles(paths) {
    if (!paths.length) return;
    api(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: paths } }).catch(e => console.warn('Dateien nicht gelöscht', e));
  }

  const stripMedia = m => { const { blob, ...rest } = m; return rest; };
  const toRow = ev => ({
    id: ev.id, title: ev.title, description: ev.desc || '',
    day: ev.day, start_min: ev.start, end_min: ev.end,
    tpl_id: ev.tpl.id, tpl_name: ev.tpl.name, tpl_emoji: ev.tpl.emoji, tpl_color: ev.tpl.color,
    loc_text: (ev.location && ev.location.text) || '', loc_label: (ev.location && ev.location.label) || null,
    loc_lat: ev.location && ev.location.lat != null ? ev.location.lat : null,
    loc_lon: ev.location && ev.location.lon != null ? ev.location.lon : null,
    media: (ev.media || []).map(stripMedia),
  });
  const fromRow = r => ({
    id: r.id, title: r.title, desc: r.description || '', day: r.day, start: r.start_min, end: r.end_min,
    tpl: { id: r.tpl_id, name: r.tpl_name, emoji: r.tpl_emoji, color: r.tpl_color },
    location: { text: r.loc_text || '', lat: r.loc_lat, lon: r.loc_lon, label: r.loc_label },
    media: Array.isArray(r.media) ? r.media : [],
  });

  async function pushEvent(ev) {
    const uploaded = [];
    try {
      const media = [];
      for (const m of ev.media || []) {
        if (m.blob) {
          const name = safeName(m.name);
          const path = `${ev.id}/${uid()}-${name}`;
          await uploadFile(path, m.blob, name);
          uploaded.push(path);
          media.push({ type: m.type, path, name: m.name || null });
        } else media.push(stripMedia(m));
      }
      const row = toRow({ ...ev, media });
      await api('/rest/v1/events?on_conflict=id', { method: 'POST', body: [row], prefer: 'resolution=merge-duplicates,return=minimal' });
      return fromRow(row);
    } catch (e) {
      removeFiles(uploaded);   // nichts Verwaistes zurücklassen
      throw e;
    }
  }
  const pushTemplate = t => api('/rest/v1/templates?on_conflict=id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: [{ id: t.id, name: t.name, emoji: t.emoji, color: t.color, dur: t.dur, custom: !!t.custom }],
  });

  async function remoteLoad() {
    const [evs, tpls] = await Promise.all([
      api('/rest/v1/events?select=*&order=created_at.asc,id.asc'),
      api('/rest/v1/templates?select=*&order=created_at.asc,id.asc'),
    ]);
    return {
      events: evs.map(fromRow),
      customTemplates: tpls.filter(r => r.custom).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, color: r.color, dur: r.dur, custom: true })),
      overrides: Object.fromEntries(tpls.filter(r => !r.custom).map(r => [r.id, { name: r.name, emoji: r.emoji, color: r.color, dur: r.dur }])),
    };
  }

  // Führt eine Datenbank-Aktion aus und zeigt dabei den Status an (ohne Zugang: nichts zu tun)
  let pending = 0;
  async function remoteOp(fn) {
    if (!REMOTE) return;
    pending++; setStatus('busy');
    try { await fn(); setStatus('ok'); }
    catch (e) { console.error(e); setStatus('err'); throw e; }
    finally { pending--; }
  }

  async function commitEvent(ev) {
    let saved = ev;
    await remoteOp(async () => {
      const old = state.events.find(e => e.id === ev.id);
      saved = await pushEvent(ev);
      const keep = new Set(saved.media.map(m => m.path).filter(Boolean));
      removeFiles(((old && old.media) || []).map(m => m.path).filter(p => p && !keep.has(p)));
    });
    const i = state.events.findIndex(x => x.id === saved.id);
    if (i >= 0) state.events[i] = saved; else state.events.push(saved);
    persist(); renderEvents();
  }
  async function removeEvent(ev) {
    await remoteOp(async () => {
      await api(`/rest/v1/events?id=eq.${encodeURIComponent(ev.id)}`, { method: 'DELETE' });
      removeFiles((ev.media || []).map(m => m.path).filter(Boolean));
    });
    state.events = state.events.filter(e => e.id !== ev.id);
    persist(); renderEvents();
  }

  // Abgleich: holt den Stand der Datenbank und zeigt ihn an, wenn er sich geändert hat
  const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
  const snapshot = () => stable({ events: state.events, customTemplates: state.customTemplates, overrides: state.overrides });

  // Einmalig pro Gerät: bisher nur lokal gespeicherte Daten in die Datenbank übernehmen
  async function migrateLocal(remote) {
    const evIds = new Set(remote.events.map(e => e.id));
    const tIds = new Set([...remote.customTemplates.map(t => t.id), ...Object.keys(remote.overrides)]);
    let failed = 0;
    const tryPush = async fn => { try { await fn(); } catch (e) { failed++; console.error(e); } };
    for (const t of state.customTemplates) if (!tIds.has(t.id)) await tryPush(() => pushTemplate({ ...t, custom: true }));
    for (const [id, o] of Object.entries(state.overrides)) if (!tIds.has(id)) await tryPush(() => pushTemplate({ id, ...o, custom: false }));
    for (const ev of state.events) if (!evIds.has(ev.id)) await tryPush(() => pushEvent(ev));
    return failed;
  }

  let syncing = false;
  async function sync({ silent = false } = {}) {
    if (!REMOTE || syncing || pending > 0) return;
    syncing = true;
    if (!silent) setStatus('busy');
    try {
      let remote = await remoteLoad();
      let migrated = false;
      try { migrated = localStorage.getItem('wochenplan-synced') === '1'; } catch { /* ignorieren */ }
      if (!migrated) {
        if (state.events.length || state.customTemplates.length || Object.keys(state.overrides).length) {
          toast('Bisherige Daten werden in die Datenbank übertragen …');
          const failed = await migrateLocal(remote);
          remote = await remoteLoad();
          if (failed) toast(`${failed} Eintrag/Einträge konnten nicht übertragen werden.`);
        }
        try { localStorage.setItem('wochenplan-synced', '1'); } catch { /* ignorieren */ }
      }
      if (!document.body.classList.contains('dragging') && stable(remote) !== snapshot()) {
        Object.assign(state, remote);
        persist(); renderPalette(); renderEvents();
      }
      setStatus('ok');
    } catch (e) {
      console.error(e);
      setStatus('err');
    } finally { syncing = false; }
  }

  // ---------- Raster ----------
  function buildGrid() {
    const week = $('#week');
    week.replaceChildren();
    const head = h('div', { class: 'week-head' },
      h('div'),
      DAYS.map((d, i) => h('div', { class: 'dayhead' + (i === todayIdx ? ' today' : '') },
        h('span', { class: 'dn-long', text: d }), h('span', { class: 'dn-short', text: DAYS_SHORT[i] }))));
    const timecol = h('div', { class: 'timecol' });
    for (let hh = START_H; hh <= END_H; hh++) {
      timecol.append(h('span', { class: 'tick', style: `top:${(hh - START_H) * ROW}px`, text: `${pad(hh)}:00` }));
    }
    const body = h('div', { class: 'week-body', id: 'weekBody' },
      timecol,
      DAYS.map((d, i) => h('div', { class: 'daycol' + (i === todayIdx ? ' today' : '') + (i >= 5 ? ' weekend' : ''), 'data-day': i, role: 'group', 'aria-label': d })),
      h('div', { class: 'empty-hint', id: 'emptyHint' }, h('b', { text: 'Dein Plan ist noch leer' }), 'Ziehe ein Feld auf einen Tag.'));
    week.append(head, body);

    body.addEventListener('click', e => {
      const ev = e.target.closest('.event');
      if (ev) { openViewer(ev.dataset.id); return; }
      const col = e.target.closest('.daycol');
      if (!col) return;
      const start = minutesAt(col, e.clientY);
      openEditor(newDraft(allTemplates()[0], +col.dataset.day, start, Math.min(start + 60, END_H * 60)), true);
    });
  }

  function minutesAt(col, clientY) {
    const r = col.getBoundingClientRect();
    let m = START_H * 60 + ((clientY - r.top) / ROW) * 60;
    m = Math.floor(m / SNAP) * SNAP;
    return Math.max(START_H * 60, Math.min(m, END_H * 60 - SNAP));
  }

  function placeBlock(el, start, end, inset = 0) {
    el.style.top = ((start - START_H * 60) / 60 * ROW + inset) + 'px';
    el.style.height = Math.max((end - start) / 60 * ROW - inset * 2, 18) + 'px';
  }

  function layoutDay(list) {
    const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
    const out = [];
    let cluster = [], clusterEnd = -1;
    const flush = () => {
      if (!cluster.length) return;
      const lanesEnd = [];
      const placed = cluster.map(ev => {
        let l = lanesEnd.findIndex(end => end <= ev.start);
        if (l < 0) { l = lanesEnd.length; lanesEnd.push(ev.end); } else lanesEnd[l] = ev.end;
        return { ev, lane: l };
      });
      placed.forEach(p => out.push({ ...p, lanes: lanesEnd.length }));
      cluster = [];
    };
    for (const ev of sorted) {
      if (cluster.length && ev.start >= clusterEnd) flush();
      clusterEnd = cluster.length ? Math.max(clusterEnd, ev.end) : ev.end;
      cluster.push(ev);
    }
    flush();
    return out;
  }

  function eventNode(ev, lane, lanes) {
    const heightPx = (ev.end - ev.start) / 60 * ROW;
    const t = tplOf(ev);
    const place = ev.location && ev.location.text ? locLabel(ev.location) : '';
    const hasMedia = ev.media && ev.media.length > 0;
    const n = h('button', {
      type: 'button', class: 'event' + (heightPx < 46 ? ' compact' : '') + (heightPx < ROW ? ' short' : ''), 'data-id': ev.id,
      'aria-label': `${ev.title}, ${fmt(ev.start)} bis ${fmt(ev.end)}` + (place ? `, ${place}` : ''),
      style: `--c:${t.color};left:calc(${lane / lanes * 100}% + 3px);width:calc(${100 / lanes}% - 6px)`,
    },
      h('span', { class: 'ev-title', text: ev.title }),
      h('span', { class: 'ev-time', text: `${fmt(ev.start)}–${fmt(ev.end)}` }),
      (place || hasMedia) ? h('span', { class: 'ev-meta' },
        place ? h('span', { class: 'ev-loc', text: `📍 ${place}` }) : null,
        hasMedia ? h('span', { class: 'ev-media', text: `🖼 ${ev.media.length}` }) : null) : null);
    placeBlock(n, ev.start, ev.end, 1);
    return n;
  }

  function renderEvents() {
    document.querySelectorAll('.daycol').forEach(col => {
      col.querySelectorAll('.event').forEach(n => n.remove());
      const list = state.events.filter(e => e.day === +col.dataset.day);
      for (const { ev, lane, lanes } of layoutDay(list)) col.append(eventNode(ev, lane, lanes));
    });
    $('#emptyHint').hidden = state.events.length > 0;
    updateNow();
  }

  function updateNow() {
    document.querySelectorAll('.now-line').forEach(n => n.remove());
    const d = new Date();
    const m = d.getHours() * 60 + d.getMinutes();
    if (m < START_H * 60 || m > END_H * 60) return;
    const col = document.querySelector(`.daycol[data-day="${todayIdx}"]`);
    if (!col) return;
    const line = h('div', { class: 'now-line' });
    line.style.top = ((m - START_H * 60) / 60 * ROW) + 'px';
    col.append(line);
  }

  // ---------- Palette & Drag-and-Drop ----------
  function renderPalette() {
    const list = $('#paletteList');
    list.replaceChildren();
    for (const t of allTemplates()) {
      const item = h('div', { class: 'tpl', style: `--c:${t.color}`, title: 'In den Plan ziehen', 'data-id': t.id },
        h('span', { class: 'tpl-ico', text: t.emoji }),
        h('span', { class: 'tpl-name' }, h('b', { text: t.name }), h('small', { text: fmtDur(t.dur) })),
        h('span', { class: 'grip', 'aria-hidden': 'true', text: '⋮⋮' }));
      item.append(h('span', { class: 'tpl-actions' },
        h('button', {
          type: 'button', class: 'tpl-btn', title: 'Feld anpassen', 'aria-label': `${t.name} anpassen`, text: '✎',
          onclick: ev => { ev.stopPropagation(); openTplDialog(t); },
        }),
        t.custom ? h('button', {
          type: 'button', class: 'tpl-btn del', title: 'Feld entfernen', 'aria-label': `${t.name} entfernen`, text: '×',
          onclick: ev => { ev.stopPropagation(); deleteCustom(t.id); },
        }) : null));
      attachDrag(item, t);
      list.append(item);
    }
  }

  async function deleteCustom(id) {
    if (!state.customTemplates.some(x => x.id === id)) return;
    try { await remoteOp(() => api(`/rest/v1/templates?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' })); }
    catch { toast('Nicht gelöscht – keine Verbindung zur Datenbank.'); return; }
    state.customTemplates = state.customTemplates.filter(x => x.id !== id);
    persist();
    renderPalette();
  }

  function attachDrag(item, tpl) {
    item.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.tpl-actions')) return;
      const sx = e.clientX, sy = e.clientY;
      let ghost = null, preview = null, target = null;

      const cleanup = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        ghost?.remove(); preview?.remove();
        document.body.classList.remove('dragging');
      };
      const move = ev => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          ghost = h('div', { class: 'drag-ghost', style: `--c:${tpl.color}`, text: `${tpl.emoji} ${tpl.name}` });
          document.body.append(ghost);
          document.body.classList.add('dragging');
        }
        ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 14}px)`;
        if (ev.clientY < 70) window.scrollBy(0, -14);
        else if (innerHeight - ev.clientY < 70) window.scrollBy(0, 14);

        const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.daycol');
        if (!col) { preview?.remove(); target = null; return; }
        const start = minutesAt(col, ev.clientY);
        const end = Math.min(start + tpl.dur, END_H * 60);
        target = { day: +col.dataset.day, start, end };
        if (!preview) preview = h('div', { class: 'drop-preview', style: `--c:${tpl.color}` });
        if (preview.parentNode !== col) col.append(preview);
        placeBlock(preview, start, end);
        preview.textContent = `${tpl.emoji} ${fmt(start)}–${fmt(end)}`;
      };
      const up = () => {
        const t = target;
        cleanup();
        if (t) openEditor(newDraft(tpl, t.day, t.start, t.end), true);
      };
      const cancel = () => cleanup();

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    });
  }

  // ---------- Termin-Entwurf ----------
  function newDraft(tpl, day, start, end) {
    return { id: uid(), title: '', desc: '', day, start, end, tpl: snap(tpl), location: { text: '', lat: null, lon: null }, media: [] };
  }
  const cloneEv = ev => ({ ...ev, tpl: { ...ev.tpl }, location: { ...(ev.location || { text: '', lat: null, lon: null }) }, media: [...(ev.media || [])] });

  // ---------- Medien ----------
  const blobUrls = new WeakMap();
  const urlOf = b => { let u = blobUrls.get(b); if (!u) { u = URL.createObjectURL(b); blobUrls.set(b, u); } return u; };

  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const bmp = await createImageBitmap(file);
    const max = 1600;
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (s === 1 && file.size < 600 * 1024) { bmp.close?.(); return file; }
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.85));
  }

  function parseLink(raw) {
    let u;
    try { u = new URL(raw.trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const s = u.href;
    let m = s.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
    if (m) return { type: 'embed', provider: 'youtube', id: m[1] };
    m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (m) return { type: 'embed', provider: 'vimeo', id: m[1] };
    if (/\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(u.pathname + u.search)) return { type: 'imageurl', url: s };
    if (/\.(mp4|webm|ogv|mov|m4v)(\?.*)?$/i.test(u.pathname + u.search)) return { type: 'videourl', url: s };
    return null;
  }

  function embedNode(m) {
    const yt = m.provider === 'youtube';
    const btn = h('button', {
      type: 'button', class: 'embed', 'aria-label': 'Video abspielen',
      style: yt ? `background-image:url(https://i.ytimg.com/vi/${m.id}/hqdefault.jpg)` : null,
    }, h('span', { class: 'play', text: '▶' }), h('span', { class: 'embed-label', text: yt ? 'YouTube' : 'Vimeo' }));
    btn.addEventListener('click', () => {
      const src = yt
        ? `https://www.youtube-nocookie.com/embed/${m.id}?autoplay=1&rel=0`
        : `https://player.vimeo.com/video/${m.id}?autoplay=1`;
      btn.replaceWith(h('iframe', {
        src, title: 'Video', allowfullscreen: true,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        referrerpolicy: 'strict-origin-when-cross-origin',
      }));
    });
    return btn;
  }

  function slideFor(m, onRemove) {
    const s = h('div', { class: 'slide' });
    if (m.type === 'image') s.append(h('img', { src: mediaSrc(m), alt: m.name || 'Bild', draggable: 'false' }));
    else if (m.type === 'imageurl') s.append(h('img', { src: m.url, alt: 'Bild', draggable: 'false', referrerpolicy: 'no-referrer' }));
    else if (m.type === 'video') s.append(h('video', { src: mediaSrc(m), controls: true, playsinline: true, preload: 'metadata' }));
    else if (m.type === 'videourl') s.append(h('video', { src: m.url, controls: true, playsinline: true, preload: 'metadata' }));
    else if (m.type === 'embed') s.append(embedNode(m));
    if (onRemove) {
      s.append(h('button', { type: 'button', class: 'slide-remove', title: 'Entfernen', 'aria-label': 'Entfernen', text: '×', onclick: () => onRemove(m) }));
    }
    return s;
  }

  // Diashow: nebeneinander, Swipe (Touch), Ziehen (Maus), Pfeile, Punkte, Tastatur
  function buildCarousel(media, { onRemove } = {}) {
    const wrap = h('div', { class: 'carousel' + (media.length < 2 ? ' single' : '') });
    const track = h('div', { class: 'track', tabindex: '0', role: 'group', 'aria-label': 'Bilder und Videos' });
    media.forEach(m => track.append(slideFor(m, onRemove)));
    const slides = () => [...track.children];
    const idx = () => {
      const c = track.scrollLeft + track.clientWidth / 2;
      let best = 0, bd = Infinity;
      slides().forEach((s, i) => { const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - c); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    const go = i => {
      const list = slides();
      const s = list[Math.max(0, Math.min(i, list.length - 1))];
      if (s) track.scrollTo({ left: s.offsetLeft + s.offsetWidth / 2 - track.clientWidth / 2, behavior: 'smooth' });
    };
    const dots = h('div', { class: 'dots' });
    media.forEach((_, i) => dots.append(h('button', { type: 'button', class: 'dot', 'aria-label': `Element ${i + 1}`, onclick: () => go(i) })));
    const prev = h('button', { type: 'button', class: 'nav prev', 'aria-label': 'Zurück', text: '‹', onclick: () => go(idx() - 1) });
    const next = h('button', { type: 'button', class: 'nav next', 'aria-label': 'Weiter', text: '›', onclick: () => go(idx() + 1) });
    const sync = () => {
      const i = idx();
      [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
      prev.disabled = i <= 0;
      next.disabled = i >= slides().length - 1;
    };
    track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
    track.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(idx() + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx() - 1); }
    });

    // Maus-Ziehen (Touch wird nativ vom Browser gewischt)
    let drag = null, moved = false, suppress = false;
    track.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target.closest('video, iframe, .slide-remove')) return;
      drag = { x: e.clientX, left: track.scrollLeft }; moved = false;
    });
    track.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!moved && Math.abs(dx) > 5) {
        moved = true;
        track.setPointerCapture(e.pointerId);
        track.classList.add('grabbing');
        track.style.scrollSnapType = 'none';
      }
      if (moved) track.scrollLeft = drag.left - dx;
    });
    const endDrag = () => {
      if (!drag) return;
      if (moved) {
        suppress = true;
        track.classList.remove('grabbing');
        track.style.scrollSnapType = '';
        go(idx());
      }
      drag = null;
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; } }, true);

    wrap.append(track, prev, next, dots);
    requestAnimationFrame(sync);
    return wrap;
  }

  // ---------- Karte (OpenStreetMap) ----------
  async function geocode(q) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&accept-language=de&q=' + encodeURIComponent(q), { signal: ctrl.signal });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j[0]) return null;
      return { lat: +j[0].lat, lon: +j[0].lon, label: placeLabel(j[0], q) };
    } catch { return null; } finally { clearTimeout(t); }
  }
  // Kurzname für den Plan: Name des Ortes, sonst Strasse mit Hausnummer
  function placeLabel(r, q) {
    const a = r.address || {};
    const road = a.road || a.pedestrian || a.footway || a.path || a.cycleway || a.square || '';
    const street = road ? road + (a.house_number ? ' ' + a.house_number : '') : '';
    const name = (r.name || '').trim();
    if (name && name !== road) return name;
    return street || name || String(q).split(',')[0].trim();
  }
  function locLabel(loc) {
    if (!loc) return '';
    return loc.label || String(loc.text || '').split(',')[0].trim();
  }
  function mapNode(loc) {
    const { lat, lon } = loc, d = 0.008;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${(lon - d * 1.6).toFixed(5)},${(lat - d).toFixed(5)},${(lon + d * 1.6).toFixed(5)},${(lat + d).toFixed(5)}&layer=mapnik&marker=${lat.toFixed(5)},${lon.toFixed(5)}`;
    return h('div', { class: 'map' },
      h('iframe', { src, loading: 'lazy', title: 'Karte', referrerpolicy: 'no-referrer' }),
      h('a', { class: 'map-link', href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`, target: '_blank', rel: 'noopener', text: 'In OpenStreetMap öffnen ↗' }));
  }

  // ---------- Dialog: Ansehen ----------
  const dlg = $('#eventDialog'), viewPane = $('#viewPane'), form = $('#editPane');
  let current = null;   // gespeicherter Termin im Viewer
  let edit = null;      // Entwurf im Editor
  let editIsNew = false;

  function showPane(which) {
    viewPane.hidden = which !== 'view';
    form.hidden = which !== 'edit';
    if (!dlg.open) dlg.showModal();
  }

  async function openViewer(id) {
    const ev = state.events.find(e => e.id === id);
    if (!ev) return;
    if (REMOTE && ev.media && ev.media.length) {
      try { await signPaths(ev.media.map(m => m.path).filter(Boolean)); }
      catch (e) { console.error(e); toast('Bilder und Videos konnten nicht geladen werden.'); }
    }
    current = ev;
    const t = tplOf(ev);
    viewPane.style.setProperty('--c', t.color);
    $('#vEmoji').textContent = t.emoji;
    $('#vTitle').textContent = ev.title;
    $('#vWhen').textContent = `${DAYS[ev.day]}, ${fmt(ev.start)}–${fmt(ev.end)}` + (t.id === 'none' ? '' : ` · ${t.name}`);
    const d = $('#vDesc'); d.textContent = ev.desc || ''; d.hidden = !ev.desc;
    const hasLoc = !!(ev.location && ev.location.text);
    $('#vLocWrap').hidden = !hasLoc;
    if (hasLoc) {
      const label = locLabel(ev.location);
      $('#vLoc').replaceChildren(
        h('span', { text: '📍 ' + label }),
        label !== ev.location.text ? h('span', { class: 'loc-full', text: ev.location.text }) : null);
      $('#vMap').replaceChildren(ev.location.lat != null ? mapNode(ev.location) : '');
    }
    const hasMedia = ev.media && ev.media.length > 0;
    $('#vMediaWrap').hidden = !hasMedia;
    $('#vMedia').replaceChildren(hasMedia ? buildCarousel(ev.media) : '');
    showPane('view');
  }

  $('#vEdit').addEventListener('click', () => openEditor(cloneEv(current), false));
  $('#vDelete').addEventListener('click', () => deleteEvent(current));

  async function deleteEvent(ev) {
    if (!ev) return;
    try { await removeEvent(ev); }
    catch { toast('Nicht gelöscht – keine Verbindung zur Datenbank.'); return; }
    dlg.close();
    toast('Termin gelöscht');
  }

  // ---------- Dialog: Bearbeiten ----------
  const f = {
    title: $('#fTitle'), tpl: $('#fTpl'), day: $('#fDay'), start: $('#fStart'), end: $('#fEnd'),
    desc: $('#fDesc'), loc: $('#fLoc'), locBtn: $('#fLocBtn'), locMsg: $('#fLocMsg'), map: $('#fMap'),
    files: $('#fFiles'), link: $('#fLink'), linkBtn: $('#fLinkBtn'), media: $('#fMedia'),
    del: $('#fDelete'), save: $('#fSave'), badge: $('#fBadge'), heading: $('#fHeading'),
  };
  f.day.replaceChildren(...DAYS.map((d, i) => h('option', { value: i, text: d })));

  function openEditor(draft, isNew) {
    edit = cloneEv(draft);
    edit.tpl = tplOf(edit);
    editIsNew = isNew;
    f.heading.textContent = isNew ? 'Neuer Termin' : 'Termin bearbeiten';
    f.title.value = edit.title;
    fillTplSelect();
    applyTplLook();
    f.day.value = edit.day;
    f.start.value = fmt(edit.start);
    f.end.value = fmt(edit.end);
    f.desc.value = edit.desc;
    f.loc.value = edit.location.text || '';
    f.locMsg.textContent = ''; f.locMsg.classList.remove('err');
    renderEditMap();
    renderEditMedia();
    f.link.value = '';
    f.del.hidden = isNew;
    showPane('edit');
    if (isNew) setTimeout(() => f.title.focus(), 60);
  }

  function fillTplSelect() {
    const list = [...allTemplates(), NONE_TPL];
    const opts = list.map(t => h('option', { value: t.id, text: `${t.emoji} ${t.name}` }));
    if (!list.some(t => t.id === edit.tpl.id)) opts.push(h('option', { value: edit.tpl.id, text: `${edit.tpl.emoji} ${edit.tpl.name}` }));
    f.tpl.replaceChildren(...opts);
    f.tpl.value = edit.tpl.id;
  }
  function applyTplLook() {
    form.style.setProperty('--c', edit.tpl.color);
    f.badge.textContent = edit.tpl.emoji;
  }
  f.tpl.addEventListener('change', () => {
    const t = [...allTemplates(), NONE_TPL].find(x => x.id === f.tpl.value);
    if (t) { edit.tpl = snap(t); applyTplLook(); }
  });

  function renderEditMap() {
    f.map.replaceChildren(edit.location.lat != null ? mapNode(edit.location) : '');
  }
  async function searchLocation() {
    const q = f.loc.value.trim();
    if (!q) return;
    f.locBtn.disabled = true;
    f.locMsg.classList.remove('err'); f.locMsg.textContent = 'Suche …';
    const g = await geocode(q);
    f.locBtn.disabled = false;
    if (g) {
      edit.location = { text: q, lat: g.lat, lon: g.lon, label: g.label };
      f.locMsg.textContent = '';
      renderEditMap();
    } else {
      f.locMsg.classList.add('err');
      f.locMsg.textContent = 'Ort nicht gefunden (oder keine Verbindung). Versuche eine genauere Adresse.';
    }
  }
  f.locBtn.addEventListener('click', searchLocation);
  f.loc.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchLocation(); } });
  f.loc.addEventListener('input', () => {
    edit.location = { text: f.loc.value, lat: null, lon: null, label: null };
    f.map.replaceChildren();
  });

  function renderEditMedia() {
    f.media.replaceChildren(edit.media.length
      ? buildCarousel(edit.media, { onRemove: m => { edit.media = edit.media.filter(x => x !== m); renderEditMedia(); } })
      : '');
  }

  async function addFiles(files) {
    for (const file of files) {
      try {
        if (file.type.startsWith('image/')) {
          const blob = await shrinkImage(file);
          if (blob.size > MAX_FILE_MB * 1024 * 1024) { toast(`${file.name} ist grösser als ${MAX_FILE_MB} MB.`); continue; }
          edit.media.push({ type: 'image', blob, name: file.name });
        } else if (file.type.startsWith('video/')) {
          if (file.size > MAX_FILE_MB * 1024 * 1024) { toast(`${file.name} ist grösser als ${MAX_FILE_MB} MB.`); continue; }
          edit.media.push({ type: 'video', blob: file, name: file.name });
        } else {
          toast(`${file.name}: Dateityp wird nicht unterstützt.`);
        }
      } catch { toast(`${file.name} konnte nicht geladen werden.`); }
    }
    renderEditMedia();
  }
  f.files.addEventListener('change', async () => { const picked = [...f.files.files]; f.files.value = ''; await addFiles(picked); });

  function addLink() {
    const raw = f.link.value.trim();
    if (!raw) return;
    const m = parseLink(raw);
    if (!m) { toast('Link nicht erkannt. Erlaubt: YouTube, Vimeo oder direkte Bild-/Video-Links.'); return; }
    edit.media.push(m);
    f.link.value = '';
    renderEditMedia();
  }
  f.linkBtn.addEventListener('click', addLink);
  f.link.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });

  f.del.addEventListener('click', () => deleteEvent(state.events.find(e => e.id === edit.id)));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const s = toMin(f.start.value), en = toMin(f.end.value);
    if (Number.isNaN(s) || Number.isNaN(en)) { toast('Bitte Start- und Endzeit angeben.'); return; }
    if (en <= s) { toast('Das Ende muss nach dem Start liegen.'); return; }
    if (s < START_H * 60 || en > END_H * 60) { toast(`Der Plan reicht von ${pad(START_H)}:00 bis ${pad(END_H)}:00.`); return; }

    f.save.disabled = true;
    f.save.textContent = REMOTE ? 'Speichert …' : 'Speichern';
    edit.title = f.title.value.trim() || (edit.tpl.id === 'none' ? 'Termin' : edit.tpl.name);
    edit.desc = f.desc.value.trim();
    edit.day = +f.day.value; edit.start = s; edit.end = en;
    const text = f.loc.value.trim();
    if (!text) edit.location = { text: '', lat: null, lon: null, label: null };
    else {
      edit.location.text = text;
      if (edit.location.lat == null) {
        const g = await geocode(text);
        if (g) { edit.location.lat = g.lat; edit.location.lon = g.lon; edit.location.label = g.label; }
      }
      if (!edit.location.label) edit.location.label = text.split(',')[0].trim();
    }
    try {
      await commitEvent(edit);
    } catch {
      f.save.disabled = false; f.save.textContent = 'Speichern';
      toast('Nicht gespeichert – keine Verbindung zur Datenbank.');
      return;
    }
    f.save.disabled = false; f.save.textContent = 'Speichern';
    dlg.close();
    toast('Gespeichert ✓');
  });

  // Dialog schliessen: Knopf, Klick auf Hintergrund
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-close]');
    if (c) c.closest('dialog').close();
  });
  document.querySelectorAll('dialog').forEach(d => {
    let downOnBackdrop = false;
    d.addEventListener('pointerdown', e => { downOnBackdrop = e.target === d; });
    d.addEventListener('click', e => { if (e.target === d && downOnBackdrop) d.close(); });
  });

  // ---------- Feld erstellen / anpassen ----------
  const cDlg = $('#customDialog'), cForm = $('#customForm');
  const cName = $('#cName'), cEmoji = $('#cEmoji'), cColor = $('#cColor'), cDur = $('#cDur'), cBadge = $('#cBadge'), cSw = $('#cSwatches');
  const cHeading = $('#cHeading'), cSub = $('#cSub'), cSubmit = $('#cSubmit');
  let editingTplId = null;

  function paintCustom() {
    cForm.style.setProperty('--c', cColor.value);
    cBadge.textContent = cEmoji.value.trim() || '⭐';
    [...cSw.children].forEach(b => b.classList.toggle('on', b.dataset.color.toLowerCase() === cColor.value.toLowerCase()));
  }
  SWATCHES.forEach(c => cSw.append(h('button', {
    type: 'button', class: 'swatch', style: `--c:${c}`, 'data-color': c, 'aria-label': `Farbe ${c}`,
    onclick: () => { cColor.value = c; paintCustom(); },
  })));
  cColor.addEventListener('input', paintCustom);
  cEmoji.addEventListener('input', paintCustom);

  function openTplDialog(t) {
    editingTplId = t ? t.id : null;
    cName.value = t ? t.name : '';
    cEmoji.value = t ? t.emoji : '⭐';
    cColor.value = t ? t.color : SWATCHES[Math.floor(Math.random() * SWATCHES.length)];
    cDur.value = String(t ? t.dur : 60);
    cHeading.textContent = t ? 'Feld anpassen' : 'Neues Feld';
    cSub.textContent = t ? 'Änderungen gelten auch für bereits eingetragene Termine.' : 'Erscheint in der Seitenleiste und lässt sich in den Plan ziehen.';
    cSubmit.textContent = t ? 'Speichern' : 'Feld erstellen';
    paintCustom();
    cDlg.showModal();
    setTimeout(() => cName.focus(), 60);
  }
  $('#addCustom').addEventListener('click', () => openTplDialog(null));

  cForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name = cName.value.trim();
    if (!name) return;
    const data = { name, emoji: cEmoji.value.trim() || '⭐', color: cColor.value, dur: +cDur.value };
    const id = editingTplId || 'c' + uid();
    const custom = state.customTemplates.find(x => x.id === id);
    try { await remoteOp(() => pushTemplate({ id, ...data, custom: !!custom || !editingTplId })); }
    catch { toast('Nicht gespeichert – keine Verbindung zur Datenbank.'); return; }
    if (custom) Object.assign(custom, data);
    else if (!editingTplId) state.customTemplates.push({ id, ...data, custom: true });
    else state.overrides[id] = data;
    persist(); renderPalette(); renderEvents();
    cDlg.close();
    toast(editingTplId ? 'Feld gespeichert ✓' : `Feld „${name}“ erstellt`);
  });

  // ---------- Einzelner Termin (ohne Feldart) ----------
  $('#addEvent').addEventListener('click', () => {
    let start = (new Date().getHours() + 1) * 60;
    start = Math.max(START_H * 60, Math.min(start, END_H * 60 - 60));
    openEditor(newDraft(NONE_TPL, todayIdx, start, start + 60), true);
  });

  // ---------- Seitenleiste ein-/ausklappen ----------
  const layoutEl = $('.layout'), sbBtn = $('#sidebarToggle');
  function setSidebar(open) {
    layoutEl.classList.toggle('collapsed', !open);
    sbBtn.setAttribute('aria-expanded', String(open));
    try { localStorage.setItem('wochenplan-sidebar', open ? '1' : '0'); } catch { /* ignorieren */ }
  }
  sbBtn.addEventListener('click', () => setSidebar(layoutEl.classList.contains('collapsed')));
  try { if (localStorage.getItem('wochenplan-sidebar') === '0') setSidebar(false); } catch { /* ignorieren */ }

  // ---------- Konto ----------
  $('#logoutBtn').addEventListener('click', async () => {
    await Auth.logout();
    try { indexedDB.deleteDatabase(DB_NAME); } catch { /* ignorieren */ }   // Zwischenspeicher dieses Geräts leeren
    location.href = '../login/';
  });

  // ---------- Start ----------
  async function init() {
    if (REMOTE && !Auth.session()) return;   // Weiterleitung zum Login läuft bereits
    if (REMOTE) {
      $('#whoAmI').textContent = '👤 ' + Auth.username();
      $('#whoAmI').hidden = false;
      $('#logoutBtn').hidden = false;
    }
    document.documentElement.style.setProperty('--row', ROW + 'px');
    document.documentElement.style.setProperty('--rows', ROWS);
    const saved = await load();
    if (saved) {
      state.events = saved.events || [];
      state.customTemplates = saved.customTemplates || [];
      state.overrides = saved.overrides || {};
    }
    buildGrid();
    renderPalette();
    renderEvents();
    setInterval(updateNow, 60000);

    setStatus(REMOTE ? 'busy' : 'local');
    if (REMOTE) {
      sync();
      setInterval(() => { if (!document.hidden) sync({ silent: true }); }, SYNC_MS);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) sync({ silent: true }); });
      window.addEventListener('online', () => sync({ silent: true }));
      window.addEventListener('offline', () => setStatus('err'));
    }
  }
  init();
})();
