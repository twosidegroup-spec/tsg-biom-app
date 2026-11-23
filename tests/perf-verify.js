/* TSG BIOM v45 perf harness — timing only, no pass/fail assertions.
   Measures the verify/enrol paths the way app.js composes them
   under the Palm-X spec build, on the same synthetic fixtures as
   tests/palmprint.test.js (roiImage generator + crease sets).

   Usage: node tests/perf-verify.js

   v45 composition (what is timed):
     enrol       15 analysed frames -> B.selectPalmprintProfileCodes
                 (burst banking: 3 sharpest time-spaced templates,
                 packed) — the matcher-side cost of the 900 ms burst
     per frame   B.verifyPalmprintRoisFast(profile, [roi])
                 (1 probe ROI -> plain+mirror packed pair -> 5-shift
                 early-exit match against up to 3 templates)
     exact       B.verifyPalmprintRois(profile, [roi])
     stream      per-frame fast calls fed to B.streamMatchUpdate
                 under the 1-snap rule: genuine stops at frame 1;
                 a no-match run costs the full 24-frame backstop
     serialise   v8.serialize proxy for the worker payload shape
                 {profile, liveRois} (structured-clone stand-in)

   Camera capture, MediaPipe landmarks and frame analysis are NOT
   measured here — this is the matcher path only, on this machine's
   CPU. Phone timings differ; the phone is the verdict. */
'use strict';
const B = require('../biometrics.js');
const v8 = require('v8');
const S = B.PALMPRINT_ROI_SIZE;

/* ---------------- fixtures (as tests/palmprint.test.js) ---------- */
function lcg(seed) { let s = seed; return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = opts.size || S, k = 128 / size, rnd = lcg(seed);
  const noiseAmp = opts.noiseAmp != null ? opts.noiseAmp : 12;
  const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const dx = opts.dx || 0, dy = opts.dy || 0;
  const g = new Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + dx) * k, py = (y + dy) * k;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7;
    for (const c of creases) {
      if (c.vert) { const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp; const d = Math.abs(px - lx); if (d < 3) v -= (3 - d) * 30; }
      else { const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp; const d = Math.abs(py - ly); if (d < 3) v -= (3 - d) * 30; }
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));
  }
  return g;
}
const PALM_A = [
  { a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 },
  { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true },
  { a: -0.12, b: 108, f: 0.05, p: 6, amp: 4 }
];
const PALM_B = [
  { a: -0.05, b: 38, f: 0.04, p: 2, amp: 5 }, { a: 0.18, b: 55, f: 0.07, p: 1, amp: 3 },
  { a: -0.5, b: 118, f: 0.05, p: 4, amp: 4 }, { a: 0.85, b: 4, f: 0.04, p: 3, amp: 4, vert: true }
];
const PALM_C = [
  { a: 0.31, b: 44, f: 0.06, p: 0, amp: 3 }, { a: -0.22, b: 70, f: 0.05, p: 2, amp: 4 },
  { a: 0.09, b: 30, f: 0.04, p: 4, amp: 3 }, { a: 0.42, b: 96, f: 0.06, p: 1, amp: 4, vert: true }
];
function enrolProfile(creases, seedBase, nFrames) {
  const frames = [];
  for (let i = 0; i < nFrames; i++) {
    const roi = roiImage(creases, seedBase + i, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 });
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, S, S), roi: roi, sharpness: 100 + i * 10 });
  }
  return { v: 4, format: B.PALMPRINT_FORMAT, codes: B.selectPalmprintProfileCodes(frames) };
}
const profileA = enrolProfile(PALM_A, 61, 15);
const profileC = enrolProfile(PALM_C, 161, 15);
const liveA = roiImage(PALM_A, 71, { dx: 1, dy: -1 });   // genuine re-presentation
const liveB = roiImage(PALM_B, 81);                       // different palm

