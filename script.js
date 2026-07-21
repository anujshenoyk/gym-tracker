/* =========================================================
   163 Cut Program — tracker logic
   ========================================================= */

const STORAGE_KEY = 'cut163_state_v2';

/* ---------------------------------------------------------
   EDIT YOUR OWN MESSAGES HERE.
   - exerciseMessages: shown after ticking ANY single item
     (morning routine, one exercise, cardio, or stretch)
   - dayCompleteMessages: shown once the whole day's card
     is fully ticked off
   A random one from the matching array is picked each time.
   --------------------------------------------------------- */
const exerciseMessages = [
  "Next one, you fat fuck.",
  "Keep moving you golem.",
  "Stop being a cow."
];

const dayCompleteMessages = [
  "Day complete. One day closer to not being called a Fat Fuck."
];

/* --------------------------------------------------------- */

let WORKOUTS = [];
let state = null;
let popupQueue = [];
let popupBusy = false;
const restTimers = {}; // { [exerciseIndex]: { intervalId, endTime, total } }

async function init() {
  const res = await fetch('workouts.json');
  const data = await res.json();
  WORKOUTS = data.workouts;

  state = loadState();
  render();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { pointer: 0, history: {}, ticks: {} };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayISO() {
  const d = new Date();
  return isoFromDate(d);
}

function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(baseDate, n) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + n);
  return d;
}

function formatLong(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatShort(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getTicks(pointer) {
  if (!state.ticks[pointer]) {
    const day = WORKOUTS[pointer];
    state.ticks[pointer] = {
      morning: false,
      exercises: day.gym_session.exercises.map(ex => new Array(ex.sets).fill(false)),
      cardio: false,
      stretch: false
    };
  }
  return state.ticks[pointer];
}

function isDayFullyTicked(t) {
  return t.morning && t.cardio && t.stretch &&
    t.exercises.every(sets => sets.every(Boolean));
}

/* ---------------- Rendering ---------------- */

function render() {
  const total = WORKOUTS.length;
  const done = Object.keys(state.history).length;

  document.getElementById('progressCount').textContent = `${done} / ${total}`;
  document.getElementById('progressFill').style.width = `${(done / total) * 100}%`;

  if (state.pointer >= total) {
    renderFinished();
    return;
  }

  renderToday();
  renderUpcoming();
  renderHistory();
}

function renderFinished() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `
    <div class="finished-banner">
      <h1>All 163 days done.</h1>
      <p style="color:var(--chalk-dim); margin-top:10px;">Program complete. Reset below if you want to run it again.</p>
    </div>
  `;
}

function renderToday() {
  clearAllRestTimers();

  const pointer = state.pointer;
  const day = WORKOUTS[pointer];
  const t = getTicks(pointer);
  const date = new Date();

  document.getElementById('todayLabel').textContent = `TODAY · DAY ${day.day}`;
  document.getElementById('todaySplit').textContent = day.gym_session.split;
  document.getElementById('todayDate').textContent = formatLong(date);
  document.getElementById('targetCals').textContent = day.gym_session.target_gym_calories;

  // Morning routine
  const mr = day.morning_routine;
  document.getElementById('morningText').textContent =
    `${mr.protein_g}g protein within ${mr.within_minutes_of_waking} min of waking · ${mr.walking_minutes} min walk (${mr.walking_target_calories} kcal)`;
  const morningCheck = document.getElementById('morningCheck');
  morningCheck.checked = t.morning;
  toggleRowDone('morningRow', t.morning);
  morningCheck.onchange = () => {
    t.morning = morningCheck.checked;
    onItemTicked('morningRow', t.morning);
  };

  // Warmup
  document.getElementById('warmupText').textContent = day.gym_session.warmup;

  // Exercises
  const list = document.getElementById('exerciseList');
  list.innerHTML = '';
  day.gym_session.exercises.forEach((ex, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'exercise-item';

    const setsDone = t.exercises[i].filter(Boolean).length;
    const allSetsDone = setsDone === ex.sets;

    const header = document.createElement('div');
    header.className = 'exercise-header' + (allSetsDone ? ' is-done' : '');
    header.id = `ex-header-${i}`;
    header.innerHTML = `
      <span class="ex-name">${ex.exercise}</span>
      <span class="ex-meta">${ex.reps} reps · ${ex.rest_seconds}s rest/set · <span id="ex-count-${i}">${setsDone}/${ex.sets}</span></span>
    `;
    wrapper.appendChild(header);

    const chipsRow = document.createElement('div');
    chipsRow.className = 'set-chips';
    for (let s = 0; s < ex.sets; s++) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'set-chip' + (t.exercises[i][s] ? ' is-done' : '');
      chip.textContent = `Set ${s + 1}`;
      chip.id = `set-chip-${i}-${s}`;
      chip.onclick = () => onSetToggle(i, s, ex);
      chipsRow.appendChild(chip);
    }
    wrapper.appendChild(chipsRow);

    const timerBox = document.createElement('div');
    timerBox.className = 'rest-timer';
    timerBox.id = `rest-timer-${i}`;
    timerBox.innerHTML = `
      <div class="rest-timer-bar"><div class="rest-timer-fill" id="rest-fill-${i}"></div></div>
      <span class="rest-timer-text" id="rest-text-${i}"></span>
      <button type="button" class="rest-skip" id="rest-skip-${i}">skip</button>
    `;
    timerBox.style.display = 'none';
    wrapper.appendChild(timerBox);

    list.appendChild(wrapper);

    document.getElementById(`rest-skip-${i}`).onclick = () => stopRestTimer(i);
  });

  // Cardio
  const cf = day.gym_session.cardio_finisher;
  const cardioOptionsText = cf.choose_one.map(opt => {
    const specs = Object.entries(opt)
      .filter(([k]) => k !== 'machine')
      .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
      .join(', ');
    return `${opt.machine} (${specs})`;
  }).join(' / ');
  document.getElementById('cardioText').textContent =
    `${cf.duration_minutes} min — ${cardioOptionsText}`;
  const cardioCheck = document.getElementById('cardioCheck');
  cardioCheck.checked = t.cardio;
  toggleRowDone('cardioRow', t.cardio);
  cardioCheck.onchange = () => {
    t.cardio = cardioCheck.checked;
    onItemTicked('cardioRow', t.cardio);
  };

  // Stretch
  document.getElementById('stretchText').textContent = `${day.gym_session.stretching_minutes} min stretching`;
  const stretchCheck = document.getElementById('stretchCheck');
  stretchCheck.checked = t.stretch;
  toggleRowDone('stretchRow', t.stretch);
  stretchCheck.onchange = () => {
    t.stretch = stretchCheck.checked;
    onItemTicked('stretchRow', t.stretch);
  };
}

