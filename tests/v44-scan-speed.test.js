/* TSG BIOM — v44 scan-duration tests (2026-11-23).

   Trigger: the Chairman's phone verdict on v43 (17:42 Dhaka):
   "now the verify and payment scan takes too timeeeee". On his
   device a full-window run measured 24 frames in 11,752 ms
   (~490 ms per analysed frame), and every non-matching frame was
   paying all 18 geometric-variant encodes plus their scoring
   before the scan moved on. v44 cuts the DURATION four ways and
   changes no verdict semantics for any judged frame:

   (1) PHONE-READABLE DIAGNOSTICS — the scan result objects carry
       a per-stage timing sink (base/geo/match ms + encode counts)
       and the app panels render it ("Scan timing: N frames
       analysed in T ms (F frames/s); per frame — landmarks X ms,
       palm code Y ms, matching Z ms ..."), so the next phone
       screenshot reports the device's own stage costs.
   (2) PROMISING-BAND GATING — a frame's geometric encodes run
       only when its base-rule max reaches PALMPRINT_GEO_FLOOR.
       MEASURED BASIS (this fixture family, 2026-11-23): rescuable
       genuine frames (base < 0.32, full rule >= 0.32) scored base
       0.158..0.314 (n=40); impostor frames base max 0.174 (n=80,
       median 0.120). Skipping geo can only LOWER a frame's score
       (a max over a subset), so the gate can never create an
       accept; the floor 0.14 sits 0.018 under the lowest measured
       rescuable frame, so no measured rescue is lost either. A
       frame inside the band must receive the IDENTICAL full v43
       judgement — the checks below pin bit-identical scores.
   (3) WALL-CLOCK DEADLINE — B.SCAN_TIME_BUDGET_MS = 6000 bounds
       the no-match grind; MAXF 24 stays as the backstop. Basis:
       across 18 fixture genuine sequences every verdict landed at
       analysed frame 3 (the evidence-rule minimum); the budget
       allows 12 frames (4x) at the phone's measured ~490 ms.
   (4) LANDMARK INPUT — ANALYSIS_MAX 480 -> 320, adopted on the
       quantised-landmark fixture measurement: genuine band holds
       (tilt av 0.90 minimum 0.345 at 320 vs 0.338 at 480;
       impostor max 0.146 vs 0.142).

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
  return { openness: 2.0, code: B.palmprintEncode(roi, 128, 128), roi: roi, sharpness: sharp || 100 };
}
function enrol(tex, baseOpt, seed0) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    frames.push(frameObj(tex, Object.assign({}, baseOpt, { seed: seed0 + i, cx: 320 + ((i % 3) - 1) * 2, cy: 240 + (((i + 1) % 3) - 1) * 2, deg: (baseOpt.deg || 0) + (i % 3) - 1 }), 100 + i * 10));
  }
  const codes = B.selectPalmprintProfileCodes(frames.filter(Boolean));
  return codes ? { v: 3, codes: codes } : null;
}
function baseScore(profile, roi) {
  return B.verifyPalmprintProfile(profile, B.palmprintProbeCodes(roi)).similarity;
}

const profile = enrol(TEX_A, {}, 100);
check('FIXTURE enrolment banks a profile', !!profile && profile.codes.length >= 2, profile && (profile.codes.length + ' codes'));
const FLOOR = B.PALMPRINT_GEO_FLOOR;

/* ---------------- the measured constants -------------------------- */
check('CONST geo floor is the measured 0.14', FLOOR === 0.14, 'floor=' + FLOOR);
check('CONST scan budget is 6000 ms', B.SCAN_TIME_BUDGET_MS === 6000, 'budget=' + B.SCAN_TIME_BUDGET_MS);
check('THRESHOLD stays the phone-calibrated 0.32', B.PALMPRINT_THRESHOLD === 0.32);

/* Rescuable genuine frames from the v41 conditions: their base
   scores must sit inside the band (>= floor, < 0.32) and the full
   rule must rescue them — the floor's empirical footing. */
