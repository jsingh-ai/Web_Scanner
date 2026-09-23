/* Five Star Sentinel — dashboard client. Vanilla JS, no build step.
 * All server-supplied strings are inserted via textContent (never innerHTML) to
 * prevent stored XSS (docs/BUILD-RULES.md rule 15). */

'use strict';

const $ = (s) => document.querySelector(s);
const TOKEN_KEY = 'webscanner.writeToken';
const THEME_KEY = 'webscanner.theme';

const state = { rows: [], filter: 'all', search: '' };

/* ---------- Theme ---------- */

const ICONS = {
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" stroke-linecap="round" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round"/>',
};
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('#themeIcon').innerHTML = t === 'dark' ? ICONS.sun : ICONS.moon;
}
function initTheme() {
  let t = 'light';
  try {
    t = localStorage.getItem(THEME_KEY) || 'light';
  } catch {
    /* ignore */
  }
  applyTheme(t);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
}

/* ---------- Token + API ---------- */

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}
function setToken(v) {
  try {
    localStorage.setItem(TOKEN_KEY, v);
  } catch {
    /* ignore */
  }
}
async function api(method, path, body) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-write-token'] = getToken();
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
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
    t.style.opacity = '0';
    t.style.transition = 'opacity .3s';
    setTimeout(() => t.remove(), 320);
  }, 3600);
}

/* ---------- Overview (gauge + KPIs) ---------- */

function updateOverview(rows) {
  const counts = { good: 0, warning: 0, down: 0, error: 0, unknown: 0 };
  for (const r of rows) counts[r.check ? r.check.status : 'unknown']++;
  const total = rows.length;
  const opsPct = total ? Math.round((counts.good / total) * 100) : 0;

  $('#kpiTotal').textContent = total;
  $('#kpiGood').textContent = counts.good;
  $('#kpiWarn').textContent = counts.warning;
  $('#kpiDown').textContent = counts.down + counts.error;
  $('#segAll').textContent = total ? `(${total})` : '';
  $('#segGood').textContent = counts.good ? `(${counts.good})` : '';
  $('#segWarn').textContent = counts.warning ? `(${counts.warning})` : '';
  $('#segDown').textContent = counts.down ? `(${counts.down})` : '';

  const C = 327;
  const arc = $('#gaugeArc');
  arc.style.strokeDashoffset = String(C - (C * opsPct) / 100);
  $('#gaugePct').textContent = total ? `${opsPct}%` : '—';

  const bad = counts.down + counts.error;
  const headline = $('#healthHeadline');
  let color = 'var(--ok)';
  if (bad > 0) {
    headline.className = 'health-headline bad';
    headline.textContent = `${bad} ${bad === 1 ? 'issue' : 'issues'} detected`;
    color = 'var(--bad)';
  } else if (counts.warning > 0) {
    headline.className = 'health-headline warn';
    headline.textContent = `${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}`;
    color = 'var(--warn)';
  } else if (total > 0) {
    headline.className = 'health-headline ok';
    headline.textContent = 'All systems operational';
  } else {
    headline.className = 'health-headline';
    headline.textContent = 'No apps configured';
    color = 'var(--neutral)';
  }
  arc.style.stroke = color;
}

/* ---------- Cards ---------- */

