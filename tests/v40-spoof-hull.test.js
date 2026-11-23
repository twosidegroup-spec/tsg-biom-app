/* TSG Biom — v40 regression: the screen-spoof GRID gate samples the
   palm HULL, and grid-alone conviction requires palm-wide COVERAGE.
   Trigger (the Chairman's phone, 2026-11-23 15:01): registration and
   verification work, but live scans still ended "Spoof / Screen
   Replay Detected" with NO spoofing — the screenshot shows density
   0.31, grid coherence 0.82, the camera over a glossy PRINTED page.
   The v36 fix scoped the grid stats to the ROI SQUARE (bounding box
   + 6% margin), but the square is much larger than the palm: print
   halftone/texture inside the square, beside and around the hand,
   supplied the flat periodic blocks that convicted.
   v40: (1) the app feeds the gate palmHullRegionPx — the convex
   hull of the palm-body landmarks (wrist, thumb base, knuckles),
   eroded 10% toward its centroid — and only blocks whose CENTRE
   falls inside the hull are sampled; (2) grid-ALONE conviction
   additionally requires the grid to be PRESENT (per-block density
   >= 0.20 and coherence >= 0.35) in at least 60% of the sampled
   in-hull blocks. A screen displaying a palm covers the palm
   (measured coverage 1.00 on every real-presentation fixture
   below); a pattern touching a minority of the palm cannot convict
   on grid alone, even when the pooled stats clear the bars
   (fixture B: pooled 0.87 / 0.79, coverage 0.40, not convicted).
   The 0.62 coherence bar, the 0.20 density threshold, the
   grid + glare rule and the bezel rule are unchanged; the box
   region path (v36 suite) is byte-identical.
   Fixtures are SYNTHETIC, in the v36-suite style; every asserted
   number was measured on this rig before the assertion was written. */
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }

const W = 160, H = 120;
function frame(fn) {
  const g = new Array(W * H), rnd = lcg(7);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = fn(x, y, rnd);
  return g;
}
/* Spread hand: v36-suite knuckle geometry plus a plausible thumb
   base (landmarks 1-4), which the hull reads. */
function hand() {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: 0.5, y: 0.6, z: 0 });
  const K = [{ x: 0.38, y: 0.55 }, { x: 0.5, y: 0.52 }, { x: 0.62, y: 0.55 }, { x: 0.72, y: 0.58 }];
  const T = [{ x: 0.30, y: 0.22 }, { x: 0.47, y: 0.16 }, { x: 0.64, y: 0.22 }, { x: 0.78, y: 0.34 }];
  lm[0] = { x: 0.5, y: 0.85, z: 0 };
  lm[1] = { x: 0.40, y: 0.72, z: 0 };
  lm[2] = { x: 0.33, y: 0.64, z: 0 };
  lm[3] = { x: 0.28, y: 0.52, z: 0 };
  lm[4] = { x: 0.24, y: 0.40, z: 0 };
  lm[5] = K[0]; lm[9] = K[1]; lm[13] = K[2]; lm[17] = K[3];
  lm[8] = T[0]; lm[12] = T[1]; lm[16] = T[2]; lm[20] = T[3];
  lm[6] = { x: (K[0].x + T[0].x) / 2, y: (K[0].y + T[0].y) / 2, z: 0 };
  lm[10] = { x: (K[1].x + T[1].x) / 2, y: (K[1].y + T[1].y) / 2, z: 0 };
  lm[14] = { x: (K[2].x + T[2].x) / 2, y: (K[2].y + T[2].y) / 2, z: 0 };
  lm[18] = { x: (K[3].x + T[3].x) / 2, y: (K[3].y + T[3].y) / 2, z: 0 };
  return lm;
}
const LM = hand();
const BOX = B.palmRoiRegionPx(W, H, LM);
const HULL = B.palmHullRegionPx(W, H, LM);

/* ---------- hull geometry ---------------------------------------- */
check('HULL a spread hand yields a hull region', !!HULL && Array.isArray(HULL.hull) && HULL.hull.length === 6,
  HULL ? HULL.hull.map(p => Math.round(p.x) + ',' + Math.round(p.y)).join(' ') : 'null');
check('HULL centroid sits inside the palm', !!HULL && Math.abs(HULL.cx - 81) <= 2 && Math.abs(HULL.cy - 74) <= 2,
  HULL ? Math.round(HULL.cx) + ',' + Math.round(HULL.cy) : 'null');