const tilt85 = frameObj(TEX_A, { seed: 1000, av: 0.85 });
const tilt70 = frameObj(TEX_A, { seed: 1021, av: 0.70 });
[[tilt85, 'tilt av=0.85'], [tilt70, 'tilt av=0.70']].forEach(function (pair) {
  const f = pair[0], b = baseScore(profile, f.roi);
  const full = B.verifyPalmprintRoisFast(profile, [f.roi]);
  check('BAND ' + pair[1] + ' genuine frame is rescuable and in-band', b >= FLOOR && b < 0.32 && full.verified === true,
    'base=' + b.toFixed(3) + ' full=' + full.similarity.toFixed(3));
});

/* Impostor frames: select, from a fixed deterministic list, one
   below the floor and one inside the band — both must exist in
   the measured distributions (median 0.120, max 0.174). */
const impCandidates = [];
[TEX_B, TEX_C].forEach(function (tex, ti) {
  [{}, { av: 0.85 }, { av: 0.70 }, { spanFactor: 1.15 }, { S: 272 * 0.85, deg: 8, av: 0.85 }].forEach(function (extra, ci) {
    for (let s = 0; s < 2; s++) {
      const f = frameObj(tex, Object.assign({ seed: 5000 + ti * 1000 + ci * 100 + s * 7 }, extra));
      if (f) impCandidates.push({ f: f, b: baseScore(profile, f.roi) });
    }
  });
});
const impBelow = impCandidates.filter(function (c) { return c.b < FLOOR; })[0];
const impInBand = impCandidates.filter(function (c) { return c.b >= FLOOR && c.b < 0.32; })[0];
info('impostor base scores sampled: ' + impCandidates.map(function (c) { return c.b.toFixed(3); }).join(', '));
check('BAND impostor frames exist below the floor', !!impBelow, impBelow && ('base=' + impBelow.b.toFixed(3)));
check('BAND impostor frames exist inside the band', !!impInBand, impInBand && ('base=' + impInBand.b.toFixed(3)));

/* ---------------- (2) gating: the 1:1 fast path ------------------- */
(function () {
  // In-band rescuable genuine: IDENTICAL judgement to v43.
  const sinkIn = {};
  const gated = B.verifyPalmprintRoisFast(profile, [tilt85.roi], { geoFloor: FLOOR, timing: sinkIn });
  const ungated = B.verifyPalmprintRoisFast(profile, [tilt85.roi]);
  check('GATE in-band tilted genuine still verifies, bit-identical score', gated.verified === true && gated.similarity === ungated.similarity,
    'gated=' + gated.similarity.toFixed(4) + ' ungated=' + ungated.similarity.toFixed(4));
  check('GATE in-band frame pays geo encodes', sinkIn.geoEncodes > 0, 'geoEncodes=' + sinkIn.geoEncodes);
  check('DIAG timing sink carries the stage fields', typeof sinkIn.baseMs === 'number' && typeof sinkIn.geoMs === 'number' &&
    typeof sinkIn.baseEncodes === 'number' && typeof sinkIn.geoEncodes === 'number',
    'baseMs=' + Math.round(sinkIn.baseMs) + ' geoMs=' + Math.round(sinkIn.geoMs));

  // Out-of-band impostor: geo skipped entirely, verdict unchanged.
  const sinkOut = {};
  const gOut = B.verifyPalmprintRoisFast(profile, [impBelow.f.roi], { geoFloor: FLOOR, timing: sinkOut });
  check('GATE out-of-band frame skips every geo encode', sinkOut.geoEncodes === 0 && sinkOut.geoMs === 0, 'geoEncodes=' + sinkOut.geoEncodes);
  check('GATE out-of-band frame still pays the full base enumeration', sinkOut.baseEncodes === 50, 'baseEncodes=' + sinkOut.baseEncodes);
  check('GATE out-of-band impostor refused at exactly its base score', gOut.verified === false && gOut.similarity === impBelow.b,
    'score=' + gOut.similarity.toFixed(4) + ' base=' + impBelow.b.toFixed(4));

  // In-band impostor: geo runs, still refused, identical score.
  const sinkBand = {};
  const gBand = B.verifyPalmprintRoisFast(profile, [impInBand.f.roi], { geoFloor: FLOOR, timing: sinkBand });
  const uBand = B.verifyPalmprintRoisFast(profile, [impInBand.f.roi]);
  check('GATE in-band impostor gets geo and is still refused, identical score', sinkBand.geoEncodes > 0 && gBand.verified === false && gBand.similarity === uBand.similarity,
    'gated=' + gBand.similarity.toFixed(4) + ' ungated=' + uBand.similarity.toFixed(4));

  // No opts at all: the v43 judgement, pair for pair. The fast /
  // exact bit-identity the v35 suite pins holds for NON-pass
  // scores (a passing fast call reports its deciding pair, the
  // exact path the full max — both verify), so the identity is
  // pinned on the in-band impostor, and the tilted genuine is
  // pinned on the shared verdict.
  const exactImp = B.verifyPalmprintRois(profile, [impInBand.f.roi]);
  check('GATE no-opts fast path still equals the exact path on a non-pass frame', uBand.similarity === exactImp.similarity && uBand.verified === exactImp.verified,
    'fast=' + uBand.similarity.toFixed(4) + ' exact=' + exactImp.similarity.toFixed(4));
  const exactTilt = B.verifyPalmprintRois(profile, [tilt85.roi]);
  check('GATE no-opts fast path verifies the tilted genuine like the exact path', ungated.verified === true && exactTilt.verified === true,
    'fast=' + ungated.similarity.toFixed(4) + ' exact=' + exactTilt.similarity.toFixed(4));
})();

