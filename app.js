/* TSG Biom PWA - app logic. Real scanning only; every verification result in
   this file comes from TSGBiometrics comparisons of real captured data. */
(function () {
  'use strict';
  var B = window.TSGBiometrics;
  var STORES = ['GreenCare Pharmacy (CVS)', 'FreshMart Supermarket', 'UrbanStyle Retail', 'City Centre Mall'];
  var PAY_STATUS = 'Biometric Authorized - Pending bKash Partner API Settlement';

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
    stream: null, video: null,
    start: function (video, facingMode) {
      this.stop();
      this.video = video;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('This browser does not expose a camera (getUserMedia unavailable). Open TSG Biom over HTTPS in Chrome or Safari.'));
      }
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
      }).then(function (stream) {
        Cam.stream = stream;
        video.srcObject = stream;
        return video.play().then(function () {
          // Best-effort torch for the rear camera fingerprint step.
          try {
            var track = stream.getVideoTracks()[0];
            var caps = track && track.getCapabilities ? track.getCapabilities() : {};
            if (caps && caps.torch) track.applyConstraints({ advanced: [{ torch: true }] }).catch(function () {});
          } catch (e) {}
          return stream;
        });
      });
    },
    stop: function () {
      if (this.stream) { this.stream.getTracks().forEach(function (t) { t.stop(); }); this.stream = null; }
      if (this.video) { try { this.video.srcObject = null; } catch (e) {} }
    }
  };

  function cameraErrorHTML(err) {
    return '<div class="error">Camera unavailable: ' + esc(err && err.message ? err.message : err) +
      '<br>Allow camera permission for this site and retry. TSG Biom does not simulate a scan when the camera is blocked.</div>';
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
  function detectFaceDescriptor(video) {
    return loadFaceModel().then(function () {
      return faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks().withFaceDescriptor();
    }).then(function (det) {
      if (!det) return null;
      return Array.from(det.descriptor);
    });
  }

  /* ---------------- Palm (MediaPipe Hands) ------------------------------- */
  var Palm = {
    hands: null, latest: null, running: false, video: null,
    init: function () {
      if (this.hands) return;
      var self = this;
      this.hands = new Hands({ locateFile: function (f) { return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/' + f; } });
      this.hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      this.hands.onResults(function (res) {
        self.latest = (res.multiHandLandmarks && res.multiHandLandmarks[0]) ? res.multiHandLandmarks[0] : null;
      });
    },
    startLoop: function (video, statusEl) {
      this.init();
      this.video = video; this.running = true;
      var self = this;
      (function loop() {
        if (!self.running) return;
        if (video.readyState >= 2) {
          self.hands.send({ image: video }).then(function () {
            if (statusEl) statusEl.textContent = self.latest ? 'Hand detected - hold still and capture.' : 'Show one open palm to the camera...';
          }).catch(function () {});
        }
        setTimeout(loop, 120);
      })();
    },
    stop: function () { this.running = false; this.latest = null; }
  };

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
    var quality = B.fingerprintQuality(stretched, size, size, ridge);
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
    document.querySelectorAll('#mainNav button').forEach(function (b) { b.classList.toggle('active', b.dataset.page === page); });
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
  var enroll = { details: null, face: null, palm: null, finger: null };
  function setStep(step) {
    document.querySelectorAll('#enrollSteps span').forEach(function (s) {
      var order = ['details', 'face', 'palm', 'finger', 'done'];
      s.classList.toggle('on', s.dataset.step === step);
      s.classList.toggle('done', order.indexOf(s.dataset.step) < order.indexOf(step));
    });
    ['details', 'face', 'palm', 'finger', 'done'].forEach(function (s) {
      $('enroll-' + s).classList.toggle('hidden', s !== step);
    });
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
    if (err) { $('enrollDetailsError').innerHTML = '<div class="error">' + esc(err) + '</div>'; return; }
    $('enrollDetailsError').innerHTML = '';
    enroll.details = {
      name: name, phone: $('enPhone').value.trim(), type: $('enType').value, store: $('enStore').value,
      walletProvider: provider || '', walletNumber: wallet || ''
    };
    setStep('face');
  });

  /* Face enroll */
  var faceWatch = null;
  function stopFaceWatch() { if (faceWatch) { clearInterval(faceWatch); faceWatch = null; } }
  $('faceStart').addEventListener('click', function () {
    var status = $('faceStatus');
    loadFaceModel(status).catch(function () {});
    Cam.start($('faceVideo'), 'user').then(function () {
      status.textContent = 'Loading face model / looking for a face...';
      stopFaceWatch();
      faceWatch = setInterval(function () {
        detectFaceDescriptor($('faceVideo')).then(function (desc) {
          if (desc) { status.textContent = 'Face detected - hold still and capture.'; $('faceCapture').disabled = false; }
          else { status.textContent = 'No face detected - face the camera in good light.'; $('faceCapture').disabled = true; }
        }).catch(function () { status.textContent = 'Face model still loading...'; });
      }, 900);
    }).catch(function (e) { $('faceMsg').innerHTML = cameraErrorHTML(e); status.textContent = 'Camera blocked.'; });
  });
  $('faceCapture').addEventListener('click', function () {
    detectFaceDescriptor($('faceVideo')).then(function (desc) {
      if (!desc) { $('faceMsg').innerHTML = '<div class="error">No face detected in this frame. Nothing was stored. Reposition and capture again.</div>'; return; }
      enroll.face = desc; stopFaceWatch(); Cam.stop();
      $('faceMsg').innerHTML = '<div class="success">Real face descriptor captured (128 points).</div>';
      setStep('palm');
    });
  });

  /* Palm enroll */
  $('palmStart').addEventListener('click', function () {
    Cam.start($('palmVideo'), 'user').then(function () {
      Palm.startLoop($('palmVideo'), $('palmStatus'));
      var iv = setInterval(function () { $('palmCapture').disabled = !Palm.latest; if (!Palm.running) clearInterval(iv); }, 300);
    }).catch(function (e) { $('palmMsg').innerHTML = cameraErrorHTML(e); $('palmStatus').textContent = 'Camera blocked.'; });
  });
  $('palmCapture').addEventListener('click', function () {
    var desc = Palm.latest ? B.palmDescriptorFromLandmarks(Palm.latest) : null;
    if (!desc) { $('palmMsg').innerHTML = '<div class="error">No hand landmarks available. Nothing was stored. Show an open palm and retry.</div>'; return; }
    enroll.palm = desc; Palm.stop(); Cam.stop();
    $('palmMsg').innerHTML = '<div class="success">Real palm hand-geometry descriptor captured (30 measures from 21 landmarks).</div>';
    setStep('finger');
  });

  /* Finger enroll */
  $('fingerStart').addEventListener('click', function () {
    Cam.start($('fingerVideo'), 'environment').then(function () {
      $('fingerStatus').textContent = 'Rear camera on - fingertip 5-8 cm away, filling the guide.';
      $('fingerCapture').disabled = false;
    }).catch(function (e) { $('fingerMsg').innerHTML = cameraErrorHTML(e); $('fingerStatus').textContent = 'Camera blocked.'; });
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
    if (!enroll.details || !enroll.face || !enroll.palm || !enroll.finger) {
      $('fingerMsg').innerHTML = '<div class="error">Enrollment is incomplete - face, palm and fingerprint are all required.</div>'; return;
    }
    Cam.stop();
    DB.nextSeq('biomSeq', 2841).then(function (seq) {
      var person = {
        id: 'TSG-BIO-' + seq,
        name: enroll.details.name, phone: enroll.details.phone, type: enroll.details.type, store: enroll.details.store,
        walletProvider: enroll.details.walletProvider, walletNumber: enroll.details.walletNumber,
        faceDescriptor: enroll.face, palmDescriptor: enroll.palm,
        fingerprint: { template: enroll.finger.template, texture: enroll.finger.texture, quality: enroll.finger.quality, ridgeImage: enroll.finger.ridgeImage },
        enrolledAt: Date.now()
      };
      return DB.put('people', person).then(function () {
        setStep('done');
        $('enrollDoneBody').innerHTML =
          '<b>Name:</b> ' + esc(person.name) + '<br><b>Biom ID:</b> ' + esc(person.id) + '<br>' +
          '<b>Store:</b> ' + esc(person.store) + '<br><b>Face:</b> enrolled (128-d descriptor)<br>' +
          '<b>Palm:</b> enrolled (hand geometry)<br><b>Fingerprint:</b> enrolled (camera template, quality ' + person.fingerprint.quality.sharpness.toFixed(1) + ')<br>' +
          '<b>Wallet:</b> ' + (person.walletProvider ? esc(person.walletProvider) + ' ' + esc(B.maskWalletNumber(person.walletNumber)) : 'Not linked');
        enroll = { details: null, face: null, palm: null, finger: null };
        toast('Enrolled: ' + person.id);
      });
    }).catch(function (e) { $('fingerMsg').innerHTML = '<div class="error">Could not save enrollment on this device: ' + esc(e.message || e) + '</div>'; });
  });

  /* ---------------- Terminal --------------------------------------------- */
  function fillTerminalPeople() {
    return DB.all('people').then(function (people) {
      $('termPerson').innerHTML = people.length
        ? people.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' — ' + esc(p.id) + '</option>'; }).join('')
        : '<option value="">No one enrolled on this device yet</option>';
    });
  }
  $('termMethod').addEventListener('change', function () {
    var m = $('termMethod').value;
    $('termGuide').className = m === 'finger' ? 'finger' : m === 'palm' ? 'hand' : 'oval';
    $('termScan').disabled = true;
  });
  $('termStart').addEventListener('click', function () {
    var method = $('termMethod').value;
    var status = $('termStatus');
    if (method === 'face') loadFaceModel(status).catch(function () {});
    Cam.start($('termVideo'), method === 'finger' ? 'environment' : 'user').then(function () {
      status.textContent = method === 'finger' ? 'Rear camera on - fingertip 5-8 cm away, filling the guide.' : 'Camera on - position for the scan, then Run Scan.';
      $('termScan').disabled = false;
      if (method === 'palm') Palm.startLoop($('termVideo'), status);
    }).catch(function (e) { $('termResult').innerHTML = cameraErrorHTML(e); status.textContent = 'Camera blocked.'; });
  });

  function logVerification(person, method, measured, result) {
    return DB.put('logs', { ts: Date.now(), personId: person.id, personName: person.name, store: $('termStore').value, method: method, measured: measured, result: result });
  }

  $('termScan').addEventListener('click', function () {
    var personId = $('termPerson').value;
    var method = $('termMethod').value;
    var amount = Number($('termAmount').value || 0);
    $('termResult').innerHTML = '<div class="notice">Scanning — comparing against the stored enrollment...</div>';
    DB.all('people').then(function (people) {
      var person = people.find(function (p) { return p.id === personId; });
      if (!person) { $('termResult').innerHTML = '<div class="error">Select an enrolled person first. Enroll on this device if the registry is empty.</div>'; return null; }

      var attempt;
      if (method === 'face') {
        attempt = detectFaceDescriptor($('termVideo')).then(function (live) {
          if (!live) return { fail: 'No face detected in the live frame. Nothing was verified.' };
          var r = B.verifyFace(person.faceDescriptor, live);
          return { r: r, measured: 'Euclidean distance ' + (r.distance === null ? 'n/a' : r.distance.toFixed(3)) + ' (threshold ' + r.threshold + ')' };
        });
      } else if (method === 'palm') {
        var livePalm = Palm.latest ? B.palmDescriptorFromLandmarks(Palm.latest) : null;
        if (!livePalm) { $('termResult').innerHTML = '<div class="error">No hand detected in the live frame. Nothing was verified. Show an open palm and run the scan again.</div>'; return null; }
        var rp = B.verifyPalm(person.palmDescriptor, livePalm);
        attempt = Promise.resolve({ r: rp, measured: 'Geometry distance ' + rp.distance.toFixed(3) + ' (threshold ' + rp.threshold + ')' });
      } else {
        var cap;
        try { cap = captureFinger($('termVideo'), $('termFingerOriginal'), $('termFingerRidge')); }
        catch (e) { $('termResult').innerHTML = cameraErrorHTML(e); return null; }
        if (!cap.record) {
          $('termResult').innerHTML = '<div class="error">Fingerprint rejected by the quality gate: ' + esc(cap.quality.reason) + ' Nothing was verified.</div>';
          return null;
        }
        var rf = B.verifyFingerprint(person.fingerprint, cap.record);
        attempt = Promise.resolve({ r: rf, measured: 'Template correlation ' + rf.correlation.toFixed(3) + ', texture similarity ' + rf.textureSimilarity.toFixed(3) + ', score ' + rf.score.toFixed(3) + ' (threshold ' + rf.threshold + ')' });
      }

      return Promise.resolve(attempt).then(function (out) {
        if (!out) return;
        if (out.fail) { $('termResult').innerHTML = '<div class="error">' + esc(out.fail) + '</div>'; return; }
        var r = out.r;
        var verified = !!r.verified;
        return logVerification(person, method, out.measured, verified ? 'Verified' : 'Denied').then(function () {
          var html;
          if (!verified) {
            html = '<div class="error"><b>Denied.</b> ' + esc(r.reason) + '<br>Measured: ' + esc(out.measured) + '</div>';
            $('termResult').innerHTML = html;
            return;
          }
          html = '<div class="success"><b>Verified — ' + esc(person.name) + ' (' + esc(person.id) + ')</b><br>Measured: ' + esc(out.measured) + '</div>';
          if (amount > 0) {
            if (!person.walletProvider) {
              $('termResult').innerHTML = html + '<div class="error" style="margin-top:10px">Biom Pay not created: this person has no linked bKash / Nagad wallet.</div>';
              return;
            }
            return DB.nextSeq('paySeq', 1001).then(function (seq) {
              var tx = {
                id: 'BIOM-PAY-' + seq, ts: Date.now(), personId: person.id, personName: person.name,
                provider: person.walletProvider, walletMasked: B.maskWalletNumber(person.walletNumber),
                store: $('termStore').value, amount: amount, method: method, measured: out.measured, status: PAY_STATUS
              };
              return DB.put('transactions', tx).then(function () {
                $('termResult').innerHTML = html +
                  '<div class="card" style="margin-top:12px"><h2>Biom Pay receipt</h2><div class="kv">' +
                  '<b>Record ID:</b> ' + esc(tx.id) + ' (TSG Biom record — not a ' + esc(tx.provider) + ' TrxID)<br>' +
                  '<b>Amount:</b> BDT ' + tx.amount.toLocaleString() + '<br><b>Wallet:</b> ' + esc(tx.provider) + ' ' + esc(tx.walletMasked) + '<br>' +
                  '<b>Store:</b> ' + esc(tx.store) + '<br><b>Authorized by:</b> ' + esc(method) + ' scan — ' + esc(out.measured) + '<br>' +
                  '<b>Status:</b> ' + esc(tx.status) + '</div></div>';
                toast('Biom Pay authorized: ' + tx.id);
              });
            });
          }
          $('termResult').innerHTML = html;
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
        return '<tr><td><b>' + esc(p.name) + '</b><br><span style="color:var(--muted)">' + esc(p.phone || '') + '</span></td>' +
          '<td>' + esc(p.id) + '</td><td>' + esc(p.type) + '<br><span style="color:var(--muted)">' + esc(p.store) + '</span></td>' +
          '<td>' + (p.faceDescriptor ? '<span class="badge ok">Enrolled</span>' : '<span class="badge bad">Missing</span>') + '</td>' +
          '<td>' + (p.palmDescriptor ? '<span class="badge ok">Enrolled</span>' : '<span class="badge bad">Missing</span>') + '</td>' +
          '<td>' + (p.fingerprint ? '<img class="thumb" src="' + p.fingerprint.ridgeImage + '" alt="Captured fingerprint ridges">' : '<span class="badge bad">Missing</span>') + '</td>' +
          '<td>' + (p.walletProvider ? esc(p.walletProvider) + '<br>' + esc(B.maskWalletNumber(p.walletNumber)) : '—') + '</td>' +
          '<td><button class="btn small" data-verify="' + esc(p.id) + '">Verify</button></td></tr>';
      }).join('');
      $('registryBody').innerHTML = rows || '<tr><td colspan="8" style="color:var(--muted)">No enrollments on this device yet.</td></tr>';
      document.querySelectorAll('[data-verify]').forEach(function (b) {
        b.addEventListener('click', function () { go('terminal'); $('termPerson').value = b.dataset.verify; });
      });
    });
  }
  $('registrySearch').addEventListener('input', renderRegistry);

  function renderLogs() {
    return Promise.all([DB.all('transactions'), DB.all('logs')]).then(function (r) {
      var txs = r[0].slice().sort(function (a, b) { return b.ts - a.ts; });
      var logs = r[1].slice().sort(function (a, b) { return b.ts - a.ts; });
      $('txBody').innerHTML = txs.map(function (t) {
        return '<tr><td>' + esc(t.id) + '</td><td>' + esc(fmtTime(t.ts)) + '</td><td>' + esc(t.personName) + '</td><td>' + esc(t.provider) + '</td><td>' + esc(t.walletMasked) + '</td><td>' + esc(t.store) + '</td><td>BDT ' + Number(t.amount).toLocaleString() + '</td><td>' + esc(t.status) + '</td></tr>';
      }).join('') || '<tr><td colspan="8" style="color:var(--muted)">No Biom Pay transactions yet.</td></tr>';
      $('logBody').innerHTML = logs.map(function (l) {
        return '<tr><td>' + esc(fmtTime(l.ts)) + '</td><td>' + esc(l.personName) + '</td><td>' + esc(l.store) + '</td><td>' + esc(l.method) + '</td><td>' + esc(l.measured) + '</td><td><span class="badge ' + (l.result === 'Verified' ? 'ok' : 'bad') + '">' + esc(l.result) + '</span></td></tr>';
      }).join('') || '<tr><td colspan="6" style="color:var(--muted)">No verifications yet.</td></tr>';
    });
  }

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
  fillStoreSelects();
  DB.open().then(function () { renderDashboard(); fillTerminalPeople(); });
})();
