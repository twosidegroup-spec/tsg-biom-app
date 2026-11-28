/* TSG Biom — v18 anti-spoof + randomised liveness sequence tests.
   The screen-spoof frames are SYNTHETIC: a smooth "real scene" frame
   versus frames carrying the physical traces of a display (pixel-grid
   moire, a rectangular bezel, flat glass glare). The detector is a
   heuristic gate; these tests prove it fires on the simulated traces
   and stays quiet on a clean frame. Real-world rates are what Field
   Test Mode measures. */
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
const clean = frame((x, y, rnd) => Math.round(105 + x * 0.3 + y * 0.25 + (rnd() * 6 - 3)));
const grid = frame((x, y) => 120 + (((x + y) % 2) ? 16 : -16) + x * 0.1);
const bezel = frame((x, y) => {
  let v = 110 + x * 0.2 + y * 0.15;
  if (y === 10 || y === H - 11 || x === 10 || x === W - 11) v = 235; // device frame edge
  return Math.round(v);
});
const glareOnly = frame((x, y) => {
  let v = 105 + x * 0.3 + y * 0.2;
  if (x >= 20 && x < 84 && y >= 16 && y < 64) v = 246; // flat saturated patch
  return Math.round(v);
});
const fullScreen = frame((x, y) => {
  let v = 118 + (((x + y) % 2) ? 15 : -15);
  if (y === 8 || y === H - 9 || x === 8 || x === W - 9) v = 232;
  if (x >= 96 && x < 144 && y >= 12 && y < 48) v = 247;
  return Math.round(v);
});

const rClean = B.screenSpoofCheck(clean, W, H);
check('SPOOF clean frame is not flagged', rClean.checked && rClean.spoof === false, 'score=' + rClean.score.toFixed(2) + ' moire=' + rClean.moire.toFixed(2));
const rGrid = B.screenSpoofCheck(grid, W, H);
check('SPOOF pixel-grid frame is rejected via flat-region grid coherence', rGrid.spoof === true && rGrid.flatCoherence >= 0.5, 'flatCoherence=' + rGrid.flatCoherence.toFixed(2));
const rBezel = B.screenSpoofCheck(bezel, W, H);
check('SPOOF bezel-edged frame is rejected', rBezel.spoof === true && rBezel.bezel === true, 'bezel=' + rBezel.bezel);
const rGlare = B.screenSpoofCheck(glareOnly, W, H);
check('SPOOF glare alone is measured but does not trigger on its own', rGlare.glare > 0.05 && rGlare.spoof === false, 'glare=' + rGlare.glare.toFixed(2));
const rFull = B.screenSpoofCheck(fullScreen, W, H);
check('SPOOF full simulated screen replay (grid + bezel + glare) is rejected', rFull.spoof === true && rFull.reasons.length >= 2, rFull.reasons.join(' | '));
check('SPOOF degenerate input fails safe (not checked, not spoof)', B.screenSpoofCheck(null, W, H).spoof === false && B.screenSpoofCheck([1, 2], W, H).checked === false);

/* Regression (v18 E2E finding): a genuine palm feed is densely textured
   and its GLOBAL alternation density reaches ~0.5 - that alone must
   never flag a scan. Organic blotchy texture with smooth regions: */
const organic = frame((x, y, rnd) => Math.round(120 + 42 * Math.sin(x * 0.11 + 25 * Math.sin(y * 0.05)) * Math.cos(y * 0.09) + (rnd() * 8 - 4)));
const rOrg = B.screenSpoofCheck(organic, W, H);
check('SPOOF organic textured frame is not flagged (global moire is not a trigger)', rOrg.spoof === false && rOrg.flatCoherence < 0.5, 'moire=' + rOrg.moire.toFixed(2) + ' flatCoherence=' + rOrg.flatCoherence.toFixed(2));

/* Regression (v19, the Chairman's phone, 2026-11-20): a genuine hand in
   indoor light false-flagged at alternation densities 0.27-0.41 -
   strong sensor noise alternates constantly but is NOT periodic. A
   noise-heavy flat frame must pass even though its density is high,
   and a true periodic moire beat must be rejected. */
