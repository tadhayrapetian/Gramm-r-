// Offline accuracy check for the recogniser.
//
// There is no handwriting dataset in the repo, so samples are synthesised: reference
// letterforms are pushed through slant, scale, aspect, wobble and jitter distortions
// well past what a steady hand produces. That is not the same as real handwriting —
// it measures whether the matcher tolerates deformation, not whether it reads people.
// Where a letter has more than one variant, the held-out test hides the variant it is
// asked to read, which is the honest half of this harness.
//
//   node tools/eval.mjs [--samples 40] [--seed 7] [--verbose] [--trace]

import fs from 'node:fs';
import { TEMPLATES, ALPHABET } from '../src/ink/alphabet.js';
import { Recognizer } from '../src/ink/recognizer.js';
import { bbox } from '../src/ink/geometry.js';
import { segment } from '../src/ink/segment.js';
import { readAnswer, readInk } from '../src/ink/decode.js';
import { COMMON_WORDS } from '../src/data/lexicon.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const SAMPLES = opt('samples', 40);
const VERBOSE = args.includes('--verbose');
const TRACE = args.includes('--trace');
// Synchronous, so a run that is interrupted still shows how far it got.
const trace = (msg) => TRACE && fs.writeSync(2, `  · ${msg}\n`);

let seed = opt('seed', 7);
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const between = (a, b) => a + rnd() * (b - a);
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;

/**
 * A "hand": the style choices a writer keeps across a whole word — how big they write,
 * how much they lean, how wide their letters are. Per-letter wobble is added on top.
 */
function makeHand(strength) {
  return {
    scale: 1 + gauss() * 0.14 * strength,
    aspect: 1 + gauss() * 0.16 * strength,
    shear: gauss() * 0.32 * strength,
    lift: gauss() * 0.07 * strength,
  };
}

/** Deform a letterform the way an unsteady hand would. */
function distort(strokes, strength = 1, hand = makeHand(strength)) {
  const scale = hand.scale * (1 + gauss() * 0.05 * strength);
  const aspect = hand.aspect * (1 + gauss() * 0.06 * strength);
  const shear = hand.shear + gauss() * 0.07 * strength;
  const dy = hand.lift + gauss() * 0.05 * strength;
  const jitter = 0.035 * strength;
  const waveAmp = 0.05 * strength;
  const wavePhase = between(0, 6.28);
  const waveFreq = between(1.5, 3.5);

  const out = strokes.map((stroke) => {
    const drift = [gauss() * 0.03 * strength, gauss() * 0.03 * strength];
    return stroke.map(([x, y]) => {
      const wave = Math.sin(y * waveFreq + wavePhase) * waveAmp;
      return [
        (x * aspect + y * shear + wave + drift[0] + gauss() * jitter) * scale,
        (y + drift[1] + gauss() * jitter) * scale + dy,
      ];
    });
  });
  // Real writing does not respect stroke order.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.map((s) => (rnd() < 0.3 ? [...s].reverse() : s));
}

function groupByLabel(templates) {
  const map = new Map();
  for (const t of templates) {
    if (!map.has(t.label)) map.set(t.label, []);
    map.get(t.label).push(t);
  }
  return map;
}

function letterTest(name, pickTemplate, buildRecognizer, strength) {
  let top1 = 0;
  let top3 = 0;
  let total = 0;
  const misses = new Map();

  for (const label of ALPHABET) {
    trace(`letter ${label}`);
    const picked = pickTemplate(label);
    if (!picked) continue;
    const recognizer = buildRecognizer(label);
    for (let i = 0; i < SAMPLES; i++) {
      const source = picked[i % picked.length];
      const ink = distort(source.strokes, strength);
      const guesses = recognizer.recognize(ink);
      total++;
      if (guesses[0] && guesses[0].label === label) top1++;
      else {
        const key = `${label}→${guesses[0] ? guesses[0].label : '?'}`;
        misses.set(key, (misses.get(key) || 0) + 1);
      }
      if (guesses.slice(0, 3).some((g) => g.label === label)) top3++;
    }
  }

  const pct = (n) => `${((100 * n) / total).toFixed(1)}%`;
  console.log(`${name.padEnd(34)} top-1 ${pct(top1).padStart(6)}   top-3 ${pct(top3).padStart(6)}   (n=${total})`);
  if (VERBOSE) {
    const worst = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (worst.length) console.log('   confusions:', worst.map(([k, v]) => `${k} ×${v}`).join(', '));
  }
  return top1 / total;
}

/** Lay distorted letters along a baseline, the way they would land on the ruled line. */
function writeWord(text, byLabel, strength, capitals = null) {
  const strokes = [];
  const hand = makeHand(strength);
  let pen = 0;
  let index = 0;
  for (const char of text.toLowerCase()) {
    if (char === ' ') {
      pen += between(0.85, 1.35);
      index = 0;
      continue;
    }
    // Words are written in the letterforms a learner would actually use: lowercase,
    // with a capital only where the answer starts one.
    const pool = capitals && index === 0 ? capitals : byLabel;
    index++;
    const variants = pool.get(char) || byLabel.get(char);
    if (!variants) return null;
    const source = variants[Math.floor(rnd() * variants.length)];
    const ink = distort(source.strokes, strength, hand);
    const box = bbox(ink.flat());
    for (const stroke of ink) strokes.push(stroke.map(([x, y]) => [x - box.minX + pen, y]));
    pen += box.width + between(0.12, 0.3);
  }
  return strokes;
}

