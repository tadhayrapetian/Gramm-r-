// Turns a pile of strokes into words and letters.
//
// Everything here works in template units (1 = one x-height, baseline at y = 0),
// which the writing line produces from raw canvas points — see `InkLine.templateStrokes`.
//
// Slanted writing is straightened first: a right-leaning `t` reaches across its
// neighbour and would otherwise be grouped with it.
//
// Grouping is horizontal, and the rules are deliberately conservative: strokes join
// into one letter when they actually overlap (`x`, the stem and bowl of `b`) or when
// a small stroke floats over one (the dot on `i`, the bar on `t`). Plain proximity is
// not enough — people leave real gaps between printed letters. Anything that still
// comes out too wide is a suspected pile-up and gets split at its thinnest point.

import { deslant } from './geometry.js';

const TOUCH_GAP = 0.1; // strokes this close are touching, not neighbouring
const OVERLAP_SHARE = 0.34; // ...or overlap this much of the narrower stroke
const MIN_SHARE_WIDTH = 0.08;
const STEM_WIDTH = 0.18; // a bare upright: the stem of `r`, `h`, `n`
const STEM_HEIGHT = 0.55;
const STEM_REACH = 0.12;
const DOT_SIZE = 0.45;
const BAR_HEIGHT = 0.28; // crossbars are wide but flat
const BAR_WIDTH = 0.8;
const DIACRITIC_REACH = 0.25;
const MAX_LETTER_WIDTH = 1.3; // widest sensible single letter (`m`, `w`)
const VALLEY_SHARE = 0.35; // a split needs a nearly empty column, not just a dip
export const JOINED_UP_WIDTH = 1.9; // beyond this it is cursive, and we say so