const noisy = frame((x, y, rnd) => Math.round(118 + x * 0.15 + (rnd() * 36 - 18)));
const rNoisy = B.screenSpoofCheck(noisy, W, H);
check('SPOOF noisy phone-style frame is not flagged (noise has no grid coherence)', rNoisy.spoof === false && rNoisy.flatCoherence < 0.2, 'flatMoire=' + rNoisy.flatMoire.toFixed(2) + ' flatCoherence=' + rNoisy.flatCoherence.toFixed(2));
check('SPOOF the same noisy frame WOULD have tripped the old density trigger', rNoisy.flatMoire >= 0.25, 'flatMoire=' + rNoisy.flatMoire.toFixed(2));
const beat = frame((x, y, rnd) => Math.round(120 + 17 * Math.sin(2 * Math.PI * x / 5) + (rnd() * 4 - 2)));
const rBeat = B.screenSpoofCheck(beat, W, H);
check('SPOOF periodic moire beat pattern is rejected', rBeat.spoof === true && rBeat.flatCoherence >= 0.5, 'flatCoherence=' + rBeat.flatCoherence.toFixed(2));

/* Regression on the ACTUAL E2E camera asset: open-palm frames from
   tests/e2e/assets/personA.y4m, downscaled exactly as the app samples
   them (160 px wide), must not be flagged. */
(function () {
  const fs = require('fs'), path = require('path');
  const buf = fs.readFileSync(path.join(__dirname, 'e2e', 'assets', 'personA.y4m'));
  const VW = 640, VH = 480, FSZ = VW * VH * 3 / 2;
  let pos = buf.indexOf(10) + 1, idx = 0; const wanted = { 2: true, 25: true }; let tested = 0;
  while (pos < buf.length && idx < 30) {
    const eol = buf.indexOf(10, pos); const start = eol + 1;
    if (wanted[idx]) {
      const gray = new Array(VW * VH);
      for (let i = 0; i < VW * VH; i++) gray[i] = buf[start + i];
      const tw = 160, th = 120, out = new Array(tw * th), sx = VW / tw, sy = VH / th;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        let s = 0, n = 0;
        for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) { s += gray[yy * VW + xx]; n++; }
        out[y * tw + x] = s / n;
      }
      const r = B.screenSpoofCheck(out, tw, th);
      check('SPOOF real camera-feed palm frame ' + idx + ' is not flagged', r.spoof === false, 'moire=' + r.moire.toFixed(2) + ' flatMoire=' + r.flatMoire.toFixed(2));
      tested++;
    }
    pos = start + FSZ; idx++;
  }
  check('SPOOF camera-feed regression frames were actually tested', tested === 2, tested + ' frames');
})();

/* ---------------- Stage measures from landmarks ---------------------- */
function hand(tips, knuckles) {
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push({ x: 0.5, y: 0.6, z: 0 });
  lm[0] = { x: 0.5, y: 0.85, z: 0 };
  lm[5] = knuckles[0]; lm[9] = knuckles[1]; lm[13] = knuckles[2]; lm[17] = knuckles[3];
  lm[8] = tips[0]; lm[12] = tips[1]; lm[16] = tips[2]; lm[20] = tips[3];
  lm[6] = { x: (knuckles[0].x + tips[0].x) / 2, y: (knuckles[0].y + tips[0].y) / 2, z: 0 };
  lm[10] = { x: (knuckles[1].x + tips[1].x) / 2, y: (knuckles[1].y + tips[1].y) / 2, z: 0 };
  lm[14] = { x: (knuckles[2].x + tips[2].x) / 2, y: (knuckles[2].y + tips[2].y) / 2, z: 0 };
  lm[18] = { x: (knuckles[3].x + tips[3].x) / 2, y: (knuckles[3].y + tips[3].y) / 2, z: 0 };
  return lm;
}
const KNUCK = [{ x: 0.38, y: 0.55 }, { x: 0.5, y: 0.52 }, { x: 0.62, y: 0.55 }, { x: 0.72, y: 0.58 }];
const spreadHand = hand([{ x: 0.30, y: 0.22 }, { x: 0.47, y: 0.16 }, { x: 0.64, y: 0.22 }, { x: 0.78, y: 0.34 }], KNUCK);
const togetherHand = hand([{ x: 0.44, y: 0.20 }, { x: 0.50, y: 0.17 }, { x: 0.56, y: 0.20 }, { x: 0.62, y: 0.26 }], KNUCK);
check('SPREAD spread hand measures above the spread minimum', B.palmSpread(spreadHand) >= B.PALM_SPREAD_MIN, 'spread=' + B.palmSpread(spreadHand).toFixed(2));
check('SPREAD fingers-together hand measures below it', B.palmSpread(togetherHand) < B.PALM_SPREAD_MIN, 'spread=' + B.palmSpread(togetherHand).toFixed(2));
const KNUCK_TILT = [{ x: 0.38, y: 0.42 }, { x: 0.5, y: 0.5 }, { x: 0.62, y: 0.6 }, { x: 0.72, y: 0.68 }];
const tiltHand = hand([{ x: 0.30, y: 0.1 }, { x: 0.47, y: 0.14 }, { x: 0.64, y: 0.24 }, { x: 0.78, y: 0.4 }], KNUCK_TILT);
check('TILT level knuckles measure near zero', B.palmTilt(spreadHand) < 8, 'tilt=' + B.palmTilt(spreadHand).toFixed(1));
check('TILT tilted knuckles measure above the tilt minimum', B.palmTilt(tiltHand) >= B.PALM_TILT_MIN, 'tilt=' + B.palmTilt(tiltHand).toFixed(1));

