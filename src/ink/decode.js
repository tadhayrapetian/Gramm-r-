// Turning letter guesses into an answer.
//
// Free letter-by-letter reading is fragile — `cl` vs `d`, `rn` vs `m`. So the ink is
// also scored against a small lexicon: the words this exercise expects plus the ones
// it expects learners to get wrong plus a common-word list. The cheapest word wins,
// and we keep the runner-up to know how sure we are. A wrong answer still reads as a
// wrong word (that is why the distractors are in the lexicon), so this constrains the
// reading without quietly turning mistakes into successes.

import { looksJoinedUp, segmentations } from './segment.js';

const MISSING_PENALTY = 0.2; // letter fell outside the candidate list
const GOOD_COST = 0.17;
const MAX_COST = 0.4;
const MARGIN_FULL = 0.055;
const LETTER_MAX = 0.55; // no single letter may be this far off in an accepted word
const TIE_MARGIN = 0.035; // reading gap below which two words are not really distinguishable

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Score every letter of a written word, keeping the candidate list per position. */
export function readLetters(word, recognizer) {
  return word.letters.map((letter) => {
    const list = recognizer.recognize(letter.strokes);
    const map = new Map(list.map((c) => [c.label, c.cost]));
    const worst = list.length ? list[list.length - 1].cost : 1;
    return { map, worst, best: list[0] ? list[0].label : '?', list };
  });
}

function scoreCandidate(slots, word) {
  const letters = [...word.toLowerCase()];
  if (letters.length !== slots.length) return null;
  let sum = 0;
  let worstLetter = 0;
  for (let i = 0; i < letters.length; i++) {
    const slot = slots[i];
    const cost = slot.map.has(letters[i]) ? slot.map.get(letters[i]) : slot.worst + MISSING_PENALTY;
    worstLetter = Math.max(worstLetter, cost);
    sum += cost;
  }
  return { word, cost: sum / letters.length, worstLetter };
}

/**
 * Read one handwritten word.
 * @param {object} word segmented word (letters + boxes)
 * @param {import('./recognizer.js').Recognizer} recognizer
 * @param {string[]} lexicon words this answer is allowed to be
 */
export function readWord(word, recognizer, lexicon) {
  const slots = readLetters(word, recognizer);
  const free = slots.map((s) => s.best).join('');

  const seen = new Set();
  const ranked = [];
  for (const candidate of lexicon) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const scored = scoreCandidate(slots, key);
    if (scored) ranked.push(scored);
  }
  ranked.sort((a, b) => a.cost - b.cost);

  const best = ranked[0] || null;
  const runnerUp = ranked[1] || null;
  const margin = best && runnerUp ? runnerUp.cost - best.cost : Infinity;

  let confidence = 0;
  if (best) {
    const costConf = clamp01((MAX_COST - best.cost) / (MAX_COST - GOOD_COST));
    const marginConf = runnerUp ? clamp01(margin / MARGIN_FULL) : 1;
    confidence = Math.min(costConf, 0.35 + 0.65 * marginConf);
    if (best.worstLetter > LETTER_MAX) confidence = Math.min(confidence, 0.3);
  }

  return { free, best, runnerUp, margin, confidence, slots, letterCount: slots.length };
}

/**
 * Read a whole written line and compare it with the expected answer.
 * @returns {{verdict: 'correct'|'wrong'|'unsure', read: string, confidence: number}}
 */
export function readAnswer(words, recognizer, lexicon, expected) {
  if (words.length === 0) return { verdict: 'unsure', read: '', confidence: 0, reason: 'empty' };

  const targets = expected.trim().split(/\s+/);
  const results = words.map((word) => readWord(word, recognizer, lexicon));
  const read = results.map((r) => (r.best ? r.best.word : r.free)).join(' ');
  const confidence = Math.min(...results.map((r) => r.confidence));

  if (words.length !== targets.length) {
    // Wrong number of words is only a verdict if we could read them at all.
    return {
      verdict: confidence > 0.4 ? 'wrong' : 'unsure',
      read,
      confidence,
      reason: 'word-count',
      results,
    };
  }

  const matches = results.every((r, i) => r.best && r.best.word === targets[i].toLowerCase());
  if (matches && confidence >= 0.45) {
    return { verdict: 'correct', read, confidence, results };
  }
  if (!matches && confidence >= 0.5) {
    // Before calling it wrong, check we can actually tell it apart from the right
    // answer. Ink that scores almost the same either way is bad handwriting, not a
    // mistake, and saying so beats marking a correct answer wrong.
    const indistinguishable = results.every((r, i) => {
      const target = scoreCandidate(r.slots, targets[i].toLowerCase());
      return target && r.best && target.cost - r.best.cost < TIE_MARGIN;
    });
    if (indistinguishable) {
      return { verdict: 'unsure', read, confidence, reason: 'too-close', results };
    }
    return { verdict: 'wrong', read, confidence, results };
  }
  return { verdict: 'unsure', read, confidence, results };
}

/**
 * Read ink from a writing line, deciding where the letters are and what they say
 * together. Each candidate cut of the ink is read in full and the most confident
 * reading wins — including when that reading is a wrong answer.
 *
 * @param {number[][][]} strokes ink in template units
 */
export function readInk(strokes, recognizer, lexicon, expected) {
  const expectedWords = expected.trim().split(/\s+/).length;
  const options = segmentations(strokes, { expectedWords });

  let best = null;
  for (const words of options) {
    if (words.length === 0) continue;
    const result = readAnswer(words, recognizer, lexicon, expected);
    const cost = result.results ? mean(result.results.map((r) => (r.best ? r.best.cost : 1))) : 1;
    const letters = words.reduce((n, w) => n + w.letters.length, 0);
    const candidate = { ...result, cost, letters, words };
    if (!best || better(candidate, best)) best = candidate;
  }

  if (!best) return { verdict: 'unsure', read: '', confidence: 0, reason: 'empty' };
  if (looksJoinedUp(best.words)) {
    return { ...best, verdict: best.verdict === 'correct' ? 'correct' : 'unsure', reason: 'joined-up' };
  }
  return best;
}

const mean = (values) => values.reduce((a, b) => a + b, 0) / (values.length || 1);

function better(candidate, incumbent) {
  if (candidate.confidence !== incumbent.confidence) return candidate.confidence > incumbent.confidence;
  return candidate.cost < incumbent.cost;
}

/** Words the reader is allowed to return for a task: the answer, its traps, and common words. */
export function buildLexicon(task, base) {
  const words = new Set();
  const add = (text) => {
    if (!text) return;
    for (const w of String(text).toLowerCase().split(/\s+/)) {
      const clean = w.replace(/[^a-z']/g, '');
      if (clean) words.add(clean);
    }
  };
  add(task.answer);
  (task.accept || []).forEach(add);
  (task.distractors || []).forEach(add);
  (task.options || []).forEach(add);
  add(task.cue);
  for (const w of base) words.add(w);
  return [...words];
}
