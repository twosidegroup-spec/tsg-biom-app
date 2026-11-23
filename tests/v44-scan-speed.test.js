/* TSG BIOM — v44 scan-duration tests (2026-11-23).

   Trigger: the Chairman's phone verdict on v43 (17:42 Dhaka):
   "now the verify and payment scan takes too timeeeee". On his
   device a full-window run measured 24 frames in 11,752 ms
   (~490 ms per analysed frame). v44's four cuts were: phone-
   readable per-stage diagnostics, geometric-variant band gating,
   the 6-second wall-clock budget, and the 320 px analysis copy.

   v45 port (2026-11-23): the spec replaces the matcher, so the
   band gate and the geometric variants are RETIRED (their checks
   are replaced by the pin that geoFloor is now ignored, and by
   the packed pipeline's own stage timings). What survives of v44
   and stays pinned here: the 6-second budget and MAXF backstop,
   the 320 px analysis copy, the per-stage timing sink on scan
   results, the fast/exact bit-identity on non-pass scores, the
   multi-profile composition identity, and worker parity. The
   tilt-band checks are NOT ported: under the 5-shift matcher the
   band no longer holds, and the honest numbers live in
   tests/v45-palmx.test.js.
   Rig timings printed here are rig timings; they do not predict
   the phone. The diagnostics exist so the phone reports itself. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }

/* ---------------- fixture machinery (from the v41 suite) ---------- */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = opts.size || 128, k = 128 / size, rnd = lcg(seed);
  const noiseAmp = opts.noiseAmp != null ? opts.noiseAmp : 12;
  const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const g = new Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x * k, py = y * k;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7;
    for (const c of creases) {
      if (c.vert) { const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp; const d = Math.abs(px - lx); if (d < 3) v -= (3 - d) * 30; }
      else { const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp; const d = Math.abs(py - ly); if (d < 3) v -= (3 - d) * 30; }
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));
  }
  return g;
}
const PALM_A = [{ a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 }, { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true }];
const PALM_B = [{ a: -0.05, b: 38, f: 0.04, p: 2, amp: 5 }, { a: 0.18, b: 55, f: 0.07, p: 1, amp: 3 }, { a: -0.5, b: 118, f: 0.05, p: 4, amp: 4 }, { a: 0.85, b: 4, f: 0.04, p: 3, amp: 4, vert: true }];
const PALM_C = [{ a: 0.35, b: 30, f: 0.07, p: 0, amp: 3 }, { a: 0.10, b: 84, f: 0.05, p: 5, amp: 4 }, { a: -0.28, b: 70, f: 0.06, p: 1, amp: 3 }, { a: 0.42, b: 30, f: 0.05, p: 5, amp: 3, vert: true }];
const TEX_A = roiImage(PALM_A, 991, { size: 272, noiseAmp: 8 });
const TEX_B = roiImage(PALM_B, 992, { size: 272, noiseAmp: 8 });
const TEX_C = roiImage(PALM_C, 993, { size: 272, noiseAmp: 8 });
function sampleBilinear(img, S, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  function v(xx, yy) { xx = Math.max(0, Math.min(S - 1, xx)); yy = Math.max(0, Math.min(S - 1, yy)); return img[yy * S + xx]; }
  return v(x0, y0) * (1 - fx) * (1 - fy) + v(x0 + 1, y0) * fx * (1 - fy) + v(x0, y0 + 1) * (1 - fx) * fy + v(x0 + 1, y0 + 1) * fx * fy;
}
function render(tex, opt) {
  opt = Object.assign({ W: 640, H: 480, S: 272, deg: 0, av: 1, cx: 320, cy: 240, seed: 7, noiseAmp: 10, spanFactor: 1 }, opt || {});
  const W = opt.W, H = opt.H, th = opt.deg * Math.PI / 180;
  const u = { x: Math.cos(th), y: Math.sin(th) }, v = { x: -Math.sin(th), y: Math.cos(th) };
  const C = { x: opt.cx, y: opt.cy }, rnd = lcg(opt.seed);
  const g = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - C.x, dy = y - C.y;
    const qx = (dx * u.x + dy * u.y) / opt.S + 0.5;
    const qy = (dx * v.x + dy * v.y) / (opt.S * opt.av) + 0.5;
    let val = 96 + 18 * Math.sin(x * 0.011 + y * 0.007);
    if (qx >= 0 && qx < 1 && qy >= 0 && qy < 1) val = sampleBilinear(tex, 272, qx * 271, qy * 271);
    g[y * W + x] = Math.max(0, Math.min(255, Math.round(val + (rnd() - 0.5) * opt.noiseAmp)));
  }
  const span = (opt.S / 1.7) * opt.spanFactor;
  const Kc = { x: C.x - v.x * 0.42 * (1.7 * span), y: C.y - v.y * 0.42 * (1.7 * span) };
  function pt(du, dv) { return { x: (Kc.x + u.x * du + v.x * dv) / W, y: (Kc.y + u.y * du + v.y * dv) / H, z: 0 }; }
  const lm = [];
  for (let i = 0; i < 21; i++) lm.push(pt(0, -0.3 * span));
  lm[5] = pt(-span / 2, 0); lm[9] = pt(-span / 6, 0); lm[13] = pt(span / 6, 0); lm[17] = pt(span / 2, 0);
  lm[0] = { x: (Kc.x + u.x * (-span / 6) + v.x * span) / W, y: (Kc.y + u.y * (-span / 6) + v.y * span) / H, z: 0 };
  return { gray: g, w: W, h: H, lm: lm };
}
function frameObj(tex, opt, sharp) {
  const r = render(tex, opt);
  const roi = B.palmRoiFromLandmarks(r.gray, r.w, r.h, r.lm);
  if (!roi) return null;
  return { openness: 2.0, code: B.palmprintEncode(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE), roi: roi, sharpness: sharp || 100 };
}
function enrol(tex, baseOpt, seed0) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    frames.push(frameObj(tex, Object.assign({}, baseOpt, { seed: seed0 + i, cx: 320 + ((i % 3) - 1) * 2, cy: 240 + (((i + 1) % 3) - 1) * 2, deg: (baseOpt.deg || 0) + (i % 3) - 1 }), 100 + i * 10));
  }
  const codes = B.selectPalmprintProfileCodes(frames.filter(Boolean));
  return codes ? { v: 4, format: B.PALMPRINT_FORMAT, codes: codes } : null;
}
function baseScore(profile, roi) {
  return B.verifyPalmprintRois(profile, [roi]).similarity;
}