/* ---------------- timing helpers --------------------------------- */
function median(xs) { const s = xs.slice().sort(function (a, b) { return a - b; }); return s[Math.floor(s.length / 2)]; }
function timeit(label, fn, reps) {
  const ts = [];
  let out;
  for (let i = 0; i < reps; i++) { const t0 = process.hrtime.bigint(); out = fn(i); ts.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  console.log(label.padEnd(58) + median(ts).toFixed(1).padStart(9) + ' ms  (median of ' + reps + ', min ' + Math.min.apply(null, ts).toFixed(1) + ')');
  return out;
}

/* warm-up (JIT) */
B.verifyPalmprintRois(profileA, [liveA]);

console.log('=== v45 perf (rig numbers; the phone is the verdict) ===');
console.log('profileA templates: ' + profileA.codes.length + ', profileC templates: ' + profileC.codes.length);

/* 1. enrolment banking over a 15-frame burst */
timeit('enrol banking: selectPalmprintProfileCodes(15 frames)', function () { return enrolProfile(PALM_A, 61, 15); }, 5);

/* 2. probe packing: one ROI -> plain+mirror packed pair */
timeit('palmprintProbePacked(one ROI) [2 encodes + 2 packs]', function () { return B.palmprintProbePacked(liveA); }, 15);

/* 3. one packed comparison, centre-hit vs full 5-shift */
(function () {
  const probe = B.palmprintProbePacked(liveA);
  timeit('palmprintPackedMatch self (centre hit, 1 shift)', function () { return B.palmprintPackedMatch(probe[0], probe[0]); }, 25);
  timeit('palmprintPackedMatch impostor (5 shifts)', function () { return B.palmprintPackedMatch(probe[0], profileC.codes[0]); }, 25);
})();

/* 4. per-frame verify calls (the streamVerifyPalm hot call) */
const rFrameA = timeit('per-frame FAST verify, GENUINE roi (1 ROI)', function () { return B.verifyPalmprintRoisFast(profileA, [liveA]); }, 9);
const rFrameB = timeit('per-frame FAST verify, NO-MATCH roi (1 ROI)', function () { return B.verifyPalmprintRoisFast(profileA, [liveB]); }, 9);
console.log('    genuine frame: verified=' + rFrameA.verified + ' sim=' + (rFrameA.similarity || 0).toFixed(3) +
  ' | no-match frame: verified=' + rFrameB.verified + ' sim=' + (rFrameB.similarity || 0).toFixed(3));

/* 5. exact path spot values */
const rExactA = B.verifyPalmprintRois(profileA, [liveA]);
const rExactB = B.verifyPalmprintRois(profileA, [liveB]);
console.log('    exact path: genuine sim=' + rExactA.similarity.toFixed(4) + ' verified=' + rExactA.verified +
  ' | no-match sim=' + rExactB.similarity.toFixed(4) + ' verified=' + rExactB.verified);

/* 6. stream simulations under the 1-snap rule */
function streamRun(tex, creases, seedBase) {
  let state = { streak: 0, best: null };
  let frames = 0, res = null;
  const shifts = [{ dx: 1, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 0 }, { dx: -1, dy: -1 }];
  for (let i = 0; i < 24 && !state.done; i++) {
    const roi = roiImage(creases, seedBase + i * 7, shifts[i % shifts.length]);
    res = B.verifyPalmprintRoisFast(profileA, [roi]);
    frames++;
    state = B.streamMatchUpdate(state, typeof res.similarity === 'number' ? res.similarity : null);
  }
  return { frames: frames, done: state.done, sim: res && res.similarity };
}
const g = timeit('STREAM genuine pass (per-frame calls until win)', function () { return streamRun(liveA, PALM_A, 71); }, 5);
console.log('    win after ' + g.frames + ' frames, final frame sim=' + (g.sim || 0).toFixed(3) + ', done=' + g.done);
const nm = timeit('STREAM full no-match (24 frames, backstop)', function () { return streamRun(liveB, PALM_B, 81); }, 3);
console.log('    no-match: done=' + nm.done + ' after ' + nm.frames + ' frames, best sim=' + (nm.sim || 0).toFixed(3));

/* 7. worker-message serialisation proxy */
(function () {
  const payload = { id: 1, profile: profileA, liveRois: [liveA] };
  const buf = v8.serialize(payload);
  timeit('serialise proxy: {profile + 1 ROI} (' + buf.length + ' bytes)', function () { return v8.serialize(payload); }, 15);
})();
console.log('=== done ===');
