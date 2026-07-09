'use strict';

/* Halo widget logic. Runs inside Tauri; falls back to demo mode in a plain
   browser (used for design review and README screenshots). */

const REPO = 'maurits2905/claude-usage-monitor';
const FALLBACK_VERSION = '0.2.0';
const LOCALE = 'en-GB';

const IS_TAURI = Boolean(window.__TAURI__);
const invoke = IS_TAURI ? window.__TAURI__.core.invoke : demoInvoke;

/* ---------- Demo mode (browser only) ---------- */
function demoState() {
  const q = new URLSearchParams(location.search).get('state') || 'live';
  const now = Date.now();
  const mk = (fh, sd, extra, age) => ({
    installed: true,
    captured_at: now - (age || 30) * 1000,
    age_seconds: age || 30,
    latest: {
      model: { display_name: 'Fable 5' },
      rate_limits: Object.assign(
        {
          five_hour: { utilization: fh, resets_at: new Date(now + 2.4 * 3600e3).toISOString() },
          seven_day: { utilization: sd, resets_at: new Date(now + 3.2 * 86400e3).toISOString() },
        },
        extra || {}
      ),
    },
    history: Array.from({ length: 60 }, (_, i) => ({
      t: now - (60 - i) * 4 * 60e3,
      fh: Math.max(0, fh - (60 - i) * 0.55 + Math.sin(i / 4) * 2),
      sd,
    })),
  });
  switch (q) {
    case 'connect': return { installed: false, latest: null, history: [] };
    case 'waiting': return { installed: true, latest: null, history: [] };
    case 'warn': return mk(78, 41);
    case 'err': return mk(94, 88, { seven_day_opus: { utilization: 97, resets_at: new Date(now + 2 * 86400e3).toISOString() } });
    case 'extra': return mk(46, 63, {
      seven_day_opus: { utilization: 71, resets_at: new Date(now + 2 * 86400e3).toISOString() },
      seven_day_fable: { utilization: 32, resets_at: new Date(now + 2 * 86400e3).toISOString() },
    });
    case 'stale': return mk(52, 63, null, 1860);
    default: return mk(42, 63);
  }
}
async function demoInvoke(cmd, args) {
  if (cmd === 'get_status') return demoState();
  if (cmd === 'get_autostart') return false;
  if (cmd === 'install_shim') return { status: 'installed', wrapped: null, backup: null };
  console.log('[demo] invoke', cmd, args || '');
  return null;
}

/* ---------- Formatting ---------- */
function fmtClock(d) {
  return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}
function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + mm + 'm';
  return mm + 'm';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Rate-limit parsing (defensive: payload is undocumented) ---------- */
