/* TSG Biom - real biometric matching logic.
   Pure functions only: every score here is computed from real captured data.
   There is no random element in any function in this file.
   Works in the browser (window.TSGBiometrics) and in Node/Bun for testing. */
(function (global) {
  'use strict';

  var FACE_THRESHOLD = 0.6;      // Euclidean distance on 128-d face descriptor
  var PALM_THRESHOLD = 0.18;     // Euclidean distance on normalized hand-geometry descriptor
  var FINGER_THRESHOLD = 0.55;   // Combined template correlation + texture similarity

  function euclidean(a, b) {
    if (!a || !b || a.length !== b.length || a.length === 0) return null;
    var sum = 0;
    for (var i = 0; i < a.length; i++) {
      var d = Number(a[i]) - Number(b[i]);
      sum += d * d;
    }
    return Math.sqrt(sum);
  }

  function verifyFace(storedDescriptor, liveDescriptor) {
    if (!storedDescriptor || !liveDescriptor) {
      return { ok: false, verified: false, distance: null, threshold: FACE_THRESHOLD, reason: 'Missing face descriptor - no real face was detected.' };
    }
    var distance = euclidean(storedDescriptor, liveDescriptor);
    if (distance === null) {
      return { ok: false, verified: false, distance: null, threshold: FACE_THRESHOLD, reason: 'Descriptor size mismatch.' };
    }
    return {
      ok: true,
      verified: distance < FACE_THRESHOLD,
      distance: distance,
      threshold: FACE_THRESHOLD,
      reason: distance < FACE_THRESHOLD ? 'Face distance below threshold.' : 'Face distance above threshold - not the enrolled person.'
    };
  }

  /* Build a scale/translation-normalized hand-geometry descriptor from
     MediaPipe's 21 hand landmarks ([{x,y,z}, ...]). */
  function palmDescriptorFromLandmarks(landmarks) {
    if (!landmarks || landmarks.length !== 21) return null;
    var wrist = landmarks[0];
    var pts = landmarks.map(function (p) {
      return { x: p.x - wrist.x, y: p.y - wrist.y };
    });
    var scale = Math.hypot(pts[9].x, pts[9].y); // wrist -> middle finger MCP
    if (!scale || scale < 1e-6) return null;
    pts = pts.map(function (p) { return { x: p.x / scale, y: p.y / scale }; });
    function dist(i, j) { return Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y); }
    var pairs = [
      [0, 5], [0, 9], [0, 13], [0, 17], [5, 9], [9, 13], [13, 17],
      [5, 8], [9, 12], [13, 16], [17, 20],
      [2, 4], [5, 6], [6, 8], [9, 10], [10, 12], [13, 14], [14, 16], [17, 18], [18, 20],
      [4, 8], [8, 12], [12, 16], [16, 20], [4, 20], [0, 4], [0, 8], [0, 12], [0, 16], [0, 20]
    ];
    return pairs.map(function (pr) { return dist(pr[0], pr[1]); });
  }

  function verifyPalm(storedDescriptor, liveDescriptor) {
    if (!storedDescriptor || !liveDescriptor) {
      return { ok: false, verified: false, distance: null, threshold: PALM_THRESHOLD, reason: 'Missing palm descriptor - no real hand was detected.' };
    }
    var distance = euclidean(storedDescriptor, liveDescriptor);
    if (distance === null) {
      return { ok: false, verified: false, distance: null, threshold: PALM_THRESHOLD, reason: 'Descriptor size mismatch.' };
    }
    return {
      ok: true,
      verified: distance < PALM_THRESHOLD,
      distance: distance,
      threshold: PALM_THRESHOLD,
      reason: distance < PALM_THRESHOLD ? 'Palm geometry distance below threshold.' : 'Palm geometry distance above threshold - not the enrolled hand.'
    };
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

  function fingerprintQuality(gray, w, h, ridgeImage) {
    var sharpness = laplacianVariance(gray, w, h);
    var ridgeDensity = 0;
    if (ridgeImage && ridgeImage.length) {
      var dark = 0;
      for (var i = 0; i < ridgeImage.length; i++) if (ridgeImage[i] === 0) dark++;
      ridgeDensity = dark / ridgeImage.length;
    }
    // A usable print is sharp and its binarized ridges cover a plausible band.
    var ridgeOk = ridgeDensity > 0.12 && ridgeDensity < 0.68;
    var sharpOk = sharpness > 40;
    return {
      sharpness: sharpness,
      ridgeDensity: ridgeDensity,
      ok: sharpOk && ridgeOk,
      reason: !sharpOk ? 'Image too blurry - keep the fingertip still, move closer (5-8 cm) and add light.'
        : !ridgeOk ? 'No clear ridge texture found - the fingertip must fill the guide, facing the camera.'
        : 'Ridge quality accepted.'
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

  function verifyFingerprint(stored, live) {
    if (!stored || !live || !stored.template || !live.template || !stored.texture || !live.texture) {
      return { ok: false, verified: false, correlation: null, textureSimilarity: null, score: null, threshold: FINGER_THRESHOLD, reason: 'Missing fingerprint template - no real camera fingerprint was captured.' };
    }
    var correlation = pearsonCorrelation(stored.template, live.template);
    var textureSimilarity = histogramSimilarity(stored.texture, live.texture);
    if (correlation === null || textureSimilarity === null) {
      return { ok: false, verified: false, correlation: correlation, textureSimilarity: textureSimilarity, score: null, threshold: FINGER_THRESHOLD, reason: 'Template size mismatch.' };
    }
    var score = 0.7 * Math.max(0, correlation) + 0.3 * textureSimilarity;
    return {
      ok: true,
      verified: score >= FINGER_THRESHOLD,
      correlation: correlation,
      textureSimilarity: textureSimilarity,
      score: score,
      threshold: FINGER_THRESHOLD,
      reason: score >= FINGER_THRESHOLD ? 'Fingerprint score above threshold.' : 'Fingerprint score below threshold - not the enrolled finger.'
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
    PALM_THRESHOLD: PALM_THRESHOLD,
    FINGER_THRESHOLD: FINGER_THRESHOLD,
    euclidean: euclidean,
    verifyFace: verifyFace,
    palmDescriptorFromLandmarks: palmDescriptorFromLandmarks,
    verifyPalm: verifyPalm,
    laplacianVariance: laplacianVariance,
    contrastStretch: contrastStretch,
    sharpen: sharpen,
    adaptiveThreshold: adaptiveThreshold,
    downscaleTemplate: downscaleTemplate,
    lbpHistogram: lbpHistogram,
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
