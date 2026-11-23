/* TSG BIOM v35 perf harness — timing only, no pass/fail assertions.
   Measures the Show & Pay (terminal) verify path the way app.js
   composes it, on the same synthetic fixtures as
   v33-maxfusion.test.js (identical roiImage generator + crease sets).

   Usage: node tests/perf-verify.js before|after

   'before' composes exactly the v34 app calls:
     per frame   Match.verifyRois(profile, [roi])  -> B.verifyPalmprintRois
     finalOut    B.verifyPalmprintRois(profile, top3Rois)
     impostorMax B.verifyPalmprintRois(otherProfile, rois) per person
                 (probe ROIs re-encoded inside every call)
   'after' composes the v35 app calls:
     per frame   B.verifyPalmprintRoisFast(profile, [roi])
                 (ordered lazy probe encodes + threshold short-circuit)
     finalOut    B.verifyPalmprintRois(profile, top3Rois)  (unchanged)
     impostorMax probe codes encoded ONCE (B.palmprintProbeCodes),
                 then B.verifyPalmprintProfile per person — the same
                 composition the worker's multi-profile message runs.

   The stream simulations mirror streamVerifyPalm's matcher loop:
   one verify call per analysed frame with a sane code, scores fed to
   B.streamMatchUpdate, stopping when the two-frame rolling-window
   rule fires (genuine) or at MAXF = 24 analysed frames (no-match),
   followed by the finalOut composition. Camera capture, MediaPipe
   landmarks and frame analysis are NOT measured here — this is the
   matcher path only, on this machine's CPU. Phone timings differ;
   the phone is the verdict. */
'use strict';
const B = require('../biometrics.js');
const v8 = require('v8');

const mode = process.argv[2];
if (mode !== 'before' && mode !== 'after') { console.error('usage: node tests/perf-verify.js before|after'); process.exit(2); }
const FAST = mode === 'after' && typeof B.verifyPalmprintRoisFast === 'function';
if (mode === 'after' && !FAST) { console.error('verifyPalmprintRoisFast not present — run after-mode only on the v35 build'); process.exit(2); }

/* ---------------- fixtures (identical to v33-maxfusion.test.js) -- */
function lcg(seed) { let s = seed; return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = 128, rnd = lcg(seed), noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * 12);
  const dx = opts.dx || 0, dy = opts.dy || 0;
  const g = new Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x + dx, py = y + dy;
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
function enrolProfile(creases, seedBase) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    const roi = roiImage(creases, seedBase + i, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 });
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, 128, 128), roi: roi, sharpness: 100 + i * 10 });
  }
  return { v: 3, codes: B.selectPalmprintProfileCodes(frames) };
}
const profileA = enrolProfile(PALM_A, 61);
const profileC = enrolProfile(PALM_C, 161);
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

console.log('=== mode: ' + mode + ' ===');
console.log('profileA codes: ' + profileA.codes.length + ', profileC codes: ' + profileC.codes.length);

/* 1. probe expansion: one ROI -> 50 codes */
timeit('palmprintProbeCodes(one ROI) [50 encodes]', function () { return B.palmprintProbeCodes(liveA); }, 7);

/* 2. one pair similarity */
(function () {
  const probes = B.palmprintProbeCodes(liveA);
  const enrolled = new Uint8Array(Buffer.from(profileA.codes[0], 'base64'));
  timeit('palmprintSimilarity(one pair) [25 code-grid shifts]', function () { return B.palmprintSimilarity(probes[0], enrolled); }, 15);
})();

/* 3. per-frame verify calls (the streamVerifyPalm hot call) */
const perFrame = FAST
  ? function (prof, roi) { return B.verifyPalmprintRoisFast(prof, [roi]); }
  : function (prof, roi) { return B.verifyPalmprintRois(prof, [roi]); };