/* Erosion: the returned hull is strictly inside the outline points'
   bounding box on every side (outline extremes in px: x 52.8..115.2,
   y 62.4..102). */
const hb = HULL ? {
  x0: Math.min.apply(null, HULL.hull.map(p => p.x)), x1: Math.max.apply(null, HULL.hull.map(p => p.x)),
  y0: Math.min.apply(null, HULL.hull.map(p => p.y)), y1: Math.max.apply(null, HULL.hull.map(p => p.y))
} : null;
check('HULL erosion pulls every side inward from the landmark outline', !!hb && hb.x0 > 52.8 && hb.x1 < 115.2 && hb.y0 > 62.4 && hb.y1 < 102,
  hb ? JSON.stringify({ x0: Math.round(hb.x0), x1: Math.round(hb.x1), y0: Math.round(hb.y0), y1: Math.round(hb.y1) }) : 'null');
const degen = []; for (let i = 0; i < 21; i++) degen.push({ x: 0.5, y: 0.5, z: 0 });
check('HULL degenerate landmarks yield no hull', B.palmHullRegionPx(W, H, degen) === null);
check('HULL missing landmarks yield no hull', B.palmHullRegionPx(W, H, null) === null);
const tiny = LM.map(p => ({ x: 0.5 + (p.x - 0.5) * 0.1, y: 0.6 + (p.y - 0.6) * 0.1, z: 0 }));
check('HULL a too-small hand (span below the ROI bar) yields no hull', B.palmHullRegionPx(W, H, tiny) === null);

/* Membership cross-check: an INDEPENDENT ray-casting point-in-
   polygon count of block centres inside the returned hull must
   equal the detector's sampled block count. */
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
let centreCount = 0;
for (let by = 0; by + 16 <= H; by += 16) for (let bx = 0; bx + 16 <= W; bx += 16) if (inPoly(bx + 8, by + 8, HULL.hull)) centreCount++;

/* ---------- shared fixture material ------------------------------- */
/* Palm skin with creases: high block range, curved aperiodic lines. */
const CREASES = [
  { a: 0.22, b: 58, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 118, f: 0.04, p: 3, amp: 4 },
  { a: 0.04, b: 84, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 30, f: 0.05, p: 2, amp: 3, vert: true }
];
function skin(x, y, rnd) {
  let v = 150 + Math.sin(x * 0.045 + 1.7) * 8 + Math.cos(y * 0.06 + 0.4) * 6;
  for (const c of CREASES) {
    if (c.vert) { const lx = c.a * y + c.b + Math.sin(y * c.f + c.p) * c.amp; const d = Math.abs(x - lx); if (d < 3) v -= (3 - d) * 26; }
    else { const ly = c.a * x + c.b + Math.sin(x * c.f + c.p) * c.amp; const d = Math.abs(y - ly); if (d < 3) v -= (3 - d) * 26; }
  }
  return Math.round(v + (rnd() * 8 - 4));
}
const checker = (x, y, rnd) => Math.round(128 + (((x + y) % 2) ? 17 : -17) + (rnd() * 3 - 1.5));
const room = (x, y, rnd) => Math.round(105 + x * 0.3 + y * 0.25 + (rnd() * 6 - 3));
/* The hand zone: an ellipse covering the hull plus a skin margin
   (the fingers and thumb around the palm are skin too). */
const inHand = (x, y) => { const dx = (x - 82) / 44, dy = (y - 80) / 34; return dx * dx + dy * dy <= 1; };

/* ---------- (a) print OUTSIDE the hull, inside the old square -----
   The screenshot's geometry: a strong periodic print fills the
   square around a live, creased palm. Under the v36 box path this
   frame CONVICTS (measured 0.87 / 0.85) — the bug. Under the hull
   path the sampled blocks are palm skin only. */
const fixA = frame((x, y, rnd) => inHand(x, y) ? skin(x, y, rnd) : checker(x, y, rnd));
const aBox = B.screenSpoofCheck(fixA, W, H, BOX);
check('HULL-A the print-around-hand fixture DOES convict under the old box region (the bug)', aBox.spoof === true && aBox.flatCoherence >= 0.62,
  'density=' + aBox.flatMoire.toFixed(2) + ' coherence=' + aBox.flatCoherence.toFixed(2));