function statusCard({ app, check }) {
  const status = check ? check.status : 'unknown';
  const card = el('div', `card ${status}`);

  const head = el('div', 'card-head');
  const left = el('div');
  left.appendChild(el('div', 'card-name', app.name));
  left.appendChild(el('div', 'card-url', app.url));
  head.appendChild(left);
  const badge = el('span', `badge ${status}`);
  badge.appendChild(el('span', 'pulse'));
  badge.appendChild(el('span', null, status === 'good' ? 'operational' : status));
  head.appendChild(badge);
  card.appendChild(head);

  if (check) {
    if (check.summary) card.appendChild(el('div', 'card-summary', check.summary));

    const meta = el('div', 'card-meta');
    meta.appendChild(el('span', 'chip', `checked ${relTime(check.created_at)}`));
    if (check.method) meta.appendChild(el('span', 'chip', check.method));
    if (check.http_status) meta.appendChild(el('span', 'chip', `HTTP ${check.http_status}`));
    if (check.verdict && check.verdict.confidence != null)
      meta.appendChild(el('span', 'chip', `${Math.round(check.verdict.confidence * 100)}% conf`));
    card.appendChild(meta);

    const v = check.verdict || {};
    const sections = v.sections || [];
    const machines = v.machines || [];
    if (sections.length || machines.length) {
      const d = el('details', 'breakdown');
      d.appendChild(el('summary', null, `Breakdown · ${sections.length} sections, ${machines.length} notes`));
      const wrap = el('div', 'sections');
      for (const s of sections) {
        const row = el('div', 'sec-row');
        row.appendChild(el('span', `dot ${s.status || 'good'}`));
        row.appendChild(el('span', null, s.notes ? `${s.name}: ${s.notes}` : s.name));
        wrap.appendChild(row);
      }
      for (const m of machines) {
        const row = el('div', 'mac-row');
        row.appendChild(el('span', 'dot down'));
        const label = [m.section, m.id].filter(Boolean).join(' / ');
        row.appendChild(el('span', null, `${label} — ${m.state || ''}${m.note ? ` (${m.note})` : ''}`));
        wrap.appendChild(row);
      }
      d.appendChild(wrap);
      card.appendChild(d);
    }

    if (check.screenshot_path && !check.screenshot_pruned) {
      const foot = el('div', 'card-foot');
      const view = el('button', 'link-btn');
      view.appendChild(iconEl('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'));
      view.appendChild(el('span', null, 'View screenshot'));
      view.addEventListener('click', () => openShot(`/screenshots/${check.screenshot_path}`));
      foot.appendChild(view);
      card.appendChild(foot);
    }
  } else {
    card.appendChild(el('div', 'card-summary', 'No scan yet — hit Run now.'));
  }
  return card;
}

function iconEl(inner) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.style.width = '14px';
  svg.style.height = '14px';
  svg.innerHTML = inner;
  return svg;
}

