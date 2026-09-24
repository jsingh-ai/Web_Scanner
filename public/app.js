/* Five Star Sentinel — dashboard client. Vanilla JS, no build step.
 * All server-supplied strings are inserted via textContent (never innerHTML) to
 * prevent stored XSS (docs/BUILD-RULES.md rule 15). */

'use strict';

const $ = (s) => document.querySelector(s);
const appEl = () => $('#app');
const TOKEN_KEY = 'webscanner.writeToken';
const THEME_KEY = 'webscanner.theme';
const COLLAPSE_KEY = 'webscanner.collapsed';
const ORDER = { down: 4, error: 3, warning: 2, good: 1, unknown: 0 };

const state = { rows: [], filter: 'all', search: '' };

/* ---------- Theme & shell ---------- */

const ICONS = {
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" stroke-linecap="round" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round"/>',
};
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('#themeIcon').innerHTML = t === 'dark' ? ICONS.sun : ICONS.moon;
}
function initShell() {
  let t = 'light';
  try { t = localStorage.getItem(THEME_KEY) || 'light'; } catch {}
  applyTheme(t);
  let c = 'false';
  try { c = localStorage.getItem(COLLAPSE_KEY) || 'false'; } catch {}
  appEl().setAttribute('data-collapsed', c);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
}
function toggleCollapse() {
  const next = appEl().getAttribute('data-collapsed') === 'true' ? 'false' : 'true';
  appEl().setAttribute('data-collapsed', next);
  try { localStorage.setItem(COLLAPSE_KEY, next); } catch {}
}
function openNav() { appEl().setAttribute('data-mobilenav', 'open'); }
function closeNav() { appEl().setAttribute('data-mobilenav', 'closed'); }

/* ---------- Token + API ---------- */

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function setToken(v) {
  try { localStorage.setItem(TOKEN_KEY, v); } catch {}
}
async function api(method, path, body) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-write-token'] = getToken();
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  return data;
}

/* ---------- Helpers ---------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function relTime(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function toast(msg, kind) {
  const t = el('div', `toast${kind ? ' ' + kind : ''}`, msg);
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, 3600);
}
function svgEl(inner, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.style.width = svg.style.height = (size || 14) + 'px';
  svg.innerHTML = inner;
  return svg;
}
function overallOf(row) {
  let worst = row.check ? row.check.status : 'unknown';
  for (const v of row.views || []) {
    const s = v.check ? v.check.status : 'unknown';
    if ((ORDER[s] || 0) > (ORDER[worst] || 0)) worst = s;
  }
  return worst;
}

/* ---------- Overview ---------- */

function updateOverview(rows) {
  const c = { good: 0, warning: 0, down: 0, error: 0, unknown: 0 };
  for (const r of rows) c[overallOf(r)]++;
  const total = rows.length;
  const pct = total ? Math.round((c.good / total) * 100) : 0;

  $('#kpiTotal').textContent = total;
  $('#kpiGood').textContent = c.good;
  $('#kpiWarn').textContent = c.warning;
  $('#kpiDown').textContent = c.down + c.error;
  $('#segAll').textContent = total ? `(${total})` : '';
  $('#segGood').textContent = c.good ? `(${c.good})` : '';
  $('#segWarn').textContent = c.warning ? `(${c.warning})` : '';
  $('#segDown').textContent = c.down ? `(${c.down})` : '';

  const C = 327;
  const arc = $('#gaugeArc');
  arc.style.strokeDashoffset = String(C - (C * pct) / 100);
  $('#gaugePct').textContent = total ? `${pct}%` : '—';

  const bad = c.down + c.error;
  const hl = $('#healthHeadline');
  const dot = $('#sideDot');
  let color = 'var(--ok)';
  if (bad > 0) { hl.className = 'health-headline bad'; hl.textContent = `${bad} ${bad === 1 ? 'issue' : 'issues'} detected`; color = 'var(--bad)'; }
  else if (c.warning > 0) { hl.className = 'health-headline warn'; hl.textContent = `${c.warning} ${c.warning === 1 ? 'warning' : 'warnings'}`; color = 'var(--warn)'; }
  else if (total > 0) { hl.className = 'health-headline ok'; hl.textContent = 'All systems operational'; }
  else { hl.className = 'health-headline'; hl.textContent = 'No apps configured'; color = 'var(--neutral)'; }
  arc.style.stroke = color;
  dot.style.background = color;
  $('#sideHealth').textContent = total ? (bad > 0 ? `${bad} down` : c.warning > 0 ? `${c.warning} warning` : 'All healthy') : 'No apps';
}

