/* TSG BIOM v46 — Delete All Data: the device owner's own erase.

   Proven here:
   - B.wipeBiomData empties a populated store COMPLETELY — people
     (including a wallet-carrying profile: balance, statement,
     linked accounts, palm templates), transactions, logs and meta
     — and reports exactly what it removed, per store.
   - The wipe never mutates its input snapshot.
   - The post-wipe store is a valid empty CURRENT-version store:
     the app's own load/migration path accepts it unchanged at
     v46, from v45, and from an unknown stamp (the full chain over
     an empty store invents nothing).
   - The confirmation flow is wired in the shipped sources: the
     Delete All Data control on the More page, the confirmation
     panel stating what will be deleted and that it cannot be
     undone, the type-DELETE gate, the distinct final confirm,
     DB.clearAll, and the plain post-delete confirmation.
   - The wipe is reachable ONLY from that flow: neither the
     startup migration block nor the boot sequence calls it —
     updates still never wipe (the standing rule; v38-migration
     proves the chain itself). */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* ---------- a populated store, in current (v45/v46) shapes -------- */
const populated = {
  people: [
    {
      id: 'TSG-BIO-2841', name: 'Wipe Fixture Person', phone: '01700000000', type: 'Customer',
      store: 'GreenCare Pharmacy (CVS)', walletProvider: 'bKash', walletNumber: '01700000000',
      limits: { perTx: 1000, daily: null }, loyaltyPoints: 137,
      palmProfile: { v: 4, format: 'legacy', codes: [], legacyCodes: ['QUJD', 'REVG'], rescanNeeded: true },
      wallet: {
        balance: 450,
        statement: [{ ref: 'DEMO-1', ts: 1795410300000, kind: 'add', amount: 450, note: 'Demo add money' }],
        linkedAccounts: [{ id: 'a1', type: 'bKash', label: 'Personal' }]
      },
      enrolledAt: 1795410000000
    },
    {
      id: 'TSG-BIO-2842', name: 'Second Fixture Person', phone: '01800000000', type: 'Staff',
      store: 'FreshMart Supermarket', loyaltyPoints: 0,
      palmProfile: { v: 4, format: 'packed96', codes: ['R0hJ'] },
      wallet: { balance: 0, statement: [], linkedAccounts: [] },
      enrolledAt: 1795410500000
    }
  ],
  logs: [
    { ts: 1795410100000, personId: 'TSG-BIO-2841', personName: 'Wipe Fixture Person', store: 'GreenCare Pharmacy (CVS)', method: 'palm', measured: 'Palmprint similarity 0.512', result: 'Verified' },
    { ts: 1795410600000, personId: 'TSG-BIO-2842', personName: 'Second Fixture Person', store: 'FreshMart Supermarket', method: 'palm', measured: 'Palmprint similarity 0.498', result: 'Verified' }
  ],
  transactions: [{
    id: 'BIOM-PAY-1001', ts: 1795410200000, personId: 'TSG-BIO-2841', personName: 'Wipe Fixture Person',
    provider: 'bKash', walletMasked: '01700-***000', store: 'GreenCare Pharmacy (CVS)', amount: 250,
    method: 'palm', measured: 'Palmprint similarity 0.512', status: 'Biometric Authorised — Pending Provider Settlement'
  }],
  meta: [{ key: 'biomSeq', value: 2843 }, { key: 'paySeq', value: 1002 }, { key: 'demoSeq', value: 2 }]
};
const populatedBefore = JSON.stringify(populated);

/* ---------- the wipe itself --------------------------------------- */
const wiped = B.wipeBiomData(populated);
check('WIPE every store is emptied', B.BIOM_DATA_STORES.every(function (s) {
  return Array.isArray(wiped.snapshot[s]) && wiped.snapshot[s].length === 0;
}), JSON.stringify(wiped.removed));
check('WIPE the wallet-carrying person is gone, balance and all',
  wiped.snapshot.people.length === 0 && JSON.stringify(wiped.snapshot).indexOf('DEMO-1') === -1 &&
  JSON.stringify(wiped.snapshot).indexOf('450') === -1);
check('WIPE removed counts are exact per store',
  wiped.removed.people === 2 && wiped.removed.logs === 2 && wiped.removed.transactions === 1 && wiped.removed.meta === 3,
  JSON.stringify(wiped.removed));
check('WIPE removedTotal is the sum', wiped.removedTotal === 8, String(wiped.removedTotal));
check('WIPE the input snapshot is not mutated', JSON.stringify(populated) === populatedBefore &&
  populated.people[0].wallet.balance === 450 && populated.people.length === 2);
check('WIPE the result stores are fresh arrays, not the input ones',
  wiped.snapshot.people !== populated.people && wiped.snapshot.meta !== populated.meta);

/* ---------- empty snapshot shape ----------------------------------- */
const empty = B.emptyBiomDataSnapshot();
check('EMPTY snapshot carries exactly the four stores, all empty',
  JSON.stringify(Object.keys(empty).sort()) === JSON.stringify(['logs', 'meta', 'people', 'transactions']) &&
  B.BIOM_DATA_STORES.every(function (s) { return Array.isArray(empty[s]) && empty[s].length === 0; }));
check('EMPTY two calls return independent arrays', B.emptyBiomDataSnapshot().people !== B.emptyBiomDataSnapshot().people);