const rFrameA = timeit('per-frame verify, GENUINE roi (1 ROI)', function () { return perFrame(profileA, liveA); }, 7);
const rFrameB = timeit('per-frame verify, NO-MATCH roi (1 ROI)', function () { return perFrame(profileA, liveB); }, 7);
console.log('    genuine frame: verified=' + rFrameA.verified + ' sim=' + (rFrameA.similarity || 0).toFixed(3) +
  ' | no-match frame: verified=' + rFrameB.verified + ' sim=' + (rFrameB.similarity || 0).toFixed(3));

/* 4. exact-path equivalence spot values (both modes) */
const rExactA = B.verifyPalmprintRois(profileA, [liveA]);
const rExactB = B.verifyPalmprintRois(profileA, [liveB]);
console.log('    exact path: genuine sim=' + rExactA.similarity.toFixed(4) + ' verified=' + rExactA.verified +
  ' | no-match sim=' + rExactB.similarity.toFixed(4) + ' verified=' + rExactB.verified);

/* 5. stream simulation — genuine pass */
function streamGenuine() {
  let state = { streak: 0, best: null };
  let frames = 0, res = null;
  const shifts = [{ dx: 1, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 0 }, { dx: -1, dy: -1 }];
  for (let i = 0; i < 24 && !state.done; i++) {
    const roi = roiImage(PALM_A, 71 + i * 7, shifts[i % shifts.length]);
    res = perFrame(profileA, roi);
    frames++;
    state = B.streamMatchUpdate(state, typeof res.similarity === 'number' ? res.similarity : null);
  }
  return { frames: frames, done: state.done, sim: res && res.similarity };
}
const g = timeit('STREAM genuine pass (per-frame calls until win)', function () { return streamGenuine(); }, 5);
console.log('    win after ' + g.frames + ' frames, final frame sim=' + (g.sim || 0).toFixed(3) + ', done=' + g.done);

/* 6. stream simulation — full no-match run: 24 frames, then the
      finalOut composition (top-3 exact verify + impostor max). */
function streamNoMatch() {
  let state = { streak: 0, best: null };
  const frames = [];
  for (let i = 0; i < 24; i++) {
    const roi = roiImage(PALM_B, 81 + i * 7, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 });
    const res = perFrame(profileA, roi);
    state = B.streamMatchUpdate(state, typeof res.similarity === 'number' ? res.similarity : null);
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, 128, 128), roi: roi, sharpness: 100 + i });
  }
  const liveRois = B.selectPalmprintLiveRois(frames);
  const fin = B.verifyPalmprintRois(profileA, liveRois);
  let impMax = null;
  if (FAST) {
    // v35 composition: encode the probe codes once, score per person.
    const codes = [];
    liveRois.forEach(function (roi) { B.palmprintProbeCodes(roi).forEach(function (c) { codes.push(c); }); });
    const ro = B.verifyPalmprintProfile(profileC, codes);
    impMax = ro && typeof ro.similarity === 'number' ? ro.similarity : null;
  } else {
    const ro = B.verifyPalmprintRois(profileC, liveRois);
    impMax = ro && typeof ro.similarity === 'number' ? ro.similarity : null;
  }
  return { finSim: fin.similarity, finVerified: fin.verified, impMax: impMax };
}
const nm = timeit('STREAM full no-match (24 frames + finalOut + impostor)', function () { return streamNoMatch(); }, 3);
console.log('    finalOut: verified=' + nm.finVerified + ' sim=' + (nm.finSim || 0).toFixed(3) + ' | impostorMax vs profileC=' + (nm.impMax === null ? 'n/a' : nm.impMax.toFixed(3)));

/* 7. worker-message serialisation proxy (v8.serialize ~ postMessage
      structured clone of the same payload shapes) */
(function () {
  const payload = { id: 1, profile: profileA, liveRois: [liveA] };
  const buf = v8.serialize(payload);
  timeit('serialise proxy: {profile + 1 ROI} (' + buf.length + ' bytes)', function () { return v8.serialize(payload); }, 15);
})();
console.log('=== done (' + mode + ') ===');