const profile = enrol(TEX_A, {}, 100);
check('FIXTURE enrolment banks a profile', !!profile && profile.codes.length >= 2, profile && (profile.codes.length + ' templates'));

/* ---------------- the surviving constants ------------------------- */
check('CONST scan budget is 6000 ms', B.SCAN_TIME_BUDGET_MS === 6000, 'budget=' + B.SCAN_TIME_BUDGET_MS);
check('THRESHOLD stays the phone-calibrated 0.32', B.PALMPRINT_THRESHOLD === 0.32);

/* Fixtures for the checks below: one genuine flat frame, one
   genuine tilted frame (the band case), impostor frames. */
const flatF = frameObj(TEX_A, { seed: 2000 });
const tilt85 = frameObj(TEX_A, { seed: 1000, av: 0.85 });
const impF = frameObj(TEX_B, { seed: 5000 });

/* ---------------- diagnostics: the timing sink -------------------- */
(function () {
  const sink = {};
  const r = B.verifyPalmprintRoisFast(profile, [impF.roi], { timing: sink });
  check('DIAG timing sink carries the stage fields', typeof sink.baseMs === 'number' && typeof sink.matchMs === 'number' &&
    typeof sink.baseEncodes === 'number' && typeof sink.geoEncodes === 'number',
    'baseMs=' + Math.round(sink.baseMs) + ' matchMs=' + Math.round(sink.matchMs));
  check('DIAG the packed probe is 2 encodes (plain + mirror), no variant encodes', sink.baseEncodes === 2 && sink.geoEncodes === 0 && sink.geoMs === 0,
    'baseEncodes=' + sink.baseEncodes + ' geoEncodes=' + sink.geoEncodes);
  check('DIAG the geo band gate is retired: geoFloor is accepted and ignored',
    B.verifyPalmprintRoisFast(profile, [impF.roi], { geoFloor: 0.14 }).similarity === r.similarity);
})();