/* ---------------- (2) gating: multi-profile + worker -------------- */
function workerCall(msg) {
  let posted = null;
  const sandbox = { Buffer: Buffer, postMessage: function (m) { posted = m; } };
  vm.createContext(sandbox);
  vm.runInContext(B.palmprintWorkerSource(), sandbox);
  sandbox.onmessage({ data: msg });
  return posted;
}
(function () {
  const profs = [profile];
  // Ungated composition === per-profile verify over the shared
  // codes === the exact 1:1 call (the v43 composition, unchanged).
  const comp = B.verifyPalmprintProfilesRois(profs, [tilt85.roi]);
  const exact = B.verifyPalmprintRois(profile, [tilt85.roi]);
  check('MULTI ungated composition equals the exact call', comp[0].similarity === exact.similarity && comp[0].verified === exact.verified,
    'multi=' + comp[0].similarity.toFixed(4) + ' exact=' + exact.similarity.toFixed(4));

  // Gated composition on the in-band genuine: identical results.
  const sinkM = {};
  const gComp = B.verifyPalmprintProfilesRois(profs, [tilt85.roi], { geoFloor: FLOOR, timing: sinkM });
  check('MULTI gated in-band genuine: identical result, geo encoded', gComp[0].similarity === comp[0].similarity && gComp[0].verified === true && sinkM.geoEncodes > 0,
    'geoEncodes=' + sinkM.geoEncodes);

  // Gated composition on the out-of-band impostor: no geo codes.
  const sinkMo = {};
  const gCompOut = B.verifyPalmprintProfilesRois(profs, [impBelow.f.roi], { geoFloor: FLOOR, timing: sinkMo });
  check('MULTI gated out-of-band impostor: geo skipped, refused at base score', sinkMo.geoEncodes === 0 &&
    gCompOut[0].verified === false && gCompOut[0].similarity === impBelow.b,
    'score=' + gCompOut[0].similarity.toFixed(4));

  // Worker: gated fast call matches the main thread and reports
  // its timing; gated multi matches too.
  const wFast = workerCall({ id: 1, profile: profile, liveRois: [impBelow.f.roi], fast: true, geoFloor: FLOOR });
  check('WORKER gated fast call: geo skipped, timing reported', !!wFast && !!wFast.result && wFast.result.verified === false &&
    !!wFast.timing && wFast.timing.geoEncodes === 0 && typeof wFast.timing.baseMs === 'number',
    wFast && wFast.timing ? 'geoEncodes=' + wFast.timing.geoEncodes : 'no timing');
  const wMulti = workerCall({ id: 2, profiles: profs, liveRois: [tilt85.roi], geoFloor: FLOOR });
  check('WORKER gated multi call equals the main-thread composition', !!wMulti && Array.isArray(wMulti.results) &&
    wMulti.results[0].similarity === gComp[0].similarity && wMulti.results[0].verified === true && !!wMulti.timing && wMulti.timing.geoEncodes > 0,
    wMulti && wMulti.results ? 'sim=' + wMulti.results[0].similarity.toFixed(4) : 'no results');
  const wMultiPlain = workerCall({ id: 3, profiles: profs, liveRois: [tilt85.roi] });
  check('WORKER ungated multi call still equals the exact composition', !!wMultiPlain && wMultiPlain.results[0].similarity === comp[0].similarity,
    wMultiPlain && wMultiPlain.results ? 'sim=' + wMultiPlain.results[0].similarity.toFixed(4) : 'no results');
})();

