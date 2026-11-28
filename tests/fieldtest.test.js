/* TSG Biom — v18 Field Test Mode statistics + CSV export tests.
   Proves the exported CSV carries the same GAR / FAR / spoof-rejection
   numbers the on-screen metrics show: the CSV is parsed back and the
   rates are recomputed from its own columns. */
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const T0 = Date.UTC(2026, 10, 20, 3, 0, 0);
function rec(i, tag, result, genuine, impostor) {
  return {
    ts: T0 + i * 60000, biomId: 'TSG-BIO-28' + (41 + (i % 3)), camera: i % 2 ? 'back' : 'front',
    lighting: ['bright', 'indoor', 'dim'][i % 3], genuineScore: genuine, impostorMax: impostor,
    liveness: result === 'verified' || genuine != null ? 'pass' : 'fail', spoofTag: tag, result: result
  };
}
const records = [
  rec(0, 'real_hand', 'verified', 0.71, 0.20),
  rec(1, 'real_hand', 'verified', 0.62, 0.41), // impostor max above threshold -> counts toward FAR
  rec(2, 'real_hand', 'verified', 0.80, 0.15),
  rec(3, 'real_hand', 'rejected', 0.24, 0.10),
  rec(4, 'photo_spoof', 'rejected', null, null),
  rec(5, 'photo_spoof', 'rejected', 0.11, null),
  rec(6, 'video_replay', 'rejected', null, null),
  rec(7, 'video_replay', 'verified', 0.55, null) // one spoof breach
];
const stats = B.fieldTestStats(records);
check('STATS GAR = 3 of 4 real-hand attempts', stats.genuine.gar === 75 && stats.genuine.attempts === 4, 'gar=' + stats.genuine.gar);
check('STATS FAR = 1 of 4 via highest other-template score', stats.impostor.far === 25 && stats.impostor.falseAccepts === 1, 'far=' + stats.impostor.far);
check('STATS spoof rejection = 3 of 4 spoof attempts', stats.spoof.rejectionRate === 75 && stats.spoof.attempts === 4, 'rate=' + stats.spoof.rejectionRate);
check('STATS empty records give null rates, not NaN', (() => { const s = B.fieldTestStats([]); return s.genuine.gar === null && s.impostor.far === null && s.spoof.rejectionRate === null; })());

const csv = B.fieldTestCsv(records);
const lines = csv.trim().split('\n');
check('CSV header is the specified column set', lines[0] === 'timestamp,biom_id,camera,lighting,genuine_score,impostor_max_score,liveness,spoof_tag,result', lines[0]);
check('CSV has one row per record', lines.length === records.length + 1, lines.length - 1 + ' rows');
check('CSV null scores export as empty cells', lines[5].indexOf(',,') >= 0, lines[5]);

/* Parse the CSV back and recompute the rates from its own columns. */
function parseCsv(text) {
  const rows = text.trim().split('\n').map(l => l.split(','));
  const head = rows[0];
  return rows.slice(1).map(cells => {
    const o = {};
    head.forEach((h, i) => { o[h] = cells[i]; });
    return o;
  });
}
const parsed = parseCsv(csv);
const real = parsed.filter(r => r.spoof_tag === 'real_hand');
const gar2 = Math.round(real.filter(r => r.result === 'verified').length / real.length * 1000) / 10;
const far2 = Math.round(real.filter(r => r.impostor_max_score !== '' && Number(r.impostor_max_score) >= B.PALMPRINT_THRESHOLD).length / real.length * 1000) / 10;
const spoofs = parsed.filter(r => r.spoof_tag === 'photo_spoof' || r.spoof_tag === 'video_replay');
const srr2 = Math.round(spoofs.filter(r => r.result !== 'verified').length / spoofs.length * 1000) / 10;
check('CSV round-trip GAR matches fieldTestStats', gar2 === stats.genuine.gar, gar2 + ' vs ' + stats.genuine.gar);
check('CSV round-trip FAR matches fieldTestStats', far2 === stats.impostor.far, far2 + ' vs ' + stats.impostor.far);
check('CSV round-trip spoof rejection matches fieldTestStats', srr2 === stats.spoof.rejectionRate, srr2 + ' vs ' + stats.spoof.rejectionRate);
check('CSV escapes commas in values', B.fieldTestCsv([Object.assign(rec(0, 'real_hand', 'verified', 0.5, 0.1), { camera: 'front, main' })]).indexOf('"front, main"') >= 0);

console.log('field-test tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