function normUtil(v) {
  if (typeof v !== 'number' || isNaN(v)) return null;
  return v <= 1 ? v * 100 : v;
}
function parseResets(v) {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
const BUCKET_LABELS = {
  five_hour: 'Session', seven_day: 'Weekly',
  seven_day_opus: 'Opus · weekly', seven_day_sonnet: 'Sonnet · weekly',
  seven_day_fable: 'Fable · weekly', extra_usage: 'Extra usage',
};
function bucketLabel(k) {
  return BUCKET_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function extractBuckets(rl) {
  const rank = (k) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2);
  const keys = Object.keys(rl).sort((a, b) => rank(a) - rank(b));
  const out = [];
  for (const key of keys) {
    const b = rl[key];
    if (b == null) continue;
    let util = null, resets = null;
    if (typeof b === 'number') util = normUtil(b);
    else if (typeof b === 'object') {
      util = normUtil(b.utilization != null ? b.utilization : b.used);
      resets = parseResets(b.resets_at != null ? b.resets_at : b.resets);
    }
    if (util == null) continue;
    out.push({ key, label: bucketLabel(key), util, resets });
  }
  return out;
}
function severity(u) { return u >= 90 ? 'err' : u >= 70 ? 'warn' : 'ok'; }
const SEV_TEXT = { ok: 'On track', warn: 'Getting close', err: 'Near limit' };

/* ---------- Mascot ("Clio") ---------- */
function mascotSvg(state) {
  // state: ok | warn | err | sleep | off
  const grad = `
    <defs><radialGradient id="mg" cx="38%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#E8895B"/><stop offset="100%" stop-color="#BC5A33"/>
    </radialGradient></defs>`;
  const body = `<path d="M32 5 C46 5 59 16 59 32 C59 48 48 59 32 59 C16 59 5 48 5 32 C5 16 18 5 32 5 Z" fill="${state === 'off' ? 'var(--bg-2)' : 'url(#mg)'}" ${state === 'off' ? 'stroke="var(--line)" stroke-width="2"' : ''}/>`;
  const ink = state === 'off' ? 'var(--ink-3)' : '#3A2417';
  let face = '';
  if (state === 'sleep') {
    face = `
      <path d="M20 33 q4 3 8 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M36 33 q4 3 8 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <text x="47" y="22" font-size="11" fill="${ink}" font-family="Georgia,serif" font-style="italic">z</text>`;
  } else if (state === 'err') {
    face = `
      <circle cx="24" cy="31" r="4.6" fill="${ink}"/>
      <circle cx="40" cy="31" r="4.6" fill="${ink}"/>
      <circle cx="25.4" cy="29.6" r="1.4" fill="#F7E9DC"/>
      <circle cx="41.4" cy="29.6" r="1.4" fill="#F7E9DC"/>
      <ellipse cx="32" cy="43" rx="4" ry="4.6" fill="${ink}"/>
      <path d="M52 16 q4 6 0 9 q-4 -3 0 -9" fill="#8FB6C9"/>`;
  } else if (state === 'warn') {
    face = `
      <path d="M18 24 l9 3" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M46 24 l-9 3" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="24" cy="33" r="3.6" fill="${ink}"/>
      <circle cx="40" cy="33" r="3.6" fill="${ink}"/>
      <path d="M27 44 h10" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  } else if (state === 'off') {
    face = `
      <circle cx="24" cy="32" r="3.4" fill="${ink}"/>
      <circle cx="40" cy="32" r="3.4" fill="${ink}"/>
      <path d="M27 43 q5 3 10 0" stroke="${ink}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  } else {
    face = `
      <circle cx="24" cy="32" r="3.8" fill="${ink}"/>
      <circle cx="40" cy="32" r="3.8" fill="${ink}"/>
      <circle cx="25.2" cy="30.8" r="1.2" fill="#F7E9DC"/>
      <circle cx="41.2" cy="30.8" r="1.2" fill="#F7E9DC"/>
      <path d="M26 42 q6 5 12 0" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${grad}${body}${face}</svg>`;
}

/* ---------- Ring ---------- */
function ringSvg(util, sev) {
  const size = 92, sw = 8, r = (size - sw) / 2, c = 2 * Math.PI * r;
  const frac = Math.min(100, Math.max(0, util)) / 100;
  const color = sev === 'ok' ? 'var(--accent)' : 'var(--' + sev + ')';
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="${sw}"/>` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" ` +
    `stroke-linecap="round" stroke-dasharray="${c * frac} ${c * (1 - frac)}" stroke-dashoffset="${c * 0.25}" ` +
    `style="transition: stroke-dasharray 250ms cubic-bezier(0.2,0,0,1)"/>` +
    `</svg>`
  );
}

/* ---------- Rendering ---------- */
const bodyEl = document.getElementById('body');
let status = null;
let lastError = null;

function render() {
  renderMascot();
  renderFeed();

  if (lastError && !status) {
    bodyEl.innerHTML =
      `<div class="hero"><span class="big-mascot">${mascotSvg('off')}</span>` +
      `<h2>Something went wrong</h2><p>${esc(lastError)}</p>` +
      `<button class="primary-btn" onclick="refresh()">Retry</button></div>`;
    return;
  }
  if (!status) {
    bodyEl.innerHTML = `<div class="rings"><div class="ring-card" style="height:170px"></div><div class="ring-card" style="height:170px"></div></div>`;
    return;
  }

  if (!status.installed) {
    bodyEl.innerHTML =
      `<div class="hero"><span class="big-mascot">${mascotSvg('off')}</span>` +
      `<h2>Connect to Claude Code</h2>` +
      `<p>Claude Code publishes your official 5-hour and weekly limits to its statusline. ` +
      `Halo taps that feed locally. Your existing statusline keeps working unchanged.</p>` +
      `<button class="primary-btn" id="connectBtn">Connect</button>` +
      `<p class="fine">One edit to ~/.claude/settings.json, backed up first. Undo anytime in Settings.</p></div>`;
    document.getElementById('connectBtn').addEventListener('click', connect);
    return;
  }

  const rl = status.latest && status.latest.rate_limits;
  if (!rl) {
    bodyEl.innerHTML =
      `<div class="hero"><span class="big-mascot">${mascotSvg('sleep')}</span>` +
      `<h2>Waiting for Claude Code</h2>` +
      `<p>Connected. Data arrives with the next statusline refresh. If Claude Code was ` +
      `already running, restart it once so it picks up the new statusline.</p>` +
      `<p class="fine">Requires Claude Code 2.1+ with a Pro or Max plan.</p></div>`;
    return;
  }

  const buckets = extractBuckets(rl);
  const primary = buckets.filter((b) => b.key === 'five_hour' || b.key === 'seven_day');
  const extras = buckets.filter((b) => b.key !== 'five_hour' && b.key !== 'seven_day');
  const now = Date.now();

  let html = '<div class="rings">';
  for (const b of primary) {
    const sev = severity(b.util);
    html +=
      `<div class="ring-card"><span class="overline">${esc(b.label)}</span>` +
      `<div class="ring-wrap">${ringSvg(b.util, sev)}` +
      `<div class="ring-center"><span class="ring-pct">${Math.round(b.util)}<span class="u">%</span></span>` +
      `<span class="ring-sub">${Math.max(0, 100 - b.util).toFixed(0)}% left</span></div></div>` +
      `<div class="ring-meta">` +
      (b.resets
        ? `<span class="ring-reset"><strong>${fmtDur(b.resets - now)}</strong> to reset · ${
            b.resets - now > 86400e3
              ? b.resets.toLocaleDateString(LOCALE, { weekday: 'short' }) + ' ' + fmtClock(b.resets)
              : fmtClock(b.resets)
          }</span>`
        : '') +
      `<span class="ring-state ${sev}">${SEV_TEXT[sev]}</span>` +
      `</div></div>`;
  }
  html += '</div>';

  if (extras.length) {
    html += '<div class="buckets">';
    for (const b of extras) {
      const sev = severity(b.util);
      html +=
        `<div class="bucket" title="${b.resets ? 'Resets ' + fmtDur(b.resets - now) + ' from now' : ''}">` +
        `<span class="bucket-label">${esc(b.label)}</span>` +
        `<span class="bucket-bar"><span class="bucket-fill ${sev === 'ok' ? '' : sev}" style="width:${Math.min(100, b.util)}%"></span></span>` +
        `<span class="bucket-pct">${Math.round(b.util)}%</span></div>`;
    }
    html += '</div>';
  }

  html += paceHtml(buckets, now);
  html += sparkHtml(now);
  bodyEl.innerHTML = html;
}

function paceHtml(buckets, now) {
  const fh = buckets.find((b) => b.key === 'five_hour');
  if (!fh || !status.history || status.history.length < 2) return '';
  const window_ = status.history.filter((s) => typeof s.fh === 'number' && now - s.t < 45 * 60e3);
  if (window_.length < 2) return '';
  const first = window_[0], last = window_[window_.length - 1];
  const spanMin = (last.t - first.t) / 60e3;
  if (spanMin < 5) return '';
  const slope = (last.fh - first.fh) / spanMin;
  if (slope <= 0.05) return '';
  const eta = new Date(now + ((100 - fh.util) / slope) * 60e3);
  if (fh.resets && eta < fh.resets) {
    const cls = fh.util >= 70 ? 'err' : 'warn';
    return `<div class="pace ${cls}">At this pace you hit the session limit ~${fmtClock(eta)}, before it resets.</div>`;
  }
  return `<div class="pace ok">At this pace you stay under the session limit until reset.</div>`;
}

function sparkHtml(now) {
  const samples = (status.history || []).filter((s) => typeof s.fh === 'number' && now - s.t < 5 * 3600e3);
  let inner;
  if (samples.length < 2) {
    inner = '<div class="spark-empty">Collecting history, the trend appears here after a few minutes of use.</div>';
  } else {
    const W = 272, H = 48;
    const t0 = now - 5 * 3600e3;
    const pts = samples.map((s) => [((s.t - t0) / (5 * 3600e3)) * W, H - 3 - (Math.min(100, s.fh) / 100) * (H - 8)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = line + ` L ${pts[pts.length - 1][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`;
    inner =
      `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Session usage, last 5 hours">` +
      `<path d="${area}" fill="var(--accent)" opacity="0.14"/>` +
      `<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  return (
    `<div class="spark-card"><div class="spark-head"><span class="overline">Session · last 5 h</span>` +
    `<span class="spark-value"></span></div>${inner}</div>`
  );
}

function renderMascot() {
  let state = 'off';
  if (status && status.installed) {
    const rl = status.latest && status.latest.rate_limits;
    if (!rl) state = 'sleep';
    else if (status.age_seconds > 600) state = 'sleep';
    else {
      const buckets = extractBuckets(rl);
      const worst = Math.max(...buckets.map((b) => b.util), 0);
      state = severity(worst);
    }
  }
  document.getElementById('mascot').innerHTML = mascotSvg(state);
}

function renderFeed() {
  const feed = document.getElementById('feed');
  const text = document.getElementById('feedText');
  if (!status) { feed.className = 'feed'; text.textContent = 'Starting…'; return; }
  if (!status.installed) { feed.className = 'feed'; text.textContent = 'Not connected'; return; }
  if (!status.latest) { feed.className = 'feed'; text.textContent = 'Waiting for data'; return; }
  if (status.age_seconds > 600) {
    feed.className = 'feed stale';
    text.textContent = 'Paused · ' + fmtDur(status.age_seconds * 1000) + ' ago';
  } else {
    feed.className = 'feed live';
    text.textContent = 'Live · ' + fmtDur(status.age_seconds * 1000) + ' ago';
  }
}

/* ---------- Actions ---------- */
async function refresh() {
  try {
    status = await invoke('get_status');
    lastError = null;
  } catch (e) {
    lastError = String(e);
  }
  render();
}
window.refresh = refresh;

async function connect() {
  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    const r = await invoke('install_shim');
    toast(r.status === 'migrated' ? 'Upgraded existing capture' : 'Connected. Restart Claude Code once.');
    await refresh();
  } catch (e) {
    toast('Failed: ' + e);
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('widget').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ---------- Header buttons ---------- */
const pinBtn = document.getElementById('pinBtn');
function applyPin(on) {
  pinBtn.setAttribute('aria-pressed', String(on));
  document.getElementById('pinToggle').checked = on;
  localStorage.setItem('halo-pin', on ? '1' : '');
  invoke('set_always_on_top', { onTop: on }).catch(() => {});
}
pinBtn.addEventListener('click', () => applyPin(pinBtn.getAttribute('aria-pressed') !== 'true'));
document.getElementById('pinToggle').addEventListener('change', (e) => applyPin(e.target.checked));

document.getElementById('hideBtn').addEventListener('click', () => invoke('hide_window').catch(() => {}));

/* ---------- Settings panel ---------- */
const panel = document.getElementById('panel');
document.getElementById('settingsBtn').addEventListener('click', async () => {
  panel.hidden = false;
  document.getElementById('autostartToggle').checked = await invoke('get_autostart').catch(() => false);
});
document.getElementById('backBtn').addEventListener('click', () => { panel.hidden = true; });

document.getElementById('autostartToggle').addEventListener('change', (e) => {
  invoke('set_autostart', { enabled: e.target.checked }).catch((err) => toast('Failed: ' + err));
});

document.getElementById('disconnectBtn').addEventListener('click', async () => {
  try {
    await invoke('restore_shim');
    toast('Statusline restored');
    panel.hidden = true;
    await refresh();
  } catch (e) {
    toast('Failed: ' + e);
  }
});
document.getElementById('githubBtn').addEventListener('click', () =>
  invoke('open_url', { url: 'https://github.com/' + REPO }).catch(() => {})
);

/* ---------- Theme ---------- */
const themeSeg = document.getElementById('themeSeg');
const media = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(pref) {
  localStorage.setItem('halo-theme', pref);
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeSeg.querySelectorAll('button').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.themeOpt === pref))
  );
}
themeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-opt]');
  if (b) applyTheme(b.dataset.themeOpt);
});
media.addEventListener('change', () => applyTheme(localStorage.getItem('halo-theme') || 'system'));
applyTheme(localStorage.getItem('halo-theme') || 'system');

/* ---------- Update check ---------- */
const updateToggle = document.getElementById('updateToggle');
updateToggle.checked = localStorage.getItem('halo-updates') !== 'off';
updateToggle.addEventListener('change', (e) => {
  localStorage.setItem('halo-updates', e.target.checked ? 'on' : 'off');
});

async function appVersion() {
  try { return await window.__TAURI__.app.getVersion(); } catch (_) { return FALLBACK_VERSION; }
}
function newerVersion(latest, current) {
  const pa = latest.replace(/^v/, '').split('.').map(Number);
  const pb = current.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}
async function checkUpdates(force) {
  if (!force && localStorage.getItem('halo-updates') === 'off') return;
  const last = Number(localStorage.getItem('halo-update-checked') || 0);
  if (!force && Date.now() - last < 20 * 3600e3) return showUpdatePill(localStorage.getItem('halo-update-tag'));
  try {
    const res = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rel = await res.json();
    localStorage.setItem('halo-update-checked', String(Date.now()));
    const current = await appVersion();
    if (rel.tag_name && newerVersion(rel.tag_name, current)) {
      localStorage.setItem('halo-update-tag', rel.tag_name);
      showUpdatePill(rel.tag_name);
    } else {
      localStorage.setItem('halo-update-tag', '');
      if (force) toast('Halo is up to date');
    }
  } catch (e) {
    if (force) toast('Update check failed: ' + e.message);
  }
}
async function showUpdatePill(tag) {
  if (!tag || !newerVersion(tag, await appVersion())) return;
  const pill = document.getElementById('updatePill');
  pill.hidden = false;
  pill.textContent = tag + ' available';
  pill.onclick = () =>
    invoke('open_url', { url: 'https://github.com/' + REPO + '/releases/latest' }).catch(() => {});
}
document.getElementById('checkNowBtn').addEventListener('click', () => checkUpdates(true));

/* ---------- Boot ---------- */
(async () => {
  document.getElementById('version').textContent = 'v' + (await appVersion());
  if (localStorage.getItem('halo-pin') === '1') applyPin(true);
  await refresh();
  setInterval(refresh, 15000);
  window.addEventListener('focus', refresh);
  checkUpdates(false);
})();
