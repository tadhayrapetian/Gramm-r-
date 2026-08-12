// Small geometry toolkit shared by the letterform templates and the recognizer.
//
// Template coordinate system (used everywhere below):
//   x grows to the right, y grows downward (same as canvas),
//   baseline is y = 0, the top of the x-height is y = -1,
//   so ascenders sit near y = -1.5 and descenders near y = +0.5.
// One unit therefore equals one x-height, which makes distances readable:
// a cost of 0.2 means "off by a fifth of an x-height on average".

const DEG = Math.PI / 180;

/** Sample an ellipse arc. Angles are in degrees, counter-clockwise, 0 = right, 90 = top. */
export function arc(cx, cy, rx, ry, a0, a1) {
  const sweep = Math.abs(a1 - a0);
  const steps = Math.max(4, Math.round(sweep / 6));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (a0 + ((a1 - a0) * i) / steps) * DEG;
    pts.push([cx + rx * Math.cos(a), cy - ry * Math.sin(a)]);
  }
  return pts;
}

/** Half-ellipse from (x0, yTop) to (x0, yBot) bulging right (dir = 1) or left (dir = -1). */
export function bowl(x0, yTop, yBot, w, dir = 1) {
  const cy = (yTop + yBot) / 2;
  const ry = Math.abs(yBot - yTop) / 2;
  return arc(x0, cy, w, ry, 90, dir > 0 ? -90 : 270);
}

/** Concatenate point lists into a single stroke (the gaps become straight joins). */
export function join(...parts) {
  const out = [];
  for (const part of parts) for (const p of part) out.push(p);
  return out;
}

export function dist(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function centroid(points) {
  let sx = 0, sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  return [sx / points.length, sy / points.length];
}

/** Resample one stroke to exactly n evenly spaced points. */
export function resample(points, n) {
  if (points.length === 0) return [];
  if (points.length === 1 || pathLength(points) < 1e-9) {
    return Array.from({ length: n }, () => [points[0][0], points[0][1]]);
  }
  const interval = pathLength(points) / (n - 1);
  const out = [[points[0][0], points[0][1]]];
  let acc = 0;
  const src = points.slice();
  for (let i = 1; i < src.length; i++) {
    const d = dist(src[i - 1], src[i]);
    if (acc + d >= interval && d > 0) {
      const t = (interval - acc) / d;
      const p = [
        src[i - 1][0] + t * (src[i][0] - src[i - 1][0]),
        src[i - 1][1] + t * (src[i][1] - src[i - 1][1]),
      ];
      out.push(p);
      src.splice(i, 0, p);
      acc = 0;
    } else {
      acc += d;
    }
  }
  while (out.length < n) out.push([src[src.length - 1][0], src[src.length - 1][1]]);
  return out.slice(0, n);
}

/**
 * Resample a multi-stroke shape to n points, splitting the budget between strokes
 * in proportion to their length (this is what makes stroke count barely matter).
 */
export function resampleStrokes(strokes, n) {
  // Ink arrives from a pointer device by way of a couple of coordinate changes, so
  // drop anything that is not a finite pair rather than letting it poison the maths.
  const live = strokes
    .map((s) => s.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])))
    .filter((s) => s.length > 0);
  if (live.length === 0) return [];
  const lengths = live.map((s) => Math.max(pathLength(s), 1e-6));
  const total = lengths.reduce((a, b) => a + b, 0);
  const budget = live.map((_, i) => Math.max(2, Math.round((n * lengths[i]) / total)));

  // Nudge the budget until it sums to exactly n. Bounded: each pass moves one point.
  let sum = budget.reduce((a, b) => a + b, 0);
  for (let guard = 0; guard < 4 * n + live.length && sum !== n; guard++) {
    const idx = budget.indexOf(sum > n ? Math.max(...budget) : Math.min(...budget));
    if (idx < 0 || (sum > n && budget[idx] <= 2)) break;
    budget[idx] += sum > n ? -1 : 1;
    sum += sum > n ? -1 : 1;
  }

  const out = [];
  live.forEach((stroke, i) => {
    for (const p of resample(stroke, budget[i])) out.push(p);
  });
  return out.slice(0, n);
}

/**
 * Estimate how far the writing leans, from the segments that are meant to be upright.
 * Fitting dx = s·dy over near-vertical segments recovers the shear that slanted them.
 */
export function estimateSlant(strokes) {
  let sxy = 0;
  let syy = 0;
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i++) {
      const dx = stroke[i][0] - stroke[i - 1][0];
      const dy = stroke[i][1] - stroke[i - 1][1];
      if (Math.abs(dy) <= Math.abs(dx)) continue; // not a vertical-ish move
      sxy += dx * dy;
      syy += dy * dy;
    }
  }
  if (syy < 1e-6) return 0;
  return Math.max(-0.7, Math.min(0.7, sxy / syy));
}

/** Undo the lean, pivoting on the baseline (y = 0) so letters keep their place on the line. */
export function deslant(strokes, slant = estimateSlant(strokes)) {
  if (Math.abs(slant) < 0.02) return strokes;
  return strokes.map((stroke) => stroke.map(([x, y]) => [x - slant * y, y]));
}

/** Uniform scale + translate so the cloud is centred on the origin and fits a unit box. */
export function normalizeShape(points) {
  const box = bbox(points);
  const scale = Math.max(box.width, box.height, 1e-6);
  const [cx, cy] = centroid(points);
  return points.map(([x, y]) => [(x - cx) / scale, (y - cy) / scale]);
}

