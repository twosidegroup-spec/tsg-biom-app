/* TSG Biom — v22 streaming enrolment sequence judge tests.
   The burst-chain enrolment accumulates measures across bursts
   separated by analysis time, and the user performs each stage only
   after the prompt changes. The clip judge's 3.5 s total window made
   that impossible (one burst alone records 12 measures; the window
   allows ~14 end to end), so enrolment stalled silently on a real
   phone. The streaming judge keeps stages-in-order + a per-stage
   recorded-frame budget. These tests pin both the fix and the
   properties that must NOT weaken. */
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const SEQ = {};
B.PALM_SEQUENCES.forEach(function (s) { SEQ[s.id] = s; });
function M(openness, spread, tilt) { return { openness: openness, spread: (spread === undefined ? 1.1 : spread), tilt: (tilt === undefined ? 2 : tilt) }; }
function fill(n, m) { const a = []; for (let i = 0; i < n; i++) a.push(m); return a; }

/* The regression case: a prompt-following human across three bursts.
   Open met at index 3, close at 15, open again at 27 - each stage
   promptly after its prompt, but the total span (24 measures = 6 s of
   recorded frames) exceeds the clip window. */
const human = [].concat(fill(3, M(1.9)), [M(2.0)], fill(11, M(1.9)), [M(1.2)], fill(11, M(1.9)), [M(2.05)], fill(4, M(1.9)));
check('STREAM prompt-following human across bursts passes', B.evaluateMovementSequenceStreaming(human, SEQ['open-close-open']).pass === true);
check('STREAM the same input fails the clip window (the v21 stall)', B.evaluateMovementSequence(human, SEQ['open-close-open'], 250).pass === false);

/* Order still matters. */
check('STREAM wrong order fails', B.evaluateMovementSequenceStreaming([M(1.2), M(2.0), M(2.0), M(2.0)], SEQ['open-close-open']).pass === false);
check('STREAM stage never met fails', B.evaluateMovementSequenceStreaming(fill(30, M(2.0)), SEQ['open-close-open']).pass === false);
check('STREAM too few measures fails', B.evaluateMovementSequenceStreaming([M(2.0), M(1.2)], SEQ['open-close-open']).pass === false);

/* Per-stage budget: a stage arriving more than 40 recorded measures
   after the previous stage is too slow, even in order. */
const slow = [].concat([M(2.0)], fill(48, M(1.9)), [M(1.2)], fill(3, M(1.9)), [M(2.0)]);
const slowR = B.evaluateMovementSequenceStreaming(slow, SEQ['open-close-open']);
check('STREAM stage beyond the per-stage budget fails', slowR.pass === false && /too slowly/.test(slowR.reason), slowR.reason);

/* Every issued sequence passes with prompt-following spacing. */
function spaced(stages) {
  const poseFor = { open: M(2.0), close: M(1.2), spread: M(2.0, 1.35), tilt: M(1.9, 1.1, 31), curl: M(1.75) };
  let ms = fill(2, M(1.9));
  stages.forEach(function (s) { ms = ms.concat(fill(9, M(1.9)), [poseFor[s]]); });
  return ms;
}
Object.keys(SEQ).forEach(function (id) {
  check('STREAM sequence ' + id + ' passes at human pace', B.evaluateMovementSequenceStreaming(spaced(SEQ[id].stages), SEQ[id]).pass === true);
});

/* A frozen replay of one pose can never complete a sequence. */
check('STREAM a held fist (photo-like) never passes', B.evaluateMovementSequenceStreaming(fill(60, M(1.2)), SEQ['open-close-open']).pass === false);
check('STREAM a held open palm never passes', B.evaluateMovementSequenceStreaming(fill(60, M(2.05)), SEQ['open-tilt-open']).pass === false);

console.log('streaming-sequence tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
