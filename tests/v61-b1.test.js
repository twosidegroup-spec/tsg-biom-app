/* TSG Biom — v61 regression: Phase B1, envelope encryption ALONE
   (team plan item 5; Seat 2's B1 spec as corrected by Seat 3's
   CD-1.2 — the packed EDCC pair is encrypted too — and Seat 1's
   B2 vault UX; coordinator decisions CD-2/CD-3/CD-6).

   What this suite proves, against the REAL biometrics.js and the
   REAL sync engine extracted from app.js:

   1. ENVELOPE: AES-GCM round-trips are byte-exact; the dual read
      passes pre-v61 plaintext through untouched; a wrong bank key
      fails closed (null) and never throws; sealing never
      double-seals.
   2. COVERAGE (list-checked): EVERY stored template
      representation is sealed by the conversion — the packed
      EDCC codes, the PalmNet Float32 embedding strings, and the
      archived legacy byte codes. The one remaining template
      representation, the transient live byte-code codec, is
      pinned as never persisted (it exists only in a capture
      session; the persisted bank is built from the packed codec).
   3. PARITY GATE (CD-3, the hard ship condition): for a fixed
      bank corpus, EDCC similarity, PalmNet cosine and the fused
      verdict computed from encrypt->decrypt round-tripped banks
      EQUAL the plaintext-bank values EXACTLY (===, no tolerance),
      for genuine and impostor probes alike.
   4. MIGRATION CONVERSION: a v60-shaped store's banks convert
      with honest counts, decrypt back deep-equal to the
      originals, and lose nothing — hand stamps, model stamps,
      wallet and every non-template field untouched; the pure
      chain's byte-identical v61 adoption is pinned in
      v38-migration.test.js.
   5. FAIL-SAFE: a key that cannot be derived, or the wrong key,
      leaves banks in their previous form, still readable, never
      bricked; conversion of an already-sealed bank is a no-op.
   6. SYNC SHAPE: with the vault dep wired, the engine posts
      ciphertext + enc:'v1' through the EXISTING profile shape;
      the API's own shape function (sibling repo, when present)
      keeps the marker and the strings verbatim; without the dep
      the engine posts plaintext exactly as v56 (proven there).
   7. VAULT: key wrap/unwrap under a passphrase and the recovery
      sheet encode/decode round-trip; the app source carries the
      vault card, the honest key-loss copy, the storage-boundary
      wiring and the v61 boot order.

   All numbers here are RIG numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bioSrc = fs.readFileSync(path.join(__dirname, '..', 'biometrics.js'), 'utf8');

/* ---------- fixture palms (the migration suite's generators) --- */
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = opts.roiSize || 128, rnd = lcg(seed);
  const noiseAmp = opts.noiseAmp != null ? opts.noiseAmp : 12;
  const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const dx = opts.dx || 0, dy = opts.dy || 0, bright = opts.bright || 0;
  const g = new Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x + dx, py = y + dy;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7 + bright;
    for (const c of creases) {
      if (c.vert) {
        const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp;
        const d = Math.abs(px - lx);
        if (d < 3) v -= (3 - d) * 30;
      } else {
        const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp;
        const d = Math.abs(py - ly);
        if (d < 3) v -= (3 - d) * 30;
      }
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));  }
  return g;
}
const PALM_A = [{ a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 }, { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true }];
const PALM_B = [{ a: -0.05, b: 38, f: 0.04, p: 2, amp: 5 }, { a: 0.18, b: 55, f: 0.07, p: 1, amp: 3 }, { a: -0.5, b: 118, f: 0.05, p: 4, amp: 4 }, { a: 0.85, b: 4, f: 0.04, p: 3, amp: 4, vert: true }];
function encode(creases, seed, opts) { return B.palmprintEncode(roiImage(creases, seed, opts), 128, 128); }
function clipFrames(creases, baseSeed) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    frames.push({ openness: 2.0, code: encode(creases, baseSeed + i, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 }), sharpness: 100 + i * 10 });
  }
  return frames;
}
function roiFrames(creases, baseSeed) {
  const S = B.PALMPRINT_ROI_SIZE;
  const frames = [];
  for (let i = 0; i < 9; i++) {
    const roi = roiImage(creases, baseSeed + i, { roiSize: S });
    frames.push({ openness: 2.0, roi: roi, code: B.palmprintEncode(roi, S, S), sharpness: 100 + i * 10 });
  }
  return frames;
}
function packedBank(creases, baseSeed) {
  return B.selectPalmprintProfileCodes(roiFrames(creases, baseSeed + 500));
}
function embVector(seed, dim) {
  const rnd = lcg(seed);
  const v = new Float32Array(dim || 256);
  for (let i = 0; i < v.length; i++) v[i] = rnd() * 2 - 1;
  return v;
}
function embJitter(base, seed, amt) {
  const rnd = lcg(seed);
  const v = new Float32Array(base.length);
  for (let i = 0; i < v.length; i++) v[i] = base[i] + (rnd() - 0.5) * amt;
  return v;
}

