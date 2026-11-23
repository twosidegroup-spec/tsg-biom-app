/* TSG Biom — v39 regression: the FAST WIN (Show & Pay).
   Trigger (the Chairman's phone verdict on v38, 2026-11-23 14:26):
   the Pay scan still takes too long at payment time. He had been
   offered this exact trade in advance — honour the win on the two
   matched frames instead of waiting for a third frame of evidence
   — tested v38, found it still slow, and the fast mode is the
   authorised change.

   The rule under test (biometrics.js, pure functions):
   streamMatchUpdate completes the match as before (two matched
   frames in a rolling three-frame window, threshold 0.32 — the
   match rule itself is unchanged). The win may then be honoured
   at TWO analysed frames when B.streamFastWinCheck passes on the
   matched pair: both frames' own spoof samples clean (an examined
   false — flagged OR unexamined both block) and the pair's poses
   passing passiveLivenessPairCheck, the 2-pose path of the same
   liveness maths with the same per-step thresholds.

   What must NOT flip, and is pinned here and by the unmodified
   suites: a genuine palm still passes, an impostor still fails,
   a static pair (held photograph) still cannot win, and the
   standard 3-pose gate still requires three poses — the fast
   path is an additional honour, not a loosened gate. */
'use strict';
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function P(cx, cy, span) { return { cx: cx, cy: cy, span: span }; }

/* ---------- pair liveness: the 2-pose path of the same check ----- */
const natPair = B.passiveLivenessPairCheck([P(0.40, 0.40, 0.25), P(0.403, 0.401, 0.251)]);
check('PAIR natural micro-shift passes', natPair.pass === true && natPair.verdict === 'natural', 'maxShift=' + natPair.maxShift.toFixed(4));
const statPair = B.passiveLivenessPairCheck([P(0.40, 0.40, 0.25), P(0.40, 0.40, 0.25)]);
check('PAIR identical poses are static and do not pass', statPair.pass === false && statPair.verdict === 'static');
const noisePair = B.passiveLivenessPairCheck([P(0.40, 0.40, 0.25), P(0.4002, 0.3999, 0.2501)]);
check('PAIR detector-noise-only displacement still reads static (a held photo cannot pass)',
  noisePair.pass === false && noisePair.verdict === 'static', 'maxShift=' + noisePair.maxShift.toFixed(5));
const bandPair = B.passiveLivenessPairCheck([P(0.40, 0.40, 0.25), P(0.4012, 0.40, 0.25)]);
check('PAIR a shift between the static and natural bands is inconclusive, never a pass',
  bandPair.pass === false && bandPair.verdict === 'inconclusive', 'maxShift=' + bandPair.maxShift.toFixed(4));
const errPair = B.passiveLivenessPairCheck([P(0.40, 0.40, 0.25), P(0.75, 0.60, 0.25)]);
check('PAIR a scene jump is erratic and does not pass', errPair.pass === false && errPair.verdict === 'erratic');
const spanPair = B.passiveLivenessPairCheck([P(0.40, 0.40, 0.25), P(0.4002, 0.40, 0.252)]);
check('PAIR span growth alone (hand moving closer) passes, as in the 3-pose path',
  spanPair.pass === true && spanPair.verdict === 'natural', 'spanChange=' + spanPair.spanChange.toFixed(3));
const fewPair = B.passiveLivenessPairCheck([P(0.40, 0.40, 0.25)]);
check('PAIR fewer than 2 valid poses is inconclusive', fewPair.pass === false && fewPair.verdict === 'inconclusive');
const nullPair = B.passiveLivenessPairCheck([null, P(0.40, 0.40, 0.25)]);
check('PAIR a missing pose is inconclusive, never a pass', nullPair.pass === false && nullPair.verdict === 'inconclusive');

/* The pair path uses the SAME thresholds as the 3-pose path: the
   same single step, judged by both, gives the same verdict. */
const stepNatural = [P(0.40, 0.40, 0.25), P(0.402, 0.40, 0.25), P(0.402, 0.40, 0.25)];
check('SHARED a step exactly at the natural minimum passes in both paths',
  B.passiveLivenessPairCheck(stepNatural.slice(0, 2)).pass === true && B.passiveLivenessCheck(stepNatural).pass === true);
const stepErratic = [P(0.40, 0.40, 0.25), P(0.4901, 0.40, 0.25), P(0.4901, 0.40, 0.25)];
check('SHARED a step just past the erratic maximum fails in both paths',
  B.passiveLivenessPairCheck(stepErratic.slice(0, 2)).verdict === 'erratic' && B.passiveLivenessCheck(stepErratic).verdict === 'erratic');
check('SHARED the standard gate itself is unchanged: 2 poses are still inconclusive to passiveLivenessCheck',
  B.passiveLivenessCheck([P(0.40, 0.40, 0.25), P(0.41, 0.41, 0.25)]).verdict === 'inconclusive');

/* ---------- the fast-win decision on the matched pair ------------ */
const cleanNatA = { matched: true, pose: P(0.40, 0.40, 0.25), spoof: false };
const cleanNatB = { matched: true, pose: P(0.403, 0.401, 0.251), spoof: false };
const fwA = B.streamFastWinCheck(cleanNatA, cleanNatB);
check('(a) 2 matched frames, micro-shift, both spoof-clean: fast win honoured',
  fwA.ok === true && fwA.reason === 'fast-win' && fwA.liveness.verdict === 'natural');