function renderGrid() {
  const grid = $('#grid');
  grid.textContent = '';
  const term = state.search.toLowerCase();
  const rows = state.rows.filter((r) => {
    const st = r.check ? r.check.status : 'unknown';
    if (state.filter !== 'all' && st !== state.filter) return false;
    if (term && !(`${r.app.name} ${r.app.url}`.toLowerCase().includes(term))) return false;
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
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.innerHTML = '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/>';
  e.appendChild(svg);
  const configured = state.rows.length > 0;
  e.appendChild(el('h3', null, configured ? 'No apps match your filter' : 'No apps configured yet'));
  e.appendChild(
    el('div', null, configured ? 'Try a different filter or search term.' : 'Open ⚙ Settings to add your first application.'),
  );
  return e;
}

function showSkeleton() {
  const grid = $('#grid');
  grid.className = 'grid skeleton';
  grid.textContent = '';
  for (let i = 0; i < 6; i++) {
    const c = el('div', 'card unknown');
    c.appendChild(Object.assign(el('div', 'sk'), { style: 'height:18px;width:60%' }));
    c.appendChild(Object.assign(el('div', 'sk'), { style: 'height:12px;width:85%' }));
    c.appendChild(Object.assign(el('div', 'sk'), { style: 'height:34px;width:100%;margin-top:6px' }));
    grid.appendChild(c);
  }
}

async function loadStatus() {
  try {
    const rows = await api('GET', '/api/status');
    state.rows = rows;
    $('#grid').className = 'grid';
    updateOverview(rows);
    renderGrid();
  } catch (e) {
    $('#grid').className = 'grid';
    const grid = $('#grid');
    grid.textContent = '';
    grid.appendChild(el('div', 'empty', `Failed to load status: ${e.message}`));
  }
}

/* ---------- Lightbox ---------- */

function openShot(src) {
  $('#shotImg').src = src;
  $('#shotOverlay').classList.remove('hidden');
}
function closeShot() {
  $('#shotOverlay').classList.add('hidden');
  $('#shotImg').src = '';
}

/* ---------- Settings drawer ---------- */

function openSettings() {
  $('#tokenInput').value = getToken();
  $('#settingsOverlay').classList.remove('hidden');
  requestAnimationFrame(() => {
    $('#settingsOverlay').classList.add('show');
    $('#settingsDrawer').classList.add('show');
  });
  $('#settingsDrawer').setAttribute('aria-hidden', 'false');
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

function readForm() {
  const sections = $('#sections').value.split(',').map((s) => s.trim()).filter(Boolean);
  const body = {
    name: $('#name').value.trim(),
    url: $('#url').value.trim(),
    is_rich_dashboard: $('#isRich').checked,
    sections,
    wait_strategy: $('#waitStrategy').value,
  };
  if ($('#settleMs').value !== '') body.settle_ms = Number($('#settleMs').value);
  if ($('#timeoutMs').value !== '') body.timeout_ms = Number($('#timeoutMs').value);
  if ($('#waitSelector').value.trim() !== '') body.wait_selector = $('#waitSelector').value.trim();
  return body;
}
function resetForm() {
  $('#appId').value = '';
  $('#appForm').reset();
  $('#saveBtn').textContent = 'Add app';
  setFormMsg('');
}
function fillForm(app) {
  $('#appId').value = app.id;
  $('#name').value = app.name;
  $('#url').value = app.url;
  $('#isRich').checked = !!app.is_rich_dashboard;
  $('#sections').value = (app.sections || []).join(', ');
  $('#waitStrategy').value = app.wait_strategy || 'load';
  $('#settleMs').value = app.settle_ms ?? '';
  $('#timeoutMs').value = app.timeout_ms ?? '';
  $('#waitSelector').value = app.wait_selector || '';
  $('#saveBtn').textContent = 'Save changes';
  setFormMsg('');
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
  if (!apps.length) {
    list.appendChild(el('div', 'hint', 'No apps yet.'));
    return;
  }
  for (const app of apps) {
    const item = el('div', 'app-item');
    const info = el('div');
    const nm = el('div', 'nm');
    nm.appendChild(el('span', null, app.name));
    if (app.is_rich_dashboard) nm.appendChild(el('span', 'tag', 'dashboard'));
    info.appendChild(nm);
    info.appendChild(el('div', 'u', app.url));
    item.appendChild(info);
    const ops = el('div', 'ops');
    const edit = el('button', 'btn', 'Edit');
    edit.addEventListener('click', () => fillForm(app));
    const del = el('button', 'btn', 'Delete');
    del.addEventListener('click', () => removeApp(app));
    ops.appendChild(edit);
    ops.appendChild(del);
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
    if (id) await api('PUT', `/api/apps/${id}`, body);
    else await api('POST', '/api/apps', body);
    resetForm();
    await loadApps();
    setFormMsg('Saved.', 'ok');
    toast('App saved', 'ok');
  } catch (e) {
    setFormMsg(e.message, 'error');
  }
}
async function removeApp(app) {
  if (!confirm(`Delete "${app.name}"? Its history is kept but it leaves the dashboard.`)) return;
  setToken($('#tokenInput').value.trim());
  try {
    await api('DELETE', `/api/apps/${app.id}`);
    await loadApps();
    toast('App removed', 'ok');
  } catch (e) {
    setFormMsg(e.message, 'error');
  }
}

/* ---------- Run now ---------- */

async function runNow() {
  const btn = $('#runNowBtn');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.textContent = 'Scanning…';
  try {
    await api('POST', '/api/run-now');
    toast('Scan started — results will refresh shortly', 'ok');
    setTimeout(loadStatus, 5000);
    setTimeout(loadStatus, 14000);
    setTimeout(loadStatus, 28000);
  } catch (e) {
    toast(`Run now failed: ${e.message}`, 'error');
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = orig;
    }, 3000);
  }
}

/* ---------- Wiring ---------- */

window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#refreshBtn').addEventListener('click', loadStatus);
  $('#runNowBtn').addEventListener('click', runNow);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', closeSettings);
  $('#settingsOverlay').addEventListener('click', closeSettings);
  $('#cancelEdit').addEventListener('click', resetForm);
  $('#appForm').addEventListener('submit', saveApp);
  $('#shotClose').addEventListener('click', closeShot);
  $('#shotOverlay').addEventListener('click', (e) => {
    if (e.target === $('#shotOverlay')) closeShot();
  });
  $('#searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderGrid();
  });
  $('#filterSeg').addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg) return;
    state.filter = seg.dataset.filter;
    $('#filterSeg')
      .querySelectorAll('.seg')
      .forEach((s) => s.setAttribute('aria-pressed', String(s === seg)));
    renderGrid();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeShot();
      if ($('#settingsDrawer').classList.contains('show')) closeSettings();
    }
  });

  showSkeleton();
  loadStatus();
  setInterval(loadStatus, 60000);
});