/* ---------- the post-wipe store loads as a valid v46 store --------- */
const loadCurrent = B.migrateBiomData(wiped.snapshot, 'v46', 'v46');
check('LOAD post-wipe store at v46: no steps, no changes, still empty',
  loadCurrent.appliedSteps.length === 0 && loadCurrent.changed === false &&
  B.BIOM_DATA_STORES.every(function (s) { return loadCurrent.snapshot[s].length === 0; }));
const loadFrom45 = B.migrateBiomData(B.wipeBiomData(populated).snapshot, 'v45', 'v46');
check('LOAD post-wipe store from a v45 stamp: adoption only, still empty',
  loadFrom45.appliedSteps.join(',') === 'v46' && loadFrom45.changed === false &&
  B.BIOM_DATA_STORES.every(function (s) { return loadFrom45.snapshot[s].length === 0; }));
const loadFromUnknown = B.migrateBiomData(B.wipeBiomData(populated).snapshot, null, 'v46');
check('LOAD post-wipe store from an unknown stamp: the full chain invents nothing',
  B.BIOM_DATA_STORES.every(function (s) { return loadFromUnknown.snapshot[s].length === 0; }));

/* ---------- edge cases ---------------------------------------------- */
const wipedEmpty = B.wipeBiomData(B.emptyBiomDataSnapshot());
check('EDGE wiping an empty store removes nothing and stays valid',
  wipedEmpty.removedTotal === 0 && B.BIOM_DATA_STORES.every(function (s) { return wipedEmpty.snapshot[s].length === 0; }));
const wipedDamaged = B.wipeBiomData({ people: populated.people });
check('EDGE a damaged snapshot (missing stores) wipes what exists, counts the rest as 0',
  wipedDamaged.removed.people === 2 && wipedDamaged.removed.logs === 0 && wipedDamaged.removedTotal === 2 &&
  B.BIOM_DATA_STORES.every(function (s) { return wipedDamaged.snapshot[s].length === 0; }));
const wipedNull = B.wipeBiomData(null);
check('EDGE a null snapshot wipes to a valid empty store', wipedNull.removedTotal === 0 &&
  B.BIOM_DATA_STORES.every(function (s) { return Array.isArray(wipedNull.snapshot[s]); }));

/* ---------- the shipped wiring -------------------------------------- */
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
check('PIN the Delete All Data control lives on the More page',
  idxSrc.indexOf('id="page-more"') !== -1 && idxSrc.indexOf('id="wipeDataBtn"') > idxSrc.indexOf('id="page-more"') &&
  idxSrc.indexOf('>Delete All Data</button>') !== -1);
check('PIN the confirmation panel states what is deleted and that it cannot be undone',
  idxSrc.indexOf('id="wipeConfirm"') !== -1 && idxSrc.indexOf('id="wipeCounts"') !== -1 &&
  /permanently delete all data/.test(idxSrc) && /cannot be undone/.test(idxSrc));
check('PIN the final confirm is a distinct button labelled Delete everything',
  idxSrc.indexOf('id="wipeConfirmBtn"') !== -1 && idxSrc.indexOf('>Delete everything</button>') !== -1 &&
  idxSrc.indexOf('id="wipeCancelBtn"') !== -1);
check('PIN the confirm is gated on typing DELETE',
  idxSrc.indexOf('id="wipeConfirmInput"') !== -1 && appSrc.indexOf("input.value.trim() !== 'DELETE'") !== -1 &&
  appSrc.indexOf('wipeConfirmBtn') !== -1 && /confirmBtn\.disabled = input\.value\.trim\(\) !== 'DELETE'/.test(appSrc));
check('PIN the flow runs the store-layer wipe and clears both backends',
  appSrc.indexOf('function wireWipeData()') !== -1 && appSrc.indexOf('B.wipeBiomData(snap)') !== -1 &&
  appSrc.indexOf('DB.clearAll()') !== -1 && appSrc.indexOf('clearAll: function') !== -1);
check('PIN clearAll empties the localStorage snapshot AND clears the IndexedDB stores',
  appSrc.indexOf('self.lsSet(s, [])') !== -1 && appSrc.indexOf('tx.objectStore(s).clear()') !== -1);
check('PIN after the wipe the app states plainly that all data was deleted, then reloads',
  appSrc.indexOf('All data deleted') !== -1 && appSrc.indexOf('location.reload()') !== -1);
check('PIN the wipe re-stamps the data version so the empty store is a valid current-version store',
  /localStorage\.setItem\(DV_KEY, APP_DATA_VERSION\)/.test(appSrc) && /localStorage\.setItem\(DBV_KEY, APP_DATA_VERSION\)/.test(appSrc));

/* The wipe must be reachable ONLY from the owner's flow: the
   startup migration block (everything before the Storage section)
   and the boot sequence never call it. */
const startupBlock = appSrc.slice(0, appSrc.indexOf('/* ---------------- Storage'));
check('PIN the startup migration block never calls the wipe',
  startupBlock.indexOf('wipeBiomData(') === -1 && startupBlock.indexOf('clearAll(') === -1);
const bootBlock = appSrc.slice(appSrc.indexOf('/* ---------------- Boot'));
check('PIN the boot sequence never calls the wipe',
  bootBlock.indexOf('wipeBiomData(') === -1 && bootBlock.indexOf('clearAll(') === -1);

console.log(fail === 0 ? 'ALL v46 WIPE TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
