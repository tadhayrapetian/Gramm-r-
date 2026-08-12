// Progress, settings and the learner's own letterforms, kept in localStorage.
// Everything stays on the device: nothing here is ever sent anywhere.

const KEY = 'grammar-ink.v1';

const EMPTY = {
  xp: 0,
  streak: { count: 0, lastDay: null },
  units: {}, // unitId → { done: [taskId], finished: bool }
  settings: { lang: 'ru', tool: 'pencil', input: 'ink' },
  hand: {}, // letter → stroke sets taught by the learner
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const saved = JSON.parse(raw);
    return {
      ...structuredClone(EMPTY),
      ...saved,
      settings: { ...EMPTY.settings, ...(saved.settings || {}) },
      streak: { ...EMPTY.streak, ...(saved.streak || {}) },
      units: saved.units || {},
      hand: saved.hand || {},
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

let state = read();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full quota: the session still works, it just will not be remembered.
  }
  for (const listener of listeners) listener(state);
}

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSetting(key, value) {
  state.settings[key] = value;
  persist();
}

export function unitProgress(unitId) {
  return state.units[unitId] || { done: [], finished: false };
}

export function taskDone(unitId, taskId, { xp = 10 } = {}) {
  const unit = unitProgress(unitId);
  if (!unit.done.includes(taskId)) {
    unit.done = [...unit.done, taskId];
    state.xp += xp;
  }
  state.units[unitId] = unit;
  bumpStreak();
  persist();
}

export function unitFinished(unitId) {
  const unit = unitProgress(unitId);
  unit.finished = true;
  state.units[unitId] = unit;
  persist();
}

export function resetUnit(unitId) {
  state.units[unitId] = { done: [], finished: false };
  persist();
}

function bumpStreak() {
  const day = today();
  const { lastDay, count } = state.streak;
  if (lastDay === day) return;
  const gap = lastDay ? daysBetween(lastDay, day) : null;
  state.streak = { count: gap === 1 ? count + 1 : 1, lastDay: day };
}

/** Letterforms the learner taught the app, as {letter: strokes[][]}. */
export function saveHand(letter, strokeSets) {
  if (strokeSets && strokeSets.length) state.hand[letter] = strokeSets;
  else delete state.hand[letter];
  persist();
}

export function clearHand() {
  state.hand = {};
  persist();
}

export function handSize() {
  return Object.keys(state.hand).length;
}
