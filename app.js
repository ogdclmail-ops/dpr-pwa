import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// State
// ============================================================
let fieldsList = [];          // [{code, real_name}]
let wellsCache = {};          // fieldCode -> [{code, real_name}]
let currentFieldCode = null;
let currentFieldName = null;
let currentDate = new Date();
currentDate.setDate(currentDate.getDate() - 1); // DPRs report the PRIOR day's production, so default to it

// ============================================================
// DOM refs
// ============================================================
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginButton = document.getElementById('login-button');

const fieldButton = document.getElementById('field-button');
const fieldNameEl = document.getElementById('field-name');
const dateLabel = document.getElementById('date-label');
const datePrev = document.getElementById('date-prev');
const dateNext = document.getElementById('date-next');
const contentArea = document.getElementById('content-area');

const pickerBackdrop = document.getElementById('picker-backdrop');
const pickerSheet = document.getElementById('picker-sheet');
const pickerClose = document.getElementById('picker-close');
const pickerList = document.getElementById('picker-list');

// ============================================================
// Auth
// ============================================================
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginButton.disabled = true;
  loginButton.textContent = 'Signing in…';

  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  loginButton.disabled = false;
  loginButton.textContent = 'Sign in';

  if (error) {
    loginError.textContent = error.message;
  }
  // On success, onAuthStateChange below handles the transition.
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showApp();
  } else {
    showLogin();
  }
});

function showLogin() {
  loginScreen.style.display = 'flex';
  appScreen.style.display = 'none';
}

async function showApp() {
  loginScreen.style.display = 'none';
  appScreen.style.display = 'flex';
  await loadFields();
  render();
}

// ============================================================
// Data loading
// ============================================================
async function loadFields() {
  const { data, error } = await supabase.from('fields').select('code, real_name').order('real_name');
  if (error) {
    contentArea.innerHTML = `<div class="empty-state"><div class="empty-title">Couldn't load fields</div><div class="empty-sub">${error.message}</div></div>`;
    return;
  }
  fieldsList = data || [];
  if (fieldsList.length && !currentFieldCode) {
    currentFieldCode = fieldsList[0].code;
    currentFieldName = fieldsList[0].real_name;
  }
}