function toggleRowDone(id, isDone) {
  const row = document.getElementById(id);
  if (!row) return;
  row.classList.toggle('is-done', isDone);
}

function onItemTicked(rowId, isChecked) {
  toggleRowDone(rowId, isChecked);
  saveState();

  if (isChecked) {
    queuePopup(pickRandom(exerciseMessages));
  }

  const t = getTicks(state.pointer);
  if (isDayFullyTicked(t)) {
    completeDay();
  }
}

function onSetToggle(exerciseIndex, setIndex, ex) {
  const t = getTicks(state.pointer);
  const nowChecked = !t.exercises[exerciseIndex][setIndex];
  t.exercises[exerciseIndex][setIndex] = nowChecked;

  const chip = document.getElementById(`set-chip-${exerciseIndex}-${setIndex}`);
  if (chip) chip.classList.toggle('is-done', nowChecked);

  const setsDone = t.exercises[exerciseIndex].filter(Boolean).length;
  const countEl = document.getElementById(`ex-count-${exerciseIndex}`);
  if (countEl) countEl.textContent = `${setsDone}/${ex.sets}`;

  const header = document.getElementById(`ex-header-${exerciseIndex}`);
  if (header) header.classList.toggle('is-done', setsDone === ex.sets);

  saveState();

  if (nowChecked) {
    queuePopup(pickRandom(exerciseMessages));
    startRestTimer(exerciseIndex, ex.rest_seconds);
  } else {
    stopRestTimer(exerciseIndex);
  }

  if (isDayFullyTicked(t)) {
    completeDay();
  }
}

