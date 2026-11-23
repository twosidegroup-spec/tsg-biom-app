/* TSG Biom — v36 regression: the screen-spoof GRID gate is scoped to
   the palm region.
   Trigger (the Chairman's phone, 2026-11-23 12:33): a takeBIOM Pay
   scan of his LIVE hand in a real room was rejected "Spoof / Screen
   Replay Detected" with grid density 0.21-0.29 and coherence
   0.83-0.84. The v35 detector measured the flat-region grid over the
   WHOLE frame; the flattest blocks were the room's patterned
   bedding/clothing, not the hand. A replay is a picture OF A PALM on
   a screen, so from v36 the grid stats are measured over the palm
   region only (screenSpoofCheck's optional region argument, fed from
   palmRoiRegionPx in the app). Thresholds, the 0.62 grid-alone bar
   and the bezel/glare rules are unchanged.
   Fixtures are SYNTHETIC, in the spoof.test.js style; every asserted
   number below was measured on this rig before the assertion was
   written. */
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
/* The palm box: block-aligned (16 px blocks), 4x4 blocks. */
const REGION = { x0: 48, y0: 32, x1: 112, y1: 96 };
const inPalm = (x, y) => x >= REGION.x0 && x < REGION.x1 && y >= REGION.y0 && y < REGION.y1;

/* (a) The screenshot's conditions, synthetic: a periodic moire beat
   across the room (the pattern that measured coherence 0.83-0.84 on
   the phone), and a smooth palm region with no periodic structure. */
const roomPatterned = frame((x, y, rnd) => inPalm(x, y)
  ? Math.round(92 + (x - 48) * 1.6 + (y - 32) * 1.2 + (rnd() * 4 - 2))
  : Math.round(120 + 17 * Math.sin(2 * Math.PI * x / 5) + (rnd() * 4 - 2)));
const aWhole = B.screenSpoofCheck(roomPatterned, W, H);
check('ROI-A the patterned-room fixture DOES convict under the old whole-frame analysis (the bug)', aWhole.spoof === true && aWhole.flatCoherence >= 0.9, 'flatCoherence=' + aWhole.flatCoherence.toFixed(2));
const aScoped = B.screenSpoofCheck(roomPatterned, W, H, REGION);
check('ROI-A background grid outside the palm no longer convicts the scan', aScoped.spoof === false, 'score=' + aScoped.score.toFixed(2));
check('ROI-A scoped grid stats read the palm only (no density, no coherence)', aScoped.flatMoire < 0.20 && aScoped.flatCoherence < 0.35, 'flatMoire=' + aScoped.flatMoire.toFixed(2) + ' flatCoherence=' + aScoped.flatCoherence.toFixed(2));
check('ROI-A scoped call reports its scope and block count', aScoped.gridScoped === true && aScoped.gridBlocks === 16, 'gridBlocks=' + aScoped.gridBlocks);
check('ROI-A no pixel-grid reason is produced for the clean palm', !aScoped.reasons.some(r => /pixel-grid/.test(r)), aScoped.reasons.join(' | '));

/* (b) The real attack: the pixel grid is IN the palm image (a palm
   shown on a screen). Clean room, checkerboard lattice over the palm
   box - the scoped gate must still fail it closed, grid-alone. */
const palmOnScreen = frame((x, y, rnd) => inPalm(x, y)
  ? Math.round(120 + (((x + y) % 2) ? 16 : -16))
  : Math.round(105 + x * 0.3 + y * 0.25 + (rnd() * 6 - 3)));