/* ---------------- Randomised sequence evaluation --------------------- */
const SEQ = {};
B.PALM_SEQUENCES.forEach(s => { SEQ[s.id] = s; });
const M = (openness, spread, tilt) => ({ openness, spread: spread != null ? spread : 1.1, tilt: tilt != null ? tilt : 2 });
check('SEQ classic open-close-open passes inside the window', B.evaluateMovementSequence([M(2.0), M(1.2), M(2.0)], SEQ['open-close-open'], 250).pass === true);
check('SEQ wrong order fails (close never follows open)', B.evaluateMovementSequence([M(1.2), M(2.0), M(2.0)], SEQ['open-close-open'], 250).pass === false);
check('SEQ too slow fails the 3.5s window', (() => {
  // Open at frame 0, close at frame 10, then frames below the open
  // bar (1.5 - the final stage stays unmet; the v28 open bar is 1.55)
  // until the final open at frame 16: span = 16 x 250ms = 4.0s > 3.5s.
  const ms = [M(2.0)]; for (let i = 0; i < 9; i++) ms.push(M(1.9)); ms.push(M(1.2)); for (let i = 0; i < 5; i++) ms.push(M(1.5)); ms.push(M(2.0));
  const r = B.evaluateMovementSequence(ms, SEQ['open-close-open'], 250);
  return r.pass === false && /too slowly/.test(r.reason);
})());
check('SEQ tilt sequence passes with a tilted open middle stage', B.evaluateMovementSequence([M(2.0, 1.1, 2), M(1.9, 1.1, 31), M(2.0, 1.1, 3)], SEQ['open-tilt-open'], 250).pass === true);
check('SEQ tilt sequence fails when the hand never tilts', B.evaluateMovementSequence([M(2.0, 1.1, 2), M(1.9, 1.1, 4), M(2.0, 1.1, 3)], SEQ['open-tilt-open'], 250).pass === false);
check('SEQ spread sequence passes ending on a spread hand', B.evaluateMovementSequence([M(2.0, 1.2), M(1.2, 0.7), M(2.0, 1.35)], SEQ['open-close-spread'], 250).pass === true);
check('SEQ curl sequence passes through a half-curl', B.evaluateMovementSequence([M(2.0), M(1.75), M(2.05)], SEQ['open-curl-open'], 250).pass === true);
check('SEQ curl sequence fails on a full fist (that is close, not curl)', B.evaluateMovementSequence([M(2.0), M(1.2), M(2.05)], SEQ['open-curl-open'], 250).pass === false);
check('SEQ four distinct sequences are issued', B.PALM_SEQUENCES.length === 4 && new Set(B.PALM_SEQUENCES.map(s => s.id)).size === 4);
check('SEQ window is the strict 3.5 seconds', B.PALM_SEQUENCE_WINDOW_MS === 3500);

console.log('spoof + sequence tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