/* ---------------- (3) deadline behaviour -------------------------- */
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

  // The genuine-pass basis: a tilted genuine sequence verdicts at
  // frame 3 — far inside the 12 frames the budget allows.
  let st2 = { streak: 0, best: null }, verdictFrame = null;
  for (let i = 0; i < 12 && verdictFrame === null; i++) {
    const f = frameObj(TEX_A, { seed: 7000 + i * 13, cx: 320 + ((i % 3) - 1) * 3, cy: 240 + (((i + 1) % 3) - 1) * 3, deg: (i % 3) - 1, av: 0.85 });
    if (!f) { st2 = B.streamMatchUpdate(st2, null); continue; }
    const r = B.verifyPalmprintRoisFast(profile, [f.roi], { geoFloor: FLOOR });
    st2 = B.streamMatchUpdate(st2, r.similarity);
    if (st2.done) verdictFrame = Math.max(i + 1, 3);
  }
  check('DEADLINE genuine tilted sequence verdicts at frame 3, inside the budget', verdictFrame === 3,
    'verdictFrame=' + verdictFrame + ' (budget allows ' + Math.floor(B.SCAN_TIME_BUDGET_MS / FRAME_MS) + ' frames at ' + FRAME_MS + ' ms)');
})();

/* ---------------- (4) landmark input size ------------------------- */
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
  const g85at320 = [0, 1].map(function (s) { return scoreWithLm(TEX_A, { seed: 11100 + s * 7, av: 0.85 }, 320); });
  const g90at320 = [0, 1].map(function (s) { return scoreWithLm(TEX_A, { seed: 11200 + s * 7, av: 0.90 }, 320); });
  const g90at480 = [0, 1].map(function (s) { return scoreWithLm(TEX_A, { seed: 11200 + s * 7, av: 0.90 }, 480); });
  const imp320 = scoreWithLm(TEX_B, { seed: 11300 }, 320);
  const min320 = Math.min.apply(null, g85at320.concat(g90at320));
  const min480 = Math.min.apply(null, g90at480);
  info('landmark 320: tilt0.85=[' + g85at320.map(function (x) { return x.toFixed(3); }).join(',') + '] tilt0.90=[' +
    g90at320.map(function (x) { return x.toFixed(3); }).join(',') + '] impostor=' + imp320.toFixed(3) +
    ' | tilt0.90 at 480 min=' + min480.toFixed(3));
  check('LANDMARK 320 px: the genuine tilt band holds above threshold', min320 >= 0.32, 'min320=' + min320.toFixed(3));
  check('LANDMARK 320 px: no genuine loss vs 480 in the tilt band', min320 >= min480 - 0.02, 'min320=' + min320.toFixed(3) + ' min480=' + min480.toFixed(3));
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
  check('APP per-frame calls in both streams carry the band gate', count('geoFloor: B.PALMPRINT_GEO_FLOOR') >= 2,
    'gate lines=' + count('geoFloor: B.PALMPRINT_GEO_FLOOR'));
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