function wordTest(name, words, recognizer, byLabel, lexicon, strength, capitals = null) {
  let correct = 0;
  let unsure = 0;
  let total = 0;
  let segmented = 0;
  const rounds = Math.max(4, Math.round(SAMPLES / 4));
  const failures = [];

  for (const word of words) {
    trace(`word ${word}`);
    const expectedWords = word.split(' ').length;
    const expectedLetters = word.replace(/ /g, '').length;
    for (let i = 0; i < rounds; i++) {
      const strokes = writeWord(word, byLabel, strength, capitals);
      if (!strokes) continue;
      const result = readInk(strokes, recognizer, lexicon, word);
      const letters = result.words ? result.words.reduce((n, w) => n + w.letters.length, 0) : 0;
      if (letters === expectedLetters && result.words && result.words.length === expectedWords) segmented++;
      total++;
      if (result.verdict === 'correct') correct++;
      else if (result.verdict === 'unsure') unsure++;
      else failures.push(`${word} read as "${result.read}"`);
    }
  }
  const pct = (n) => `${((100 * n) / total).toFixed(1)}%`;
  console.log(
    `${name.padEnd(34)} accepted ${pct(correct).padStart(6)}   unsure ${pct(unsure).padStart(6)}` +
      `   misread ${pct(total - correct - unsure).padStart(6)}   split right ${pct(segmented).padStart(6)}   (n=${total})`,
  );
  if (VERBOSE && failures.length) console.log('   misreads:', failures.slice(0, 10).join('; '));
  return correct / total;
}

function falsePositiveTest(name, pairs, recognizer, byLabel, lexicon, strength) {
  // Write the wrong word and make sure the checker does not wave it through.
  let flagged = 0;
  let accepted = 0;
  let total = 0;
  const rounds = Math.max(4, Math.round(SAMPLES / 4));
  for (const [written, expected] of pairs) {
    trace(`pair ${written}/${expected}`);
    for (let i = 0; i < rounds; i++) {
      const strokes = writeWord(written, byLabel, strength);
      if (!strokes) continue;
      const result = readInk(strokes, recognizer, lexicon, expected);
      total++;
      if (result.verdict === 'wrong') flagged++;
      else if (result.verdict === 'correct') accepted++;
    }
  }
  const pct = (n) => `${((100 * n) / total).toFixed(1)}%`;
  console.log(`${name.padEnd(34)} caught ${pct(flagged).padStart(6)}   wrongly accepted ${pct(accepted).padStart(6)}   (n=${total})`);
  return accepted / total;
}

const byLabel = groupByLabel(TEMPLATES);
const byLower = groupByLabel(TEMPLATES.filter((t) => t.form === 'lower'));
const byUpper = groupByLabel(TEMPLATES.filter((t) => t.form === 'upper'));
const full = new Recognizer();

console.log('\nLetters');
letterTest('  distorted, all variants known', (l) => byLabel.get(l), () => full, 1);
letterTest('  heavily distorted', (l) => byLabel.get(l), () => full, 1.6);
letterTest(
  '  held-out variant (unseen form)',
  (l) => {
    const variants = byLabel.get(l) || [];
    return variants.length > 1 ? variants.slice(1) : null;
  },
  (l) => {
    const variants = byLabel.get(l) || [];
    const hidden = new Set(variants.slice(1));
    return new Recognizer(TEMPLATES.filter((t) => !hidden.has(t)));
  },
  1,
);

const answers = [
  'goes', 'watches', 'plays', 'is', 'are', 'am', 'an', 'the', 'boxes', 'children',
  'switch', 'socket', 'plug', 'cable', 'bigger', 'went', 'studied', 'on', 'in', 'at',
];
const lexicon = [...new Set([...answers, ...COMMON_WORDS])];

console.log('\nWords (segmentation + lexicon reading)');
wordTest('  expected answers', answers, full, byLower, lexicon, 1);
wordTest('  heavily distorted', answers, full, byLower, lexicon, 1.5);
wordTest('  two-word answers', ['is going', 'has got', 'did not'], full, byLower, lexicon, 1);
wordTest('  capital first letter', ['the', 'she', 'they', 'an'], full, byLower, lexicon, 1, byUpper);

console.log('\nWrong answers must not slip through');
falsePositiveTest(
  '  near-miss spellings',
  [
    ['go', 'goes'], ['watchs', 'watches'], ['plaies', 'plays'], ['boxs', 'boxes'],
    ['childs', 'children'], ['a', 'an'], ['gooder', 'bigger'], ['goed', 'went'],
    ['studyed', 'studied'], ['in', 'on'],
  ],
  full,
  byLower,
  lexicon,
  1,
);
console.log('');