async function loadWellsForField(fieldCode) {
  if (wellsCache[fieldCode]) return wellsCache[fieldCode];
  const { data, error } = await supabase.from('wells').select('code, real_name').eq('field_code', fieldCode);
  if (error) return [];
  wellsCache[fieldCode] = data || [];
  return wellsCache[fieldCode];
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadDayData(fieldCode, dateStr) {
  const { data, error } = await supabase
    .from('daily_production')
    .select('*')
    .eq('field_code', fieldCode)
    .eq('production_date', dateStr);
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

// ============================================================
// Rendering
// ============================================================
function fmt(v, decimals = 1) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDisplayDate(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function statusInfo(status) {
  const map = {
    active: { label: 'Flowing', color: '#94B583' },
    shut_in: { label: 'Shut in', color: '#D9A24C' },
    plugged_abandoned: { label: 'P & A', color: '#786C5C' },
    suspended: { label: 'Suspended', color: '#D9A24C' },
  };
  return map[status] || null;
}

function animateCount(el, target, decimals) {
  const duration = 700;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * eased, decimals);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function render() {
  fieldNameEl.textContent = currentFieldName || '—';
  dateLabel.textContent = formatDisplayDate(currentDate);
  contentArea.innerHTML = `<div class="empty-state"><div class="empty-sub">Loading…</div></div>`;

  if (!currentFieldCode) return;

  const [rows, wells] = await Promise.all([
    loadDayData(currentFieldCode, dateKey(currentDate)),
    loadWellsForField(currentFieldCode),
  ]);
  const wellNameByCode = Object.fromEntries(wells.map((w) => [w.code, w.real_name]));

  if (!rows.length) {
    contentArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No data yet</div>
        <div class="empty-sub">${currentFieldName} has no report for ${formatDisplayDate(currentDate)}.</div>
      </div>`;
    return;
  }

  const totalGas = rows.reduce((s, r) => s + (r.gas_produced_mmscf || 0), 0);
  const totalOil = rows.reduce((s, r) => s + (r.oil_produced_bpd ?? r.cond_produced_bpd ?? 0), 0);
  const totalWater = rows.reduce((s, r) => s + (r.water_produced_bpd || 0), 0);
  const highlights = rows.find((r) => r.operational_highlights)?.operational_highlights;
  const sourceFilename = rows[0]?.source_filename;

  contentArea.innerHTML = `
    <div class="hero-tiles">
      <div class="hero-tile" style="background:var(--gas);">
        <div class="hero-tile-value" id="hero-gas">0.0</div>
        <div class="hero-tile-label">GAS · MMSCF</div>
      </div>
      <div class="hero-tile" style="background:var(--oil);">
        <div class="hero-tile-value" id="hero-oil">0</div>
        <div class="hero-tile-label">OIL · BPD</div>
      </div>
      <div class="hero-tile" style="background:var(--water);">
        <div class="hero-tile-value" id="hero-water">0</div>
        <div class="hero-tile-label">WATER · BPD</div>
      </div>
    </div>
    <div class="well-list" id="well-list"></div>
    ${highlights ? `
      <div class="highlights-section">
        <div class="highlights-title">OPERATIONAL HIGHLIGHTS</div>
        <div class="highlights-text">${highlights}</div>
      </div>` : ''}
    <div class="download-row">
      <button id="download-btn" class="download-btn">Download source DPR</button>
      <div id="download-status" class="download-status"></div>
    </div>
  `;

  animateCount(document.getElementById('hero-gas'), totalGas, 1);
  animateCount(document.getElementById('hero-oil'), totalOil, 0);
  animateCount(document.getElementById('hero-water'), totalWater, 0);

  const wellListEl = document.getElementById('well-list');
  rows
    .sort((a, b) => (wellNameByCode[a.well_code] || '').localeCompare(wellNameByCode[b.well_code] || ''))
    .forEach((row, i) => {
      const name = wellNameByCode[row.well_code] || row.well_code;
      const status = statusInfo(row.well_status);
      const card = document.createElement('button');
      card.className = 'well-card';
      card.style.animationDelay = `${i * 45}ms`;
      card.innerHTML = `
        <div class="well-card-top">
          <div class="well-name">${name}</div>
          ${status ? `<div class="well-status-badge"><span class="status-dot" style="background:${status.color};"></span>${status.label}</div>` : ''}
        </div>
        <div class="well-tiles">
          <div class="well-tile" style="background:var(--gas);">
            <div class="well-tile-value">${fmt(row.gas_produced_mmscf, 2)}</div>
            <div class="well-tile-label">GAS</div>
          </div>
          <div class="well-tile" style="background:var(--oil);">
            <div class="well-tile-value">${fmt(row.oil_produced_bpd ?? row.cond_produced_bpd, 0)}</div>
            <div class="well-tile-label">OIL</div>
          </div>
          <div class="well-tile" style="background:var(--water);">
            <div class="well-tile-value">${fmt(row.water_produced_bpd, 0)}</div>
            <div class="well-tile-label">WATER</div>
          </div>
        </div>
        <div class="well-detail">
          <div class="well-detail-grid">
            <div><div class="well-detail-stat-value">${fmt(row.choke_size, 0)}</div><div class="well-detail-stat-label">Choke, 1/64"</div></div>
            <div><div class="well-detail-stat-value">${fmt(row.fcv_pct, 0)}</div><div class="well-detail-stat-label">FCV, %</div></div>
            <div><div class="well-detail-stat-value">${fmt(row.whfp_psi, 0)}</div><div class="well-detail-stat-label">WHFP, psi</div></div>
            <div><div class="well-detail-stat-value">${fmt(row.line_pressure_psi, 0)}</div><div class="well-detail-stat-label">Line P, psi</div></div>
            <div><div class="well-detail-stat-value">${fmt(row.cond_produced_bpd, 0)}</div><div class="well-detail-stat-label">Condensate, BPD</div></div>
            <div><div class="well-detail-stat-value">${fmt(row.lpg_produced_mton, 2)}</div><div class="well-detail-stat-label">LPG, mton</div></div>
            <div><div class="well-detail-stat-value">${fmt(row.ngl_produced_bbls, 1)}</div><div class="well-detail-stat-label">NGL, bbls</div></div>
          </div>
          ${row.remarks ? `<div class="well-remarks">${row.remarks}</div>` : ''}
        </div>
      `;
      card.addEventListener('click', () => {
        card.querySelector('.well-detail').classList.toggle('open');
      });
      wellListEl.appendChild(card);
    });

  wireDownloadButton(sourceFilename);
}

async function wireDownloadButton(sourceFilename) {
  const btn = document.getElementById('download-btn');
  const status = document.getElementById('download-status');
  if (!btn) return;

  if (!sourceFilename) {
    btn.disabled = true;
    status.textContent = 'No source file on record';
    return;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Finding file…';

    // daily_production tells us WHICH file this data came from;
    // processed_files tells us WHERE that file lives in Storage.
    // Looking it up this way (rather than guessing a path from
    // field/date) works correctly for every field, including Shewa,
    // whose date is a pipeline-assigned fallback rather than a real
    // value stored anywhere consistent enough to reconstruct a path from.
    const { data: fileRecord, error: lookupError } = await supabase
      .from('processed_files')
      .select('raw_storage_path')
      .eq('filename', sourceFilename)
      .eq('status', 'success')
      .order('processed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError || !fileRecord?.raw_storage_path) {
      status.textContent = "Couldn't find the archived file";
      btn.disabled = false;
      return;
    }

    status.textContent = 'Downloading…';
    const { data: blob, error: downloadError } = await supabase.storage
      .from('dpr-files')
      .download(fileRecord.raw_storage_path);

    btn.disabled = false;

    if (downloadError || !blob) {
      status.textContent = 'Download failed';
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sourceFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.textContent = '';
  });
}

// ============================================================
// Field picker
// ============================================================
fieldButton.addEventListener('click', () => {
  pickerList.innerHTML = '';
  fieldsList.forEach((f) => {
    const item = document.createElement('button');
    item.className = 'picker-item' + (f.code === currentFieldCode ? ' selected' : '');
    item.textContent = f.real_name;
    item.addEventListener('click', () => {
      currentFieldCode = f.code;
      currentFieldName = f.real_name;
      closePicker();
      render();
    });
    pickerList.appendChild(item);
  });
  openPicker();
});
function openPicker() {
  pickerBackdrop.classList.add('open');
  pickerSheet.classList.add('open');
}
function closePicker() {
  pickerBackdrop.classList.remove('open');
  pickerSheet.classList.remove('open');
}
pickerBackdrop.addEventListener('click', closePicker);
pickerClose.addEventListener('click', closePicker);

// ============================================================
// Date nav
// ============================================================
datePrev.addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() - 1);
  render();
});
dateNext.addEventListener('click', () => {
  currentDate.setDate(currentDate.getDate() + 1);
  render();
});