/* ---------------- fast / exact identity --------------------------- */
(function () {
  const exactImp = B.verifyPalmprintRois(profile, [impF.roi]);
  const fastImp = B.verifyPalmprintRoisFast(profile, [impF.roi]);
  check('FAST non-pass score is bit-identical to the exact path', fastImp.similarity === exactImp.similarity && fastImp.verified === false,
    'fast=' + fastImp.similarity.toFixed(4) + ' exact=' + exactImp.similarity.toFixed(4));
  const exactFlat = B.verifyPalmprintRois(profile, [flatF.roi]);
  const fastFlat = B.verifyPalmprintRoisFast(profile, [flatF.roi]);
  check('FAST genuine flat frame verifies like the exact path', fastFlat.verified === true && exactFlat.verified === true,
    'fast=' + fastFlat.similarity.toFixed(4) + ' exact=' + exactFlat.similarity.toFixed(4));
  info('tilted frame (av 0.85) under the packed matcher: fast=' + B.verifyPalmprintRoisFast(profile, [tilt85.roi]).similarity.toFixed(3) +
    ' — below threshold; the tilt band is reported in tests/v45-palmx.test.js');
})();

/* ---------------- multi-profile + worker -------------------------- */
function workerCall(msg) {
  let posted = null;
  const sandbox = { Buffer: Buffer, postMessage: function (m) { posted = m; } };
  vm.createContext(sandbox);
  vm.runInContext(B.palmprintWorkerSource(), sandbox);
  sandbox.onmessage({ data: msg });
  return posted;
}
(function () {
  const comp = B.verifyPalmprintProfilesRois([profile], [flatF.roi]);
  const exact = B.verifyPalmprintRois(profile, [flatF.roi]);
  check('MULTI composition equals the exact call', comp[0].similarity === exact.similarity && comp[0].verified === exact.verified,
    'multi=' + comp[0].similarity.toFixed(4) + ' exact=' + exact.similarity.toFixed(4));
  const wFast = workerCall({ id: 1, profile: profile, liveRois: [impF.roi], fast: true });
  check('WORKER fast call matches the main thread and reports its timing', !!wFast && !!wFast.result && wFast.result.verified === false &&
    !!wFast.timing && typeof wFast.timing.baseMs === 'number' && wFast.timing.baseEncodes === 2,
    wFast && wFast.timing ? 'baseEncodes=' + wFast.timing.baseEncodes : 'no timing');
  const wMulti = workerCall({ id: 2, profiles: [profile], liveRois: [flatF.roi] });
  check('WORKER multi call equals the main-thread composition', !!wMulti && Array.isArray(wMulti.results) &&
    wMulti.results[0].similarity === comp[0].similarity && wMulti.results[0].verified === true,
    wMulti && wMulti.results ? 'sim=' + wMulti.results[0].similarity.toFixed(4) : 'no results');
  const wExh = workerCall({ id: 3, profile: profile, liveRois: [impF.roi], exhaustive: true });
  const mExh = B.verifyPalmprintRois(profile, [impF.roi], { exhaustive: true });
  check('WORKER exhaustive call carries the per-shift log, identical to the main thread',
    !!wExh && !!wExh.result && Array.isArray(wExh.result.shiftLog) && wExh.result.shiftLog.length === 30 &&
    wExh.result.similarity === mExh.similarity && JSON.stringify(wExh.result.shiftLog) === JSON.stringify(mExh.shiftLog),
    wExh && wExh.result ? 'shifts=' + wExh.result.shiftLog.length + ' (6 probe x enrolled pairs x 5 shifts)' : 'no result');
})();

