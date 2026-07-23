/* =========================================================
   163 Cut Program — calendar tracker logic
   ========================================================= */

const STORAGE_KEY = 'cut163_state_v3';

let WORKOUTS = [];
let state = null;
let viewYear, viewMonth; // month currently shown in calendar (0-indexed month)
let selectedISO = null;

async function init() {
  const res = await fetch('workouts.json');
  const data = await res.json();
  WORKOUTS = data.workouts;

  state = loadState();

  const today = new Date();
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();
  selectedISO = isoFromDate(today);

  renderAll();

  document.getElementById('calPrev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('calNext').addEventListener('click', () => shiftMonth(1));
  document.getElementById('backupToggle').addEventListener('click', onBackupToggle);
  document.getElementById('backupCopyBtn').addEventListener('click', onBackupCopy);
  document.getElementById('backupRestoreBtn').addEventListener('click', onBackupRestore);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { pointer: 0, history: {} };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------- Date helpers ---------------- */

function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function todayDateOnly() {
  return dateOnly(new Date());
}

function daysBetween(a, b) {
  return Math.round((dateOnly(a) - dateOnly(b)) / 86400000);
}

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function formatLong(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/* ---------------- Day status resolution ---------------- */

// Returns { status: 'done'|'today'|'missed'|'future'|'beyond', workoutIndex, entry }
function resolveDateStatus(dateObj) {
  const iso = isoFromDate(dateObj);

  const historyEntry = Object.entries(state.history).find(([, e]) => e.completedDate === iso);
  if (historyEntry) {
    return { status: 'done', workoutIndex: Number(historyEntry[0]), entry: historyEntry[1] };
  }

  const diff = daysBetween(dateObj, todayDateOnly());
  if (diff < 0) {
    return { status: 'missed', workoutIndex: null, entry: null };
  }

  const workoutIndex = state.pointer + diff;
  if (workoutIndex >= WORKOUTS.length) {
    return { status: 'beyond', workoutIndex: null, entry: null };
  }
  return { status: diff === 0 ? 'today' : 'future', workoutIndex, entry: null };
}

/* ---------------- Rendering ---------------- */

function renderAll() {
  renderProgress();
  renderCalendar();
  renderDetail();
}

function renderProgress() {
  const total = WORKOUTS.length;
  const done = Object.keys(state.history).length;
  document.getElementById('progressCount').textContent = `${done} / ${total}`;
  document.getElementById('progressFill').style.width = `${(done / total) * 100}%`;
}

function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
}

function renderCalendar() {
  const label = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  document.getElementById('calMonthLabel').textContent = label;

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  const firstDay = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();

  for (let i = 0; i < leadingBlanks; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-cell is-blank';
    grid.appendChild(blank);
  }

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dateObj = new Date(viewYear, viewMonth, dayNum);
    const iso = isoFromDate(dateObj);
    const { status } = resolveDateStatus(dateObj);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.textContent = dayNum;
    cell.className = 'cal-cell is-' + status;
    if (iso === selectedISO) cell.classList.add('is-selected');
    cell.onclick = () => {
      selectedISO = iso;
      renderCalendar();
      renderDetail();
    };
    grid.appendChild(cell);
  }
}

function renderDetail() {
  const container = document.getElementById('detailCard');
  if (!selectedISO) { container.innerHTML = ''; return; }

  const [y, m, d] = selectedISO.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const { status, workoutIndex, entry } = resolveDateStatus(dateObj);

  if (status === 'missed') {
    container.innerHTML = `
      <div class="detail-head">
        <div class="detail-date">${formatLong(dateObj)}</div>
        <h2 class="detail-split">No workout logged</h2>
        <span class="detail-badge badge-missed">Missed</span>
      </div>
      <p class="detail-text">This day wasn't marked complete. Its workout hasn't disappeared — it's just still waiting, attached to today's date instead.</p>
      <button type="button" class="jump-btn" id="jumpTodayBtn">Go to today</button>
    `;
    document.getElementById('jumpTodayBtn').onclick = jumpToToday;
    return;
  }

  if (status === 'beyond') {
    container.innerHTML = `
      <div class="detail-head">
        <div class="detail-date">${formatLong(dateObj)}</div>
        <h2 class="detail-split">Program complete by this date</h2>
      </div>
      <p class="detail-text">All 163 days will already be finished before this date, at your current pace.</p>
    `;
    return;
  }

  const day = WORKOUTS[workoutIndex];
  const gs = day.gym_session;
  const mr = day.morning_routine;

  let badgeHtml = '';
  if (status === 'done') badgeHtml = `<span class="detail-badge badge-done">Completed</span>`;
  else if (status === 'future') badgeHtml = `<span class="detail-badge badge-future">Upcoming</span>`;

  const cardioText = gs.cardio_finisher.choose_one.map(opt => {
    const specs = Object.entries(opt)
      .filter(([k]) => k !== 'machine')
      .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
      .join(', ');
    return `${opt.machine} (${specs})`;
  }).join(' / ');

  container.innerHTML = `
    <div class="detail-head">
      <div class="detail-date">${formatLong(dateObj)} · DAY ${day.day}</div>
      <h2 class="detail-split">${gs.split}</h2>
      ${badgeHtml}
    </div>

    <div class="detail-block">
      <div class="detail-block-title">Morning · 30-30-30</div>
      <div class="detail-text">${mr.protein_g}g protein within ${mr.within_minutes_of_waking} min of waking · ${mr.walking_minutes} min walk (${mr.walking_target_calories} kcal)</div>
    </div>

    <div class="detail-block">
      <div class="detail-block-title">Warm-up</div>
      <div class="detail-text">${gs.warmup}</div>
    </div>

    <div class="detail-block">
      <div class="detail-block-title">Workout · ${gs.target_gym_calories} kcal target</div>
      ${gs.exercises.map(ex => `
        <div class="detail-exercise-row">
          <span class="ex-name">${ex.exercise}</span>
          <span class="ex-detail">${ex.sets} × ${ex.reps} · ${ex.rest_seconds}s rest</span>
        </div>
      `).join('')}
    </div>

    <div class="detail-block">
      <div class="detail-block-title">Cardio Finisher</div>
      <div class="detail-text">${gs.cardio_finisher.duration_minutes} min — ${cardioText}</div>
    </div>

    <div class="detail-block">
      <div class="detail-block-title">Stretch</div>
      <div class="detail-text">${gs.stretching_minutes} min stretching</div>
    </div>

    ${status === 'today' ? `<button type="button" class="complete-btn" id="completeBtn">Mark day complete</button>` : ''}
  `;

  if (status === 'today') {
    document.getElementById('completeBtn').addEventListener('click', onCompleteToday);
  }
}

function jumpToToday() {
  const today = new Date();
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();
  selectedISO = isoFromDate(today);
  renderCalendar();
  renderDetail();
}

function onCompleteToday(e) {
  const btn = e.currentTarget;
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Tap again to confirm';
    clearTimeout(btn._armTimeout);
    btn._armTimeout = setTimeout(() => {
      if (btn) {
        btn.classList.remove('armed');
        btn.textContent = 'Mark day complete';
      }
    }, 3000);
    return;
  }

  const pointer = state.pointer;
  const day = WORKOUTS[pointer];
  const todayISO = isoFromDate(new Date());

  state.history[pointer] = {
    day: day.day,
    split: day.gym_session.split,
    completedDate: todayISO
  };
  state.pointer = pointer + 1;
  saveState();

  renderAll();
}