/* ---------------- Rest timers ---------------- */

function formatSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function startRestTimer(index, totalSeconds) {
  stopRestTimer(index); // clear any existing one for this row first

  const box = document.getElementById(`rest-timer-${index}`);
  const fill = document.getElementById(`rest-fill-${index}`);
  const text = document.getElementById(`rest-text-${index}`);
  if (!box) return;

  box.style.display = 'flex';
  box.classList.remove('rest-done');
  const endTime = Date.now() + totalSeconds * 1000;

  const tick = () => {
    const remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));
    text.textContent = formatSeconds(remaining);
    fill.style.width = `${((totalSeconds - remaining) / totalSeconds) * 100}%`;

    if (remaining <= 0) {
      clearInterval(restTimers[index].intervalId);
      delete restTimers[index];
      text.textContent = 'Rest done';
      box.classList.add('rest-done');
      setTimeout(() => {
        if (box) box.style.display = 'none';
      }, 4000);
    }
  };

  const intervalId = setInterval(tick, 250);
  restTimers[index] = { intervalId, endTime, total: totalSeconds };
  tick();
}

function stopRestTimer(index) {
  if (restTimers[index]) {
    clearInterval(restTimers[index].intervalId);
    delete restTimers[index];
  }
  const box = document.getElementById(`rest-timer-${index}`);
  if (box) box.style.display = 'none';
}

function clearAllRestTimers() {
  Object.keys(restTimers).forEach(i => clearInterval(restTimers[i].intervalId));
  for (const k in restTimers) delete restTimers[k];
}

function completeDay() {
  clearAllRestTimers();
  const pointer = state.pointer;
  const day = WORKOUTS[pointer];

  state.history[pointer] = {
    day: day.day,
    split: day.gym_session.split,
    completedDate: todayISO()
  };
  delete state.ticks[pointer];
  state.pointer = pointer + 1;
  saveState();

  queuePopup(pickRandom(dayCompleteMessages));
  setTimeout(render, 350);
}

function renderUpcoming() {
  const container = document.getElementById('upcomingList');
  container.innerHTML = '';
  const start = state.pointer + 1;
  const end = Math.min(start + 5, WORKOUTS.length);

  if (start >= WORKOUTS.length) {
    container.innerHTML = `<div class="history-empty">Nothing left — this is the last day.</div>`;
    return;
  }

  for (let i = start; i < end; i++) {
    const day = WORKOUTS[i];
    const offset = i - state.pointer;
    const projected = addDays(new Date(), offset);
    const row = document.createElement('div');
    row.className = 'upcoming-row';
    row.innerHTML = `<span>Day ${day.day} · ${day.gym_session.split}</span><span class="up-date">${formatShort(projected)}</span>`;
    container.appendChild(row);
  }
}

function renderHistory() {
  const container = document.getElementById('historyList');
  const countEl = document.getElementById('historyCount');
  const entries = Object.values(state.history).sort((a, b) => a.day - b.day);

  countEl.textContent = entries.length ? `(${entries.length})` : '';

  if (!entries.length) {
    container.innerHTML = `<div class="history-empty">Nothing logged yet.</div>`;
    return;
  }

  container.innerHTML = '';
  entries.slice().reverse().forEach(e => {
    const d = new Date(e.completedDate + 'T00:00:00');
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <span class="h-day">Day ${e.day}</span>
      <span class="h-split">${e.split}</span>
      <span class="h-date">${formatShort(d)}</span>
    `;
    container.appendChild(row);
  });
}

/* ---------------- Popups ---------------- */

function pickRandom(arr) {
  if (!arr || !arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function queuePopup(text) {
  if (!text) return;
  popupQueue.push(text);
  processPopupQueue();
}

function processPopupQueue() {
  if (popupBusy || !popupQueue.length) return;
  popupBusy = true;
  const text = popupQueue.shift();
  const el = document.getElementById('popup');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      popupBusy = false;
      processPopupQueue();
    }, 250);
  }, 1800);
}

init();