const aHull = B.screenSpoofCheck(fixA, W, H, HULL);
check('HULL-A print outside the palm hull no longer convicts the scan', aHull.spoof === false, 'score=' + aHull.score.toFixed(2));
check('HULL-A the sampled blocks are exactly the in-hull centres', aHull.gridBlocks === centreCount && centreCount === 5,
  'gridBlocks=' + aHull.gridBlocks + ' independentCount=' + centreCount);
check('HULL-A no in-hull block carries grid evidence (coverage 0)', aHull.gridPositives === 0 && aHull.gridCoverage === 0,
  'positives=' + aHull.gridPositives + ' coverage=' + aHull.gridCoverage);
check('HULL-A the call reports hull mode', aHull.gridHull === true && aHull.gridScoped === true);
const aClean = B.screenSpoofCheck(frame((x, y, rnd) => inHand(x, y) ? skin(x, y, rnd) : room(x, y, rnd)), W, H, HULL);
check('HULL-A a clean creased palm in a plain room stays clean', aClean.spoof === false && aClean.gridCoverage === 0,
  'density=' + aClean.flatMoire.toFixed(2) + ' coherence=' + aClean.flatCoherence.toFixed(2));

/* ---------- (b) grid over a MINORITY of the hull ------------------
   Checkerboard over the left of the palm (x < 78), creased skin on
   the rest. The grid blocks are the flattest in-hull blocks, so the
   POOLED stats clear both conviction bars (measured 0.87 / 0.79) —
   only the coverage gate (0.40 < 0.60) prevents conviction. Glare
   and bezel are absent, so the gate is provably what saves it. */
const fixB = frame((x, y, rnd) => inHand(x, y) ? (x < 78 ? checker(x, y, rnd) : skin(x, y, rnd)) : Math.round(110 + x * 0.3 + (rnd() * 5 - 2.5)));
const bHull = B.screenSpoofCheck(fixB, W, H, HULL);
check('HULL-B the pooled trigger IS armed (density and coherence above the bars)', bHull.flatMoire >= 0.20 && bHull.flatCoherence >= 0.62,
  'density=' + bHull.flatMoire.toFixed(2) + ' coherence=' + bHull.flatCoherence.toFixed(2));
check('HULL-B no second signal is present (glare and bezel absent)', bHull.glare <= 0.05 && bHull.bezel === false,
  'glare=' + bHull.glare.toFixed(3) + ' bezel=' + bHull.bezel);
check('HULL-B grid coverage is a minority of the palm', Math.abs(bHull.gridCoverage - 0.4) < 1e-9 && bHull.gridPositives === 2,
  'coverage=' + bHull.gridCoverage + ' positives=' + bHull.gridPositives + '/' + bHull.gridBlocks);
check('HULL-B a minority-coverage grid does NOT convict on grid alone', bHull.spoof === false, 'score=' + bHull.score.toFixed(2));

/* ---------- (c) the real presentations still convict --------------
   A screen displaying a palm carries its lattice across the whole
   hull: coverage 1.00, pooled coherence 1.00, convicted grid-alone
   at the unchanged 0.62 bar. Includes the existing v36 palm-grid
   fixture and the spoof.test.js fixtures through the new path. */
const fixC = frame((x, y, rnd) => inHand(x, y) ? checker(x, y, rnd) : room(x, y, rnd));
const cHull = B.screenSpoofCheck(fixC, W, H, HULL);
check('HULL-C grid covering the palm is still rejected as spoof', cHull.spoof === true, 'coherence=' + cHull.flatCoherence.toFixed(2));
check('HULL-C the rejection clears the unchanged 0.62 grid-alone bar', cHull.flatCoherence >= 0.62, 'coherence=' + cHull.flatCoherence.toFixed(2));
check('HULL-C coverage is palm-wide', cHull.gridCoverage === 1 && cHull.gridPositives === cHull.gridBlocks,
  'coverage=' + cHull.gridCoverage + ' positives=' + cHull.gridPositives + '/' + cHull.gridBlocks);
check('HULL-C the reason names the palm region', cHull.reasons.some(r => /pixel-grid pattern detected in the palm region/.test(r)), cHull.reasons.join(' | '));
const REGION36 = { x0: 48, y0: 32, x1: 112, y1: 96 };
const in36 = (x, y) => x >= REGION36.x0 && x < REGION36.x1 && y >= REGION36.y0 && y < REGION36.y1;
const palmOnScreen36 = frame((x, y, rnd) => in36(x, y) ? Math.round(120 + (((x + y) % 2) ? 16 : -16)) : room(x, y, rnd));
const c36 = B.screenSpoofCheck(palmOnScreen36, W, H, HULL);
check('HULL-C the v36 palm-grid fixture is still rejected through the hull path', c36.spoof === true && c36.gridCoverage === 1,
  'coherence=' + c36.flatCoherence.toFixed(2) + ' coverage=' + c36.gridCoverage);