/* ---------------- deadline behaviour ------------------------------ */
(function () {
  // A synthetic no-match stream at the phone's measured per-frame
  // cost, stopped by the app's own two limits (MAXF frames or the
  // wall-clock budget): it must end at the BUDGET, not the cap.
  const FRAME_MS = 490, MAXF = 24;
  let elapsed = 0, frames = 0, st = { streak: 0, best: null }, stopReason = null;
  while (true) {
    frames++; elapsed += FRAME_MS;
    st = B.streamMatchUpdate(st, 0.12); // an impostor-band score, frame after frame
    if (st.done) { stopReason = 'matched'; break; }
    if (frames >= MAXF) { stopReason = 'frame-cap'; break; }
    if (elapsed > B.SCAN_TIME_BUDGET_MS) { stopReason = 'budget'; break; }
  }
  check('DEADLINE a no-match stream ends at the budget, not the frame cap', stopReason === 'budget' && frames < MAXF,
    'stopped after ' + frames + ' frames / ' + elapsed + ' ms (' + stopReason + ')');

  // The genuine-pass basis under the 1-snap rule: a flat genuine
  // sequence completes at the FIRST analysed frame.
  let st2 = { streak: 0, best: null }, verdictFrame = null;
  for (let i = 0; i < 12 && verdictFrame === null; i++) {
    const f = frameObj(TEX_A, { seed: 7000 + i * 13, cx: 320 + ((i % 3) - 1) * 3, cy: 240 + (((i + 1) % 3) - 1) * 3, deg: (i % 3) - 1 });
    if (!f) { st2 = B.streamMatchUpdate(st2, null); continue; }
    const r = B.verifyPalmprintRoisFast(profile, [f.roi]);
    st2 = B.streamMatchUpdate(st2, r.similarity);
    if (st2.done) verdictFrame = i + 1;
  }
  check('DEADLINE (v45 1-snap) a flat genuine sequence completes at frame 1, far inside the budget', verdictFrame === 1,
    'verdictFrame=' + verdictFrame + ' (budget allows ' + Math.floor(B.SCAN_TIME_BUDGET_MS / FRAME_MS) + ' frames at ' + FRAME_MS + ' ms)');
})();

/* ---------------- landmark input size ----------------------------- */
function snapLm(lm, W, H) {
  return lm.map(function (p) { return { x: Math.round(p.x * W) / W, y: Math.round(p.y * H) / H, z: 0 }; });
}
function scoreWithLm(tex, opt, W) {
  const r = render(tex, opt);
  const lm = W ? snapLm(r.lm, W, W * 480 / 640) : r.lm;
  const roi = B.palmRoiFromLandmarks(r.gray, r.w, r.h, lm);
  if (!roi) return null;
  return B.verifyPalmprintRoisFast(profile, [roi]).similarity;
}
(function () {
  const g320 = scoreWithLm(TEX_A, { seed: 11100 }, 320);
  const g480 = scoreWithLm(TEX_A, { seed: 11100 }, 480);
  const imp320 = scoreWithLm(TEX_B, { seed: 11300 }, 320);
  info('landmark quantisation, flat genuine: 320px=' + g320.toFixed(3) + ' 480px=' + g480.toFixed(3) + '; impostor at 320=' + imp320.toFixed(3));
  check('LANDMARK 320 px: flat genuine still verifies', g320 >= 0.32, 'sim=' + g320.toFixed(3));
  check('LANDMARK 320 px: no genuine loss vs 480 on flat presentations', g320 >= g480 - 0.02, 'g320=' + g320.toFixed(3) + ' g480=' + g480.toFixed(3));
  check('LANDMARK 320 px: impostor still refused with margin', imp320 < 0.25, 'impostor=' + imp320.toFixed(3));
})();

/* ---------------- app wiring (source pins) ------------------------ */
(function () {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const count = function (needle) { return appSrc.split(needle).length - 1; };
  check('APP analysis copy is 320 px', appSrc.indexOf('ANALYSIS_MAX = 320') !== -1);
  check('APP both streams run on the wall-clock budget', count('deadline = t0 + B.SCAN_TIME_BUDGET_MS') === 2 &&
    count('MAXF = 24') === 2, 'budget lines=' + count('deadline = t0 + B.SCAN_TIME_BUDGET_MS'));
  check('APP timeout is reported plainly in both streams', count('No match was found within the') >= 2,
    'wording lines=' + count('No match was found within the'));
  check('APP per-frame calls in both streams carry the Field Test exhaustive flag', count('fieldExhaustiveOn()') >= 2,
    'flag lines=' + count('fieldExhaustiveOn()'));
  check('APP diagnostics line ships in both streams', count('Scan timing:') >= 2 && count('frames analysed in') >= 2,
    'diag lines=' + count('Scan timing:'));
  check('APP frame results carry the stage timings', appSrc.indexOf('lmMs: lmMs, encMs: encMs') !== -1 &&
    appSrc.indexOf('stLm += r.lmMs') !== -1);
  check('APP result panels render the measured strings (terminal + wallet routes)',
    appSrc.indexOf("Measured: ' + esc(out.measured)") !== -1 &&
    appSrc.indexOf("termResult').innerHTML = html") !== -1 && appSrc.indexOf("wHomeMsg').innerHTML") !== -1);
})();

console.log(fail === 0 ? 'ALL V44 TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
