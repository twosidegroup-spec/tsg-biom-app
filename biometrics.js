/* TSG Biom - real biometric matching logic.
   Pure functions only: every score here is computed from real captured data.
   There is no random element in any function in this file.
   Works in the browser (window.TSGBiometrics) and in Node/Bun for testing.

   SECURITY POSTURE (hardened after false-accept reports, 2026-11-19):
   Fail closed everywhere. A verification can only pass when ALL of these
   hold: (a) the enrolled template is present and non-degenerate, (b) the
   live capture is present and non-degenerate, (c) the comparison passes
   the method's rule. Null, empty, zero, constant, NaN or mismatched data
   is DENIED, never verified. Fingerprint uses a BOTH-MUST-PASS rule
   (correlation AND texture independently), never an average that lets a
   strong texture score carry a weak template match. */
(function (global) {
  'use strict';

  var FACE_THRESHOLD = 0.6;       // Euclidean distance on 128-d face descriptor
  var FACE_MIN_NORM = 0.2;        // real face descriptors have norm ~0.5-1.5; near-zero = degenerate
  var PALM_THRESHOLD = 0.06;      // Euclidean distance on normalized hand-geometry descriptor.
                                  // Calibrated with synthetic tests (see tests/false-accept.test.js):
                                  // same hand, 5-frame averaged, landmark jitter up to 0.008 of frame
                                  // -> distance <= 0.035; smallest different-hand change tested
                                  // (palm 6% wider) -> 0.079; fingers +3% & spread 1.05 -> 0.23.
                                  // 0.06 sits between: ~1.7x margin over worst same-hand noise,
                                  // and every different-hand variant tested is above it.
  var FINGER_CORR_MIN = 0.55;     // template Pearson correlation must pass on its own
  var FINGER_TEXTURE_MIN = 0.60;  // LBP texture similarity must ALSO pass on its own
  var FINGER_THRESHOLD = FINGER_CORR_MIN; // legacy export: the headline finger threshold

  /* ---------------- shared sanity helpers ---------------- */

  function allFinite(arr) {
    for (var i = 0; i < arr.length; i++) {
      var v = Number(arr[i]);
      if (!isFinite(v) || isNaN(v)) return false;
    }
    return true;
  }
  function vecNorm(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) { var v = Number(arr[i]); s += v * v; }
    return Math.sqrt(s);
  }
  function vecStd(arr) {
    if (!arr || !arr.length) return 0;
    var m = 0, i;
    for (i = 0; i < arr.length; i++) m += Number(arr[i]);
    m /= arr.length;
    var s = 0;
    for (i = 0; i < arr.length; i++) { var d = Number(arr[i]) - m; s += d * d; }
    return Math.sqrt(s / arr.length);
  }

  /* A usable face descriptor: right shape, finite, and with real energy.
     A zero / near-zero / constant descriptor is degenerate - it would sit
     at distance ~0 from another degenerate descriptor and false-accept. */
  function faceDescriptorSane(d) {
    if (!d || d.length !== 128) return false;
    if (!allFinite(d)) return false;
    if (vecNorm(d) < FACE_MIN_NORM) return false;
    if (vecStd(d) < 0.005) return false; // constant vector carries no identity
    return true;
  }

  /* A usable palm geometry descriptor: 30 positive, plausible distances. */
  function palmDescriptorSane(d) {
    if (!d || d.length !== 30) return false;
    if (!allFinite(d)) return false;
    for (var i = 0; i < d.length; i++) {
      var v = Number(d[i]);
      if (v < 0.03 || v > 3.5) return false; // normalized hand distances live well inside this band
    }
    if (vecNorm(d) < 1) return false; // a real 30-measure hand descriptor has norm ~4-6
    return true;
  }

  /* A usable fingerprint record: non-flat template + a real texture
     histogram (sums to ~1, not concentrated in a single bin). */
  function fingerprintRecordSane(rec) {
    if (!rec || !rec.template || !rec.texture) return false;
    if (!rec.template.length || rec.template.length !== 96 * 96) return false;
    if (rec.texture.length !== 256) return false;
    if (!allFinite(rec.template) || !allFinite(rec.texture)) return false;
    if (vecStd(rec.template) < 5) return false; // flat/blank template
    var sum = 0, maxBin = 0;
    for (var i = 0; i < 256; i++) { var v = Number(rec.texture[i]); if (v < 0) return false; sum += v; if (v > maxBin) maxBin = v; }
    if (Math.abs(sum - 1) > 0.05) return false;
    if (maxBin > 0.95) return false; // single-bin histogram = uniform image, not a print
    return true;
  }

  function euclidean(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return null;
    var sum = 0;
    for (var i = 0; i < a.length; i++) {
      var d = Number(a[i]) - Number(b[i]);
      if (!isFinite(d)) return null;
      sum += d * d;
    }
    return Math.sqrt(sum);
  }

  /* ---------------- Face ---------------- */

  function verifyFace(storedDescriptor, liveDescriptor) {
    if (!faceDescriptorSane(storedDescriptor)) {
      return { ok: false, verified: false, distance: null, threshold: FACE_THRESHOLD, reason: 'No usable face enrolled for this person - the stored face data is missing or invalid.' };
    }
    if (!faceDescriptorSane(liveDescriptor)) {
      return { ok: false, verified: false, distance: null, threshold: FACE_THRESHOLD, reason: 'No real face was detected in this scan.' };
    }
    var distance = euclidean(storedDescriptor, liveDescriptor);
    if (distance === null || !isFinite(distance)) {
      return { ok: false, verified: false, distance: null, threshold: FACE_THRESHOLD, reason: 'Face comparison failed.' };
    }
    return {
      ok: true,
      verified: distance < FACE_THRESHOLD,
      distance: distance,
      threshold: FACE_THRESHOLD,
      reason: distance < FACE_THRESHOLD ? 'Face distance below threshold.' : 'Face distance above threshold - not the enrolled person.'
    };
  }

  /* ---------------- Palm ---------------- */

  /* Build a scale/translation-normalized hand-geometry descriptor from
     MediaPipe's 21 hand landmarks ([{x,y,z}, ...]).
     Returns null for degenerate or implausible detections: partial hands,
     collapsed/tiny landmark clusters, or geometry no real hand has - a
     descriptor is never built from those. */
  function palmDescriptorFromLandmarks(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    var i;
    for (i = 0; i < 21; i++) {
      var p = landmarks[i];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
    }
    // The hand must occupy a real fraction of the frame - a tiny cluster of
    // points is a false/partial detection, not a palm.
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    landmarks.forEach(function (pt) {
      if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
    });
    var bw = maxX - minX, bh = maxY - minY;
    if (bw < 0.12 || bh < 0.12 || bw * bh < 0.025) return null;

    var wrist = landmarks[0];
    var pts = landmarks.map(function (pt) {
      return { x: pt.x - wrist.x, y: pt.y - wrist.y };
    });
    var scale = Math.hypot(pts[9].x, pts[9].y); // wrist -> middle finger MCP
    if (!scale || scale < 0.10) return null; // hand too small / collapsed
    pts = pts.map(function (pt) { return { x: pt.x / scale, y: pt.y / scale }; });
    function dist(a, b) { return Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y); }

    // Human-plausible geometry: fingertip reach from the wrist, in units of
    // the wrist->middle-MCP scale. Outside these bands it is not a real
    // open hand (bent/partial/false detection) - reject, do not describe.
    var reach = [
      { tip: 4, min: 0.8, max: 2.3 },   // thumb
      { tip: 8, min: 1.6, max: 2.6 },   // index
      { tip: 12, min: 1.9, max: 2.9 },  // middle
      { tip: 16, min: 1.7, max: 2.7 },  // ring
      { tip: 20, min: 1.3, max: 2.3 }   // pinky
    ];
    for (i = 0; i < reach.length; i++) {
      var d = dist(0, reach[i].tip);
      if (!(d >= reach[i].min && d <= reach[i].max)) return null;
    }
    var knuckleSpan = dist(5, 17); // index MCP -> pinky MCP
    if (!(knuckleSpan >= 0.5 && knuckleSpan <= 1.5)) return null;
    // Every finger chain must have real segment lengths (no folded-to-zero joints).
    var chains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
    for (i = 0; i < chains.length; i++) {
      var ch = chains[i];
      for (var j = 0; j < ch.length - 1; j++) {
        if (dist(ch[j], ch[j + 1]) < 0.12) return null;
      }
    }

    var pairs = [
      [0, 5], [0, 9], [0, 13], [0, 17], [5, 9], [9, 13], [13, 17],
      [5, 8], [9, 12], [13, 16], [17, 20],
      [2, 4], [5, 6], [6, 8], [9, 10], [10, 12], [13, 14], [14, 16], [17, 18], [18, 20],
      [4, 8], [8, 12], [12, 16], [16, 20], [4, 20], [0, 4], [0, 8], [0, 12], [0, 16], [0, 20]
    ];
    var descriptor = pairs.map(function (pr) { return dist(pr[0], pr[1]); });
    return palmDescriptorSane(descriptor) ? descriptor : null;
  }

  function verifyPalm(storedDescriptor, liveDescriptor) {
    if (!palmDescriptorSane(storedDescriptor)) {
      return { ok: false, verified: false, distance: null, threshold: PALM_THRESHOLD, reason: 'No usable palm enrolled for this person - the stored palm data is missing or invalid.' };
    }
    if (!palmDescriptorSane(liveDescriptor)) {
      return { ok: false, verified: false, distance: null, threshold: PALM_THRESHOLD, reason: 'No real open palm was detected in this scan.' };
    }
    var distance = euclidean(storedDescriptor, liveDescriptor);
    if (distance === null || !isFinite(distance)) {
      return { ok: false, verified: false, distance: null, threshold: PALM_THRESHOLD, reason: 'Palm comparison failed.' };
    }
    return {
      ok: true,
      verified: distance < PALM_THRESHOLD,
      distance: distance,
      threshold: PALM_THRESHOLD,
      reason: distance < PALM_THRESHOLD ? 'Palm geometry distance below threshold.' : 'Palm geometry distance above threshold - not the enrolled hand.'
    };
  }

  /* ---------------- Palm strengthening (2026-11-20) ----------------
     Three layers added on top of the geometry match, after calibration
     probes (synthetic hands + synthetic palm images, 2026-11-20):

     1) MULTI-CAPTURE PROFILE. Enrollment stores up to 5 geometry captures
        of the same hand (slightly different angles). Verification takes
        the BEST (smallest) distance - angle variation at enrollment is
        the main cause of genuine palm rejections.

     2) TEXTURE REALNESS GATE. A global LBP histogram of the palm crop.
        Calibration was blunt: LBP similarity for the same palm re-rendered
        was 0.892 and for a DIFFERENT palm 0.895 - global LBP does NOT
        identify a palm, and grid LBP / coarse-template correlation did
        not separate either (same 0.44-0.60 vs different 0.50-0.76). So
        texture is never used as identity here. What it provably does:
        a flat / blank / uniform frame scores ~0.07 against a real palm
        texture, real palms score ~0.89. The gate floor (0.35) therefore
        rejects flat, blank and texture-less captures - a realness check,
        scored alongside geometry, exactly as labelled in the UI.

     3) MOVEMENT LIVENESS. A photograph or screen image of a palm cannot
        open and close. palmOpenness (mean wrist->tip / wrist->MCP ratio,
        index..pinky) measured on synthetic hands: open 2.08, fist 1.15.
        A passing scan must show a real open -> close -> open sequence.
        This is the primary anti-photo defence. */

  var PALM_TEXTURE_MIN = 0.35;    // realness floor - see calibration note above
  var PALM_OPEN_MIN = 1.65;       // openness at/above this = open hand (open synthetic: 2.08)
  var PALM_CLOSED_MAX = 1.55;     // openness at/below this = closed hand (fist synthetic: 1.15)
  var PALM_MOVE_MIN_RANGE = 0.35; // openness must swing at least this far during the scan
  var PALM_MOVE_MIN_SAMPLES = 6;  // and be observed over at least this many samples
  // Thresholds were loosened once, after the first real-phone test
  // (2026-11-20, "nothing is happening"): a real loose fist on real
  // MediaPipe landmarks does not curl as far as the synthetic fist, so
  // the closed/range bars were set too strict. The anti-photo margin is
  // untouched: a static image's openness range measures ~0.04, ten times
  // below the 0.35 swing still required.

  /* A usable palm texture: a real 256-bin LBP histogram (sums to ~1,
     not concentrated in one bin - a uniform image lands in one bin). */
  function palmTextureSane(t) {
    if (!t || t.length !== 256) return false;
    if (!allFinite(t)) return false;
    var sum = 0, maxBin = 0;
    for (var i = 0; i < 256; i++) {
      var v = Number(t[i]);
      if (v < 0) return false;
      sum += v; if (v > maxBin) maxBin = v;
    }
    if (Math.abs(sum - 1) > 0.05) return false;
    if (maxBin > 0.9) return false;
    if (vecStd(t) < 0.001) return false;
    return true;
  }

  /* A palm profile is either a legacy single geometry descriptor (plain
     array, pre-strengthening enrollments) or the strengthened record:
     { v: 2, geometry: [descriptor, ...], texture: [256] | null }. */
  function normalisePalmProfile(stored) {
    if (!stored) return null;
    if (Array.isArray(stored)) {
      return palmDescriptorSane(stored) ? { geometry: [stored], texture: null, legacy: true } : null;
    }
    if (typeof stored === 'object' && Array.isArray(stored.geometry)) {
      var geo = stored.geometry.filter(function (d) { return palmDescriptorSane(d); });
      if (!geo.length || geo.length !== stored.geometry.length) return null;
      if (stored.texture != null && !palmTextureSane(stored.texture)) return null;
      return { geometry: geo, texture: stored.texture || null, legacy: false };
    }
    return null;
  }

  function palmProfileSane(stored) { return normalisePalmProfile(stored) !== null; }

  /* Strengthened palm verification. Geometry is the identity check and
     uses the best of the enrolled captures; when a texture was enrolled,
     the live texture MUST be present and clear the realness floor -
     missing texture fails closed, it never silently skips the gate.
     Legacy enrollments (no texture) verify on geometry alone and say so. */
  function verifyPalmProfile(stored, live) {
    var fail = function (reason, distance, textureSimilarity) {
      return { ok: false, verified: false, distance: distance, threshold: PALM_THRESHOLD, textureSimilarity: textureSimilarity, textureThreshold: PALM_TEXTURE_MIN, reason: reason };
    };
    var profile = normalisePalmProfile(stored);
    if (!profile) return fail('No usable palm enrolled for this person - the stored palm data is missing or invalid.', null, null);
    if (!live || !palmDescriptorSane(live.geometry)) return fail('No real open palm was detected in this scan.', null, null);
    var best = null;
    for (var i = 0; i < profile.geometry.length; i++) {
      var d = euclidean(profile.geometry[i], live.geometry);
      if (d === null || !isFinite(d)) return fail('Palm comparison failed.', null, null);
      if (best === null || d < best) best = d;
    }
    var geometryOk = best < PALM_THRESHOLD;
    var textureSimilarity = null, textureOk = true;
    if (profile.texture) {
      if (!palmTextureSane(live.texture)) return fail('Palm texture was not captured in this scan - hold the palm steady in good light and scan again.', best, null);
      textureSimilarity = histogramSimilarity(profile.texture, live.texture);
      if (textureSimilarity === null || !isFinite(textureSimilarity)) return fail('Palm texture comparison failed.', best, null);
      textureOk = textureSimilarity >= PALM_TEXTURE_MIN;
    }
    var verified = geometryOk && textureOk;
    var reason;
    if (verified) reason = profile.texture ? 'Palm geometry matches the enrolled hand and the palm texture is real.' : 'Palm geometry matches the enrolled hand (legacy enrollment - no texture gate).';
    else if (!geometryOk) reason = 'Palm geometry distance above threshold - not the enrolled hand.';
    else reason = 'Palm texture does not look like a real palm capture - scan a real, open palm in good light.';
    return { ok: true, verified: verified, distance: best, threshold: PALM_THRESHOLD, textureSimilarity: textureSimilarity, textureThreshold: PALM_TEXTURE_MIN, reason: reason };
  }

  /* Openness of a hand from its 21 landmarks: mean over index..pinky of
     wrist->tip distance divided by wrist->MCP distance. Scale-free.
     Open synthetic hand: 2.08. Fist: 1.15. Returns null for bad input. */
  function palmOpenness(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    for (var i = 0; i < 21; i++) {
      var p = landmarks[i];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
    }
    function dist(a, b) { return Math.hypot(landmarks[a].x - landmarks[b].x, landmarks[a].y - landmarks[b].y); }
    if (dist(0, 9) < 0.02) return null; // collapsed / degenerate detection
    var fingers = [[8, 5], [12, 9], [16, 13], [20, 17]];
    var sum = 0;
    for (i = 0; i < fingers.length; i++) {
      var mcp = dist(0, fingers[i][1]);
      if (mcp < 0.01) return null;
      sum += dist(0, fingers[i][0]) / mcp;
    }
    var v = sum / fingers.length;
    return isFinite(v) ? v : null;
  }

  /* Movement liveness verdict over a time series of openness samples.
     Pass requires ALL of: enough samples, the hand was seen open, the
     hand was seen closed, the openness swung by at least the minimum
     range, and the hand ENDS open — judged on the end phase (any of
     the last 3 samples open), not the single final sample: on a real
     phone the last detection is often a soft/partial read while the
     hand settles (his 2026-11-20 v9 test failed exactly there, after
     a full open-close swing). A static image produces a near-constant
     series and still fails on range. */
  /* The liveness cycle: an open sample, then a closed sample, then an
     open sample again, in that order, anywhere inside the clip. This
     cycle rule replaced the v10 "final samples must read open" rule in
     v14 (2026-11-20): on a real phone the hand naturally relaxes or
     leaves the frame as the 4.5 s recording ends, which failed real
     users who had completed the movement — the end check alone failed
     the chairman's own enrolments on 2026-11-20 (v9 and v13 tests).
     A still photo still cannot pass: it shows neither the close nor
     the re-open. Fail-closed is unchanged. */
  function palmCycleCompleted(vals) {
    var seenOpen = false, seenClosedAfterOpen = false;
    for (var i = 0; i < vals.length; i++) {
      if (!seenOpen) { if (vals[i] >= PALM_OPEN_MIN) seenOpen = true; }
      else if (!seenClosedAfterOpen) { if (vals[i] <= PALM_CLOSED_MAX) seenClosedAfterOpen = true; }
      else if (vals[i] >= PALM_OPEN_MIN) return true;
    }
    return false;
  }
  function evaluatePalmMovement(samples) {
    var vals = (samples || []).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    var out = { ok: false, pass: false, samples: vals.length, min: null, max: null, last: null, range: null, reason: 'Not enough hand movement observed.' };
    if (vals.length < PALM_MOVE_MIN_SAMPLES) { out.reason = 'Movement check needs a few seconds of hand movement - open, close, then open your palm.'; return out; }
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), last = vals[vals.length - 1];
    out.min = min; out.max = max; out.last = last; out.range = max - min;
    if (max < PALM_OPEN_MIN) out.reason = 'Open your palm wide, fingers spread, so the camera can see it fully.';
    else if (min > PALM_CLOSED_MAX) out.reason = 'Now close your hand into a loose fist, then open it again - a still image cannot pass this check.';
    else if (out.range < PALM_MOVE_MIN_RANGE) out.reason = 'The open-close movement was too small - close fully into a loose fist, then open wide.';
    else if (!palmCycleCompleted(vals)) out.reason = 'After closing into a fist, open your palm wide again - the full open - close - open movement must complete inside the recording.';
    else { out.ok = true; out.pass = true; out.reason = 'Live hand movement confirmed (open - close - open).'; }
    return out;
  }

  /* ---- Clip frame selection (recorded palm clip path) ----
     A recorded palm clip is analysed frame by frame; each analysed
     frame yields { openness, descriptor, sharpness, texture } with any
     field possibly null. These selectors are the pure decision layer
     over that list. A frame counts as a usable open palm only when its
     openness is at/above PALM_OPEN_MIN AND its descriptor passed every
     plausibility gate - a fist frame or a garbage frame never counts,
     no matter how sharp it is. */
  function palmUsableOpenFrames(frames) {
    var out = [];
    (frames || []).forEach(function (f, i) {
      if (f && typeof f.openness === 'number' && isFinite(f.openness) && f.openness >= PALM_OPEN_MIN && palmDescriptorSane(f.descriptor)) {
        out.push({ index: i, openness: f.openness, descriptor: f.descriptor, sharpness: f.sharpness || 0, texture: f.texture || null });
      }
    });
    return out;
  }
  function averageDescriptorList(list) {
    if (!list.length) return null;
    if (list.length === 1) return list[0].slice();
    var out = [];
    for (var j = 0; j < list[0].length; j++) {
      var s = 0;
      list.forEach(function (d) { s += d[j]; });
      out.push(s / list.length);
    }
    return palmDescriptorSane(out) ? out : list[0].slice();
  }
  // Verification: one descriptor averaged (in descriptor space) from
  // the sharpest usable open frames, up to 3. Null when the clip holds
  // no usable open palm at all.
  function selectPalmDescriptor(frames) {
    var usable = palmUsableOpenFrames(frames);
    if (!usable.length) return null;
    usable.sort(function (a, b) { return b.sharpness - a.sharpness; });
    return averageDescriptorList(usable.slice(0, 3).map(function (u) { return u.descriptor; }));
  }
  // Enrolment: up to 3 descriptors spread across the clip - the
  // sharpest usable frame in each third of the usable sequence - so
  // the stored profile keeps natural pose variation, the same role the
  // old straight/tilt-left/tilt-right captures played.
  function selectPalmProfile(frames) {
    var usable = palmUsableOpenFrames(frames);
    if (!usable.length) return null;
    if (usable.length <= 3) return usable.map(function (u) { return u.descriptor; });
    var picks = [];
    for (var t = 0; t < 3; t++) {
      var bucket = usable.slice(Math.floor(t * usable.length / 3), Math.floor((t + 1) * usable.length / 3));
      bucket.sort(function (a, b) { return b.sharpness - a.sharpness; });
      if (bucket.length) picks.push(bucket[0].descriptor);
    }
    return picks.length ? picks : null;
  }

  /* ---------------- Palmprint — EDCC competitive code (v9, 2026-11-20) ----
     The geometry matcher above is kept for legacy (v2) enrolments only.
     New enrolments use a real palmprint method, ported from EDCC
     (Leosocy/EDCC-Palmprint-Recognition, MIT licence — the strongest
     licence-clean palmprint encoder found in the 2026-11-20 GitHub
     research; see ~/workspace/research_notes/github-palm-scan-best-20261120-0552/).

     Pipeline, the same shape every serious palmprint system uses:
       1. ROI: MediaPipe landmarks are used ONLY to locate the palm —
          a palm-centred square is perspective-warped out of the frame
          (palmRoiFromLandmarks). Landmarks carry no identity here.
       2. ENCODE (EDCC competitive coding, ported faithfully from the
          MIT reference; image_size 64 chosen over the 29 default -
          see PALMPRINT_SIZE):
          resize ROI to SIZE x SIZE, Gaussian blur, Laplacian enhancement,
          convolve with a fixed bank of 10 Gabor kernels (kmax = pi/2,
          sigma = 2pi, kernel 5x5); at each pixel the winning direction
          d (0..9) is stored plus one side bit s (which neighbouring
          direction responded stronger). One byte per pixel, 841 bytes.
       3. MATCH (EDCC comparer, exact): score = fraction of pixels whose
          packed (d, s) byte is identical. Our one extension, declared:
          the score is the best over +-1 px translations of the code
          grid, because a phone warp is never pixel-perfect.

     The enhancement stage (blur + Laplacian) is implemented with the
     standard separable 5-tap kernels; enrolment and verification always
     run this same code, so templates are self-consistent. Threshold is
     calibrated on synthetic palmprint probes (tests/palmprint.test.js)
     and MUST be recalibrated on real palms in the field test before
     any pilot sale — published EDCC numbers come from controlled
     datasets with pre-extracted ROIs. */

  var PALMPRINT_SIZE = 64;          // EDCC image_size. The reference implementation's default is 29;
                                    // 64 is a legitimate EncoderConfig choice and keeps far more print
                                    // detail from a 128px phone ROI - measured better separation below.
  var PALMPRINT_DIRECTIONS = 10;    // EDCC gabor_directions
  var PALMPRINT_KERNEL_SIZE = 5;    // EDCC gabor_kernel_size
  var PALMPRINT_CODE_LEN = PALMPRINT_SIZE * PALMPRINT_SIZE; // 4096 at size 64
  var PALMPRINT_ROI_SIZE = 128;     // canonical warped ROI side (px)
  var PALMPRINT_THRESHOLD = 0.36;   // Calibrated 2026-11-20 TWICE. (1) Synthetic probes
                                    // (tests/palmprint.test.js) through the product decision rule.
                                    // (2) REALISTIC-IMAGE calibration (tests/e2e, 5 photorealistic
                                    // palms, re-capture variants +-4px / +-8% brightness, product
                                    // rule = best of 3 enrolled x 2 live codes): at code size 29
                                    // genuine min 0.512 / impostor max 0.383 (margin 0.129); at 48:
                                    // 0.487 / 0.307 (0.180); at 64: 0.467 / 0.261 (0.206) - hence
                                    // size 64 and threshold 0.36 (~0.10 margin both sides). The
                                    // earlier 0.28 threshold FALSE-ACCEPTED a different palm in
                                    // the first end-to-end run (impostor scored 0.295 at size 29).
                                    // Still a small sample - the 20-person field test remains
                                    // the gate before any pilot sale.
  var PALMPRINT_MAX_DIR_SHARE = 0.80; // one direction may not dominate a real code

  /* --- small image helpers (array-like gray, row-major) --- */
  function reflect101(i, n) {
    if (n <= 1) return 0;
    while (i < 0 || i >= n) { if (i < 0) i = -i; if (i >= n) i = 2 * n - 2 - i; }
    return i;
  }
  function resizeGrayBilinear(gray, w, h, size) {
    var out = new Float64Array(size * size);
    var sx, sy, x0, y0, x1, y1, fx, fy;
    for (var y = 0; y < size; y++) {
      sy = (y + 0.5) * (h / size) - 0.5;
      y0 = Math.floor(sy); fy = sy - y0;
      y1 = y0 + 1;
      y0 = Math.max(0, Math.min(h - 1, y0)); y1 = Math.max(0, Math.min(h - 1, y1));
      for (var x = 0; x < size; x++) {
        sx = (x + 0.5) * (w / size) - 0.5;
        x0 = Math.floor(sx); fx = sx - x0;
        x1 = x0 + 1;
        x0 = Math.max(0, Math.min(w - 1, x0)); x1 = Math.max(0, Math.min(w - 1, x1));
        var top = gray[y0 * w + x0] * (1 - fx) + gray[y0 * w + x1] * fx;
        var bot = gray[y1 * w + x0] * (1 - fx) + gray[y1 * w + x1] * fx;
        out[y * size + x] = top * (1 - fy) + bot * fy;
      }
    }
    return out;
  }
  function convolveSeparable(gray, size, kx, ky) {
    var tmp = new Float64Array(size * size), out = new Float64Array(size * size);
    var half = Math.floor(kx.length / 2), x, y, i, s;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
      s = 0;
      for (i = -half; i <= half; i++) s += kx[i + half] * gray[y * size + reflect101(x + i, size)];
      tmp[y * size + x] = s;
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
      s = 0;
      for (i = -half; i <= half; i++) s += ky[i + half] * tmp[reflect101(y + i, size) * size + x];
      out[y * size + x] = s;
    }
    return out;
  }
  function convolve2d(gray, size, kernel, ksize) {
    var out = new Float64Array(size * size);
    var half = Math.floor(ksize / 2);
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var s = 0;
      for (var i = -half; i <= half; i++) for (var j = -half; j <= half; j++) {
        s += kernel[(i + half) * ksize + (j + half)] * gray[reflect101(y + i, size) * size + reflect101(x + j, size)];
      }
      out[y * size + x] = s;
    }
    return out;
  }

  /* EDCC Gabor kernel (real part), verbatim formula from gabor_filter.cpp:
     Kv = kmax / f^dimension with kmax = pi/2, dimension = 0 -> Kv = pi/2;
     sigma = 2*pi; kernel = Kv^2/sigma^2 * exp(-Kv^2 (i^2+j^2) / (2 sigma^2))
     * (cos(Kv cos(Qu) j + Kv sin(Qu) i) - exp(-sigma^2 / 2)), Qu = pi*d/10. */
  function gaborKernelReal(direction) {
    var size = PALMPRINT_KERNEL_SIZE, half = Math.floor(size / 2);
    var kmax = Math.PI / 2, sigma = 2 * Math.PI, sqsigma = sigma * sigma;
    var Kv = kmax;
    var Qu = Math.PI * direction / PALMPRINT_DIRECTIONS;
    var postmean = Math.exp(-sqsigma / 2);
    var kernel = new Float64Array(size * size);
    for (var i = -half; i <= half; i++) for (var j = -half; j <= half; j++) {
      var tmp1 = Math.exp(-(Kv * Kv * (i * i + j * j)) / (2 * sqsigma));
      var tmp2 = Math.cos(Kv * Math.cos(Qu) * j + Kv * Math.sin(Qu) * i) - postmean;
      kernel[(i + half) * size + (j + half)] = Kv * Kv * tmp1 * tmp2 / sqsigma;
    }
    return kernel;
  }
  var PALMPRINT_KERNELS = null;
  function palmprintKernels() {
    if (!PALMPRINT_KERNELS) {
      PALMPRINT_KERNELS = [];
      for (var d = 0; d < PALMPRINT_DIRECTIONS; d++) PALMPRINT_KERNELS.push(gaborKernelReal(d));
    }
    return PALMPRINT_KERNELS;
  }

  /* EDCC enhancement: Gaussian blur 5x5 (sigma 1.1, OpenCV's auto sigma
     for a 5-tap kernel), then a 5-tap Laplacian (separable Sobel form:
     smooth [1,4,6,4,1]/16 on one axis, second difference [1,-2,1] on
     the other, summed over both axes). */
  function palmprintEnhance(img29, size) {
    size = size || PALMPRINT_SIZE;
    var gw = [], norm = 0, k;
    for (k = 0; k < 5; k++) { var wgt = Math.exp(-((k - 2) * (k - 2)) / (2 * 1.1 * 1.1)); gw.push(wgt); norm += wgt; }
    for (k = 0; k < 5; k++) gw[k] /= norm;
    var blurred = convolveSeparable(img29, size, gw, gw);
    var smooth = [1, 4, 6, 4, 1].map(function (v) { return v / 16; });
    var d2 = [0, 1, -2, 1, 0];
    var lx = convolveSeparable(blurred, size, d2, smooth);
    var ly = convolveSeparable(blurred, size, smooth, d2);
    var out = new Float64Array(size * size);
    for (var i = 0; i < size * size; i++) out[i] = lx[i] + ly[i];
    return out;
  }

  /* Encode a grayscale palm ROI (any size) into an EDCC code:
     a Uint8Array of 841 packed bytes (direction | side << 4), or null
     when the input is unusable. The code is only a template — sanity
     (palmprintCodeSane) decides whether it carries real print detail. */
  function palmprintEncode(gray, w, h, size) {
    size = size || PALMPRINT_SIZE;
    if (!gray || !w || !h || gray.length < w * h) return null;
    var img = resizeGrayBilinear(gray, w, h, size);
    var enhanced = palmprintEnhance(img, size);
    var kernels = palmprintKernels();
    var responses = [];
    for (var d = 0; d < PALMPRINT_DIRECTIONS; d++) responses.push(convolve2d(enhanced, size, kernels[d], PALMPRINT_KERNEL_SIZE));
    var code = new Uint8Array(size * size);
    for (var p = 0; p < size * size; p++) {
      var best = 0, bestVal = -Infinity;
      for (d = 0; d < PALMPRINT_DIRECTIONS; d++) {
        var v = responses[d][p];
        if (v > bestVal) { bestVal = v; best = d; }
      }
      var sLeft = best === PALMPRINT_DIRECTIONS - 1 ? 0 : best + 1;
      var sRight = best === 0 ? PALMPRINT_DIRECTIONS - 1 : best - 1;
      var side = responses[sLeft][p] >= responses[sRight][p] ? 1 : 0;
      code[p] = best | (side << 4);
    }
    return code;
  }

  /* A usable palmprint code: right length, every byte a legal (d, s)
     pair, and real directional variety — a flat or blank capture
     collapses to one dominant direction and is rejected here. */
  function palmprintCodeSane(code, size) {
    var bytes = palmprintCodeBytes(code);
    var want = (size || PALMPRINT_SIZE) * (size || PALMPRINT_SIZE);
    if (!bytes || bytes.length !== want) return false;
    var counts = new Array(PALMPRINT_DIRECTIONS).fill(0);
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if ((b & 0x0F) >= PALMPRINT_DIRECTIONS) return false;
      if ((b & 0xF0) !== 0 && (b & 0xF0) !== 0x10) return false;
      counts[b & 0x0F]++;
    }
    var distinct = 0, maxShare = 0;
    for (i = 0; i < PALMPRINT_DIRECTIONS; i++) {
      if (counts[i] > 0) distinct++;
      if (counts[i] / bytes.length > maxShare) maxShare = counts[i] / bytes.length;
    }
    if (distinct < 5) return false;
    if (maxShare > PALMPRINT_MAX_DIR_SHARE) return false;
    return true;
  }

  /* Codes travel as base64 strings inside stored profiles. */
  function palmprintCodeBytes(code) {
    if (!code) return null;
    if (typeof code === 'string') return palmprintCodeFromBase64(code);
    var n = code.length, root = Math.round(Math.sqrt(n));
    if (n >= PALMPRINT_CODE_LEN && root * root === n) {
      var out = new Uint8Array(n);
      for (var i = 0; i < n; i++) { var v = Number(code[i]); if (!isFinite(v) || v < 0 || v > 255) return null; out[i] = v; }
      return out;
    }
    return null;
  }
  function palmprintCodeToBase64(code) {
    var bytes = palmprintCodeBytes(code);
    if (!bytes) return null;
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(s) : null;
  }
  function palmprintCodeFromBase64(str) {
    if (typeof str !== 'string' || !str.length) return null;
    try {
      var bytes;
      if (typeof Buffer !== 'undefined') bytes = new Uint8Array(Buffer.from(str, 'base64'));
      else if (typeof atob === 'function') {
        var bin = atob(str);
        bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else return null;
      return bytes.length === PALMPRINT_CODE_LEN ? bytes : null;
    } catch (e) { return null; }
  }

  /* EDCC comparer, exact: score = (# pixels with identical packed
     byte) / len, computed here at a code-grid translation (dx, dy)
     over the overlapping region only. */
  function edccScoreAtShift(a, b, dx, dy, size) {
    size = size || PALMPRINT_SIZE;
    var matches = 0, count = 0;
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var bx = x + dx, by = y + dy;
      if (bx < 0 || bx >= size || by < 0 || by >= size) continue;
      count++;
      if (a[y * size + x] === b[by * size + bx]) matches++;
    }
    return count ? matches / count : null;
  }
  /* Palmprint similarity: EDCC score, best over +-1 px translations. */
  function palmprintSimilarity(a, b, size) {
    var ba = palmprintCodeBytes(a), bb = palmprintCodeBytes(b);
    if (!palmprintCodeSane(ba, size) || !palmprintCodeSane(bb, size)) return null;
    var best = null;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var s = edccScoreAtShift(ba, bb, dx, dy, size);
      if (s !== null && (best === null || s > best)) best = s;
    }
    return best;
  }

  /* --- Palm ROI extraction: landmarks locate, they do not identify ---
     Palm frame built in PIXEL space (landmark coords are per-axis
     normalised, so geometry must be computed after scaling): u runs
     along the knuckle line (index MCP -> pinky MCP), v runs from the
     knuckles toward the wrist. The ROI square has side 1.7 x knuckle
     span, centred 0.42 side-lengths toward the wrist from the knuckle
     line — the central palm, where the principal print lines live. */
  function palmRoiCornersPx(w, h, landmarks) {
    if (!landmarks || landmarks.length !== 21 || !w || !h) return null;
    var pts = [];
    for (var i = 0; i < 21; i++) {
      var p = landmarks[i];
      if (!p || !isFinite(Number(p.x)) || !isFinite(Number(p.y))) return null;
      pts.push({ x: Number(p.x) * w, y: Number(p.y) * h });
    }
    var A = pts[5], Bp = pts[17], W = pts[0];
    var mx = (A.x + Bp.x) / 2, my = (A.y + Bp.y) / 2;
    var ux = Bp.x - A.x, uy = Bp.y - A.y;
    var span = Math.hypot(ux, uy);
    if (!(span >= 0.10 * Math.min(w, h))) return null; // hand too small / partial
    ux /= span; uy /= span;
    var vx = -uy, vy = ux;
    if ((W.x - mx) * vx + (W.y - my) * vy < 0) { vx = -vx; vy = -vy; }
    var side = 1.7 * span;
    var cx = mx + vx * 0.42 * side, cy = my + vy * 0.42 * side;
    var hs = side / 2;
    return [
      { x: cx - ux * hs - vx * hs, y: cy - uy * hs - vy * hs },
      { x: cx + ux * hs - vx * hs, y: cy + uy * hs - vy * hs },
      { x: cx + ux * hs + vx * hs, y: cy + uy * hs + vy * hs },
      { x: cx - ux * hs + vx * hs, y: cy - uy * hs + vy * hs }
    ];
  }
  function homographyFromQuad(corners) {
    // Maps the unit square (0,0),(1,0),(1,1),(0,1) onto corners TL,TR,BR,BL.
    var x0 = corners[0].x, y0 = corners[0].y, x1 = corners[1].x, y1 = corners[1].y;
    var x2 = corners[2].x, y2 = corners[2].y, x3 = corners[3].x, y3 = corners[3].y;
    var sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    var dx1 = x1 - x2, dy1 = y1 - y2, dx2 = x3 - x2, dy2 = y3 - y2;
    var det = dx1 * dy2 - dx2 * dy1;
    if (!det || !isFinite(det)) return null;
    var g = (sx * dy2 - dx2 * sy) / det, hh = (dx1 * sy - sx * dy1) / det;
    return {
      a: x1 - x0 + g * x1, b: x3 - x0 + hh * x3, c: x0,
      d: y1 - y0 + g * y1, e: y3 - y0 + hh * y3, f: y0,
      g: g, h: hh
    };
  }
  /* Warp the palm square out of a grayscale frame. Returns a
     PALMPRINT_ROI_SIZE square (plain Array of gray values) or null. */
  function palmRoiFromLandmarks(gray, w, h, landmarks, outSize) {
    if (!gray || gray.length < w * h) return null;
    var size = outSize || PALMPRINT_ROI_SIZE;
    var corners = palmRoiCornersPx(w, h, landmarks);
    if (!corners) return null;
    var H = homographyFromQuad(corners);
    if (!H) return null;
    var out = new Array(size * size);
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      var u = x / (size - 1), v = y / (size - 1);
      var den = H.g * u + H.h * v + 1;
      var sx = (H.a * u + H.b * v + H.c) / den;
      var sy = (H.d * u + H.e * v + H.f) / den;
      sx = Math.max(0, Math.min(w - 1, sx)); sy = Math.max(0, Math.min(h - 1, sy));
      var x0 = Math.floor(sx), y0 = Math.floor(sy);
      var x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      var fx = sx - x0, fy = sy - y0;
      var top = gray[y0 * w + x0] * (1 - fx) + gray[y0 * w + x1] * fx;
      var bot = gray[y1 * w + x0] * (1 - fx) + gray[y1 * w + x1] * fx;
      out[y * size + x] = top * (1 - fy) + bot * fy;
    }
    return out;
  }

  /* --- Palmprint profile (v3) + clip selection --- */
  function normalisePalmprintProfile(stored) {
    if (!stored || typeof stored !== 'object' || stored.v !== 3 || !Array.isArray(stored.codes)) return null;
    var codes = [];
    for (var i = 0; i < stored.codes.length; i++) {
      var bytes = palmprintCodeBytes(stored.codes[i]);
      if (!bytes || !palmprintCodeSane(bytes)) return null;
      codes.push(bytes);
    }
    if (codes.length < 2) return null; // enrolment keeps 3; fewer than 2 sane codes is not a profile
    return { codes: codes };
  }
  function palmprintProfileSane(stored) { return normalisePalmprintProfile(stored) !== null; }

  /* Verify a live palmprint against a v3 profile: the best EDCC
     similarity over every (enrolled code x live code) pair must clear
     the threshold. Fail closed on any missing or degenerate data. */
  function verifyPalmprintProfile(stored, liveCodes) {
    var fail = function (reason, similarity) {
      return { ok: false, verified: false, similarity: similarity, threshold: PALMPRINT_THRESHOLD, reason: reason };
    };
    var profile = normalisePalmprintProfile(stored);
    if (!profile) return fail('No usable palmprint enrolled for this person - the stored palmprint data is missing or invalid.', null);
    var live = [];
    (liveCodes || []).forEach(function (c) { var b = palmprintCodeBytes(c); if (b && palmprintCodeSane(b)) live.push(b); });
    if (!live.length) return fail('No real open palm with readable print detail was detected in this scan.', null);
    var best = null;
    for (var i = 0; i < profile.codes.length; i++) for (var j = 0; j < live.length; j++) {
      var s = palmprintSimilarity(profile.codes[i], live[j]);
      if (s === null || !isFinite(s)) return fail('Palmprint comparison failed.', null);
      if (best === null || s > best) best = s;
    }
    var verified = best >= PALMPRINT_THRESHOLD;
    return {
      ok: true, verified: verified, similarity: best, threshold: PALMPRINT_THRESHOLD,
      reason: verified ? 'Palmprint code matches the enrolled palm.' : 'Palmprint similarity below threshold - not the enrolled palm.'
    };
  }

  /* Clip frames for the palmprint path carry { openness, code,
     sharpness }. A frame counts only when the hand is open AND its
     code carries real print detail. */
  function palmprintUsableOpenFrames(frames) {
    var out = [];
    (frames || []).forEach(function (f, i) {
      if (f && typeof f.openness === 'number' && isFinite(f.openness) && f.openness >= PALM_OPEN_MIN && palmprintCodeSane(f.code)) {
        out.push({ index: i, openness: f.openness, code: palmprintCodeBytes(f.code), sharpness: f.sharpness || 0 });
      }
    });
    return out;
  }
  // Enrolment: up to 3 codes, sharpest usable frame in each third of
  // the clip (natural pose variation), returned as base64 strings.
  function selectPalmprintProfileCodes(frames) {
    var usable = palmprintUsableOpenFrames(frames);
    if (usable.length < 2) return null;
    var picks = [];
    if (usable.length <= 3) picks = usable.slice();
    else {
      for (var t = 0; t < 3; t++) {
        var bucket = usable.slice(Math.floor(t * usable.length / 3), Math.floor((t + 1) * usable.length / 3));
        bucket.sort(function (a, b) { return b.sharpness - a.sharpness; });
        if (bucket.length) picks.push(bucket[0]);
      }
    }
    if (picks.length < 2) return null;
    var out = picks.map(function (u) { return palmprintCodeToBase64(u.code); });
    return out.indexOf(null) >= 0 ? null : out;
  }
  // Verification: the 2 sharpest usable live codes.
  function selectPalmprintLiveCodes(frames) {
    var usable = palmprintUsableOpenFrames(frames);
    if (!usable.length) return null;
    usable.sort(function (a, b) { return b.sharpness - a.sharpness; });
    // Top 3 live codes (was 2): the 2026-11-20 E2E battery showed genuine
    // scores swinging 0.354-0.699 across runs of the same palm when only
    // 1-2 usable open frames survived a clip; a third live code steadies
    // the genuine best-match. Impostor separation re-verified on the same
    // battery before this shipped (v13).
    return usable.slice(0, 3).map(function (u) { return u.code; });
  }

  /* ---- Fingerprint through camera: image processing on real pixels ---- */

  // gray: array of 0..255, width w, height h (row-major)
  function laplacianVariance(gray, w, h) {
    if (!gray || gray.length < w * h || w < 3 || h < 3) return 0;
    var values = [];
    var mean = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
        values.push(lap);
        mean += lap;
      }
    }
    if (!values.length) return 0;
    mean /= values.length;
    var variance = 0;
    for (var j = 0; j < values.length; j++) variance += (values[j] - mean) * (values[j] - mean);
    return variance / values.length;
  }

  function contrastStretch(gray) {
    var min = 255, max = 0, i, v;
    for (i = 0; i < gray.length; i++) { v = gray[i]; if (v < min) min = v; if (v > max) max = v; }
    var range = max - min;
    var out = new Array(gray.length);
    if (range < 1) { for (i = 0; i < gray.length; i++) out[i] = gray[i]; return out; }
    for (i = 0; i < gray.length; i++) out[i] = Math.round(((gray[i] - min) / range) * 255);
    return out;
  }

  function sharpen(gray, w, h) {
    var out = gray.slice();
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var v = 5 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
        out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    return out;
  }

  // Adaptive threshold using a downscaled local-mean approximation (box blur radius r).
  function adaptiveThreshold(gray, w, h, radius, offset) {
    radius = radius || 8; offset = offset || 12;
    var blurred = boxBlur(gray, w, h, radius);
    var out = new Array(gray.length);
    for (var i = 0; i < gray.length; i++) out[i] = gray[i] < blurred[i] - offset ? 0 : 255;
    return out;
  }

  function boxBlur(gray, w, h, r) {
    var out = new Array(gray.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var sum = 0, count = 0;
        for (var dy = -r; dy <= r; dy += Math.max(1, Math.floor(r / 2))) {
          for (var dx = -r; dx <= r; dx += Math.max(1, Math.floor(r / 2))) {
            var xx = x + dx, yy = y + dy;
            if (xx >= 0 && xx < w && yy >= 0 && yy < h) { sum += gray[yy * w + xx]; count++; }
          }
        }
        out[y * w + x] = sum / count;
      }
    }
    return out;
  }

  function downscaleTemplate(gray, w, h, size) {
    size = size || 96;
    var out = new Array(size * size);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var sx = Math.min(w - 1, Math.floor((x / size) * w));
        var sy = Math.min(h - 1, Math.floor((y / size) * h));
        out[y * size + x] = gray[sy * w + sx];
      }
    }
    return out;
  }

  // Local Binary Pattern histogram (256 bins, normalized) - a real texture descriptor.
  function lbpHistogram(gray, w, h) {
    var hist = new Array(256).fill(0);
    var count = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x, c = gray[i], code = 0;
        if (gray[i - w - 1] >= c) code |= 1;
        if (gray[i - w] >= c) code |= 2;
        if (gray[i - w + 1] >= c) code |= 4;
        if (gray[i + 1] >= c) code |= 8;
        if (gray[i + w + 1] >= c) code |= 16;
        if (gray[i + w] >= c) code |= 32;
        if (gray[i + w - 1] >= c) code |= 64;
        if (gray[i - 1] >= c) code |= 128;
        hist[code]++; count++;
      }
    }
    if (count) for (var j = 0; j < 256; j++) hist[j] /= count;
    return hist;
  }

  function imageStats(gray) {
    var mean = 0, i;
    for (i = 0; i < gray.length; i++) mean += Number(gray[i]);
    mean /= gray.length;
    return { mean: mean, std: vecStd(gray) };
  }

  /* Quality gate. IMPORTANT: `gray` must be the ORIGINAL camera grayscale,
     never a contrast-stretched copy - stretching amplifies sensor noise in
     dark/blank frames until it looks "sharp" (that was a false-accept
     hole: a covered camera in a dark room passed the old gate).
     Hard floors, all must pass:
       - brightness mean inside [12, 245] (not a black/white-out frame)
       - pixel std-dev >= 12 (a near-uniform frame has no print on it)
       - Laplacian sharpness >= 30 on the original pixels
       - binarized ridge density inside [0.15, 0.65]                     */
  function fingerprintQuality(gray, w, h, ridgeImage) {
    var stats = imageStats(gray);
    var sharpness = laplacianVariance(gray, w, h);
    var ridgeDensity = 0;
    if (ridgeImage && ridgeImage.length) {
      var dark = 0;
      for (var i = 0; i < ridgeImage.length; i++) if (ridgeImage[i] === 0) dark++;
      ridgeDensity = dark / ridgeImage.length;
    }
    var ridgeOk = ridgeDensity > 0.15 && ridgeDensity < 0.65;
    var sharpOk = sharpness >= 30;
    var stdOk = stats.std >= 12;
    var brightOk = stats.mean >= 12 && stats.mean <= 245;
    var ok = sharpOk && ridgeOk && stdOk && brightOk;
    var reason = 'Ridge quality accepted.';
    if (!brightOk) reason = 'Frame is almost completely dark or blown out - add light and keep the fingertip 5-8 cm away.';
    else if (!stdOk) reason = 'Frame is nearly uniform - no fingertip texture in view. Put the fingertip inside the guide, facing the camera.';
    else if (!sharpOk) reason = 'Image too blurry - keep the fingertip still, move closer (5-8 cm) and add light.';
    else if (!ridgeOk) reason = 'No clear ridge texture found - the fingertip must fill the guide, facing the camera.';
    return {
      sharpness: sharpness,
      ridgeDensity: ridgeDensity,
      stdDev: stats.std,
      meanBrightness: stats.mean,
      ok: ok,
      reason: reason
    };
  }

  function pearsonCorrelation(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return null;
    var ma = 0, mb = 0, i;
    for (i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    ma /= a.length; mb /= b.length;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < a.length; i++) {
      var xa = a[i] - ma, xb = b[i] - mb;
      num += xa * xb; da += xa * xa; db += xb * xb;
    }
    if (da === 0 || db === 0) return 0; // a flat/blank template correlates with nothing
    return num / Math.sqrt(da * db);
  }

  function histogramSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    var inter = 0, total = 0;
    for (var i = 0; i < a.length; i++) { inter += Math.min(a[i], b[i]); total += Math.max(a[i], b[i]); }
    return total === 0 ? 0 : inter / total;
  }

  /* BOTH-MUST-PASS: the template correlation must clear FINGER_CORR_MIN
     AND the texture similarity must clear FINGER_TEXTURE_MIN, each on its
     own. (The old weighted average let a high texture similarity - which
     unrelated fingerprints and even noise frames share - carry a weak
     template match over the line.) */
  function verifyFingerprint(stored, live) {
    var fail = function (reason, correlation, textureSimilarity) {
      return { ok: false, verified: false, correlation: correlation, textureSimilarity: textureSimilarity, score: correlation, threshold: FINGER_CORR_MIN, textureThreshold: FINGER_TEXTURE_MIN, reason: reason };
    };
    if (!fingerprintRecordSane(stored)) return fail('No usable fingerprint enrolled for this person - the stored print data is missing or invalid.', null, null);
    if (!fingerprintRecordSane(live)) return fail('The captured print is missing or invalid - no real fingerprint was captured.', null, null);
    var correlation = pearsonCorrelation(stored.template, live.template);
    var textureSimilarity = histogramSimilarity(stored.texture, live.texture);
    if (correlation === null || textureSimilarity === null || !isFinite(correlation) || !isFinite(textureSimilarity)) {
      return fail('Fingerprint comparison failed.', correlation, textureSimilarity);
    }
    var corrOk = correlation >= FINGER_CORR_MIN;
    var texOk = textureSimilarity >= FINGER_TEXTURE_MIN;
    var verified = corrOk && texOk;
    return {
      ok: true,
      verified: verified,
      correlation: correlation,
      textureSimilarity: textureSimilarity,
      score: correlation,
      threshold: FINGER_CORR_MIN,
      textureThreshold: FINGER_TEXTURE_MIN,
      reason: verified ? 'Fingerprint correlation and texture both pass.'
        : !corrOk ? 'Fingerprint template correlation too low - not the enrolled finger.'
        : 'Fingerprint texture does not match the enrolled finger.'
    };
  }

  /* ---- Wallet helpers (bKash / Nagad) ---- */
  function normaliseWalletNumber(raw) {
    if (!raw) return null;
    var digits = String(raw).replace(/[^\d]/g, '');
    if (digits.indexOf('880') === 0) digits = '0' + digits.slice(3);
    else if (digits.indexOf('88') === 0 && digits.length === 13) digits = '0' + digits.slice(2);
    if (!/^01\d{9}$/.test(digits)) return null;
    return digits;
  }

  function maskWalletNumber(normalised) {
    if (!normalised || normalised.length !== 11) return '';
    return normalised.slice(0, 5) + '-***' + normalised.slice(8);
  }

  var api = {
    FACE_THRESHOLD: FACE_THRESHOLD,
    FACE_MIN_NORM: FACE_MIN_NORM,
    PALM_THRESHOLD: PALM_THRESHOLD,
    FINGER_THRESHOLD: FINGER_THRESHOLD,
    FINGER_CORR_MIN: FINGER_CORR_MIN,
    FINGER_TEXTURE_MIN: FINGER_TEXTURE_MIN,
    euclidean: euclidean,
    faceDescriptorSane: faceDescriptorSane,
    palmDescriptorSane: palmDescriptorSane,
    fingerprintRecordSane: fingerprintRecordSane,
    verifyFace: verifyFace,
    palmDescriptorFromLandmarks: palmDescriptorFromLandmarks,
    verifyPalm: verifyPalm,
    PALM_TEXTURE_MIN: PALM_TEXTURE_MIN,
    PALM_OPEN_MIN: PALM_OPEN_MIN,
    PALM_CLOSED_MAX: PALM_CLOSED_MAX,
    PALM_MOVE_MIN_RANGE: PALM_MOVE_MIN_RANGE,
    palmTextureSane: palmTextureSane,
    palmProfileSane: palmProfileSane,
    verifyPalmProfile: verifyPalmProfile,
    palmOpenness: palmOpenness,
    evaluatePalmMovement: evaluatePalmMovement,
    palmUsableOpenFrames: palmUsableOpenFrames,
    selectPalmDescriptor: selectPalmDescriptor,
    selectPalmProfile: selectPalmProfile,
    PALMPRINT_THRESHOLD: PALMPRINT_THRESHOLD,
    PALMPRINT_ROI_SIZE: PALMPRINT_ROI_SIZE,
    palmprintEncode: palmprintEncode,
    palmprintCodeSane: palmprintCodeSane,
    palmprintSimilarity: palmprintSimilarity,
    palmRoiFromLandmarks: palmRoiFromLandmarks,
    palmprintProfileSane: palmprintProfileSane,
    verifyPalmprintProfile: verifyPalmprintProfile,
    palmprintUsableOpenFrames: palmprintUsableOpenFrames,
    selectPalmprintProfileCodes: selectPalmprintProfileCodes,
    selectPalmprintLiveCodes: selectPalmprintLiveCodes,
    laplacianVariance: laplacianVariance,
    contrastStretch: contrastStretch,
    sharpen: sharpen,
    adaptiveThreshold: adaptiveThreshold,
    downscaleTemplate: downscaleTemplate,
    lbpHistogram: lbpHistogram,
    imageStats: imageStats,
    fingerprintQuality: fingerprintQuality,
    pearsonCorrelation: pearsonCorrelation,
    histogramSimilarity: histogramSimilarity,
    verifyFingerprint: verifyFingerprint,
    normaliseWalletNumber: normaliseWalletNumber,
    maskWalletNumber: maskWalletNumber
  };

  global.TSGBiometrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