const gridEverywhere = frame((x, y) => 120 + (((x + y) % 2) ? 16 : -16) + x * 0.1);
const cGrid = B.screenSpoofCheck(gridEverywhere, W, H, HULL);
check('HULL-C the spoof.test.js pixel-grid fixture is still rejected through the hull path', cGrid.spoof === true && cGrid.gridCoverage === 1,
  'coherence=' + cGrid.flatCoherence.toFixed(2));
const fullScreen = frame((x, y) => {
  let v = 118 + (((x + y) % 2) ? 15 : -15);
  if (y === 8 || y === H - 9 || x === 8 || x === W - 9) v = 232;
  if (x >= 96 && x < 144 && y >= 12 && y < 48) v = 247;
  return Math.round(v);
});
const cFull = B.screenSpoofCheck(fullScreen, W, H, HULL);
check('HULL-C the full simulated screen replay is still rejected through the hull path', cFull.spoof === true && cFull.reasons.length >= 2,
  cFull.reasons.join(' | '));

/* ---------- (d) halftone print at print scale, whole palm ---------
   A dot-screen texture across the ENTIRE frame, hull included.
   Measured on this rig: period 4 dots read density 0.87 /
   coherence 0.67 with coverage 1.00 — the detector CONVICTS.
   That is the documented hard case, asserted as-is, NOT tuned
   away: a printed palm photograph filling the palm area is
   indistinguishable from a screen by this gate alone, and the
   defence there is the match + liveness lines, not this gate.
   Periods 3 and 5 stay under the 0.62 coherence bar (0.50 / 0.39)
   and do not convict. */
function halftone(period, amp) {
  return frame((x, y, rnd) => {
    const cx = ((x % period) + period) % period - period / 2, cy = ((y % period) + period) % period - period / 2;
    const d = Math.sqrt(cx * cx + cy * cy);
    const dot = d < period * 0.32 ? -amp : amp * 0.55;
    return Math.round(128 + dot + (rnd() * 3 - 1.5));
  });
}
const d4 = B.screenSpoofCheck(halftone(4, 20), W, H, HULL);
check('HULL-D KNOWN LIMIT: halftone at period 4 covering the whole palm still convicts', d4.spoof === true && d4.gridCoverage === 1 && d4.flatCoherence >= 0.62,
  'density=' + d4.flatMoire.toFixed(2) + ' coherence=' + d4.flatCoherence.toFixed(2) + ' coverage=' + d4.gridCoverage);
const d3 = B.screenSpoofCheck(halftone(3, 20), W, H, HULL);
check('HULL-D halftone at period 3 stays under the coherence bar and does not convict', d3.spoof === false && d3.flatCoherence < 0.62,
  'coherence=' + d3.flatCoherence.toFixed(2) + ' coverage=' + d3.gridCoverage);
const d5 = B.screenSpoofCheck(halftone(5, 20), W, H, HULL);
check('HULL-D halftone at period 5 stays under the coherence bar and does not convict', d5.spoof === false && d5.flatCoherence < 0.62,
  'coherence=' + d5.flatCoherence.toFixed(2) + ' coverage=' + d5.gridCoverage);

/* ---------- fallbacks: no hull, no fallback ----------------------- */
const nHull = B.screenSpoofCheck(fixC, W, H, null);
check('HULL-NULL a null region carries no grid evidence and cannot convict (never falls back)', nHull.spoof === false && nHull.flatCoherence === 0 && nHull.gridCoverage === null && nHull.gridBlocks === 0,
  'coherence=' + nHull.flatCoherence.toFixed(2));
const boxPin = B.screenSpoofCheck(fixC, W, H, BOX);
check('HULL-NULL the box region path is unchanged (no coverage measured, v36 rule applies)', boxPin.gridCoverage === null && boxPin.gridHull === false && boxPin.spoof === true,
  'coverage=' + boxPin.gridCoverage + ' spoof=' + boxPin.spoof);
const wholePin = B.screenSpoofCheck(fixC, W, H);
check('HULL-NULL the whole-frame path is unchanged (no coverage measured)', wholePin.gridCoverage === null && wholePin.gridHull === false);

console.log('v40 spoof-hull tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