function strokeBox(stroke) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of stroke) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function box(minX, maxX, minY, maxY) {
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function mergeBoxes(a, b) {
  return box(
    Math.min(a.minX, b.minX),
    Math.max(a.maxX, b.maxX),
    Math.min(a.minY, b.minY),
    Math.max(a.maxY, b.maxY),
  );
}

function boxOf(strokes) {
  return strokes.map(strokeBox).reduce(mergeBoxes);
}

/** Split a cluster that is too wide to be one letter, at its thinnest vertical slice. */
function splitWide(cluster, tuning, depth = 0) {
  if (cluster.box.width <= tuning.splitWidth || cluster.strokes.length < 2 || depth > 3) {
    return [cluster];
  }

  const BIN = 0.05;
  const bins = Math.max(1, Math.ceil(cluster.box.width / BIN));
  const density = new Float64Array(bins);
  for (const stroke of cluster.strokes) {
    for (const [x] of stroke) {
      const i = Math.min(bins - 1, Math.floor((x - cluster.box.minX) / BIN));
      density[i] += 1;
    }
  }

  // Look for the emptiest slice, staying away from the edges.
  const margin = Math.max(1, Math.floor(0.34 / BIN));
  let bestIndex = -1;
  let bestValue = Infinity;
  for (let i = margin; i < bins - margin; i++) {
    const value = density[i - 1] + density[i] + density[i + 1];
    if (value < bestValue) {
      bestValue = value;
      bestIndex = i;
    }
  }
  const mean = 3 * (density.reduce((a, b) => a + b, 0) / bins); // three bins are summed above
  if (bestIndex < 0 || bestValue > mean * tuning.valleyShare) return [cluster];

  const splitX = cluster.box.minX + (bestIndex + 0.5) * BIN;
  const left = [];
  const right = [];
  for (const stroke of cluster.strokes) {
    const sb = strokeBox(stroke);
    ((sb.minX + sb.maxX) / 2 < splitX ? left : right).push(stroke);
  }
  if (!left.length || !right.length) return [cluster];

  return [
    ...splitWide({ strokes: left, box: boxOf(left) }, tuning, depth + 1),
    ...splitWide({ strokes: right, box: boxOf(right) }, tuning, depth + 1),
  ];
}

/** Dots and crossbars: too small to be a letter, so they belong to one. */
function isFloater(box) {
  return isDot(box) || isBar(box);
}

function isDot(box) {
  return box.width < DOT_SIZE && box.height < DOT_SIZE;
}

function isBar(box) {
  return box.height < BAR_HEIGHT && box.width < BAR_WIDTH;
}

/**
 * A lone upright stroke is never a whole letter on its own except `l` and `I`, so
 * when it lands against something else, it is that letter's stem: `r`, `h`, `b`, `k`.
 */
function isStem(box) {
  return box.width < STEM_WIDTH && box.height > STEM_HEIGHT;
}

function clusterStrokes(strokes, tuning) {
  const items = strokes
    .filter((s) => s.length > 0)
    .map((stroke) => ({ stroke, box: strokeBox(stroke) }))
    .sort((a, b) => a.box.minX - b.box.minX);

  // Pass 1 — letter bodies only. Sorting by x puts the dot on `i` before its stem,
  // so letting floaters seed clusters would strand the letter they belong to.
  const clusters = [];
  for (const item of items) {
    if (isFloater(item.box)) continue;

    let host = null;
    let hostScore = Infinity;
    for (const cluster of clusters) {
      const overlap = Math.min(item.box.maxX, cluster.box.maxX) - Math.max(item.box.minX, cluster.box.minX);
      const narrower = Math.max(MIN_SHARE_WIDTH, Math.min(item.box.width, cluster.box.width));
      const gap = item.box.minX - cluster.box.maxX;
      // A stem may sit a hair inside its bowl or arch; two neighbouring letters that
      // graze each other must not be treated the same way, hence the stem test.
      const stemTouch =
        (isStem(item.box) || isStem(cluster.box)) && gap > -STEM_REACH && gap < TOUCH_GAP;

      if (!(overlap > OVERLAP_SHARE * narrower || (gap >= 0 && gap < TOUCH_GAP) || stemTouch)) continue;
      if (mergeBoxes(cluster.box, item.box).width > tuning.splitWidth * 1.35) continue;

      const score = overlap > 0 ? -overlap : Math.abs(gap);
      if (score < hostScore) {
        hostScore = score;
        host = cluster;
      }
    }

    if (host) {
      host.strokes.push(item.stroke);
      host.box = mergeBoxes(host.box, item.box);
    } else {
      clusters.push({ strokes: [item.stroke], box: { ...item.box } });
    }
  }

  // Anything too wide to be one letter is probably two that touched.
  let split = clusters.flatMap((c) => splitWide(c, tuning));

  // Pass 2 — hand each floater to the letter it belongs to. A crossbar spanning two
  // uprights joins them (`H`, `A`, `E`); a dot goes to the stroke below it. A stray
  // mark with no letter under it stays on its own: that is how an apostrophe survives.
  for (const item of items) {
    if (!isFloater(item.box)) continue;

    if (isBar(item.box) && !isDot(item.box)) {
      const spanned = split.filter((cluster) => {
        const centre = (cluster.box.minX + cluster.box.maxX) / 2;
        return centre > item.box.minX - DIACRITIC_REACH && centre < item.box.maxX + DIACRITIC_REACH;
      });
      if (spanned.length > 1) {
        const merged = spanned.reduce(
          (acc, cluster) => ({
            strokes: [...acc.strokes, ...cluster.strokes],
            box: mergeBoxes(acc.box, cluster.box),
          }),
          { strokes: [item.stroke], box: item.box },
        );
        if (merged.box.width <= tuning.splitWidth * 1.35) {
          split = split.filter((cluster) => !spanned.includes(cluster));
          split.push(merged);
          continue;
        }
      }
    }

    const centre = (item.box.minX + item.box.maxX) / 2;
    let host = null;
    let hostScore = Infinity;
    for (const cluster of split) {
      const distance =
        centre < cluster.box.minX
          ? cluster.box.minX - centre
          : centre > cluster.box.maxX
            ? centre - cluster.box.maxX
            : 0;
      if (distance > DIACRITIC_REACH) continue;
      if (distance < hostScore) {
        hostScore = distance;
        host = cluster;
      }
    }
    if (host) {
      host.strokes.push(item.stroke);
      host.box = mergeBoxes(host.box, item.box);
    } else {
      split.push({ strokes: [item.stroke], box: { ...item.box } });
    }
  }

  split = split.sort((a, b) => a.box.minX - b.box.minX);
  return split;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function groupIntoWords(clusters, breakAt) {
  const words = [];
  let current = null;
  clusters.forEach((cluster, i) => {
    const letter = { strokes: cluster.strokes, box: cluster.box };
    const gap = i === 0 ? Infinity : cluster.box.minX - clusters[i - 1].box.maxX;
    if (!current || breakAt(gap, i)) {
      current = { letters: [letter], box: { ...cluster.box } };
      words.push(current);
    } else {
      current.letters.push(letter);
      current.box = mergeBoxes(current.box, cluster.box);
    }
  });
  return words;
}

/**
 * @param {number[][][]} strokes ink in template units
 * @param {{expectedWords?: number}} [options] used only to place spaces, never letters
 * @returns {{letters: {strokes: number[][][], box: object}[], box: object}[]}
 */
export function segment(rawStrokes, options = {}) {
  const tuning = {
    splitWidth: options.splitWidth ?? MAX_LETTER_WIDTH,
    valleyShare: options.valleyShare ?? VALLEY_SHARE,
  };
  const strokes = options.deslanted ? rawStrokes : deslant(rawStrokes);
  const clusters = clusterStrokes(strokes, tuning);
  if (clusters.length === 0) return [];

  const gaps = clusters.slice(1).map((c, i) => c.box.minX - clusters[i].box.maxX);
  const typical = median(gaps.filter((g) => g > 0)) || 0.2;
  const threshold = Math.max(0.5, Math.min(1.1, typical * 2.6));
  let words = groupIntoWords(clusters, (gap) => gap > threshold);

  // If the exercise expects a set number of words and the spacing was ambiguous,
  // put the spaces at the widest gaps instead. This moves spaces, not letters —
  // it cannot turn a misread word into a correct one.
  const expected = options.expectedWords;
  if (expected && expected !== words.length && clusters.length >= expected) {
    const ranked = gaps
      .map((gap, i) => ({ gap, at: i + 1 }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, expected - 1);
    if (ranked.every((r) => r.gap > Math.max(0.35, typical * 1.6))) {
      const breaks = new Set(ranked.map((r) => r.at));
      words = groupIntoWords(clusters, (_, i) => breaks.has(i));
    }
  }
  return words;
}

/**
 * The same ink, cut up three ways: as measured, more eagerly, and more reluctantly.
 * The reader scores all three and keeps whichever it can read with most confidence —
 * cutting between letters is the part this file is least certain about.
 */
export function segmentations(strokes, options = {}) {
  const deslanted = deslant(strokes);
  const shared = { ...options, deslanted: true };
  return [
    segment(deslanted, shared),
    segment(deslanted, { ...shared, splitWidth: 1.02, valleyShare: 0.62 }),
    segment(deslanted, { ...shared, splitWidth: 1.7, valleyShare: 0.2 }),
  ];
}

/** True when a letter group is so wide it was probably written joined-up. */
export function looksJoinedUp(words) {
  return words.some((word) => word.letters.some((l) => l.box.width > JOINED_UP_WIDTH));
}