/* ---------------- Backup / restore ---------------- */

function onBackupToggle() {
  const panel = document.getElementById('backupPanel');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    document.getElementById('backupText').value = JSON.stringify(state);
    document.getElementById('backupStatus').textContent = '';
  }
}

function onBackupCopy() {
  const textarea = document.getElementById('backupText');
  textarea.value = JSON.stringify(state);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (e) {}
  const status = document.getElementById('backupStatus');
  if (!copied && navigator.clipboard) {
    navigator.clipboard.writeText(textarea.value)
      .then(() => { status.textContent = 'Copied.'; })
      .catch(() => { status.textContent = 'Could not auto-copy — select the text above manually and copy it.'; });
  } else {
    status.textContent = copied ? 'Copied.' : 'Select the text above manually and copy it.';
  }
}

function onBackupRestore() {
  const textarea = document.getElementById('backupText');
  const status = document.getElementById('backupStatus');
  try {
    const parsed = JSON.parse(textarea.value);
    if (typeof parsed.pointer !== 'number' || !parsed.history) {
      throw new Error('bad shape');
    }
    state = parsed;
    saveState();
    renderAll();
    status.textContent = 'Restored.';
  } catch (e) {
    status.textContent = "That doesn't look like a valid backup — check you pasted the whole thing.";
  }
}

init();