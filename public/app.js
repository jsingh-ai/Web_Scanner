/* Web Scanner dashboard client. Vanilla JS, no build step.
 * All server-supplied strings are inserted via textContent (never innerHTML) to
 * prevent stored XSS (docs/BUILD-RULES.md rule 15). */

'use strict';

const $ = (sel) => document.querySelector(sel);
const TOKEN_KEY = 'webscanner.writeToken';

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
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg = (data && data.error) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

function relTime(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/* ---------- Status dashboard ---------- */

function statusCard({ app, check }) {
  const status = check ? check.status : 'unknown';
  const card = el('div', `card ${status}`);

  const head = el('div', 'card-head');
  head.appendChild(el('span', 'card-name', app.name));
  head.appendChild(el('span', `badge ${status}`, status));
  card.appendChild(head);

  card.appendChild(el('div', 'card-url', app.url));

  if (check) {
    if (check.summary) card.appendChild(el('div', 'card-summary', check.summary));

    const meta = el('div', 'card-meta');
    meta.appendChild(el('span', null, `checked ${relTime(check.created_at)}`));
    if (check.method) meta.appendChild(el('span', null, check.method));
    if (check.http_status) meta.appendChild(el('span', null, `HTTP ${check.http_status}`));
    card.appendChild(meta);

    const verdict = check.verdict || {};
    const sections = verdict.sections || [];
    const machines = verdict.machines || [];
    if (sections.length || machines.length) {
      const details = el('details', 'breakdown');
      details.appendChild(el('summary', null, `Breakdown (${sections.length} sections)`));
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
      details.appendChild(wrap);
      card.appendChild(details);
    }

    if (check.screenshot_path && !check.screenshot_pruned) {
      const actions = el('div', 'card-actions');
      const view = el('button', 'link-btn', 'View screenshot');
      view.addEventListener('click', () => openShot(`/screenshots/${check.screenshot_path}`));
      actions.appendChild(view);
      card.appendChild(actions);
    }
  } else {
    card.appendChild(el('div', 'card-summary', 'No scan yet.'));
  }

  return card;
}

async function loadStatus() {
  const grid = $('#grid');
  try {
    const rows = await api('GET', '/api/status');
    grid.textContent = '';
    if (!rows.length) {
      grid.appendChild(el('div', 'empty', 'No apps configured yet. Open ⚙ Settings to add one.'));
    } else {
      for (const row of rows) grid.appendChild(statusCard(row));
    }
    const counts = rows.reduce((acc, r) => {
      const s = r.check ? r.check.status : 'unknown';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const parts = ['good', 'warning', 'down', 'error', 'unknown']
      .filter((k) => counts[k])
      .map((k) => `${counts[k]} ${k}`);
    $('#subtitle').textContent = `${rows.length} apps · ${parts.join(' · ') || 'no data'}`;
  } catch (e) {
    grid.textContent = '';
    grid.appendChild(el('div', 'empty', `Failed to load status: ${e.message}`));
  }
}

/* ---------- Screenshot viewer ---------- */

function openShot(src) {
  $('#shotImg').src = src;
  $('#shotOverlay').classList.remove('hidden');
}
function closeShot() {
  $('#shotOverlay').classList.add('hidden');
  $('#shotImg').src = '';
}

/* ---------- Settings ---------- */

function readForm() {
  const sections = $('#sections').value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
    list.appendChild(el('div', 'empty', 'No apps yet.'));
    return;
  }
  for (const app of apps) {
    const item = el('div', 'app-item');
    const info = el('div', 'info');
    const nm = el('div', 'nm', app.name);
    if (app.is_rich_dashboard) nm.appendChild(el('span', 'hint', '  · dashboard'));
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
  } catch (e) {
    setFormMsg(e.message, 'error');
  }
}

async function removeApp(app) {
  if (!confirm(`Delete "${app.name}"? Its history is kept but it disappears from the dashboard.`))
    return;
  setToken($('#tokenInput').value.trim());
  try {
    await api('DELETE', `/api/apps/${app.id}`);
    await loadApps();
  } catch (e) {
    setFormMsg(e.message, 'error');
  }
}

async function openSettings() {
  $('#tokenInput').value = getToken();
  $('#settingsOverlay').classList.remove('hidden');
  try {
    await loadApps();
  } catch (e) {
    setFormMsg(e.message, 'error');
  }
}
function closeSettings() {
  $('#settingsOverlay').classList.add('hidden');
  resetForm();
  loadStatus();
}

async function runNow() {
  const btn = $('#runNowBtn');
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    await api('POST', '/api/run-now');
    // Give the worker time to scan, then refresh a few times.
    setTimeout(loadStatus, 4000);
    setTimeout(loadStatus, 12000);
    setTimeout(loadStatus, 25000);
  } catch (e) {
    alert(`Run now failed: ${e.message}`);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Run now';
    }, 3000);
  }
}

/* ---------- Wiring ---------- */

window.addEventListener('DOMContentLoaded', () => {
  $('#refreshBtn').addEventListener('click', loadStatus);
  $('#runNowBtn').addEventListener('click', runNow);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', closeSettings);
  $('#cancelEdit').addEventListener('click', resetForm);
  $('#appForm').addEventListener('submit', saveApp);
  $('#shotClose').addEventListener('click', closeShot);
  $('#shotOverlay').addEventListener('click', (e) => {
    if (e.target === $('#shotOverlay')) closeShot();
  });

  loadStatus();
  setInterval(loadStatus, 60000); // auto-refresh every minute
});