const fwB = B.streamFastWinCheck(
  { matched: true, pose: P(0.40, 0.40, 0.25), spoof: false },
  { matched: true, pose: P(0.40, 0.40, 0.25), spoof: false });
check('(b) 2 matched frames with static poses: NO fast win (scan continues)',
  fwB.ok === false && fwB.reason === 'liveness-static');
check('(c) a flagged spoof sample on the FIRST frame blocks the fast win',
  B.streamFastWinCheck({ matched: true, pose: P(0.40, 0.40, 0.25), spoof: true }, cleanNatB).reason === 'spoof-not-clean');
check('(c) a flagged spoof sample on the SECOND frame blocks the fast win',
  B.streamFastWinCheck(cleanNatA, { matched: true, pose: P(0.403, 0.401, 0.251), spoof: true }).reason === 'spoof-not-clean');
check('(c) an UNEXAMINED frame (spoof null) is not clean and blocks the fast win',
  B.streamFastWinCheck({ matched: true, pose: P(0.40, 0.40, 0.25), spoof: null }, cleanNatB).reason === 'spoof-not-clean' &&
  B.streamFastWinCheck(cleanNatA, { matched: true, pose: P(0.403, 0.401, 0.251), spoof: null }).reason === 'spoof-not-clean');
check('FASTWIN an unmatched frame in the pair is not a fast win',
  B.streamFastWinCheck({ matched: false, pose: P(0.40, 0.40, 0.25), spoof: false }, cleanNatB).reason === 'pair-not-matched');
check('FASTWIN an erratic pair is not a fast win',
  B.streamFastWinCheck(cleanNatA, { matched: true, pose: P(0.75, 0.60, 0.25), spoof: false }).reason === 'liveness-erratic');
check('FASTWIN an inconclusive pair is not a fast win',
  B.streamFastWinCheck(cleanNatA, { matched: true, pose: P(0.4012, 0.401, 0.251), spoof: false }).reason === 'liveness-inconclusive');

/* ---------- composition: the app flow over the pure rules ---------
   Mirrors streamVerifyPalm.applyMatch: scores apply in capture
   order through streamMatchUpdate; when done first fires, the
   partner is the most recent matched record within two back, and
   streamFastWinCheck judges the pair. */
function runFlow(frames) {
  let st = { streak: 0, best: null };
  const applied = [];
  let outcome = { doneAt: null, fastOk: false, reason: null };
  frames.forEach(function (f, i) {
    st = B.streamMatchUpdate(st, f.score);
    const entry = {
      matched: typeof f.score === 'number' && f.score >= B.PALMPRINT_THRESHOLD,
      pose: f.pose, spoof: f.spoof
    };
    applied.push(entry);
    if (st.done && outcome.doneAt === null) {
      outcome.doneAt = i + 1;
      let partner = null;
      for (let k = applied.length - 2; k >= applied.length - 3 && k >= 0; k--) {
        if (applied[k].matched) { partner = applied[k]; break; }
      }
      const fw = partner ? B.streamFastWinCheck(partner, entry) : { ok: false, reason: 'no-partner' };
      outcome.fastOk = fw.ok; outcome.reason = fw.reason;
    }
  });
  return outcome;
}
const flowFast = runFlow([
  { score: 0.41, pose: P(0.40, 0.40, 0.25), spoof: false },
  { score: 0.38, pose: P(0.403, 0.401, 0.251), spoof: false }
]);
check('FLOW genuine pair completes the match at frame 2 AND fast-wins there',
  flowFast.doneAt === 2 && flowFast.fastOk === true, flowFast.reason);
const flowStatic = runFlow([
  { score: 0.41, pose: P(0.40, 0.40, 0.25), spoof: false },
  { score: 0.38, pose: P(0.40, 0.40, 0.25), spoof: false }
]);
check('FLOW a static pair still completes the MATCH (standard path may honour it) but earns no fast win',
  flowStatic.doneAt === 2 && flowStatic.fastOk === false && flowStatic.reason === 'liveness-static');
const flowWindow = runFlow([
  { score: 0.41, pose: P(0.40, 0.40, 0.25), spoof: false },
  { score: 0.20, pose: P(0.401, 0.40, 0.25), spoof: false },
  { score: 0.38, pose: P(0.403, 0.401, 0.251), spoof: false }
]);
check('FLOW rolling-window pair (frames 1 and 3) fast-wins on those two frames evidence',
  flowWindow.doneAt === 3 && flowWindow.fastOk === true, flowWindow.reason);
const flowFlagged = runFlow([
  { score: 0.41, pose: P(0.40, 0.40, 0.25), spoof: true },
  { score: 0.20, pose: P(0.401, 0.40, 0.25), spoof: false },
  { score: 0.38, pose: P(0.403, 0.401, 0.251), spoof: false }
]);
check('FLOW a flagged sample on the earlier matched frame blocks the fast win even in the window case',
  flowFlagged.doneAt === 3 && flowFlagged.fastOk === false && flowFlagged.reason === 'spoof-not-clean');
const flowImpostor = runFlow([
  { score: 0.10, pose: P(0.40, 0.40, 0.25), spoof: false },
  { score: 0.12, pose: P(0.403, 0.401, 0.251), spoof: false }
]);
check('FLOW an impostor pair never completes the match at all', flowImpostor.doneAt === null && flowImpostor.fastOk === false);

console.log(fail === 0 ? 'ALL FAST-WIN TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
