// Single-letter recognizer: a $P point-cloud matcher (Vatavu, Anthony & Wobbrock)
// with one addition that matters a lot here — because the app draws the ruled line
// the learner writes on, we know where the baseline is and how tall the x-height is.
// So ink can be mapped into template space directly, and vertical extent becomes a
// real feature: `l` is tall, `o` is not, `p` hangs below the line.
//
// Every letter is scored twice:
//   dGuide — distance after guideline normalisation (keeps size and height)
//   dShape — distance after plain $P normalisation (size-blind, forgiving)
// and the two are blended, so writing a bit large or small costs a little, not everything.
//
// Clouds are flat Float32Arrays (x, y, x, y, ...) because this runs on every pause in
// writing, on a tablet, and the matcher is O(n²) per comparison.

import { TEMPLATES } from './alphabet.js';
import { normalizeShape, resampleStrokes } from './geometry.js';

const N = 24; // points per cloud
const STARTS_COARSE = 1;
const STARTS_FINE = 2;

// Blend weights and the search performed around the writing line.
const W_GUIDE = 0.62;
const W_SHAPE = 0.38;
const SHAPE_GAIN = 2.2; // puts dShape on the same numeric scale as dGuide
const SCALES = [0.82, 1, 1.2];
const OFFSETS = [-0.13, 0, 0.13];
const STAGE_B_CANDIDATES = 10;
const USER_TEMPLATE_BONUS = 0.86; // hand-taught letterforms win ties

function flatten(points) {
  const out = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    out[i * 2] = points[i][0];
    out[i * 2 + 1] = points[i][1];
  }
  return out;
}

/** Centre horizontally — where the letter sits along the line carries no meaning. */
function centerXFlat(cloud) {
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < cloud.length; i += 2) {
    if (cloud[i] < minX) minX = cloud[i];
    if (cloud[i] > maxX) maxX = cloud[i];
  }
  const cx = (minX + maxX) / 2;
  const out = new Float32Array(cloud.length);
  for (let i = 0; i < cloud.length; i += 2) {
    out[i] = cloud[i] - cx;
    out[i + 1] = cloud[i + 1];
  }
  return out;
}

export function makeCloud(strokes) {
  const pts = resampleStrokes(strokes, N);
  if (pts.length === 0) return null;
  return { guide: centerXFlat(flatten(pts)), shape: flatten(normalizeShape(pts)) };
}

/** $P greedy cloud match, with an early exit once the running sum is hopeless. */
function cloudDistance(a, b, start, limit) {
  const n = a.length / 2;
  const matched = new Uint8Array(n);
  let sum = 0;
  let i = start;
  for (let step = 0; step < n; step++) {
    const ax = a[i * 2];
    const ay = a[i * 2 + 1];
    let min = Infinity;
    let index = -1;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const dx = ax - b[j * 2];
      const dy = ay - b[j * 2 + 1];
      const d = dx * dx + dy * dy; // argmin is the same, and this skips n sqrt calls
      if (d < min) {
        min = d;
        index = j;
      }
    }
    matched[index] = 1;
    sum += (1 - step / n) * Math.sqrt(min);
    if (sum >= limit) return Infinity;
    i = (i + 1) % n;
  }
  return sum;
}

function greedyMatch(a, b, starts = STARTS_FINE, limit = Infinity) {
  const n = a.length / 2;
  const step = Math.max(1, Math.floor(n / starts));
  let min = limit;
  for (let i = 0; i < n; i += step) {
    const d1 = cloudDistance(a, b, i, min);
    if (d1 < min) min = d1;
    const d2 = cloudDistance(b, a, i, min);
    if (d2 < min) min = d2;
  }
  // Normalise by point count and by the $P weighting mass (~n/2).
  return min === Infinity ? Infinity : (min * 2) / n;
}

function transformGuide(cloud, scale, dy) {
  const out = new Float32Array(cloud.length);
  for (let i = 0; i < cloud.length; i += 2) {
    out[i] = cloud[i] * scale;
    out[i + 1] = cloud[i + 1] * scale + dy;
  }
  return out;
}

export class Recognizer {
  constructor(templates = TEMPLATES) {
    this.templates = [];
    for (const t of templates) this.add(t.label, t.strokes, t.source || 'builtin');
  }

  add(label, strokes, source = 'user') {
    const cloud = makeCloud(strokes);
    if (!cloud) return;
    this.templates.push({ label, source, ...cloud });
  }

  /** Replace every hand-taught template for a label. */
  setUserTemplates(label, strokeSets) {
    this.templates = this.templates.filter((t) => !(t.source === 'user' && t.label === label));
    for (const strokes of strokeSets) this.add(label, strokes, 'user');
  }

  clearUserTemplates() {
    this.templates = this.templates.filter((t) => t.source !== 'user');
  }

  hasUserTemplates() {
    return this.templates.some((t) => t.source === 'user');
  }

  /**
   * @param {number[][][]} strokes ink for one letter, already in template units
   * @returns {{label: string, cost: number}[]} best labels, cheapest first
   */
  recognize(strokes, { topK = 6 } = {}) {
    const input = makeCloud(strokes);
    if (!input) return [];

    // Stage A — one cheap pass over everything, just to pick who gets a proper look.
    const coarse = this.templates.map((t, index) => {
      const g = greedyMatch(input.guide, t.guide, STARTS_COARSE);
      const s = greedyMatch(input.shape, t.shape, STARTS_COARSE);
      return { index, cost: W_GUIDE * g + W_SHAPE * SHAPE_GAIN * s };
    });
    coarse.sort((a, b) => a.cost - b.cost);

    // Stage B — let the survivors slide and resize a little to fit the writing.
    const variants = [];
    for (const scale of SCALES) {
      for (const dy of OFFSETS) variants.push(transformGuide(input.guide, scale, dy));
    }

    const best = new Map();
    for (const { index } of coarse.slice(0, STAGE_B_CANDIDATES)) {
      const t = this.templates[index];
      const shapeCost = greedyMatch(input.shape, t.shape);
      let guideCost = Infinity;
      for (const moved of variants) {
        const d = greedyMatch(moved, t.guide, STARTS_FINE, guideCost);
        if (d < guideCost) guideCost = d;
      }
      let cost = W_GUIDE * guideCost + W_SHAPE * SHAPE_GAIN * shapeCost;
      if (t.source === 'user') cost *= USER_TEMPLATE_BONUS;
      const prev = best.get(t.label);
      if (prev === undefined || cost < prev) best.set(t.label, cost);
    }

    return [...best.entries()]
      .map(([label, cost]) => ({ label, cost }))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, topK);
  }
}
