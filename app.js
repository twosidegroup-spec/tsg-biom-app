/* TSG Biom PWA - app logic. Real scanning only; every verification result in
   this file comes from TSGBiometrics comparisons of real captured data. */
(function () {
  'use strict';
  var B = window.TSGBiometrics;
  var STORES = ['GreenCare Pharmacy (CVS)', 'FreshMart Supermarket', 'UrbanStyle Retail', 'City Centre Mall'];
  var PAY_STATUS = 'Biometric Authorised — Pending Provider Settlement';

  /* ---------------- Storage: IndexedDB with localStorage fallback -------- */
  var DB = {
    db: null, useLS: false,
    open: function () {
      var self = this;
      return new Promise(function (resolve) {
        if (!('indexedDB' in window)) { self.useLS = true; resolve(); return; }
        var req = indexedDB.open('tsg-biom', 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          db.createObjectStore('people', { keyPath: 'id' });
          db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          db.createObjectStore('transactions', { keyPath: 'id' });
          db.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = function () { self.db = req.result; resolve(); };
        req.onerror = function () { self.useLS = true; resolve(); };
      });
    },
    lsGet: function (store) { try { return JSON.parse(localStorage.getItem('tsgbiom_' + store) || '[]'); } catch (e) { return []; } },
    lsSet: function (store, rows) { try { localStorage.setItem('tsgbiom_' + store, JSON.stringify(rows)); } catch (e) {} },
    put: function (store, value) {
      var self = this;
      if (this.useLS) {
        var rows = this.lsGet(store);
        if (store === 'meta') {
          var i = rows.findIndex(function (r) { return r.key === value.key; });
          if (i >= 0) rows[i] = value; else rows.push(value);
        } else if (value.id) {
          var j = rows.findIndex(function (r) { return r.id === value.id; });
          if (j >= 0) rows[j] = value; else rows.push(value);
        } else rows.push(value);
        this.lsSet(store, rows);
        return Promise.resolve(value);
      }
      return new Promise(function (resolve, reject) {
        var tx = self.db.transaction(store, 'readwrite');
        var req = tx.objectStore(store).put(value);
        req.onsuccess = function () { resolve(value); };
        req.onerror = function () { reject(req.error); };
      });
    },
    all: function (store) {
      var self = this;
      if (this.useLS) return Promise.resolve(this.lsGet(store));
      return new Promise(function (resolve, reject) {
        var req = self.db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    },
    getMeta: function (key, fallback) {
      return this.all('meta').then(function (rows) {
        var row = rows.find(function (r) { return r.key === key; });
        return row ? row.value : fallback;
      });
    },
    setMeta: function (key, value) { return this.put('meta', { key: key, value: value }); },
    nextSeq: function (key, base) {
      var self = this;
      return this.getMeta(key, base).then(function (v) {
        return self.setMeta(key, v + 1).then(function () { return v; });
      });
    }
  };

  /* ---------------- Small helpers ---------------------------------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    setTimeout(function () { t.classList.add('hidden'); }, 4200);
  }
  function fmtTime(ts) { return new Date(ts).toLocaleString(); }
  function isToday(ts) { var d = new Date(ts), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }

  /* ---------------- Camera manager --------------------------------------- */
  var Cam = {
    stream: null, video: null, viewKey: null, _token: 0, _starting: null, _startVideo: null, _startKey: null,
    start: function (video, facingMode, viewKey) {
      // A second start for the same view while one is already in flight
      // (double tap, or a camera/flash toggle restarting the view) joins
      // the in-flight start instead of racing it - racing starts are
      // what produced "The play() request was interrupted by a new load
      // request" on the phone (2026-11-20).
      if (this._starting && this._startVideo === video && this._startKey === (viewKey || null)) return this._starting;
      var token = ++this._token;
      this.stop();
      this.video = video;
      this.viewKey = viewKey || null;
      // Preview mirroring is DISPLAY ONLY and only for the front camera.
      // Captures always use the raw video frame (drawImage / detectors read
      // the untransformed pixels), so enrolling on one camera and verifying
      // on the other still compares consistently.
      video.classList.toggle('mirror', facingMode === 'user');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('This browser does not expose a camera (getUserMedia unavailable). Open TSG Biom over HTTPS in Chrome or Safari.'));
      }
      function playWithRetry() {
        return video.play().catch(function (err) {
          // AbortError = play() was interrupted by a load/srcObject
          // change. If this start is still the current one and the
          // stream is still attached, one short-delay retry recovers it.
          if (err && err.name === 'AbortError' && token === Cam._token && video.srcObject) {
            return new Promise(function (res) { setTimeout(res, 300); }).then(function () { return video.play(); });
          }
          throw err;
        });
      }
      // Constraint ladder (v17): a bare-string facingMode is an EXACT
      // requirement, and on multi-lens Android phones the exact request
      // is the classic OverconstrainedError - the camera "troubles" on
      // both front and back. Try exact first, then the same facing as a
      // preference, then any camera at all - a working camera on the
      // other side beats no camera. NotReadableError means the previous
      // camera has not released yet: wait briefly and retry the ladder
      // once before giving up.
      function gum(facing, exact) {
        var v = { width: { ideal: 1280 }, height: { ideal: 720 } };
        if (facing) v.facingMode = exact ? facing : { ideal: facing };
        return navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      }
      function openCamera() {
        return gum(facingMode, true).catch(function (e1) {
          if (e1 && (e1.name === 'OverconstrainedError' || e1.name === 'NotFoundError')) return gum(facingMode, false);
          throw e1;
        }).catch(function (e2) {
          if (e2 && (e2.name === 'OverconstrainedError' || e2.name === 'NotFoundError')) return gum(null, false);
          throw e2;
        }).catch(function (e3) {
          if (e3 && e3.name === 'NotReadableError') {
            return new Promise(function (res) { setTimeout(res, 700); }).then(function () { return gum(facingMode, false); });
          }
          throw e3;
        });
      }
      var p = openCamera().then(function (stream) {
        if (token !== Cam._token) { // a newer start superseded this one
          stream.getTracks().forEach(function (t) { t.stop(); });
          return null;
        }
        Cam.stream = stream;
        video.srcObject = stream;
        return playWithRetry().then(function () {
          // Flash is MANUAL only - it is never turned on automatically.
          // The one exception to "only from the toggle": if the user had
          // already chosen Flash On for this view before the camera
          // started, honour that explicit choice now (via the same
          // apply helper the toggle uses).
          if (viewKey && typeof flashState !== 'undefined' && flashState[viewKey]) {
            return applyFlashForKey(viewKey).then(function () { return stream; });
          }
          return stream;
        });
      });
      this._starting = p;
      this._startVideo = video;
      this._startKey = viewKey || null;
      var clear = function () { if (Cam._starting === p) { Cam._starting = null; Cam._startVideo = null; Cam._startKey = null; } };
      p.then(clear, clear);
      return p;
    },
    stop: function () {
      if (this.stream) {
        this.stream.getTracks().forEach(function (t) { t.stop(); });
        this.stream = null;
        // The old track is gone, so that view's flash choice resets to Off.
        if (this.viewKey && typeof resetFlash === 'function') resetFlash(this.viewKey);
      }
      if (this.video) { try { this.video.srcObject = null; } catch (e) {} }
    }
  };

  function cameraErrorHTML(err) {
    return '<div class="error">Camera unavailable: ' + esc(err && err.message ? err.message : err) +
      '<br>Allow camera permission for this site and retry. TSG Biom does not simulate a scan when the camera is blocked.</div>';
  }

  /* ---------------- Per-step camera choice (Front / Back) -----------------
     Every camera view has its own independent Front | Back toggle.
     Defaults: Face Front, Palm Front, Fingerprint Back — for enrollment
     steps and, separately, for each terminal method. Choices are kept in
     this state object for the whole session. */
  var camFacing = {
    enrollFace: 'user', enrollPalm: 'user', enrollFinger: 'environment',
    termFace: 'user', termPalm: 'user', termFinger: 'environment'
  };
  var camRestarters = {}; // key -> function that (re)starts that view's camera
  function termFacingKey(method) { return 'term' + method.charAt(0).toUpperCase() + method.slice(1); }
  function syncCamToggle(key) {
    document.querySelectorAll('[data-cam-toggle="' + key + '"] button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.facing === camFacing[key === 'terminal' ? termFacingKey($('termMethod').value) : key]);
    });
  }
  function applyMirror(videoId, facing) { var v = $(videoId); if (v) v.classList.toggle('mirror', facing === 'user'); }
  function wireCamToggles() {
    document.querySelectorAll('[data-cam-toggle]').forEach(function (group) {
      var groupKey = group.dataset.camToggle;
      group.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var key = groupKey === 'terminal' ? termFacingKey($('termMethod').value) : groupKey;
          if (camFacing[key] === b.dataset.facing) return;
          camFacing[key] = b.dataset.facing;
          syncCamToggle(groupKey);
          // If this view's camera is live, restart it on the new camera.
          var restart = camRestarters[groupKey];
          var videoId = groupKey === 'enrollFace' ? 'faceVideo' : groupKey === 'enrollPalm' ? 'palmVideo' : groupKey === 'enrollFinger' ? 'fingerVideo' : 'termVideo';
          applyMirror(videoId, b.dataset.facing);
          if (restart && Cam.stream && Cam.video === $(videoId)) restart();
        });
      });
    });
  }

  /* ---------------- Per-view flash (torch) choice -------------------------
     Flash is INDEPENDENT and MANUAL - never automatic. Every camera view
     has its own Flash Off | Flash On toggle next to its Front | Back
     toggle, default OFF, remembered per view (terminal: per method) in
     this state object - keyed exactly like camFacing. The ONLY code that
     ever lights the torch is applyTorchToCurrentTrack below, and it is
     only ever called from the flash toggle handler or, when a camera
     starts, to honour a Flash On the user had already chosen for that
     view. Switching camera or stopping the camera resets that view's
     flash to Off (see Cam.stop). */
  var flashState = {
    enrollFace: false, enrollPalm: false, enrollFinger: false,
    termFace: false, termPalm: false, termFinger: false
  };
  function flashGroupKey(key) { return key.indexOf('term') === 0 ? 'terminal' : key; }
  function flashKeyForGroup(groupKey) { return groupKey === 'terminal' ? termFacingKey($('termMethod').value) : groupKey; }
  function flashVideoId(groupKey) {
    return groupKey === 'enrollFace' ? 'faceVideo' : groupKey === 'enrollPalm' ? 'palmVideo' : groupKey === 'enrollFinger' ? 'fingerVideo' : 'termVideo';
  }
  function syncFlashToggle(groupKey) {
    var key = flashKeyForGroup(groupKey);
    document.querySelectorAll('[data-flash-toggle="' + groupKey + '"] button').forEach(function (b) {
      b.classList.toggle('on', (b.dataset.flash === 'on') === !!flashState[key]);
    });
  }
  function setFlashNote(groupKey, text) {
    var n = document.querySelector('[data-flash-note="' + groupKey + '"]');
    if (n) n.textContent = text || '';
  }
  function resetFlash(key) {
    if (!key || !(key in flashState)) return;
    flashState[key] = false;
    syncFlashToggle(flashGroupKey(key));
    setFlashNote(flashGroupKey(key), '');
  }
  /* The single place in the app that applies the torch constraint.
     Resolves true only when the live track actually accepted it. */
  function applyTorchToCurrentTrack(on) {
    var track = Cam.stream && Cam.stream.getVideoTracks ? Cam.stream.getVideoTracks()[0] : null;
    if (!track || !track.applyConstraints) return Promise.resolve(false);
    var caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) {}
    if (!caps.torch) return Promise.resolve(false); // not supported on this camera/device
    return track.applyConstraints({ advanced: [{ torch: !!on }] })
      .then(function () { return true; })
      .catch(function () { return false; });
  }
  /* Honour view key's stored Flash On against the live track. If the
     camera/device has no torch, say so plainly and leave flash Off. */
  function applyFlashForKey(key) {
    var groupKey = flashGroupKey(key);
    if (!flashState[key]) { setFlashNote(groupKey, ''); return Promise.resolve(); }
    return applyTorchToCurrentTrack(true).then(function (ok) {
      if (!ok) {
        flashState[key] = false;
        syncFlashToggle(groupKey);
        setFlashNote(groupKey, 'Flash is not available on this camera/device.');
      } else {
        setFlashNote(groupKey, '');
      }
    });
  }
  function wireFlashToggles() {
    document.querySelectorAll('[data-flash-toggle]').forEach(function (group) {
      var groupKey = group.dataset.flashToggle;
      group.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var key = flashKeyForGroup(groupKey);
          var wantOn = b.dataset.flash === 'on';
          if (!!flashState[key] === wantOn) { syncFlashToggle(groupKey); return; }
          flashState[key] = wantOn;
          syncFlashToggle(groupKey);
          var live = Cam.stream && Cam.video === $(flashVideoId(groupKey));
          if (!wantOn) {
            setFlashNote(groupKey, '');
            if (live) applyTorchToCurrentTrack(false);
            return;
          }
          if (live) {
            applyFlashForKey(key);
          } else {
            // Camera not started yet: remember the choice; it is applied
            // when the camera starts - because the user chose it.
            setFlashNote(groupKey, 'Flash is set On - it will light when this camera starts.');
          }
        });
      });
    });
  }

  /* ---------------- Face model (face-api) -------------------------------- */
  var faceModelReady = null;
  function loadFaceModel(statusEl) {
    if (faceModelReady) return faceModelReady;
    var MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/';
    if (statusEl) statusEl.textContent = 'Loading face model from CDN...';
    faceModelReady = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    return faceModelReady;
  }
  var FACE_SCORE_FLOOR = 0.65;
  function detectFaceDescriptor(video) {
    // Strict: EXACTLY ONE face in frame, detection confidence at or above
    // the floor, and a sane (non-degenerate) descriptor. Anything else is
    // "no face" - it can never become a capture or a verification.
    return loadFaceModel().then(function () {
      return faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: FACE_SCORE_FLOOR }))
        .withFaceLandmarks().withFaceDescriptors();
    }).then(function (dets) {
      if (!dets || dets.length !== 1) return null;
      var det = dets[0];
      if (!det.detection || det.detection.score < FACE_SCORE_FLOOR) return null;
      var desc = Array.from(det.descriptor);
      return B.faceDescriptorSane(desc) ? desc : null;
    });
  }

  /* ---------------- Palm (MediaPipe Hands) ------------------------------- */
  var Palm = {
    hands: null, latest: null, running: false, video: null, buffer: [],
    // Movement liveness (open -> close -> open). A photo cannot do this.
    movement: { watching: false, samples: [], passed: false, statusEl: null, onPass: null },
    init: function () {
      if (this.hands) return;
      var self = this;
      this.hands = new Hands({ locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/' + f; } });
      this.hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
      this.hands.onResults(function (res) {
        self.latest = (res.multiHandLandmarks && res.multiHandLandmarks[0]) ? res.multiHandLandmarks[0] : null;
        // Keep the last 8 landmark sets: captures average them, which cuts
        // single-frame landmark jitter roughly in half - the main cause of
        // genuine palm scans being rejected ("not properly scanning").
        if (self.latest) {
          self.buffer.push(self.latest);
          if (self.buffer.length > 8) self.buffer.shift();
          if (self.movement.watching) {
            var op = B.palmOpenness(self.latest);
            if (op !== null) {
              self.movement.samples.push(op);
              if (self.movement.samples.length > 90) self.movement.samples.shift();
              var ev = B.evaluatePalmMovement(self.movement.samples);
              if (self.movement.statusEl) {
                if (ev.pass) {
                  self.movement.statusEl.textContent = 'Movement confirmed - live hand. Hold your open palm still to capture.';
                } else {
                  // Step-by-step progress, so the person always sees
                  // which part of the movement the system is waiting for.
                  var stOpen = (ev.max !== null && ev.max >= B.PALM_OPEN_MIN) ? 'done' : 'waiting';
                  var stClose = (ev.min !== null && ev.min <= B.PALM_CLOSED_MAX) ? 'done' : 'waiting';
                  var stAgain = (stClose === 'done' && ev.last !== null && ev.last >= B.PALM_OPEN_MIN) ? 'done' : 'waiting';
                  self.movement.statusEl.textContent = 'Movement check - Open: ' + stOpen + ' / Close: ' + stClose + ' / Open again: ' + stAgain + '. ' + ev.reason;
                }
              }
              if (ev.pass) {
                self.movement.passed = true;
                self.movement.watching = false;
                if (self.movement.onPass) self.movement.onPass();
              }
            }
          }
        } else if (self.movement.watching && self.movement.statusEl && self.movement.samples.length === 0) {
          self.movement.statusEl.textContent = 'No hand detected yet - hold one open palm fully inside the guide, in good light.';
        }
      });
    },
    beginMovement: function (statusEl, onPass) {
      this.movement = { watching: true, samples: [], passed: false, statusEl: statusEl || null, onPass: onPass || null };
      if (statusEl) statusEl.textContent = 'Show one open palm, then close it into a loose fist, then open it again...';
    },
    resetMovement: function () {
      this.movement = { watching: false, samples: [], passed: false, statusEl: null, onPass: null };
    },
    // Averaged landmarks over recent frames, or null if too few samples.
    averagedLandmarks: function () {
      if (this.buffer.length < 3) return null;
      var sets = this.buffer.slice(-5);
      var out = [];
      for (var i = 0; i < 21; i++) {
        var x = 0, y = 0, z = 0;
        sets.forEach(function (s) { x += s[i].x; y += s[i].y; z += s[i].z || 0; });
        out.push({ x: x / sets.length, y: y / sets.length, z: z / sets.length });
      }
      return out;
    },
    captureDescriptor: function () {
      var avg = this.averagedLandmarks();
      if (avg) { var d0 = B.palmDescriptorFromLandmarks(avg); if (d0) return d0; }
      // Fallback: per-frame descriptors, most recent first, averaged over
      // the frames that individually pass the plausibility gates. This
      // matters right after the movement check: the buffer then holds a
      // mix of open, fist and re-opening frames, and averaging those
      // LANDMARK sets produces a half-curled "hand" the gates rightly
      // reject - even though the same buffer holds perfectly good
      // open-palm frames from seconds earlier. (Found on the first real
      // phone verification attempt, 2026-11-20: movement passed, then
      // "No usable open palm detected in the live frames.")
      var valid = [];
      for (var i = this.buffer.length - 1; i >= 0 && valid.length < 5; i--) {
        var d = B.palmDescriptorFromLandmarks(this.buffer[i]);
        if (d) valid.push(d);
      }
      if (!valid.length) return null;
      if (valid.length === 1) return valid[0];
      var out = [];
      for (var j = 0; j < valid[0].length; j++) {
        var s = 0;
        valid.forEach(function (v) { s += v[j]; });
        out.push(s / valid.length);
      }
      return B.palmDescriptorSane(out) ? out : valid[0];
    },
    /* Palm texture: LBP histogram of the palm region of the live frame,
       cropped around the detected hand so it is the palm's own texture.
       Used as a realness gate (see biometrics.js calibration note). */
    captureTexture: function () {
      try {
        var video = this.video, lm = this.latest;
        if (!video || !lm || !video.videoWidth || !video.videoHeight) return null;
        var vw = video.videoWidth, vh = video.videoHeight;
        var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        lm.forEach(function (p) {
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        });
        var cx = (minX + maxX) / 2 * vw, cy = (minY + maxY) / 2 * vh;
        var side = Math.max(maxX - minX, maxY - minY) * 1.15 * Math.max(vw, vh);
        side = Math.min(side, vw, vh);
        if (!(side >= 40)) return null;
        var sx = Math.max(0, Math.min(vw - side, cx - side / 2));
        var sy = Math.max(0, Math.min(vh - side, cy - side / 2));
        var size = 128;
        var canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
        var img = ctx.getImageData(0, 0, size, size).data;
        var gray = new Array(size * size);
        for (var i = 0; i < size * size; i++) gray[i] = Math.round(0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2]);
        var tex = B.lbpHistogram(gray, size, size);
        return B.palmTextureSane(tex) ? tex : null;
      } catch (e) { return null; }
    },
    startLoop: function (video, statusEl) {
      this.init();
      this.video = video; this.running = true;
      var self = this;
      (function loop() {
        if (!self.running) return;
        // One inference at a time: on a phone each Hands inference can
        // take longer than the 120ms tick, and unthrottled sends queue
        // up until the movement samples lag seconds behind the real hand.
        if (video.readyState >= 2 && !self._sending) {
          self._sending = true;
          self.hands.send({ image: video }).then(function () {
            self._sending = false;
            if (statusEl && !self.movement.watching) statusEl.textContent = self.latest ? 'Hand detected - hold still and capture.' : 'Show one open palm to the camera...';
          }, function () { self._sending = false; });
        }
        setTimeout(loop, 120);
      })();
    },
    stop: function () { this.running = false; this.latest = null; this.buffer = []; this.resetMovement(); }
  };

  /* ---------------- Palm CLIP capture (recorded-clip path) --------------
     Why this exists: the live-stream palm path kept failing on a real
     phone (camera start races, inference lag behind the real hand, and
     the mixed-frame averaging trap after the movement check). The clip
     path records a few seconds of real frames first, then analyses
     them one by one with a dedicated Hands processor: movement
     liveness from the openness series, and (v9) a palmprint code from
     each genuine open-palm frame — the landmarks locate the palm
     square, the EDCC encoder reads the print inside it. Legacy v2
     geometry descriptors are still computed per frame so older
     enrolments keep verifying. A single still photo is NOT accepted
     anywhere: with no movement series there is no liveness, so there
     is no scan. */
  var PalmProc = {
    hands: null, pending: null,
    init: function () {
      if (this.hands) return;
      var self = this;
      this.hands = new Hands({ locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/' + f; } });
      this.hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      this.hands.onResults(function (res) {
        var p = self.pending; self.pending = null;
        if (p) p((res.multiHandLandmarks && res.multiHandLandmarks[0]) ? res.multiHandLandmarks[0] : null);
      });
    },
    landmarks: function (image) {
      var self = this;
      this.init();
      return new Promise(function (resolve) {
        self.pending = resolve;
        self.hands.send({ image: image }).catch(function () {
          if (self.pending === resolve) { self.pending = null; resolve(null); }
        });
      });
    }
  };

  function grabVideoFrame(video) {
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    var scale = Math.min(1, 960 / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /* Palm texture + sharpness from any image source (a recorded frame
     here; the same maths the live captureTexture used), cropped around
     the detected hand so it is the palm's own texture. */
  function palmFrameMeasures(source, sw, sh, lm) {
    try {
      if (!lm || !sw || !sh) return { texture: null, sharpness: 0 };
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      lm.forEach(function (p) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      });
      var cx = (minX + maxX) / 2 * sw, cy = (minY + maxY) / 2 * sh;
      var side = Math.max(maxX - minX, maxY - minY) * 1.15 * Math.max(sw, sh);
      side = Math.min(side, sw, sh);
      if (!(side >= 40)) return { texture: null, sharpness: 0 };
      var sx = Math.max(0, Math.min(sw - side, cx - side / 2));
      var sy = Math.max(0, Math.min(sh - side, cy - side / 2));
      var size = 128;
      var canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
      var img = ctx.getImageData(0, 0, size, size).data;
      var gray = new Array(size * size);
      for (var i = 0; i < size * size; i++) gray[i] = Math.round(0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2]);
      var tex = B.lbpHistogram(gray, size, size);
      return { texture: B.palmTextureSane(tex) ? tex : null, sharpness: B.laplacianVariance(gray, size, size) };
    } catch (e) { return { texture: null, sharpness: 0 }; }
  }

  function recordPalmClip(video, statusEl, durationMs, sequence) {
    var frames = [];
    var t0 = Date.now();
    var stages = (sequence && sequence.stages && sequence.stages.length) ? sequence.stages : ['open', 'close', 'open'];
    return new Promise(function (resolve) {
      var iv = setInterval(function () {
        var el = Date.now() - t0;
        var f = grabVideoFrame(video);
        if (f) frames.push(f);
        // Timed stage prompts: coach the ISSUED liveness sequence (v18:
        // randomised per scan) in step with the recording — one stage
        // per third of the clip, each shown while its stage is due.
        if (statusEl) {
          var frac = durationMs ? el / durationMs : 1;
          var stageIdx = Math.min(stages.length - 1, Math.floor(frac * stages.length));
          var stage = B.PALM_STAGE_PROMPTS[stages[stageIdx]] || stages[stageIdx];
          statusEl.textContent = 'Recording palm clip... ' + Math.max(0, Math.ceil((durationMs - el) / 1000)) + 's - keep the whole hand inside the frame, about 30 cm away. ' + stage;
        }
        if (el >= durationMs) { clearInterval(iv); resolve(frames); }
      }, 250);
    });
  }

  /* Palmprint ROI + EDCC codes from a recorded frame (v9): the landmarks
     locate the palm square, the warp cuts it out, the encoder reads the
     print itself. Returns { code, codeM } (codeM = the mirror twin's
     code, v15) or null. */
  function palmCodesFromFrame(frame, lm) {
    try {
      var w = frame.width, h = frame.height;
      if (!w || !h) return null;
      var ctx = frame.getContext('2d');
      var img = ctx.getImageData(0, 0, w, h).data;
      var gray = new Array(w * h);
      for (var i = 0; i < w * h; i++) gray[i] = Math.round(0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2]);
      var roi = B.palmRoiFromLandmarks(gray, w, h, lm);
      if (!roi) return null;
      var code = B.palmprintEncode(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE);
      var flipped = B.flipGrayHorizontal(roi, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE);
      var codeM = flipped ? B.palmprintEncode(flipped, B.PALMPRINT_ROI_SIZE, B.PALMPRINT_ROI_SIZE) : null;
      return { code: code, codeM: codeM, roi: roi };
    } catch (e) { return null; }
  }

  var spoofScratch = null;
  /* Downscale a recorded frame and run the screen-spoof detector on
     it (v18). Returns the detector result plus the frame's mean
     brightness (used for the field-test lighting tag), or null. */
  function spoofSample(frame) {
    try {
      if (!spoofScratch) spoofScratch = document.createElement('canvas');
      var w = 160, h = Math.max(48, Math.round(160 * frame.height / frame.width));
      spoofScratch.width = w; spoofScratch.height = h;
      var ctx = spoofScratch.getContext('2d');
      ctx.drawImage(frame, 0, 0, w, h);
      var img = ctx.getImageData(0, 0, w, h).data;
      var gray = new Array(w * h), sum = 0;
      for (var i = 0; i < w * h; i++) { var v = Math.round(0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2]); gray[i] = v; sum += v; }
      var chk = B.screenSpoofCheck(gray, w, h);
      chk.meanBrightness = sum / (w * h);
      return chk;
    } catch (e) { return null; }
  }
  function processPalmClip(frames, statusEl, sequence) {
    var results = [];
    var spoofChecks = [];
    function analyseFrame(frame, idx) {
      return PalmProc.landmarks(frame).then(function (lm) {
        if (!lm) { results[idx] = { openness: null, descriptor: null, code: null, codeM: null, roi: null, sharpness: 0, texture: null, spread: null, tilt: null }; return; }
        var openness = B.palmOpenness(lm);
        var descriptor = B.palmDescriptorFromLandmarks(lm);
        var meas = descriptor ? palmFrameMeasures(frame, frame.width, frame.height, lm) : { texture: null, sharpness: 0 };
        var codes = (descriptor && typeof openness === 'number' && openness >= B.PALM_OPEN_MIN) ? palmCodesFromFrame(frame, lm) : null;
        results[idx] = { openness: openness, descriptor: descriptor, code: codes ? codes.code : null, codeM: codes ? codes.codeM : null, roi: codes ? codes.roi : null, sharpness: meas.sharpness, texture: meas.texture, spread: B.palmSpread(lm), tilt: B.palmTilt(lm) };
      });
    }
    var chain = Promise.resolve();
    frames.forEach(function (frame, idx) {
      chain = chain.then(function () {
        if (statusEl) statusEl.textContent = 'Analysing palm clip... frame ' + (idx + 1) + ' of ' + frames.length + '.';
        if (idx % 3 === 0) { var s = spoofSample(frame); if (s) spoofChecks.push(s); }
        return analyseFrame(frame, idx);
      });
    });
    return chain.then(function () {
      // Rescue pass (v17): frames where the detector found no hand get
      // one more attempt at a lower detection confidence before they
      // are given up - on real phones the first pass misses frames that
      // a slightly easier threshold catches, and every missed frame is
      // a frame the movement check and the matcher never see.
      var missed = [];
      results.forEach(function (r, i) { if (r && !r.descriptor) missed.push(i); });
      if (!missed.length || !PalmProc.hands) return null;
      PalmProc.hands.setOptions({ minDetectionConfidence: 0.3 });
      var rescue = Promise.resolve();
      missed.forEach(function (idx) {
        rescue = rescue.then(function () {
          if (statusEl) statusEl.textContent = 'Analysing palm clip... second look at frame ' + (idx + 1) + '.';
          return analyseFrame(frames[idx], idx);
        });
      });
      return rescue.then(function () {
        PalmProc.hands.setOptions({ minDetectionConfidence: 0.5 });
      }, function () {
        PalmProc.hands.setOptions({ minDetectionConfidence: 0.5 });
      });
    }).then(function () {
      var series = [];
      var measures = [];
      results.forEach(function (r) { if (typeof r.openness === 'number' && isFinite(r.openness)) { series.push(r.openness); measures.push({ openness: r.openness, spread: r.spread, tilt: r.tilt }); } });
      var usable = B.palmUsableOpenFrames(results);
      var bestTexture = null, bestSharp = -1;
      usable.forEach(function (u) { if (u.texture && u.sharpness > bestSharp) { bestSharp = u.sharpness; bestTexture = u.texture; } });
      // Movement: from v18 the issued randomised sequence is the gate
      // (order + 3.5s window); without a sequence the legacy cycle rule
      // applies. Spoof: aggregate the sampled frame checks - the scan
      // is a screen replay when at least half the sampled frames (and
      // at least two) carry screen traces.
      var movement = sequence ? B.evaluateMovementSequence(measures, sequence, 250) : B.evaluatePalmMovement(series);
      var spoofFrames = spoofChecks.filter(function (c) { return c.spoof; });
      var spoof = {
        spoof: spoofChecks.length > 0 && spoofFrames.length >= Math.max(2, Math.ceil(spoofChecks.length / 2)),
        score: spoofChecks.reduce(function (m, c) { return Math.max(m, c.score); }, 0),
        reasons: spoofFrames.reduce(function (acc, c) { return acc.concat(c.reasons); }, []),
        framesChecked: spoofChecks.length, framesFlagged: spoofFrames.length
      };
      var meanB = spoofChecks.length ? spoofChecks.reduce(function (s, c) { return s + c.meanBrightness; }, 0) / spoofChecks.length : null;
      var lightTag = meanB === null ? null : meanB > 150 ? 'bright' : meanB >= 80 ? 'indoor' : 'dim';
      return { results: results, movement: movement, bestTexture: bestTexture, usableCount: usable.length, spoof: spoof, lightTag: lightTag };
    });
  }
  var palmScanBusy = false;

  /* Record + analyse palm clips with the v16 toughness fixes:
     enrolment always takes TWO clips (a wider enrolled pose set lifts
     genuine match scores, and enrolment is a one-time step); the
     terminal takes a second clip automatically when the first one's
     movement check failed or it produced no usable open-palm frames,
     so a slow or imperfect first attempt is not a dead end. Movement
     passes when either clip completes the open - close - open cycle. */
  function capturePalmResults(video, statusEl, twoClips, swapCamera, sequence) {
    function oneClip() {
      return recordPalmClip(video, statusEl, 4500, sequence).then(function (frames) {
        return processPalmClip(frames, statusEl, sequence);
      });
    }
    function merge(r1, r2) {
      return {
        results: r1.results.concat(r2.results),
        movement: r1.movement.pass ? r1.movement : r2.movement,
        bestTexture: r1.bestTexture || r2.bestTexture,
        usableCount: r1.usableCount + r2.usableCount,
        spoof: (r2.spoof && r2.spoof.spoof) ? r2.spoof : r1.spoof,
        lightTag: r2.lightTag || r1.lightTag
      };
    }
    function secondClip(r1, note) {
      if (statusEl) statusEl.textContent = note;
      return new Promise(function (resolve) { setTimeout(resolve, 1200); }).then(oneClip).then(function (r2) { return merge(r1, r2); });
    }
    return oneClip().then(function (r1) {
      // Spoof verdicts are FINAL (v18): a flagged screen replay is
      // never retried, re-recorded or camera-swapped - it is rejected
      // and logged by the caller.
      if (r1.spoof && r1.spoof.spoof) return r1;
      // Zero-hand rescue (v17): if NO frame in the clip produced a hand
      // at all, the likeliest cause is the camera itself - a lens the
      // detector cannot work with, a black feed, a covered lens. When
      // the caller provides a camera swap, switch to the other camera
      // and record once more before reporting failure.
      var anyHand = r1.results.some(function (r) { return !!r.descriptor; });
      if (!anyHand && swapCamera) {
        if (statusEl) statusEl.textContent = 'No hand was seen by this camera - switching to the other camera and trying once more.';
        return swapCamera().then(function () { return secondClip(r1, 'Other camera on - same movement again: follow the prompts on screen.'); });
      }
      var needSecond = twoClips || !r1.movement.pass || !r1.usableCount;
      if (!needSecond) return r1;
      return secondClip(r1, twoClips ? 'Clip 1 done - once more, same movement: follow the prompts.' : 'One more try - follow the prompts shown on screen, promptly and in order.');
    });
  }

  /* ---------------- Fingerprint through camera --------------------------- */
  function captureFinger(video, origCanvas, ridgeCanvas) {
    var size = 480;
    var tmp = document.createElement('canvas'); tmp.width = size; tmp.height = size;
    var ctx = tmp.getContext('2d');
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) throw new Error('Camera frame not ready yet - wait a moment and retry.');
    var side = Math.min(vw, vh);
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
    var img = ctx.getImageData(0, 0, size, size).data;
    var gray = new Array(size * size);
    for (var i = 0; i < size * size; i++) {
      gray[i] = Math.round(0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2]);
    }
    var stretched = B.contrastStretch(gray);
    var sharp = B.sharpen(stretched, size, size);
    var ridge = B.adaptiveThreshold(sharp, size, size, 10, 12);
    drawGray(origCanvas, stretched, size, size);
    drawGray(ridgeCanvas, ridge, size, size);
    // The quality gate reads the ORIGINAL grayscale - never the stretched
    // copy (stretching amplifies dark-room sensor noise until blank frames
    // look "sharp", which let covered-camera frames pass the old gate).
    var quality = B.fingerprintQuality(gray, size, size, ridge);
    var record = null;
    if (quality.ok) {
      var template = B.downscaleTemplate(ridge, size, size, 96);
      record = {
        template: template,
        texture: B.lbpHistogram(template, 96, 96),
        quality: { sharpness: quality.sharpness, ridgeDensity: quality.ridgeDensity },
        ridgeImage: ridgeCanvas.toDataURL('image/png')
      };
    }
    return { record: record, quality: quality };
  }
  function drawGray(canvas, gray, w, h) {
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(w, h);
    for (var i = 0; i < w * h; i++) { img.data[i * 4] = gray[i]; img.data[i * 4 + 1] = gray[i]; img.data[i * 4 + 2] = gray[i]; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------------- Navigation ------------------------------------------- */
  function go(page) {
    var navPage = (page === 'stores' || page === 'logs' || page === 'partner') ? 'more' : page;
    document.querySelectorAll('#mainNav button').forEach(function (b) { b.classList.toggle('active', b.dataset.page === navPage); });
    document.querySelectorAll('section.page').forEach(function (s) { s.classList.toggle('active', s.id === 'page-' + page); });
    if (page !== 'enroll' && page !== 'terminal') { Cam.stop(); Palm.stop(); stopFaceWatch(); }
    if (page === 'dashboard') renderDashboard();
    if (page === 'registry') renderRegistry();
    if (page === 'logs') renderLogs();
    if (page === 'terminal') fillTerminalPeople();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('#mainNav button').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.page); });
  });
  document.querySelectorAll('[data-launch]').forEach(function (b) {
    b.addEventListener('click', function () { go('terminal'); $('termStore').value = b.dataset.launch; toast('Terminal set to ' + b.dataset.launch); });
  });
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { go(b.dataset.go); });
  });

  /* ---------------- Dashboard -------------------------------------------- */
  function renderDashboard() {
    return Promise.all([DB.all('people'), DB.all('logs'), DB.all('transactions')]).then(function (r) {
      var people = r[0], logs = r[1], txs = r[2];
      var todayLogs = logs.filter(function (l) { return isToday(l.ts); });
      var verified = todayLogs.filter(function (l) { return l.result === 'Verified'; }).length;
      $('statPeople').textContent = people.length;
      $('statVerifs').textContent = todayLogs.length;
      $('statRate').textContent = todayLogs.length ? Math.round((verified / todayLogs.length) * 100) + '%' : '—';
      $('statWallets').textContent = people.filter(function (p) { return p.walletProvider; }).length;
      var vol = txs.filter(function (t) { return isToday(t.ts); }).reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
      $('statVolume').textContent = 'BDT ' + vol.toLocaleString();
      var feed = logs.slice(-6).reverse().map(function (l) {
        return '<div><b>' + esc(fmtTime(l.ts)) + '</b> — ' + esc(l.personName) + ' · ' + esc(l.method) + ' · ' + esc(l.measured) + ' · <span class="badge ' + (l.result === 'Verified' ? 'ok' : 'bad') + '">' + esc(l.result) + '</span></div>';
      }).join('');
      $('liveFeed').innerHTML = feed || 'No activity yet on this device.';
    });
  }

  /* ---------------- Enroll flow ------------------------------------------ */
  var ENROLL_ORDER = ['face', 'palm', 'finger'];
  var METHOD_LABEL = { face: 'Face', palm: 'Palm', finger: 'Fingerprint' };
  var enroll = { details: null, face: null, palm: null, finger: null, types: { face: true, palm: true, finger: true } };
  var STEP_LABEL = { details: 'Details + Wallet', face: 'Face Scan', palm: 'Palm Scan', finger: 'Fingerprint Scan', done: 'Biom ID' };
  function setStep(step) {
    ['details', 'face', 'palm', 'finger', 'done'].forEach(function (s) {
      $('enroll-' + s).classList.toggle('hidden', s !== step);
    });
    // Simple progress: "Step 2 of 4 - Palm Scan", counting only the steps
    // this enrollment actually takes (details + chosen biometrics + done).
    var flow = ['details'].concat(ENROLL_ORDER.filter(function (s) { return enroll.types[s]; }), ['done']);
    var idx = flow.indexOf(step);
    if (idx >= 0) {
      $('enrollProgress').textContent = 'Step ' + (idx + 1) + ' of ' + flow.length + ' — ' + STEP_LABEL[step];
      $('enrollProgressBar').style.width = Math.round(((idx + 1) / flow.length) * 100) + '%';
    }
  }
  function capturedCount() { return [enroll.face, enroll.palm, enroll.finger].filter(function (v) { return !!v; }).length; }
  function advanceFrom(step) {
    var idx = ENROLL_ORDER.indexOf(step);
    var next = ENROLL_ORDER.slice(idx + 1).filter(function (s) { return enroll.types[s]; })[0];
    if (next) { setStep(next); return; }
    finishEnrollment(step);
  }
  function finishEnrollment(fromStep) {
    var msgIds = { face: 'faceMsg', palm: 'palmMsg', finger: 'fingerMsg' };
    function fail(html) {
      var id = msgIds[fromStep];
      if (id && $(id)) $(id).innerHTML = html;
      toast('Enrollment not finished - no biometric was captured.');
    }
    if (!enroll.details) { fail('<div class="error">Enrollment is incomplete - details are missing. Go back and start again.</div>'); return; }
    if (capturedCount() === 0) {
      fail('<div class="error">No biometric was captured, so no Biom ID was issued. Capture at least one of Face, Palm or Fingerprint - each one works independently.</div>');
      return;
    }
    Cam.stop(); Palm.stop(); stopFaceWatch();
    DB.nextSeq('biomSeq', 2841).then(function (seq) {
      var person = {
        id: 'TSG-BIO-' + seq,
        name: enroll.details.name, phone: enroll.details.phone, type: enroll.details.type, store: enroll.details.store,
        walletProvider: enroll.details.walletProvider, walletNumber: enroll.details.walletNumber,
        limits: { perTx: enroll.details.limitPerTx || null, daily: enroll.details.limitDaily || null },
        loyaltyPoints: 0,
        faceDescriptor: enroll.face || null,
        palmDescriptor: enroll.palm && enroll.palm.geometry ? enroll.palm.geometry[0] : null,
        palmProfile: enroll.palm || null,
        fingerprint: enroll.finger ? { template: enroll.finger.template, texture: enroll.finger.texture, quality: enroll.finger.quality, ridgeImage: enroll.finger.ridgeImage } : null,
        enrolledAt: Date.now()
      };
      return DB.put('people', person).then(function () {
        setStep('done');
        $('enrollDoneBody').innerHTML =
          '<b>Name:</b> ' + esc(person.name) + '<br><b>Biom ID:</b> ' + esc(person.id) + '<br>' +
          '<b>Store:</b> ' + esc(person.store) + '<br>' +
          '<b>Face:</b> ' + (person.faceDescriptor ? 'Enrolled (128-d descriptor)' : 'Not enrolled') + '<br>' +
          '<b>Palm:</b> ' + (person.palmProfile && person.palmProfile.v === 3 ? 'Enrolled (palmprint — EDCC competitive code, ' + person.palmProfile.codes.length + ' captures, movement-checked)' : person.palmProfile ? 'Enrolled (3 geometry captures + palm texture, movement-checked)' : person.palmDescriptor ? 'Enrolled (hand geometry)' : 'Not enrolled') + '<br>' +
          '<b>Fingerprint:</b> ' + (person.fingerprint ? 'Enrolled (camera template, quality ' + person.fingerprint.quality.sharpness.toFixed(1) + ')' : 'Not enrolled') + '<br>' +
          '<b>Wallet:</b> ' + (person.walletProvider ? esc(person.walletProvider) + ' ' + esc(B.maskWalletNumber(person.walletNumber)) : 'Not linked') + '<br>' +
          '<b>Biometric-only limits:</b> ' + (person.limits.perTx ? 'BDT ' + person.limits.perTx.toLocaleString() + ' per transaction' : 'No per-transaction limit') + (person.limits.daily ? ', BDT ' + person.limits.daily.toLocaleString() + ' per day' : '') + '<br>' +
          '<b>Palm Loyalty:</b> Active — 0 points';
        enroll = { details: null, face: null, palm: null, finger: null, types: { face: true, palm: true, finger: true } };
        toast('Enrolled: ' + person.id);
      });
    }).catch(function (e) { fail('<div class="error">Could not save enrollment on this device: ' + esc(e.message || e) + '</div>'); });
  }
  function fillStoreSelects() {
    ['enStore', 'termStore'].forEach(function (id) {
      $(id).innerHTML = STORES.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    });
  }

  $('enrollDetailsNext').addEventListener('click', function () {
    var name = $('enName').value.trim();
    var provider = $('enWalletProvider').value;
    var walletRaw = $('enWalletNumber').value.trim();
    var wallet = null;
    var err = '';
    if (!name) err = 'Enter the person\'s full name.';
    if (!err && provider) {
      wallet = B.normaliseWalletNumber(walletRaw);
      if (!wallet) err = 'Wallet number is not a valid Bangladeshi mobile number (01 + 9 digits). It was not saved.';
    }
    if (!err && !provider && walletRaw) err = 'Choose bKash or Nagad, or clear the wallet number.';
    var types = { face: $('enOptFace').checked, palm: $('enOptPalm').checked, finger: $('enOptFinger').checked };
    if (!err && !types.face && !types.palm && !types.finger) err = 'Select at least one biometric to enroll (Face, Palm or Fingerprint) - each one works independently, but a Biom ID needs at least one captured.';
    if (err) { $('enrollDetailsError').innerHTML = '<div class="error">' + esc(err) + '</div>'; return; }
    $('enrollDetailsError').innerHTML = '';
    enroll.types = types;
    enroll.face = null; enroll.palm = null; enroll.finger = null;
    resetPalmEnroll();
    enroll.details = {
      name: name, phone: $('enPhone').value.trim(), type: $('enType').value, store: $('enStore').value,
      walletProvider: provider || '', walletNumber: wallet || '',
      limitPerTx: Number($('enLimitPerTx').value) > 0 ? Number($('enLimitPerTx').value) : null,
      limitDaily: Number($('enLimitDaily').value) > 0 ? Number($('enLimitDaily').value) : null
    };
    setStep(ENROLL_ORDER.filter(function (s) { return types[s]; })[0]);
  });

  /* Face enroll */
  var faceWatch = null;
  function stopFaceWatch() { if (faceWatch) { clearInterval(faceWatch); faceWatch = null; } }
  function startFaceCamera() {
    var status = $('faceStatus');
    loadFaceModel(status).catch(function () {});
    Cam.start($('faceVideo'), camFacing.enrollFace, 'enrollFace').then(function () {
      status.textContent = 'Loading face model / looking for a face...';
      stopFaceWatch();
      faceWatch = setInterval(function () {
        detectFaceDescriptor($('faceVideo')).then(function (desc) {
          if (desc) { status.textContent = 'Face detected - hold still and capture.'; $('faceCapture').disabled = false; }
          else { status.textContent = 'No face detected - face the camera in good light.'; $('faceCapture').disabled = true; }
        }).catch(function () { status.textContent = 'Face model still loading...'; });
      }, 900);
    }).catch(function (e) { $('faceMsg').innerHTML = cameraErrorHTML(e); status.textContent = 'Camera blocked.'; });
  }
  $('faceStart').addEventListener('click', startFaceCamera);
  camRestarters.enrollFace = startFaceCamera;
  $('faceCapture').addEventListener('click', function () {
    detectFaceDescriptor($('faceVideo')).then(function (desc) {
      if (!desc) { $('faceMsg').innerHTML = '<div class="error">No face detected in this frame. Nothing was stored. Reposition and capture again.</div>'; return; }
      enroll.face = desc; stopFaceWatch(); Cam.stop();
      $('faceMsg').innerHTML = '<div class="success">Real face descriptor captured (128 points).</div>';
      advanceFrom('face');
    });
  });
  $('faceSkip').addEventListener('click', function () {
    enroll.face = null; stopFaceWatch(); Cam.stop();
    toast('Face skipped - it will show as Not enrolled.');
    advanceFrom('face');
  });

  /* Palm enroll - recorded-clip path: one 4-second clip carries the
     whole enrolment. The movement check runs on the clip's openness
     series (a photo has no series), and the stored profile (v3) keeps
     3 palmprint codes read from the clip's best open-palm frames
     spread across the recording. */
  function resetPalmEnroll() { /* clip enrolment keeps no partial state */ }
  function startPalmCamera() {
    Cam.start($('palmVideo'), camFacing.enrollPalm, 'enrollPalm').then(function () {
      $('palmStatus').textContent = 'Camera on - tap Record Palm Clip, hold the phone about 30 cm away so your whole hand fits inside the frame. The app records two short clips and shows a movement sequence on screen - it is picked at random each time; just follow each prompt as it appears.';
      $('palmCapture').disabled = false;
    }).catch(function (e) { $('palmMsg').innerHTML = cameraErrorHTML(e); $('palmStatus').textContent = 'Camera blocked.'; });
  }
  $('palmStart').addEventListener('click', startPalmCamera);
  camRestarters.enrollPalm = startPalmCamera;
  $('palmCapture').addEventListener('click', function () {
    if (palmScanBusy) return;
    palmScanBusy = true;
    $('palmCapture').disabled = true;
    $('palmMsg').innerHTML = '';
    var sequence = B.PALM_SEQUENCES[Math.floor(Math.random() * B.PALM_SEQUENCES.length)];
    capturePalmResults($('palmVideo'), $('palmStatus'), true, function () {
      camFacing.enrollPalm = camFacing.enrollPalm === 'user' ? 'environment' : 'user';
      syncCamToggle('enrollPalm');
      return Cam.start($('palmVideo'), camFacing.enrollPalm, 'enrollPalm');
    }, sequence).then(function (res) {
      palmScanBusy = false;
      if (res.spoof && res.spoof.spoof) {
        DB.put('logs', { ts: Date.now(), personId: '', personName: '(enrolment attempt)', store: '', method: 'palm', measured: 'Spoof score ' + res.spoof.score.toFixed(2) + ' - ' + res.spoof.reasons.join('; '), result: 'Spoof / Screen Replay Detected' });
        $('palmMsg').innerHTML = '<div class="error">Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (' + esc(res.spoof.reasons.join('; ')) + '). Nothing was stored. Enrolment requires the real hand, live in front of the camera.</div>';
        $('palmCapture').disabled = false;
        return;
      }
      if (!res.movement.pass) {
        $('palmMsg').innerHTML = '<div class="error">Movement check failed in both clips: ' + esc(res.movement.reason) + ' Nothing was stored. Record again and complete the movement sequence shown in the prompts, in order, inside each recording.</div>';
        $('palmCapture').disabled = false;
        return;
      }
      var codes = B.selectPalmprintProfileCodes(res.results);
      if (!codes) {
        $('palmMsg').innerHTML = '<div class="error">No usable open palm with readable print detail found in the clip. Nothing was stored. Hold one open palm still, fingers spread, filling the guide in good light, and record again.</div>';
        $('palmCapture').disabled = false;
        return;
      }
      enroll.palm = { v: 3, codes: codes };
      Cam.stop();
      $('palmStatus').textContent = 'Palm clip analysed.';
      $('palmMsg').innerHTML = '<div class="success">Palm enrolled from live recorded clips: movement check passed, and ' + codes.length + ' palmprint codes (EDCC competitive code — the palm\'s own print pattern) were read from the two clips\' best fully-open frames.</div>';
      advanceFrom('palm');
    }).catch(function (e) {
      palmScanBusy = false;
      $('palmCapture').disabled = false;
      $('palmMsg').innerHTML = '<div class="error">Palm clip failed: ' + esc(e && e.message ? e.message : e) + ' Nothing was stored.</div>';
    });
  });
  $('palmSkip').addEventListener('click', function () {
    enroll.palm = null; resetPalmEnroll(); Palm.stop(); Cam.stop();
    toast('Palm skipped - it will show as Not enrolled.');
    advanceFrom('palm');
  });

  /* Finger enroll */
  function startFingerCamera() {
    Cam.start($('fingerVideo'), camFacing.enrollFinger, 'enrollFinger').then(function () {
      $('fingerStatus').textContent = (camFacing.enrollFinger === 'environment' ? 'Back' : 'Front') + ' camera on - fingertip 5-8 cm away, filling the guide.';
      $('fingerCapture').disabled = false;
    }).catch(function (e) { $('fingerMsg').innerHTML = cameraErrorHTML(e); $('fingerStatus').textContent = 'Camera blocked.'; });
  }
  $('fingerStart').addEventListener('click', startFingerCamera);
  camRestarters.enrollFinger = startFingerCamera;
  $('fingerSkip').addEventListener('click', function () {
    enroll.finger = null; Cam.stop();
    $('fingerAccept').classList.add('hidden');
    toast('Fingerprint skipped - it will show as Not enrolled.');
    advanceFrom('finger');
  });
  $('fingerCapture').addEventListener('click', function () {
    try {
      var res = captureFinger($('fingerVideo'), $('fingerOriginal'), $('fingerRidge'));
      if (!res.record) {
        $('fingerMsg').innerHTML = '<div class="error">Print rejected by the quality gate: ' + esc(res.quality.reason) + ' Sharpness measured: ' + res.quality.sharpness.toFixed(1) + '. Nothing was stored.</div>';
        $('fingerAccept').classList.add('hidden');
        return;
      }
      enroll.finger = res.record;
      $('fingerMsg').innerHTML = '<div class="success">Ridges captured from real camera pixels. Sharpness ' + res.quality.sharpness.toFixed(1) + ', ridge density ' + res.quality.ridgeDensity.toFixed(2) + '. Check the ridge image above is your print, then accept.</div>';
      $('fingerAccept').classList.remove('hidden');
    } catch (e) { $('fingerMsg').innerHTML = cameraErrorHTML(e); }
  });
  $('fingerAccept').addEventListener('click', function () {
    if (!enroll.finger) {
      $('fingerMsg').innerHTML = '<div class="error">No fingerprint print has been accepted yet - capture a clear print first, or Skip this step.</div>'; return;
    }
    advanceFrom('finger');
  });

  /* ---------------- Terminal --------------------------------------------- */
  var termPeopleCache = [];
  function renderTermPeople() {
    var q = ($('termSearch').value || '').toLowerCase();
    var current = $('termPerson').value;
    var list = termPeopleCache.filter(function (p) {
      return !q || p.name.toLowerCase().indexOf(q) >= 0 || p.id.toLowerCase().indexOf(q) >= 0 || (p.phone || '').indexOf(q) >= 0;
    });
    $('termPerson').innerHTML = list.length
      ? list.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' — ' + esc(p.id) + '</option>'; }).join('')
      : '<option value="">' + (termPeopleCache.length ? 'No one matches that search' : 'No one enrolled on this device yet') + '</option>';
    if (list.some(function (p) { return p.id === current; })) $('termPerson').value = current;
    else if (list.length) $('termPerson').value = list[0].id; // first fill: select the first person explicitly - an innerHTML rebuild can otherwise leave the dropdown showing a name while its value stays empty (found by the 2026-11-20 end-to-end test)
    fillTermMethods();
  }
  function fillTerminalPeople() {
    return DB.all('people').then(function (people) {
      termPeopleCache = people;
      renderTermPeople();
    });
  }
  // Method list shows ONLY what the selected person actually enrolled.
  function fillTermMethods() {
    var person = termPeopleCache.find(function (p) { return p.id === $('termPerson').value; }) || null;
    var current = $('termMethod').value;
    var available = ENROLL_ORDER.filter(function (m) { return personHasMethod(person, m); });
    $('termMethod').innerHTML = available.length
      ? available.map(function (m) { return '<option value="' + m + '">' + esc(METHOD_LABEL[m]) + (m === 'palm' ? ' — Palmprint' : m === 'finger' ? ' (camera)' : '') + '</option>'; }).join('')
      : '<option value="">No biometrics enrolled for this person</option>';
    if (available.indexOf(current) >= 0) $('termMethod').value = current;
    $('termMethodNote').textContent = person
      ? (available.length ? person.name + ' enrolled: ' + available.map(function (m) { return METHOD_LABEL[m]; }).join(', ') + '.' : person.name + ' has no usable biometric enrolled - re-enroll this person first.')
      : '';
    $('termMethod').dispatchEvent(new Event('change'));
  }
  function personHasMethod(person, method) {
    // An enrollment only counts if the stored data is present AND sane -
    // a missing, empty or degenerate template can never be verified against.
    if (!person) return false;
    if (method === 'face') return B.faceDescriptorSane(person.faceDescriptor);
    if (method === 'palm') return B.palmprintProfileSane(person.palmProfile) || B.palmProfileSane(person.palmProfile) || B.palmDescriptorSane(person.palmDescriptor);
    return B.fingerprintRecordSane(person.fingerprint);
  }
  function notEnrolledMessage(person, method) {
    return 'This person has no ' + METHOD_LABEL[method] + ' enrolled - choose a method they enrolled. ' +
      esc(person.name) + ' enrolled: ' +
      ['face', 'palm', 'finger'].filter(function (m) { return personHasMethod(person, m); }).map(function (m) { return METHOD_LABEL[m]; }).join(', ') + '.';
  }
  function getTerminalPerson() {
    var personId = $('termPerson').value;
    return DB.all('people').then(function (people) {
      return people.find(function (p) { return p.id === personId; }) || null;
    });
  }
  $('termMethod').addEventListener('change', function () {
    var m = $('termMethod').value;
    $('termGuide').className = m === 'finger' ? 'finger' : m === 'palm' ? 'hand' : 'oval';
    // The fingerprint preview pair belongs to finger scans only; on face
    // and palm scans it showed as two empty black boxes (v15 tidy-up).
    $('termFingerPreviews').classList.toggle('hidden', m !== 'finger');
    $('termScan').disabled = true;
    syncCamToggle('terminal');
    syncFlashToggle('terminal');
    setFlashNote('terminal', flashState[termFacingKey(m)] ? 'Flash is set On - it will light when this camera starts.' : '');
    applyMirror('termVideo', camFacing[termFacingKey(m)]);
    if (Cam.stream && Cam.video === $('termVideo')) startTermCamera();
  });
  $('termPerson').addEventListener('change', function () { $('termScan').disabled = true; fillTermMethods(); });
  $('termSearch').addEventListener('input', renderTermPeople);
  function startTermCamera() {
    var method = $('termMethod').value;
    var status = $('termStatus');
    getTerminalPerson().then(function (person) {
      if (!person) { $('termResult').innerHTML = '<div class="error">Select an enrolled person first. Enroll on this device if the registry is empty.</div>'; return; }
      if (!personHasMethod(person, method)) {
        Cam.stop(); Palm.stop();
        $('termScan').disabled = true;
        status.textContent = 'Camera not started.';
        $('termResult').innerHTML = '<div class="error">' + notEnrolledMessage(person, method) + '</div>';
        return;
      }
      if (method === 'face') loadFaceModel(status).catch(function () {});
      Cam.start($('termVideo'), camFacing[termFacingKey(method)], termFacingKey(method)).then(function () {
        status.textContent = method === 'finger' ? 'Camera on - fingertip 5-8 cm away, filling the guide.' : 'Camera on - position for the scan, then Run Scan.';
        $('termScan').disabled = false;
        if (method === 'palm') status.textContent = 'Camera on - tap SCAN, keep the whole hand inside the frame about 30 cm away, and follow the movement prompts shown during the recording - the sequence is picked at random for each scan and must be completed promptly, in order.';
      }).catch(function (e) { $('termResult').innerHTML = cameraErrorHTML(e); status.textContent = 'Camera blocked.'; });
    });
  }
  $('termStart').addEventListener('click', startTermCamera);
  camRestarters.terminal = startTermCamera;

  function logVerification(person, method, measured, result) {
    return DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: $('termStore').value, method: method, measured: measured, result: result });
  }

  /* ---------------- Field Test Mode (v18) -------------------------------
     When ON, every terminal palm scan also writes a field-test record
     (kind 'fieldtest' in the logs store): camera, auto lighting tag,
     genuine score, highest score against any OTHER enrolled palm,
     liveness result, operator-set attempt type, and the outcome. The
     Logs panel turns those records into GAR / FAR / spoof-rejection
     metrics and the exportable CSV via the pure functions in
     biometrics.js, so screen, CSV and tests always agree. */
  function fieldModeOn() { try { return localStorage.getItem('biomFieldMode') === '1'; } catch (e) { return false; } }
  function setFieldMode(on) {
    try { localStorage.setItem('biomFieldMode', on ? '1' : '0'); } catch (e) {}
    if ($('fieldModeToggle')) $('fieldModeToggle').checked = on;
    if ($('fieldModeToggle2')) $('fieldModeToggle2').checked = on;
    if ($('fieldRow')) $('fieldRow').classList.toggle('hidden', !on);
  }
  function currentCameraTag(viewKey) {
    try {
      var track = Cam.stream && Cam.stream.getVideoTracks()[0];
      var f = track && track.getSettings && track.getSettings().facingMode;
      if (f === 'user') return 'front';
      if (f === 'environment') return 'back';
    } catch (e) {}
    return camFacing[viewKey] === 'environment' ? 'back' : 'front';
  }
  function writeFieldRecord(rec) {
    rec.kind = 'fieldtest';
    return DB.put('logs', rec).then(function () { renderFieldPanel(); });
  }

  $('termScan').addEventListener('click', function () {
    var personId = $('termPerson').value;
    var method = $('termMethod').value;
    var amount = Number($('termAmount').value || 0);
    $('termResult').innerHTML = '<div class="notice">Scanning — comparing against the stored enrollment...</div>';
    DB.all('people').then(function (people) {
      var person = people.find(function (p) { return p.id === personId; });
      if (!person) { $('termResult').innerHTML = '<div class="error">Select an enrolled person first. Enroll on this device if the registry is empty.</div>'; return null; }
      if (!personHasMethod(person, method)) {
        $('termResult').innerHTML = '<div class="error">' + notEnrolledMessage(person, method) + ' No scan was run and nothing was verified.</div>';
        return null;
      }

      var attempt;
      if (method === 'face') {
        attempt = detectFaceDescriptor($('termVideo')).then(function (live) {
          if (!live) return { fail: 'No face detected in the live frame. Nothing was verified.' };
          var r = B.verifyFace(person.faceDescriptor, live);
          return { r: r, measured: 'Euclidean distance ' + (r.distance === null ? 'n/a' : r.distance.toFixed(3)) + ' (threshold ' + r.threshold + ')' };
        });
      } else if (method === 'palm') {
        if (palmScanBusy) return null;
        palmScanBusy = true;
        $('termScan').disabled = true;
        var sequence = B.PALM_SEQUENCES[Math.floor(Math.random() * B.PALM_SEQUENCES.length)];
        $('termResult').innerHTML = '<div class="notice">Recording palm clip — this scan has issued a random live sequence (' + esc(sequence.label) + '). Follow the prompts on the camera view, in order and promptly...</div>';
        attempt = capturePalmResults($('termVideo'), $('termStatus'), false, function () {
          var k = termFacingKey($('termMethod').value);
          camFacing[k] = camFacing[k] === 'user' ? 'environment' : 'user';
          syncCamToggle('terminal');
          return Cam.start($('termVideo'), camFacing[k], 'terminal');
        }, sequence).then(function (res) {
          palmScanBusy = false;
          $('termScan').disabled = false;
          var fieldRec = function (genuineScore, impostorMax, liveness, result) {
            if (!fieldModeOn()) return;
            writeFieldRecord({
              ts: Date.now(), biomId: person.id, camera: currentCameraTag(termFacingKey('palm')),
              lighting: res.lightTag || '', genuineScore: genuineScore, impostorMax: impostorMax,
              liveness: liveness, spoofTag: $('fieldAttemptTag').value, result: result
            });
          };
          if (res.spoof && res.spoof.spoof) {
            var spoofMeasured = 'Spoof score ' + res.spoof.score.toFixed(2) + ' - ' + res.spoof.reasons.join('; ');
            logVerification(person, 'palm', spoofMeasured, 'Spoof / Screen Replay Detected');
            fieldRec(null, null, 'fail', 'rejected');
            return { fail: 'Spoof / Screen Replay Detected — the scan showed a screen or a recording, not a live hand (' + res.spoof.reasons.join('; ') + '). Nothing was verified. Present the real hand, live in front of the camera.' };
          }
          if (!res.movement.pass) { fieldRec(null, null, 'fail', 'rejected'); return { fail: 'Movement check not completed in either recording attempt - nothing was verified. During the recording the customer must follow the issued sequence (' + sequence.label + ') as prompted, in order and inside the time window. A still photo or a pre-recorded video cannot pass. (' + res.movement.reason + ')' }; }
          if (B.palmprintProfileSane(person.palmProfile)) {
            var liveCodes = B.selectPalmprintLiveCodes(res.results);
            if (!liveCodes) { fieldRec(null, null, 'pass', 'rejected'); return { fail: 'No usable open palm with readable print detail found in the recorded clip. Nothing was verified. Hold one open palm still, fingers spread, filling the guide in good light, and run the scan again.' }; }
            var rp3 = B.verifyPalmprintProfile(person.palmProfile, liveCodes);
            var impostorMax = null;
            people.forEach(function (p) {
              if (p.id === person.id || !B.palmprintProfileSane(p.palmProfile)) return;
              var ro = B.verifyPalmprintProfile(p.palmProfile, liveCodes);
              if (ro && typeof ro.similarity === 'number' && (impostorMax === null || ro.similarity > impostorMax)) impostorMax = ro.similarity;
            });
            fieldRec(rp3.similarity, impostorMax, 'pass', rp3.verified ? 'verified' : 'rejected');
            var measured3 = 'Palmprint similarity ' + (rp3.similarity === null ? 'n/a' : rp3.similarity.toFixed(3)) + ' (threshold ' + rp3.threshold + ', best of ' + person.palmProfile.codes.length + ' enrolled print codes x ' + liveCodes.length + ' live codes), live movement sequence ' + sequence.id + ' passed in recorded clip';
            return { r: rp3, measured: measured3 };
          }
          var livePalm = B.selectPalmDescriptor(res.results);
          if (!livePalm) { fieldRec(null, null, 'pass', 'rejected'); return { fail: 'No usable open palm found in the recorded clip. Nothing was verified. Hold one open palm still, fingers spread, filling the guide, and run the scan again.' }; }
          var storedPalm = person.palmProfile || person.palmDescriptor;
          var rp = B.verifyPalmProfile(storedPalm, { geometry: livePalm, texture: res.bestTexture });
          fieldRec(null, null, 'pass', rp.verified ? 'verified' : 'rejected');
          var palmMeasured = 'Geometry distance ' + (rp.distance === null ? 'n/a' : rp.distance.toFixed(3)) + ' (threshold ' + rp.threshold + ', best of ' + (person.palmProfile ? person.palmProfile.geometry.length : 1) + ' enrolled captures)' +
            (rp.textureSimilarity !== null && rp.textureSimilarity !== undefined ? ', palm texture similarity ' + rp.textureSimilarity.toFixed(3) + ' (realness floor ' + rp.textureThreshold + ')' : ', no texture gate (legacy enrollment)') +
            ', live movement sequence ' + sequence.id + ' passed in recorded clip';
          return { r: rp, measured: palmMeasured };
        }).catch(function (e) {
          palmScanBusy = false;
          $('termScan').disabled = false;
          return { fail: 'Palm clip failed: ' + (e && e.message ? e.message : e) + ' Nothing was verified.' };
        });
      } else {
        var cap;
        try { cap = captureFinger($('termVideo'), $('termFingerOriginal'), $('termFingerRidge')); }
        catch (e) { $('termResult').innerHTML = cameraErrorHTML(e); return null; }
        if (!cap.record) {
          $('termResult').innerHTML = '<div class="error">Fingerprint rejected by the quality gate: ' + esc(cap.quality.reason) + ' Nothing was verified.</div>';
          return null;
        }
        var rf = B.verifyFingerprint(person.fingerprint, cap.record);
        attempt = Promise.resolve({ r: rf, measured: 'Template correlation ' + (rf.correlation === null ? 'n/a' : rf.correlation.toFixed(3)) + ' (needs ' + rf.threshold + '), texture similarity ' + (rf.textureSimilarity === null ? 'n/a' : rf.textureSimilarity.toFixed(3)) + ' (needs ' + rf.textureThreshold + ') - both must pass' });
      }

      return Promise.resolve(attempt).then(function (out) {
        if (!out) return;
        if (out.fail) { $('termResult').innerHTML = '<div class="error">' + esc(out.fail) + '</div>'; return; }
        var r = out.r;
        var verified = r.ok === true && r.verified === true; // fail closed: only an explicit pass verifies
        return logVerification(person, method, out.measured, verified ? 'Verified' : 'Denied').then(function () {
          var html;
          if (!verified) {
            html = '<div class="resultbig bad"><div class="verdict">NOT VERIFIED</div><div class="who">' + esc(person.name) + ' — ' + esc(METHOD_LABEL[method]) + ' scan did not match</div><div class="meas">' + esc(r.reason) + '<br>Measured: ' + esc(out.measured) + '</div></div>';
            $('termResult').innerHTML = html;
            return;
          }
          html = '<div class="resultbig ok"><div class="verdict">VERIFIED</div><div class="who">' + esc(person.name) + ' (' + esc(person.id) + ')</div><div class="meas">Measured: ' + esc(out.measured) + '</div></div>';
          // Palm Loyalty (live mode, v18): every verified palm scan
          // earns points - 1 per BDT 10 on a payment, 5 for a visit
          // scan - credited to the customer's Biom ID record.
          var loyaltyLine = '';
          if (method === 'palm') {
            var pts = amount > 0 ? Math.floor(amount / 10) : 5;
            if (pts > 0) {
              person.loyaltyPoints = (person.loyaltyPoints || 0) + pts;
              loyaltyLine = '<div class="notice" style="margin-top:10px">Palm Loyalty: +' + pts + ' points awarded — balance ' + person.loyaltyPoints + ' points.</div>';
              DB.put('people', person);
            }
          }
          if (amount > 0) {
            if (!person.walletProvider) {
              $('termResult').innerHTML = html + loyaltyLine + '<div class="error" style="margin-top:10px">Biom Pay not created: this person has no linked bKash / Nagad wallet.</div>';
              return;
            }
            var createPay = function () {
              return DB.nextSeq('paySeq', 1001).then(function (seq) {
                var tx = {
                  id: 'BIOM-PAY-' + seq, ts: Date.now(), personId: person.id, personName: person.name,
                  provider: person.walletProvider, walletMasked: B.maskWalletNumber(person.walletNumber),
                  store: $('termStore').value, amount: amount, method: method, measured: out.measured, status: PAY_STATUS
                };
                return DB.put('transactions', tx).then(function () {
                  $('termResult').innerHTML = html + loyaltyLine +
                    '<div class="receipt"><div class="rhead">Biom Pay — Payment Authorized</div><div class="kv">' +
                    '<b>Amount:</b> BDT ' + tx.amount.toLocaleString() + '<br>' +
                    '<b>Paid by:</b> ' + esc(person.name) + '<br>' +
                    '<b>Wallet:</b> ' + esc(tx.provider) + ' ' + esc(tx.walletMasked) + '<br>' +
                    '<b>Record ID:</b> ' + esc(tx.id) + ' (TSG Biom record — not a ' + esc(tx.provider) + ' TrxID)<br>' +
                    '<b>Store:</b> ' + esc(tx.store) + '<br><b>Authorized by:</b> ' + esc(METHOD_LABEL[method]) + ' scan — ' + esc(out.measured) + '<br>' +
                    '<b>Status:</b> ' + esc(tx.status) + '</div></div>';
                  toast('Biom Pay authorized: ' + tx.id);
                });
              });
            };
            // Biometric-only limits set at registration (regBIOM): above
            // a limit the palm alone does not create a payment - PIN
            // confirmation is required, so nothing is recorded as paid.
            if (person.limits && person.limits.perTx && amount > person.limits.perTx) {
              $('termResult').innerHTML = html + loyaltyLine + '<div class="error" style="margin-top:10px">Biom Pay not created: BDT ' + amount.toLocaleString() + ' exceeds this customer\'s biometric-only per-transaction limit of BDT ' + person.limits.perTx.toLocaleString() + '. PIN confirmation is required above the limit.</div>';
              return;
            }
            if (person.limits && person.limits.daily) {
              return DB.all('transactions').then(function (txs) {
                var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
                var todaySum = txs.filter(function (t) { return t.personId === person.id && t.ts >= dayStart.getTime(); }).reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
                if (todaySum + amount > person.limits.daily) {
                  $('termResult').innerHTML = html + loyaltyLine + '<div class="error" style="margin-top:10px">Biom Pay not created: this payment would take today\'s total to BDT ' + (todaySum + amount).toLocaleString() + ', above this customer\'s biometric-only daily limit of BDT ' + person.limits.daily.toLocaleString() + '. PIN confirmation is required above the limit.</div>';
                  return;
                }
                return createPay();
              });
            }
            return createPay();
          }
          $('termResult').innerHTML = html + loyaltyLine;
        });
      });
    }).catch(function (e) { $('termResult').innerHTML = '<div class="error">Scan failed: ' + esc(e && e.message ? e.message : e) + '</div>'; });
  });

  /* ---------------- Registry & logs -------------------------------------- */
  function renderRegistry() {
    var q = ($('registrySearch').value || '').toLowerCase();
    return DB.all('people').then(function (people) {
      var rows = people.filter(function (p) {
        return !q || p.name.toLowerCase().indexOf(q) >= 0 || p.id.toLowerCase().indexOf(q) >= 0 || (p.phone || '').indexOf(q) >= 0;
      }).map(function (p) {
        return '<tr><td><b>' + esc(p.name) + '</b><br><span style="color:var(--muted)">' + esc(p.phone || '') + '</span>' + (p.loyaltyPoints ? '<br><span style="color:var(--muted)">Loyalty: ' + p.loyaltyPoints + ' pts</span>' : '') + '</td>' +
          '<td>' + esc(p.id) + '</td><td>' + esc(p.type) + '<br><span style="color:var(--muted)">' + esc(p.store) + '</span></td>' +
          '<td>' + (personHasMethod(p, 'face') ? '<span class="badge ok">Enrolled</span>' : '<span class="badge bad">Not enrolled</span>') + '</td>' +
          '<td>' + (personHasMethod(p, 'palm') ? '<span class="badge ok">Enrolled</span>' : '<span class="badge bad">Not enrolled</span>') + '</td>' +
          '<td>' + (personHasMethod(p, 'finger') ? '<img class="thumb" src="' + p.fingerprint.ridgeImage + '" alt="Captured fingerprint ridges"><br><span class="badge ok">Enrolled</span>' : '<span class="badge bad">Not enrolled</span>') + '</td>' +
          '<td>' + (p.walletProvider ? esc(p.walletProvider) + '<br>' + esc(B.maskWalletNumber(p.walletNumber)) : '—') + '</td>' +
          '<td><button class="btn small" data-verify="' + esc(p.id) + '">Verify</button></td></tr>';
      }).join('');
      $('registryBody').innerHTML = rows || '<tr><td colspan="8" style="color:var(--muted)">No enrollments on this device yet.</td></tr>';
      document.querySelectorAll('[data-verify]').forEach(function (b) {
        b.addEventListener('click', function () {
          go('terminal');
          $('termSearch').value = '';
          renderTermPeople();
          $('termPerson').value = b.dataset.verify;
          fillTermMethods();
        });
      });
    });
  }
  $('registrySearch').addEventListener('input', renderRegistry);

  function renderFieldPanel() {
    if (!$('fieldStats')) return Promise.resolve();
    return DB.all('logs').then(function (logs) {
      var recs = logs.filter(function (l) { return l.kind === 'fieldtest'; });
      var st = B.fieldTestStats(recs);
      var fmt = function (v) { return v === null ? '—' : v + '%'; };
      $('fieldStats').innerHTML = '<b>Scans recorded:</b> ' + recs.length + ' of 200<br>' +
        '<b>Genuine Accept Rate (GAR):</b> ' + fmt(st.genuine.gar) + ' — ' + st.genuine.accepted + ' of ' + st.genuine.attempts + ' real-hand attempts verified<br>' +
        '<b>False Accept Rate (FAR):</b> ' + fmt(st.impostor.far) + ' — ' + st.impostor.falseAccepts + ' of ' + st.impostor.attempts + ' genuine attempts reached the threshold against another enrolled palm<br>' +
        '<b>Spoof Rejection Rate:</b> ' + fmt(st.spoof.rejectionRate) + ' — ' + st.spoof.rejected + ' of ' + st.spoof.attempts + ' photo / video attempts rejected';
    });
  }

  function renderLogs() {
    return Promise.all([DB.all('transactions'), DB.all('logs')]).then(function (r) {
      var txs = r[0].slice().sort(function (a, b) { return b.ts - a.ts; });
      var logs = r[1].filter(function (l) { return l.kind !== 'fieldtest'; }).sort(function (a, b) { return b.ts - a.ts; });
      var dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      var todayTxs = txs.filter(function (t) { return t.ts >= dayStart.getTime(); });
      var todayTotal = todayTxs.reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
      $('dailySheet').innerHTML = '<b>Biom Pay transactions today:</b> ' + todayTxs.length + '<br><b>Total authorised today:</b> BDT ' + todayTotal.toLocaleString() + '<br><b>Status of all:</b> ' + esc(PAY_STATUS);
      $('txBody').innerHTML = txs.map(function (t) {
        return '<tr><td>' + esc(t.id) + '</td><td>' + esc(fmtTime(t.ts)) + '</td><td>' + esc(t.personName) + '</td><td>' + esc(t.provider) + '</td><td>' + esc(t.walletMasked) + '</td><td>' + esc(t.store) + '</td><td>BDT ' + Number(t.amount).toLocaleString() + '</td><td>' + esc(t.status) + '</td></tr>';
      }).join('') || '<tr><td colspan="8" style="color:var(--muted)">No Biom Pay transactions yet.</td></tr>';
      $('logBody').innerHTML = logs.map(function (l) {
        return '<tr><td>' + esc(fmtTime(l.ts)) + '</td><td>' + esc(l.personName) + '</td><td>' + esc(l.store) + '</td><td>' + esc(l.method) + '</td><td>' + esc(l.measured) + '</td><td><span class="badge ' + (l.result === 'Verified' ? 'ok' : 'bad') + '">' + esc(l.result) + '</span></td></tr>';
      }).join('') || '<tr><td colspan="6" style="color:var(--muted)">No verifications yet.</td></tr>';
      return renderFieldPanel();
    });
  }

  $('fieldExportBtn').addEventListener('click', function () {
    DB.all('logs').then(function (logs) {
      var recs = logs.filter(function (l) { return l.kind === 'fieldtest'; }).sort(function (a, b) { return a.ts - b.ts; });
      var blob = new Blob([B.fieldTestCsv(recs)], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tsg-biom-field-test.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      toast(recs.length ? 'Field test CSV exported — ' + recs.length + ' scans.' : 'No field-test scans recorded yet; the CSV holds only its header.');
    });
  });
  $('fieldModeToggle').addEventListener('change', function () { setFieldMode(this.checked); toast(this.checked ? 'Field Test Mode ON — terminal palm scans are being recorded for the gate.' : 'Field Test Mode OFF.'); });
  $('fieldModeToggle2').addEventListener('change', function () { setFieldMode(this.checked); toast(this.checked ? 'Field Test Mode ON — terminal palm scans are being recorded for the gate.' : 'Field Test Mode OFF.'); });

  /* ---------------- Install (PWA) ---------------------------------------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; });
  function install() {
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function () { deferredPrompt = null; }); return; }
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    toast(isIOS ? 'To install: tap Share, then "Add to Home Screen".' : 'To install: open the Chrome menu and choose "Install app" / "Add to Home screen". If it does not appear, this page may already be installed or opened in an in-app browser - open it in Chrome.');
  }
  $('installBtn').addEventListener('click', install);
  $('installBtn2').addEventListener('click', install);

  /* ---------------- Boot --------------------------------------------------- */
  window.TSGApp = { go: go };
  wireCamToggles();
  wireFlashToggles();
  setFieldMode(fieldModeOn());
  syncCamToggle('terminal');
  ['enrollFace', 'enrollPalm', 'enrollFinger', 'terminal'].forEach(function (g) { syncFlashToggle(g); });
  fillStoreSelects();
  DB.open().then(function () { renderDashboard(); fillTerminalPeople(); });
})();