const bScoped = B.screenSpoofCheck(palmOnScreen, W, H, REGION);
check('ROI-B grid inside the palm region is still rejected as spoof', bScoped.spoof === true, 'flatCoherence=' + bScoped.flatCoherence.toFixed(2));
check('ROI-B the rejection clears the unchanged 0.62 grid-alone bar', bScoped.flatCoherence >= 0.62, 'flatCoherence=' + bScoped.flatCoherence.toFixed(2));
check('ROI-B the reason names the palm region', bScoped.reasons.some(r => /pixel-grid pattern detected in the palm region/.test(r)), bScoped.reasons.join(' | '));
const bWhole = B.screenSpoofCheck(palmOnScreen, W, H);
check('ROI-B whole-frame analysis dilutes the same palm grid below the trigger (why scoping matters)', bWhole.spoof === false, 'flatCoherence=' + bWhole.flatCoherence.toFixed(2));
const bNull = B.screenSpoofCheck(palmOnScreen, W, H, null);
check('ROI-B a null region (no palm located) carries no grid evidence and cannot convict', bNull.spoof === false && bNull.flatCoherence === 0 && bNull.gridBlocks === 0, 'flatCoherence=' + bNull.flatCoherence.toFixed(2));
const aTiny = B.screenSpoofCheck(roomPatterned, W, H, { x0: 0, y0: 0, x1: 16, y1: 16 });
check('ROI-B a region holding fewer than 4 blocks yields no grid evidence', aTiny.spoof === false && aTiny.gridBlocks === 1 && aTiny.flatCoherence === 0, 'gridBlocks=' + aTiny.gridBlocks);

/* (c) The existing spoof fixtures through the app's scoped path: a
   full simulated screen replay carries its grid over the palm too,
   so it must still be caught with the region applied. */
const fullScreen = frame((x, y) => {
  let v = 118 + (((x + y) % 2) ? 15 : -15);
  if (y === 8 || y === H - 9 || x === 8 || x === W - 9) v = 232;
  if (x >= 96 && x < 144 && y >= 12 && y < 48) v = 247;
  return Math.round(v);
});
const cFull = B.screenSpoofCheck(fullScreen, W, H, REGION);
check('ROI-C full simulated screen replay is still rejected with the palm region applied', cFull.spoof === true && cFull.reasons.length >= 2, cFull.reasons.join(' | '));
const gridFrame = frame((x, y) => 120 + (((x + y) % 2) ? 16 : -16) + x * 0.1);
const cGrid = B.screenSpoofCheck(gridFrame, W, H, REGION);
check('ROI-C the pixel-grid fixture is still rejected with the palm region applied', cGrid.spoof === true && cGrid.flatCoherence >= 0.62, 'flatCoherence=' + cGrid.flatCoherence.toFixed(2));
const clean = frame((x, y, rnd) => Math.round(105 + x * 0.3 + y * 0.25 + (rnd() * 6 - 3)));
const cClean = B.screenSpoofCheck(clean, W, H, REGION);
check('ROI-C a clean frame stays clean with the palm region applied', cClean.spoof === false && cClean.checked === true, 'score=' + cClean.score.toFixed(2));

/* palmRoiRegionPx: the region the app derives from real landmarks. */
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
const reg = B.palmRoiRegionPx(W, H, spreadHand);
check('ROI-REGION a spread hand yields a region inside the frame', !!reg && reg.x0 >= 0 && reg.y0 >= 0 && reg.x1 <= W && reg.y1 <= H && reg.x1 - reg.x0 >= 64, JSON.stringify(reg));
const degen = []; for (let i = 0; i < 21; i++) degen.push({ x: 0.5, y: 0.5, z: 0 });
check('ROI-REGION degenerate landmarks yield no region', B.palmRoiRegionPx(W, H, degen) === null);
check('ROI-REGION missing landmarks yield no region', B.palmRoiRegionPx(W, H, null) === null);

/* Reason dedupe: the screenshot's doubled grid reason (same text,
   different measured numbers, once per flagged frame) collapses to
   one entry, kept verbatim; distinct kinds survive. */
const gridReason1 = 'periodic screen pixel-grid pattern detected in the palm region of the frame (density 0.21, grid coherence 0.83)';
const gridReason2 = 'periodic screen pixel-grid pattern detected in the palm region of the frame (density 0.29, grid coherence 0.84)';
const bezelReason = 'rectangular device bezel edges detected around the hand';
const deduped = B.dedupeSpoofReasons([gridReason1, gridReason2, bezelReason, gridReason1]);
check('ROI-DEDUPE the doubled grid reason collapses to one verbatim entry', deduped.length === 2 && deduped[0] === gridReason1 && deduped[1] === bezelReason, deduped.join(' | '));
check('ROI-DEDUPE empty and missing input stay empty', B.dedupeSpoofReasons([]).length === 0 && B.dedupeSpoofReasons(null).length === 0);

console.log('v36 spoof-roi tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