/* ---------- Cards ---------- */

function statusCard(row) {
  const a = row.app;
  const main = row.check;
  const status = overallOf(row);
  const card = el('div', `card ${status}`);

  // Thumbnail (main screenshot).
  if (main && main.screenshot_path && !main.screenshot_pruned) {
    const thumb = el('div', 'card-thumb');
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = `/screenshots/${main.screenshot_path}`;
    thumb.appendChild(img);
    thumb.addEventListener('click', () => openShot(`/screenshots/${main.screenshot_path}`));
    card.appendChild(thumb);
  }

  const body = el('div', 'card-body');

  const head = el('div', 'card-head');
  const left = el('div', 'card-title');
  left.appendChild(el('div', 'card-name', a.name));
  if (a.description) left.appendChild(el('div', 'card-desc', a.description));
  head.appendChild(left);
  const badge = el('span', `badge ${status}`);
  badge.appendChild(el('span', 'pulse'));
  badge.appendChild(el('span', null, status === 'good' ? 'operational' : status));
  head.appendChild(badge);
  body.appendChild(head);

  body.appendChild(el('div', 'card-url', a.url));

  if (main) {
    if (main.summary) body.appendChild(el('div', 'card-summary', main.summary));
    const meta = el('div', 'card-meta');
    meta.appendChild(el('span', 'chip', `checked ${relTime(main.created_at)}`));
    if (main.method) meta.appendChild(el('span', 'chip', main.method));
    if (main.http_status) meta.appendChild(el('span', 'chip', `HTTP ${main.http_status}`));
    if (main.verdict && main.verdict.confidence != null)
      meta.appendChild(el('span', 'chip', `${Math.round(main.verdict.confidence * 100)}% conf`));
    body.appendChild(meta);
  } else {
    body.appendChild(el('div', 'card-summary', 'No scan yet — hit Run now.'));
  }

  // Tab views.
  if (row.views && row.views.length) {
    const d = el('details', 'breakdown');
    d.appendChild(el('summary', null, `Tabs · ${row.views.length}`));
    const wrap = el('div', 'sections');
    for (const v of row.views) {
      const st = v.check ? v.check.status : 'unknown';
      const rowEl = el('div', 'tab-row');
      rowEl.appendChild(el('span', `dot ${st}`));
      rowEl.appendChild(el('span', 'tab-name', v.view.label));
      rowEl.appendChild(el('span', 'tab-status', st === 'good' ? 'ok' : st));
      if (v.check && v.check.screenshot_path && !v.check.screenshot_pruned) {
        const link = el('button', 'link-btn', 'view');
        link.addEventListener('click', () => openShot(`/screenshots/${v.check.screenshot_path}`));
        rowEl.appendChild(link);
      }
      wrap.appendChild(rowEl);
    }
    d.appendChild(wrap);
    body.appendChild(d);
  }

  // Main verdict breakdown (sections/machines).
  const v = (main && main.verdict) || {};
  const sections = v.sections || [];
  const machines = v.machines || [];
  if (sections.length || machines.length) {
    const d = el('details', 'breakdown');
    d.appendChild(el('summary', null, `Breakdown · ${sections.length} sections, ${machines.length} notes`));
    const wrap = el('div', 'sections');
    for (const s of sections) {
      const rowEl = el('div', 'sec-row');
      rowEl.appendChild(el('span', `dot ${s.status || 'good'}`));
      rowEl.appendChild(el('span', null, s.notes ? `${s.name}: ${s.notes}` : s.name));
      wrap.appendChild(rowEl);
    }
    for (const m of machines) {
      const rowEl = el('div', 'mac-row');
      rowEl.appendChild(el('span', 'dot down'));
      const label = [m.section, m.id].filter(Boolean).join(' / ');
      rowEl.appendChild(el('span', null, `${label} — ${m.state || ''}${m.note ? ` (${m.note})` : ''}`));
      wrap.appendChild(rowEl);
    }
    d.appendChild(wrap);
    body.appendChild(d);
  }

  card.appendChild(body);
  return card;
}