/* A full banked person in the v60 stored shape: packed EDCC codes
   + a current-stamp PalmNet bank + archived legacy byte codes. */
function fixturePerson(id, creases, seed, hand) {
  const embBase = embVector(seed * 7 + 1);
  const legacy = clipFrames(creases, seed + 900).slice(0, 3).map(function (f) { return Buffer.from(f.code).toString('base64'); });
  return {
    id: id, name: 'Rig ' + id, phone: '01000000000', createdAt: '2026-11-20T00:00:00.000Z',
    loyaltyPoints: 137,
    wallet: { balance: 450, statement: [{ id: 's1', amount: 250 }], linkedAccounts: [{ provider: 'bkash', number: '01000000000' }] },
    palmProfile: {
      v: 4, format: 'packed96', hand: hand,
      codes: packedBank(creases, seed),
      legacyCodes: legacy,
      neural: { v: 1, dim: 256, model: B.PALMNET_MODEL_ID, embeddings: [B.palmnetEmbeddingToBase64(embBase), B.palmnetEmbeddingToBase64(embJitter(embBase, seed + 3, 0.02))] }
    },
    _embBase: embBase
  };
}
function stripRig(p) { const c = JSON.parse(JSON.stringify(p)); delete c._embBase; return c; }

async function main() {
  check('ENV WebCrypto is available to the envelope', B.bankEncAvailable() === true);

  /* ---------- vault keys for two banks + a stranger ------------- */
  const rawMain = await B.vaultGenerateRaw();
  const kidMain = await B.vaultKeyId(rawMain);
  const vaultKey = await B.vaultImportKey(rawMain, false);
  const cache = {};
  function deriveKey(biomId) {
    if (!cache[biomId]) cache[biomId] = B.vaultDeriveBankKey(vaultKey, biomId);
    return cache[biomId];
  }
  const rawOther = await B.vaultGenerateRaw();
  const kidOther = await B.vaultKeyId(rawOther);
  const otherKey = await B.vaultImportKey(rawOther, false);
  check('VAULT key ids are stable, distinct per key', kidMain.length === 10 && kidOther.length === 10 && kidMain !== kidOther, kidMain + ' vs ' + kidOther);

  /* ---------- 1. envelope primitives ---------------------------- */
  const plain = 'QUJDREVGRw== packed-template-string 12345';
  const bk1 = await deriveKey('TSG-BIO-1');
  const sealed = await B.bankEncryptString(plain, bk1, kidMain);
  check('ENV a sealed string carries the enc.v1.<kid>. envelope', B.bankEncIsSealed(sealed) && B.bankEncKidOf(sealed) === kidMain, sealed.slice(0, 24) + '…');
  check('ENV the ciphertext does not contain the plaintext', sealed.indexOf(plain) === -1 && sealed.indexOf('QUJD') === -1);
  check('ENV round-trip is byte-exact', (await B.bankDecryptString(sealed, bk1)) === plain);
  check('ENV the dual read passes pre-v61 plaintext through untouched', (await B.bankDecryptString(plain, bk1)) === plain);
  check('ENV sealing never double-seals', (await B.bankEncryptString(sealed, bk1, kidMain)) === sealed);
  const bkOther = await B.vaultDeriveBankKey(otherKey, 'TSG-BIO-1');
  check('ENV the wrong vault key fails closed (null, never a throw, never garbage)',
    (await B.bankDecryptString(sealed, bkOther)) === null);
  const bk2 = await deriveKey('TSG-BIO-2');
  check('ENV a bank key derived for another Biom ID fails closed',
    (await B.bankDecryptString(sealed, bk2)) === null);
  check('ENV a corrupt envelope fails closed', (await B.bankDecryptString('enc.v1.' + kidMain + '.!!!not-base64!!!', bk1)) === null);

  /* ---------- vault wrap + recovery sheet ----------------------- */
  const wrapped = await B.vaultWrapKey(rawMain, 'rig passphrase');
  let wrapBlob = null;
  try { wrapBlob = JSON.parse(wrapped); } catch (e) { /* not JSON */ }
  check('VAULT the wrap blob is a JSON envelope (version, salt, nonce, ciphertext)',
    !!wrapBlob && wrapBlob.v === 1 && typeof wrapBlob.salt === 'string' && typeof wrapBlob.nonce === 'string' && typeof wrapBlob.ct === 'string');
  check('VAULT the wrap work factor is PBKDF2-SHA-256 at 600,000 iterations (pinned constant)',
    bioSrc.indexOf('BANK_ENC_PBKDF2_ITERATIONS = 600000') !== -1 && bioSrc.indexOf("name: 'PBKDF2', hash: 'SHA-256'") !== -1);
  const unwrapped = await B.vaultUnwrapKey(wrapped, 'rig passphrase');
  check('VAULT unwrap with the right passphrase returns the same key', !!unwrapped && (await B.vaultKeyId(unwrapped)) === kidMain);
  check('VAULT unwrap with a wrong passphrase returns null (never garbage, never a throw)',
    (await B.vaultUnwrapKey(wrapped, 'wrong passphrase')) === null);
  const sheet = B.vaultRecoveryEncode(rawMain);
  check('VAULT the recovery sheet is 52 base32 chars in groups of 4', /^[A-Z2-7]{4}( [A-Z2-7]{4}){12}$/.test(sheet), sheet.slice(0, 19) + '…');
  const sheetBack = B.vaultRecoveryDecode(sheet.toLowerCase().replace(/ /g, ''));
  check('VAULT the sheet decodes back to the same key', !!sheetBack && (await B.vaultKeyId(sheetBack)) === kidMain);
  check('VAULT a malformed sheet is refused, not guessed', B.vaultRecoveryDecode('TOO SHORT') === null && B.vaultRecoveryDecode('') === null);

  /* ---------- 2. representation coverage (list-checked) --------- */
  const personA = fixturePerson('TSG-BIO-101', PALM_A, 51, 'left');
  const personB = fixturePerson('TSG-BIO-102', PALM_B, 61, 'right');
  const srcPins = [
    ['the sync record reads palmProfile.codes', bioSrc.indexOf('Array.isArray(prof.codes) ? prof.codes.filter') !== -1],
    ['the sync record reads palmProfile.neural.embeddings', bioSrc.indexOf('Array.isArray(neural.embeddings) ? neural.embeddings.filter') !== -1],
    ['the v45 migration archives byte codes as palmProfile.legacyCodes', bioSrc.indexOf('nprof.legacyCodes = Array.isArray(prof.codes) ? prof.codes.slice() : [];') !== -1],
    ['the bank seam collects palmProfile.codes', bioSrc.indexOf('collect(prof.codes);') !== -1],
    ['the bank seam collects palmProfile.neural.embeddings', bioSrc.indexOf('collect(prof.neural.embeddings);') !== -1],
    ['the bank seam collects palmProfile.legacyCodes', bioSrc.indexOf('collect(prof.legacyCodes);') !== -1],
    ['the seam enumeration in the B1 header names exactly the three at-rest representations',
      bioSrc.indexOf('1. palmProfile.codes[] — packed EDCC strings') !== -1 &&
      bioSrc.indexOf('2. palmProfile.neural.embeddings[] — PalmNet Float32 LE') !== -1 &&
      bioSrc.indexOf('3. palmProfile.legacyCodes[] — the v3 byte-code strings') !== -1 &&
      bioSrc.indexOf('representations 1-3 are the complete at-rest set') !== -1]
  ];
  srcPins.forEach(function (p) { check('COVER ' + p[0], p[1]); });
  const stringArrays = [];
  (function walk(obj, prefix) {
    Object.keys(obj).forEach(function (k) {
      const v = obj[k];
      if (Array.isArray(v) && v.length && v.every(function (x) { return typeof x === 'string'; })) stringArrays.push(prefix + k);
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, prefix + k + '.');
    });
  })(stripRig(personA).palmProfile, '');
  check('COVER the fixture bank carries template strings in exactly the three sealed lists',
    deepEq(stringArrays.slice().sort(), ['codes', 'legacyCodes', 'neural.embeddings']),
    stringArrays.join(','));

  /* ---------- conversion seals every representation ------------- */
  const originals = [stripRig(personA), stripRig(personB)];
  const conv = await B.convertBanksV61(JSON.parse(JSON.stringify(originals)), deriveKey, kidMain);
  const expectSealed = originals.reduce(function (n, p) {
    return n + p.palmProfile.codes.length + p.palmProfile.neural.embeddings.length + p.palmProfile.legacyCodes.length;
  }, 0);
  check('CONVERT every template string in every representation is sealed', conv.templatesSealed === expectSealed && conv.banksFailed === 0,
    'sealed ' + conv.templatesSealed + ' of ' + expectSealed);
  check('CONVERT both banks report converted', conv.banksConverted === 2 && conv.banksAlreadySealed === 0);
  const sealedA = conv.people[0];
  check('CONVERT the sealed bank carries the enc v1 marker', sealedA.palmProfile.enc === 'v1');
  check('CONVERT every stored string is an envelope under this vault key',
    sealedA.palmProfile.codes.concat(sealedA.palmProfile.neural.embeddings, sealedA.palmProfile.legacyCodes)
      .every(function (s) { return B.bankEncIsSealed(s) && B.bankEncKidOf(s) === kidMain; }));
  check('CONVERT no plaintext template survives anywhere in the sealed bank',
    JSON.stringify(sealedA.palmProfile).indexOf(originals[0].palmProfile.codes[0]) === -1 &&
    JSON.stringify(sealedA.palmProfile).indexOf(originals[0].palmProfile.neural.embeddings[0]) === -1 &&
    JSON.stringify(sealedA.palmProfile).indexOf(originals[0].palmProfile.legacyCodes[0]) === -1);
  check('CONVERT hand stamp, model stamp, wallet and points are untouched by sealing',
    sealedA.palmProfile.hand === 'left' && sealedA.palmProfile.neural.model === B.PALMNET_MODEL_ID &&
    sealedA.wallet.balance === 450 && sealedA.wallet.statement.length === 1 && sealedA.loyaltyPoints === 137);
  const opened = await B.bankDecryptPerson(sealedA, deriveKey);
  check('CONVERT decrypting the sealed bank restores the original byte-for-byte',
    opened.failed === 0 && deepEq(opened.person, originals[0]));
  const convAgain = await B.convertBanksV61(conv.people, deriveKey, kidMain);
  check('CONVERT an already-sealed bank is a no-op (counted, never double-sealed)',
    convAgain.banksConverted === 0 && convAgain.banksAlreadySealed === 2 && convAgain.templatesSealed === 0 &&
    convAgain.people[0] === conv.people[0] && deepEq(convAgain.people[0], sealedA));

  /* ---------- 3. THE PARITY GATE (CD-3) --------------------------
     Scores from the round-tripped banks must EQUAL the plaintext
     scores EXACTLY. Any drift fails the release. */
  function judgeAll(profile, probes, probeEmb) {
    const edcc = B.verifyPalmprintProfile(profile, probes);
    const neural = B.palmnetScoreProfile(profile, [probeEmb]);
    const fused = B.fusePalmVerifyResults(edcc, neural);
    return { edcc: edcc, neural: neural, fused: fused };
  }
  const probeA = B.selectPalmprintLiveCodes(roiFrames(PALM_A, 71));
  const probeB = B.selectPalmprintLiveCodes(roiFrames(PALM_B, 81));
  const cases = [
    { name: 'A bank vs A palm (genuine)', person: originals[0], probes: probeA, emb: embJitter(personA._embBase, 999, 0.02) },
    { name: 'A bank vs B palm (impostor)', person: originals[0], probes: probeB, emb: embVector(4242) },
    { name: 'B bank vs B palm (genuine)', person: originals[1], probes: probeB, emb: embJitter(personB._embBase, 888, 0.02) },
    { name: 'B bank vs A palm (impostor)', person: originals[1], probes: probeA, emb: embVector(777) }
  ];
  for (const c of cases) {
    const before = judgeAll(c.person.palmProfile, c.probes, c.emb);
    const sealedPerson = conv.people[originals.indexOf(c.person)];
    const openedPerson = (await B.bankDecryptPerson(sealedPerson, deriveKey)).person;
    check('PARITY ' + c.name + ': templates byte-identical after the round-trip', deepEq(openedPerson.palmProfile, c.person.palmProfile));
    const after = judgeAll(openedPerson.palmProfile, c.probes, c.emb);
    check('PARITY ' + c.name + ': EDCC similarity EXACTLY equal', after.edcc.similarity === before.edcc.similarity && after.edcc.verified === before.edcc.verified,
      'edcc ' + before.edcc.similarity + ' -> ' + after.edcc.similarity);
    check('PARITY ' + c.name + ': PalmNet cosine EXACTLY equal', after.neural === before.neural,
      'palmnet ' + before.neural + ' -> ' + after.neural);
    check('PARITY ' + c.name + ': fused verdict EXACTLY equal',
      after.fused.verified === before.fused.verified && after.fused.acceptedBy === before.fused.acceptedBy &&
      after.fused.similarity === before.fused.similarity && after.fused.neuralScore === before.fused.neuralScore,
      'acceptedBy ' + before.fused.acceptedBy);
  }
  const genuine = judgeAll(originals[0].palmProfile, probeA, embJitter(personA._embBase, 999, 0.02));
  check('PARITY the genuine fixture actually verifies (the gate is not vacuous)', genuine.fused.verified === true, 'acceptedBy ' + genuine.fused.acceptedBy);
  const impostor = judgeAll(originals[0].palmProfile, probeB, embVector(4242));
  check('PARITY the impostor fixture actually fails (the gate is not vacuous)', impostor.fused.verified === false);

  /* ---------- 4/5. migration conversion + fail-safe ------------- */
  const broken = await B.convertBanksV61(JSON.parse(JSON.stringify(originals)), function () { throw new Error('no key'); }, kidMain);
  check('FAILSAFE a key that cannot be derived converts nothing and throws nothing',
    broken.banksFailed === 2 && broken.templatesSealed === 0 && deepEq(broken.people, originals));
  const wrongOpen = await B.bankDecryptPerson(sealedA, function () { return B.vaultDeriveBankKey(otherKey, sealedA.id); });
  check('FAILSAFE opening with the wrong key leaves the bank sealed and counted, never garbage',
    wrongOpen.failed > 0 && deepEq(wrongOpen.person, sealedA));
  check('FAILSAFE the bank state reader tells the states apart',
    B.bankTemplateState(originals[0]).state === 'encoded' &&
    B.bankTemplateState(sealedA).state === 'sealed' &&
    B.bankTemplateState(sealedA).sealed === B.bankTemplateState(sealedA).total &&
    B.bankTemplateState({}).state === 'none' && B.bankTemplateState(null).state === 'none');
  const noBank = await B.convertBanksV61([{ id: 'TSG-BIO-None', name: 'No Palm' }], deriveKey, kidMain);
  check('FAILSAFE a person with no bank passes through untouched, never an error',
    noBank.banksConverted === 0 && noBank.banksFailed === 0 && noBank.people[0].id === 'TSG-BIO-None' && !('palmProfile' in noBank.people[0]));

  /* ---------- 6. sync shape: ciphertext through the old shape --- */
  const core = B.syncProfileRecord(originals[0], 1764000000000);
  const sealedCore = await B.bankEncryptProfileCore(core, deriveKey, kidMain);
  check('SYNC the sealed core carries enc v1 and only sealed strings',
    sealedCore.enc === 'v1' && sealedCore.edccCodes.every(function (s) { return B.bankEncIsSealed(s); }) &&
    sealedCore.neuralEmbeddings.every(function (s) { return B.bankEncIsSealed(s); }));
  check('SYNC the sealed core keeps the record shape (biomId, hand, model, stamp)',
    sealedCore.biomId === core.biomId && sealedCore.hand === 'left' && sealedCore.neuralModel === core.neuralModel && sealedCore.updatedTs === core.updatedTs);
  const coreBack = await B.bankDecryptString(sealedCore.edccCodes[0], await deriveKey(core.biomId));
  check('SYNC a sealed core string opens back to the exact template', coreBack === core.edccCodes[0]);
  const engineSrc = appSrc.slice(appSrc.indexOf('/* SYNC-ENGINE-BEGIN'), appSrc.indexOf('/* SYNC-ENGINE-END */'));
  check('SYNC the engine is extractable from app.js', engineSrc.indexOf('function createBiomSync') !== -1);
  const createBiomSync = new Function(engineSrc + '\nreturn createBiomSync;')();
  const store = { outbox: [] };
  const sent = [];
  const engine = createBiomSync({
    B: B, modelId: B.PALMNET_MODEL_ID, appVersion: 'v61',
    getPrefs: function () { return { on: true, endpoint: 'http://api.test', deviceKey: 'device-key-1', label: 'rig' }; },
    loadOutbox: function () { return Promise.resolve(store.outbox); },
    saveOutbox: function (items) { store.outbox = items; return Promise.resolve(); },
    fetchFn: function (url, opts) { sent.push({ url: url, body: JSON.parse(opts.body) }); return Promise.resolve({ status: 201 }); },
    now: function () { return 1764000000000; },
    uuid: function () { return 'uuid-b1'; },
    onStatus: function () {},
    encryptProfileCore: function (c) { return B.bankEncryptProfileCore(c, deriveKey, kidMain); }
  });
  await engine.ensureLoaded();
  const queued = await engine.noteProfile(originals[0]);
  /* noteProfile seals asynchronously, then queues; wait for the
     persisted outbox to carry the profile before flushing. */
  for (let i = 0; i < 100 && !store.outbox.some(function (it) { return it.type === 'profile'; }); i++) {
    await new Promise(function (r) { setTimeout(r, 25); });
  }
  await engine.flush();
  const posted = sent.filter(function (s) { return /\/api\/profiles$/.test(s.url); }).map(function (s) { return s.body; })[0];
  check('SYNC with the vault dep the engine queues and posts the profile', queued === true && !!posted);
  check('SYNC the posted body is ciphertext + enc v1 through the existing shape',
    !!posted && posted.enc === 'v1' && posted.edccCodes.every(function (s) { return B.bankEncIsSealed(s); }) &&
    posted.neuralEmbeddings.every(function (s) { return B.bankEncIsSealed(s); }) &&
    JSON.stringify(posted).indexOf(core.edccCodes[0]) === -1);
  let apiShape = null;
  try { apiShape = require(path.join(__dirname, '..', '..', 'tsg-biom-api', 'lib', 'records.js')).shapeProfile; } catch (e) { /* sibling repo absent */ }
  if (apiShape && posted) {
    const shaped = (apiShape(posted) || {}).record;
    check('SYNC the API shape keeps enc v1 and the ciphertext verbatim (server stays blind)',
      !!shaped && shaped.enc === 'v1' && deepEq(shaped.edccCodes, posted.edccCodes) && deepEq(shaped.neuralEmbeddings, posted.neuralEmbeddings));
    const shapedPlain = (apiShape(core) || {}).record;
    check('SYNC the API shape adds no enc marker to a plaintext core', !!shapedPlain && !('enc' in shapedPlain));
  } else if (!apiShape) {
    info('sibling tsg-biom-api repo not present: the API-side shape checks run in that repo\'s own suite (api.test.js)');
  }

  /* ---------- 7. vault UX + wiring source pins ------------------- */
  check('VERSION app is v63 and the shell is v63 (v63 named pin change)', appSrc.indexOf("APP_DATA_VERSION = 'v63'") !== -1 && swSrc.indexOf('tsg-biom-shell-v63') !== -1);
  check('VERSION v63 is the newest chain link (v63 named pin change)', B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v63');
  const vaultIds = ['vaultStatus', 'vaultReport', 'vaultBanks', 'vaultSetup', 'vaultSheetSetup', 'vaultPass1', 'vaultPass2', 'vaultAckInput', 'vaultAckBtn', 'vaultSetupMsg', 'vaultActions', 'vaultConvertBtn', 'vaultShowPass', 'vaultShowBtn', 'vaultHideBtn', 'vaultSheetView', 'vaultShowMsg', 'vaultImportCode', 'vaultImportPass', 'vaultImportBtn', 'vaultImportMsg'];
  check('VAULT UX the Biom Vault card carries every control the wiring expects',
    vaultIds.every(function (id) { return htmlSrc.indexOf('id="' + id + '"') !== -1; }),
    vaultIds.length + ' ids');
  check('VAULT UX the card states the honest key-loss consequence (re-enrolment)',
    htmlSrc.indexOf('the sealed banks cannot be opened and each person must re-enrol') !== -1);
  check('VAULT UX the card sits before the Scan Sync card on the More page',
    htmlSrc.indexOf('Biom Vault — palm template encryption') !== -1 &&
    htmlSrc.indexOf('Biom Vault — palm template encryption') < htmlSrc.indexOf('<h2>Scan Sync</h2>'));
  check('WIRING the people store passes through the vault at the DB boundary',
    appSrc.indexOf('return vaultEncryptRow(value).then(function (sealed) { return self._putRaw(store, sealed); });') !== -1 &&
    appSrc.indexOf('return self._allRaw(store).then(function (rows) { return vaultDecryptRows(rows); });') !== -1 &&
    appSrc.indexOf('_putRaw: function (store, value)') !== -1 && appSrc.indexOf('_allRaw: function (store)') !== -1);
  check('WIRING the sync engine is handed the sealing dep',
    appSrc.indexOf('encryptProfileCore: function (core) { return Vault.encryptProfileCore(core); }') !== -1);
  const bootAt = appSrc.indexOf('DB.open().then(function () { return Vault.init(); })');
  check('WIRING the boot order is vault, then migration, then conversion',
    bootAt !== -1 &&
    appSrc.indexOf('return migrateDbStores();', bootAt) !== -1 &&
    appSrc.indexOf('return Vault.convertBanks();', bootAt) !== -1 &&
    appSrc.indexOf('return migrateDbStores();', bootAt) < appSrc.indexOf('return Vault.convertBanks();', bootAt));
  check('WIRING Delete All Data does not destroy the vault (the key is not biometric data)',
    appSrc.indexOf('the vault key SURVIVES') !== -1);
  check('FREEZE the codec freeze is declared in biometrics.js',
    bioSrc.indexOf('CODEC FREEZE') !== -1 && bioSrc.indexOf('is a codec change requiring') !== -1 &&
    bioSrc.indexOf('must never ride along') !== -1);

  console.log(fail === 0 ? 'ALL v61 B1 TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.log('FAIL  suite crashed: ' + (e && e.stack || e)); process.exit(1); });