function renderGrid() {
  const grid = $('#grid');
  grid.textContent = '';
  const term = state.search.toLowerCase();
  const rows = state.rows.filter((r) => {
    const st = overallOf(r);
    if (state.filter !== 'all' && st !== state.filter) return false;
    if (term) {
      const hay = `${r.app.name} ${r.app.url} ${r.app.description || ''} ${(r.views || []).map((v) => v.view.label).join(' ')}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
  if (!rows.length) {
    grid.appendChild(emptyState());
    return;
  }
  for (const r of rows) grid.appendChild(statusCard(r));
}

function emptyState() {
  const e = el('div', 'empty');
  e.appendChild(svgEl('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/>', 64));
  const configured = state.rows.length > 0;
  e.appendChild(el('h3', null, configured ? 'No apps match your filter' : 'No apps configured yet'));
  e.appendChild(el('div', null, configured ? 'Try a different filter or search.' : 'Open Settings to add your first application.'));
  return e;
}

function showSkeleton() {
  const grid = $('#grid');
  grid.textContent = '';
  for (let i = 0; i < 6; i++) {
    const c = el('div', 'card unknown');
    const t = el('div', 'sk'); t.style.cssText = 'height:120px;width:100%';
    const b = el('div', 'card-body');
    const n = el('div', 'sk'); n.style.cssText = 'height:18px;width:60%';
    const u = el('div', 'sk'); u.style.cssText = 'height:12px;width:85%;margin-top:8px';
    b.append(n, u);
    c.append(t, b);
    grid.appendChild(c);
  }
}

async function loadStatus() {
  try {
    const rows = await api('GET', '/api/status');
    state.rows = rows;
    updateOverview(rows);
    renderGrid();
  } catch (e) {
    $('#grid').textContent = '';
    $('#grid').appendChild(el('div', 'empty', `Failed to load status: ${e.message}`));
  }
}

/* ---------- Lightbox ---------- */

function openShot(src) { $('#shotImg').src = src; $('#shotOverlay').classList.remove('hidden'); }
function closeShot() { $('#shotOverlay').classList.add('hidden'); $('#shotImg').src = ''; }

/* ---------- Settings: app form ---------- */

function setRich(v) {
  $('#isRich').value = v ? 'true' : 'false';
  $('#typeToggle').querySelectorAll('.toggle').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.rich === 'true') === !!v)));
}
function readForm() {
  return {
    name: $('#name').value.trim(),
    url: $('#url').value.trim(),
    description: $('#description').value.trim(),
    is_rich_dashboard: $('#isRich').value === 'true',
  };
}
function resetForm() {
  $('#appId').value = '';
  $('#appForm').reset();
  setRich(false);
  $('#saveBtn').textContent = 'Add app';
  setFormMsg('');
  $('#tabsPanel').classList.add('hidden');
}
function fillForm(a) {
  $('#appId').value = a.id;
  $('#name').value = a.name;
  $('#url').value = a.url;
  $('#description').value = a.description || '';
  setRich(!!a.is_rich_dashboard);
  $('#saveBtn').textContent = 'Save changes';
  setFormMsg('');
  $('#tabsTitle').textContent = `Tabs for “${a.name}”`;
  $('#tabsPanel').classList.remove('hidden');
  $('#candidatesBox').classList.add('hidden');
  $('#tabsScanMsg').textContent = '';
  loadViews(a.id).catch(() => {});
  $('#settingsDrawer').querySelector('.drawer-body').scrollTop = 0;
}
function setFormMsg(text, kind) {
  const m = $('#formMsg');
  m.textContent = text;
  m.className = `form-msg${kind ? ' ' + kind : ''}`;
}
async function loadApps() {
  const list = $('#appsList');
  list.textContent = '';
  const apps = await api('GET', '/api/apps');
  if (!apps.length) { list.appendChild(el('div', 'hint', 'No apps yet.')); return; }
  for (const a of apps) {
    const item = el('div', 'app-item');
    const info = el('div');
    const nm = el('div', 'nm');
    nm.appendChild(el('span', null, a.name));
    if (a.is_rich_dashboard) nm.appendChild(el('span', 'tag', 'dashboard'));
    info.appendChild(nm);
    if (a.description) info.appendChild(el('div', 'u', a.description));
    info.appendChild(el('div', 'u', a.url));
    item.appendChild(info);
    const ops = el('div', 'ops');
    const edit = el('button', 'btn', 'Edit');
    edit.addEventListener('click', () => fillForm(a));
    const del = el('button', 'btn', 'Delete');
    del.addEventListener('click', () => removeApp(a));
    ops.append(edit, del);
    item.appendChild(ops);
    list.appendChild(item);
  }
}
async function saveApp(evt) {
  evt.preventDefault();
  setToken($('#tokenInput').value.trim());
  const body = readForm();
  const id = $('#appId').value;
  try {
    if (id) {
      await api('PUT', `/api/apps/${id}`, body);
    } else {
      const created = await api('POST', '/api/apps', body);
      // Keep editing the new app so tabs can be added right away.
      created.name = body.name;
      fillForm(created);
    }
    await loadApps();
    setFormMsg('Saved.', 'ok');
    toast('App saved', 'ok');
  } catch (e) {
    setFormMsg(e.message, 'error');
  }
}
async function removeApp(a) {
  if (!confirm(`Delete "${a.name}"? Its history is kept but it leaves the dashboard.`)) return;
  setToken($('#tokenInput').value.trim());
  try {
    await api('DELETE', `/api/apps/${a.id}`);
    if ($('#appId').value === String(a.id)) resetForm();
    await loadApps();
    toast('App removed', 'ok');
  } catch (e) {
    setFormMsg(e.message, 'error');
  }
}

/* ---------- Settings: tabs ---------- */

async function loadViews(appId) {
  const list = $('#viewsList');
  list.textContent = '';
  const views = await api('GET', `/api/apps/${appId}/views`);
  if (!views.length) {
    list.appendChild(el('div', 'hint', 'No tabs monitored yet — Scan tabs or add one below.'));
    return;
  }
  for (const v of views) {
    const item = el('div', 'view-item');
    const info = el('div');
    const nm = el('div', 'nm');
    nm.appendChild(el('span', null, v.label));
    nm.appendChild(el('span', 'tag', v.nav_type));
    info.appendChild(nm);
    info.appendChild(el('div', 'u', v.target));
    item.appendChild(info);
    const ops = el('div', 'ops');
    const toggle = el('button', 'btn', v.enabled ? 'On' : 'Off');
    toggle.addEventListener('click', async () => {
      setToken($('#tokenInput').value.trim());
      try { await api('PUT', `/api/views/${v.id}`, { enabled: !v.enabled }); await loadViews(appId); }
      catch (e) { toast(e.message, 'error'); }
    });
    const del = el('button', 'btn', 'Remove');
    del.addEventListener('click', async () => {
      setToken($('#tokenInput').value.trim());
      try { await api('DELETE', `/api/views/${v.id}`); await loadViews(appId); }
      catch (e) { toast(e.message, 'error'); }
    });
    ops.append(toggle, del);
    item.appendChild(ops);
    list.appendChild(item);
  }
}

async function scanTabs() {
  const appId = $('#appId').value;
  if (!appId) return;
  setToken($('#tokenInput').value.trim());
  const btn = $('#scanTabsBtn');
  btn.disabled = true;
  $('#candidatesBox').classList.add('hidden');
  $('#tabsScanMsg').textContent = 'Scanning the app for tabs…';
  try {
    await api('POST', `/api/apps/${appId}/discover`);
  } catch (e) {
    $('#tabsScanMsg').textContent = e.message;
    btn.disabled = false;
    return;
  }
  let tries = 0;
  const poll = async () => {
    tries++;
    let cands = [];
    try { cands = await api('GET', `/api/apps/${appId}/candidates`); } catch {}
    if (cands.length) {
      renderCandidates(cands);
      $('#tabsScanMsg').textContent = '';
      btn.disabled = false;
    } else if (tries >= 9) {
      $('#tabsScanMsg').textContent = 'No tabs found. Add one manually below, or Rescan.';
      btn.disabled = false;
    } else {
      setTimeout(poll, 2500);
    }
  };
  setTimeout(poll, 2500);
}

function renderCandidates(cands) {
  const box = $('#candidatesBox');
  const list = $('#candidatesList');
  list.textContent = '';
  for (const c of cands) {
    const row = el('label', 'cand');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.label = c.label;
    cb.dataset.nav = c.nav_type;
    cb.dataset.target = c.target;
    row.appendChild(cb);
    const txt = el('div');
    txt.appendChild(el('div', 'nm', c.label));
    txt.appendChild(el('div', 'u', `${c.nav_type} · ${c.target}`));
    row.appendChild(txt);
    list.appendChild(row);
  }
  box.classList.remove('hidden');
}

async function addSelected() {
  const appId = $('#appId').value;
  const checks = [...$('#candidatesList').querySelectorAll('input:checked')];
  if (!checks.length) { toast('Select at least one tab', 'error'); return; }
  const views = checks.map((cb) => ({ label: cb.dataset.label, nav_type: cb.dataset.nav, target: cb.dataset.target }));
  setToken($('#tokenInput').value.trim());
  try {
    await api('POST', `/api/apps/${appId}/views`, { views });
    $('#candidatesBox').classList.add('hidden');
    await loadViews(appId);
    toast(`Added ${views.length} tab(s)`, 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function addManualTab() {
  const appId = $('#appId').value;
  const label = $('#tabLabel').value.trim();
  const target = $('#tabUrl').value.trim();
  if (!label || !target) { toast('Tab name and URL required', 'error'); return; }
  setToken($('#tokenInput').value.trim());
  try {
    await api('POST', `/api/apps/${appId}/views`, { views: [{ label, nav_type: 'url', target }] });
    $('#tabLabel').value = '';
    $('#tabUrl').value = '';
    await loadViews(appId);
    toast('Tab added', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- Drawer ---------- */

function openSettings() {
  $('#tokenInput').value = getToken();
  $('#settingsOverlay').classList.remove('hidden');
  requestAnimationFrame(() => {
    $('#settingsOverlay').classList.add('show');
    $('#settingsDrawer').classList.add('show');
  });
  $('#settingsDrawer').setAttribute('aria-hidden', 'false');
  closeNav();
  loadApps().catch((e) => setFormMsg(e.message, 'error'));
}
function closeSettings() {
  $('#settingsOverlay').classList.remove('show');
  $('#settingsDrawer').classList.remove('show');
  $('#settingsDrawer').setAttribute('aria-hidden', 'true');
  setTimeout(() => $('#settingsOverlay').classList.add('hidden'), 250);
  resetForm();
  loadStatus();
}

/* ---------- Run now ---------- */

async function runNow() {
  const btn = $('#runNowBtn');
  const lbl = btn.querySelector('.lbl');
  btn.disabled = true;
  const orig = lbl ? lbl.textContent : '';
  if (lbl) lbl.textContent = 'Scanning…';
  try {
    await api('POST', '/api/run-now');
    toast('Scan started — results will refresh shortly', 'ok');
    setTimeout(loadStatus, 5000);
    setTimeout(loadStatus, 14000);
    setTimeout(loadStatus, 28000);
  } catch (e) {
    toast(`Run now failed: ${e.message}`, 'error');
  } finally {
    setTimeout(() => { btn.disabled = false; if (lbl) lbl.textContent = orig; }, 3000);
  }
}

/* ---------- Wiring ---------- */

window.addEventListener('DOMContentLoaded', () => {
  initShell();
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#collapseToggle').addEventListener('click', toggleCollapse);
  $('#menuToggle').addEventListener('click', openNav);
  $('#navScrim').addEventListener('click', closeNav);
  $('#runNowBtn').addEventListener('click', runNow);
  $('#runNowMobile').addEventListener('click', () => { runNow(); closeNav(); });
  $('#refreshBtn').addEventListener('click', () => { loadStatus(); closeNav(); });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', closeSettings);
  $('#settingsOverlay').addEventListener('click', closeSettings);
  $('#cancelEdit').addEventListener('click', resetForm);
  $('#appForm').addEventListener('submit', saveApp);
  $('#typeToggle').addEventListener('click', (e) => {
    const b = e.target.closest('.toggle');
    if (b) setRich(b.dataset.rich === 'true');
  });
  $('#scanTabsBtn').addEventListener('click', scanTabs);
  $('#addSelectedBtn').addEventListener('click', addSelected);
  $('#addTabBtn').addEventListener('click', addManualTab);
  $('#shotClose').addEventListener('click', closeShot);
  $('#shotOverlay').addEventListener('click', (e) => { if (e.target === $('#shotOverlay')) closeShot(); });
  $('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; renderGrid(); });
  $('#filterSeg').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    state.filter = seg.dataset.filter;
    $('#filterSeg').querySelectorAll('.seg').forEach((s) => s.setAttribute('aria-pressed', String(s === seg)));
    renderGrid();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeShot();
      closeNav();
      if ($('#settingsDrawer').classList.contains('show')) closeSettings();
    }
  });

  showSkeleton();
  loadStatus();
  setInterval(loadStatus, 60000);
});
