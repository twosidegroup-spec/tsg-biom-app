/* TSG BIOM v72 — LINK / CHANGE THE BIOM PAY WALLET FROM SETTINGS
   (the gap the Chairman's v71 bKash sandbox rail exposed).

   A profile's Biom Pay wallet (profile.walletProvider /
   profile.walletNumber) could only be set in the enrolment
   details form. No code path let an EXISTING profile link or
   change it, so Wallet Pay refused every existing profile
   ("your profile has no linked bKash / Nagad wallet") and the
   v71 sandbox rail never engaged for them.

   v72 closes the gap in three layers, all pinned here:
     1. STORE (biometrics.js): B.walletSetPayWallet /
        B.walletClearPayWallet — pure functions in the
        walletAddLinkedAccount style, with enrolment's
        validation (two refusal texts verbatim from enrolment;
        the provider-without-number text a clearer variant).
        NOTE: walletProvider /
        walletNumber are NOT wallet.linkedAccounts (the Add
        Money funding accounts) — a different field entirely.
     2. UI (index.html + app.js): a "Biom Pay wallet" card in
        the customer Settings (#page-settings → #settingsOpen),
        a .setrow in the existing style, and an inline panel in
        the v69 Delete-panel pattern. Only the signed-in
        customer's own profile (walletSessionPerson) is edited.
     3. PERSISTENCE: the enrolment / post-enrolment mutation
        path exactly — DB.put('people', person), then
        Sync.noteProfile(person), then loadWalletPeople() so
        the Pay flow's fresh reads see the link at once.

   The Pay flow itself, BkashRail, limits, balances, statement,
   points and palmProfile are untouched — after linking, the
   existing v71 code paths engage with zero changes to them.

   Vault-record scope (v72 review, Seat 2): Sync.noteProfile
   notes the mutation through the same call enrolment uses, but
   the sealed vault bank record (B.syncProfileRecord, the v62
   protocol) carries the biometric bank and the walletLink
   agreement field only — walletProvider / walletNumber live
   on the device profile, exactly as when set at enrolment,
   and are NOT part of that bank record. The persistence check
   below pins the persist CALL ORDER (DB.put, then
   Sync.noteProfile — the same order as enrolment); it does
   not claim the link fields ride the vault record.

   The frozen rules are re-pinned: EDCC 0.32 / PalmNet 0.5895. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  const j = b ? src.indexOf(b, i + a.length) : src.length;
  return i === -1 ? '' : src.slice(i, j === -1 ? src.length : j);
}

/* A person in the exact post-enrolment shape, with a real
   wallet state worth protecting: a balance, a statement row,
   a linked funding account, limits, points and a palm bank. */
function person(id, name) {
  return {
    id: id, name: name, phone: '01700000000', type: 'Customer', store: 'GreenCare Pharmacy (CVS)',
    walletProvider: '', walletNumber: '', limits: { perTx: 1000, daily: 5000 },
    loyaltyPoints: 120,
    wallet: {
      balance: 750,
      statement: [{ ref: 'DEMO-3', ts: 1795423600000, kind: 'add', amount: 750, balanceAfter: 750 }],
      linkedAccounts: [{ id: 'ACCT-1-1', type: 'Bank', label: 'My bank', linkedAt: 1795420000000 }]
    },
    palmProfile: { v: 4, format: 'packed96', codes: ['QUJD', 'REVG', 'R0hJ'], hand: 'right' },
    enrolledAt: 1795420000000
  };
}
/* A Map-backed fake of the people store with IndexedDB-like
   semantics (rows are cloned in and out, like DB.put / DB.all),
   so a "reload" re-read proves what actually persisted. */
function makeStore(people) {
  const rows = new Map();
  people.forEach(function (p) { rows.set(p.id, clone(p)); });
  return {
    put: function (p) { rows.set(p.id, clone(p)); },
    get: function (id) { const r = rows.get(id); return r ? clone(r) : null; }
  };
}
/* The protected sub-objects whose bytes must never move. */
function protectedJson(p) {
  return JSON.stringify({ wallet: p.wallet, limits: p.limits, loyaltyPoints: p.loyaltyPoints, palmProfile: p.palmProfile });
}

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v95 (v95 named pin change: merchant terminal lightest)',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  html.indexOf('<meta name="biom-build" content="v95">') !== -1 &&
  html.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95');
check('MIGRATION the chain ends at v95 with 59 links (v95 named pin change: merchant terminal lightest)',
  B.BIOM_DATA_VERSIONS.length === 59 && B.BIOM_DATA_VERSIONS[0] === 'v37');
check('MIGRATION the v72 step is a pure adoption: a v71-stamped snapshot opens unchanged under v72',
  (function () {
    const store = {
      people: [person('TSG-BIO-3001', 'Ayesha Rahman')],
      logs: [{ ts: 1, result: 'Verified' }],
      transactions: [{ id: 'BIOM-PAY-1001', amount: 320 }],
      meta: [{ key: 'syncOutbox', value: [{ type: 'profile', record: { biomId: 'TSG-BIO-3001' } }] }]
    };
    store.people[0].walletProvider = 'bKash';
    store.people[0].walletNumber = '01770123456';
    const before = JSON.stringify(store);
    const mig = B.migrateBiomData(JSON.parse(before), 'v71', 'v72');
    return mig.appliedSteps.join(',') === 'v72' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());
check('MIGRATION the whole chain v37->v72 applies 35 steps',
  (function () {
    const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v37', 'v72');
    return mig.appliedSteps.length === 35 && mig.appliedSteps[mig.appliedSteps.length - 1] === 'v72';
  })());
check('FROZEN bars untouched: EDCC 0.32 / PalmNet 0.5895',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

/* ---------- the store layer -------------------------------------- */
check('STORE walletSetPayWallet / walletClearPayWallet are exported store functions',
  typeof B.walletSetPayWallet === 'function' && typeof B.walletClearPayWallet === 'function');

const store = makeStore([person('TSG-BIO-3001', 'Ayesha Rahman'), person('TSG-BIO-3002', 'Tanvir Hasan')]);
const otherBefore = JSON.stringify(store.get('TSG-BIO-3002'));

/* (a) link sets provider+number and persists through a reload */
const meA = store.get('TSG-BIO-3001');
const protectedBefore = protectedJson(meA);
const linkRes = B.walletSetPayWallet(meA, 'bKash', '01770123456');
check('LINK a valid bKash link succeeds and sets exactly the Pay-gate fields',
  linkRes.ok === true && linkRes.person.walletProvider === 'bKash' && linkRes.person.walletNumber === '01770123456');
check('LINK the store function is pure: a NEW row, the input row untouched',
  linkRes.person !== meA && meA.walletProvider === '' && meA.walletNumber === '');
store.put(linkRes.person); // the app persists res.person via DB.put('people', ...)
const reloaded = store.get('TSG-BIO-3001');
check('LINK the link persists through a simulated reload (re-read from the store)',
  reloaded.walletProvider === 'bKash' && reloaded.walletNumber === '01770123456');
check('LINK an 880-prefixed number folds to the 01 form, exactly like enrolment',
  (function () {
    const r = B.walletSetPayWallet(store.get('TSG-BIO-3001'), 'Nagad', '+880 1912-345678');
    return r.ok === true && r.person.walletProvider === 'Nagad' && r.person.walletNumber === '01912345678';
  })());
check('LINK the row value mask is the enrolment mask format (slice(0,5) + -*** + slice(8))',
  B.maskWalletNumber(reloaded.walletNumber) === '01770-***456');

/* (b) after linking, the Pay gate predicate reads linked */
check('PAY-GATE before linking the gate refuses; after linking the same profile passes the !walletProvider refusal',
  (function () {
    const unlinked = person('TSG-BIO-3009', 'Unlinked Person');
    return !unlinked.walletProvider === true && !reloaded.walletProvider === false;
  })());
check('PAY-GATE the linked bKash profile satisfies the v71 rail predicates (provider === bKash at the rail line and the sandbox branch)',
  reloaded.walletProvider === 'bKash');
check('PAY-GATE app.js still reads the gate from the fresh profile at the Pay site (the refusal and the sandbox branch are the v71 code, unchanged)',
  (function () {
    const seg = sliceBetween(appSrc, "$('wPayScan').addEventListener('click'", '/* ---------------- v71 bKash sandbox payment flow');
    return seg.indexOf('if (!fresh.walletProvider) {') !== -1 &&
      seg.indexOf('your profile has no linked bKash / Nagad wallet') !== -1 &&
      seg.indexOf("fresh.walletProvider === 'bKash' && probedMode === 'sandbox'") !== -1 &&
      seg.indexOf("me.walletProvider === 'bKash' && BkashRail.hasTransport()") !== -1;
  })());

/* (g) protected sub-objects byte-identical after link */
check('PROTECTED balance, statement, linked accounts, limits, points and palmProfile are byte-identical after link',
  protectedJson(reloaded) === protectedBefore);
check('PROTECTED nothing else on the profile changed: the reloaded row equals the original with only the two link fields set',
  (function () {
    const expect = person('TSG-BIO-3001', 'Ayesha Rahman');
    expect.walletProvider = 'bKash';
    expect.walletNumber = '01770123456';
    return JSON.stringify(reloaded) === JSON.stringify(expect);
  })());

/* (c) invalid number refused, nothing saved */
check('REFUSE an invalid number is refused with enrolment\'s exact error text',
  (function () {
    const r = B.walletSetPayWallet(store.get('TSG-BIO-3001'), 'bKash', '12345');
    return r.ok === false && r.error === 'Wallet number is not a valid Bangladeshi mobile number (01 + 9 digits). It was not saved.' && !r.person;
  })());
check('REFUSE after the invalid-number refusal the stored record is unchanged',
  JSON.stringify(store.get('TSG-BIO-3001')) === JSON.stringify(reloaded));

/* (d) number-without-provider and provider-without-number refused */
check('REFUSE a number without a provider is refused with enrolment\'s exact error text',
  (function () {
    const r = B.walletSetPayWallet(store.get('TSG-BIO-3001'), '', '01770123456');
    return r.ok === false && r.error === 'Choose bKash or Nagad, or clear the wallet number.' && !r.person;
  })());
check('REFUSE an unknown provider with a number is refused the same way',
  (function () {
    const r = B.walletSetPayWallet(store.get('TSG-BIO-3001'), 'Rocket', '01770123456');
    return r.ok === false && r.error === 'Choose bKash or Nagad, or clear the wallet number.' && !r.person;
  })());
check('REFUSE a provider without a number is refused and saves nothing',
  (function () {
    const r = B.walletSetPayWallet(store.get('TSG-BIO-3001'), 'bKash', '');
    return r.ok === false && typeof r.error === 'string' && r.error.length > 0 && !r.person &&
      JSON.stringify(store.get('TSG-BIO-3001')) === JSON.stringify(reloaded);
  })());
check('REFUSE no person at all is refused',
  B.walletSetPayWallet(null, 'bKash', '01770123456').ok === false && B.walletClearPayWallet(null).ok === false);

/* (e) unlink clears both fields, and persists */
const clearRes = B.walletClearPayWallet(store.get('TSG-BIO-3001'));
check('UNLINK clear succeeds and empties both fields on a new row',
  clearRes.ok === true && clearRes.person.walletProvider === '' && clearRes.person.walletNumber === '' && clearRes.person !== reloaded);
store.put(clearRes.person);
const afterClear = store.get('TSG-BIO-3001');
check('UNLINK the cleared link persists through a reload and the Pay gate refuses again',
  afterClear.walletProvider === '' && afterClear.walletNumber === '' && !afterClear.walletProvider === true);
check('PROTECTED balance, statement, linked accounts, limits, points and palmProfile are byte-identical after unlink',
  protectedJson(afterClear) === protectedBefore &&
  JSON.stringify(afterClear) === JSON.stringify(person('TSG-BIO-3001', 'Ayesha Rahman')));

/* (f) a second profile is byte-identical untouched throughout */
check('ISOLATION the second profile is byte-identical untouched by link, refusals and unlink',
  JSON.stringify(store.get('TSG-BIO-3002')) === otherBefore);

/* ---------- the Settings UI + wiring ------------------------------ */
check('UI the Settings page carries the Biom Pay wallet card between the Account card and "Use this app as"',
  (function () {
    const acct = html.indexOf('<h2>Account</h2>');
    const card = html.indexOf('<h2>Biom Pay wallet</h2>');
    const useAs = html.indexOf('<h2>Use this app as</h2>');
    return acct !== -1 && card > acct && useAs > card;
  })());
check('UI the card carries the row, panel and controls in the Delete-panel pattern',
  ['id="setPayWalletRow"', 'id="setPayWalletVal"', 'id="payWalletPanel"', 'id="payWalletProvider"',
   'id="payWalletNumber"', 'id="payWalletSaveBtn"', 'id="payWalletUnlinkBtn"', 'id="payWalletCancelBtn"',
   'id="payWalletMsg"', 'class="card seccard"', 'Biom Pay wallet', 'Not linked']
    .every(function (s) { return html.indexOf(s) !== -1; }));
check('UI the provider select offers exactly Choose provider / bKash / Nagad',
  html.indexOf('<option value="">Choose provider</option><option value="bKash">bKash</option><option value="Nagad">Nagad</option>') !== -1);
check('WIRING Save runs the store rule on the signed-in profile only (walletSessionPerson)',
  (function () {
    const seg = sliceBetween(appSrc, 'function wirePayWalletLink()', 'wirePayWalletLink();');
    return seg.indexOf('B.walletSetPayWallet(me, providerSel.value, numberInput.value)') !== -1 &&
      seg.indexOf('B.walletClearPayWallet(me)') !== -1 &&
      seg.indexOf('walletSessionPerson()') !== -1;
  })());
check('WIRING persistence is the enrolment path: DB.put(\'people\', res.person), then Sync.noteProfile(res.person), then loadWalletPeople()',
  (function () {
    const seg = sliceBetween(appSrc, 'function wirePayWalletLink()', 'wirePayWalletLink();');
    const put = seg.indexOf("DB.put('people', res.person)");
    const note = seg.indexOf('Sync.noteProfile(res.person)');
    const load = seg.indexOf('loadWalletPeople()', note);
    return put !== -1 && note > put && load > note;
  })());
check('WIRING the persist path calls DB.put then Sync.noteProfile, the same order as enrolment (call order only — see the vault-record scope note in the header)',
  (function () {
    const seg = sliceBetween(appSrc, "return DB.put('people', person).then(function () {", 'Sync.noteScan');
    return seg.indexOf('Sync.noteProfile(person)') !== -1;
  })());
check('WIRING the Settings render path refreshes the row value whenever Settings is shown',
  (function () {
    const seg = sliceBetween(appSrc, 'function renderSettings()', "$('setSwitchRow')");
    return seg.indexOf("$('setPayWalletVal').textContent = payWalletRowText(me);") !== -1 &&
      seg.indexOf("$('setName').textContent = me.name;") !== -1;
  })());
/* ---------- v72 review fixes: panel reset, target, in-flight ---- */
check('RESET renderSettings invokes the pay-wallet panel reset, so no stale panel survives an account switch, log out or plain navigation',
  (function () {
    const seg = sliceBetween(appSrc, 'function renderSettings()', "$('setSwitchRow')");
    return seg.indexOf('resetPayWalletPanel();') !== -1;
  })());
check('RESET resetPayWalletPanel hides the panel, re-enables the row, and clears the full wallet number and the message',
  (function () {
    const seg = sliceBetween(appSrc, 'function resetPayWalletPanel()', 'function wirePayWalletLink()');
    return seg.indexOf("panel.classList.add('hidden')") !== -1 &&
      seg.indexOf('row.disabled = false') !== -1 &&
      seg.indexOf("numberInput.value = ''") !== -1 &&
      seg.indexOf("msg.innerHTML = ''") !== -1;
  })());
check('TARGET the panel captures the profile id when it opens, and Save / Unlink verify it (panelTargetMismatch) before writing, refusing a mismatch with an honest error',
  (function () {
    const seg = sliceBetween(appSrc, 'function wirePayWalletLink()', 'wirePayWalletLink();');
    return seg.indexOf('panelTargetId = me.id;') !== -1 &&
      seg.indexOf('me.id !== panelTargetId') !== -1 &&
      (seg.split('panelTargetMismatch()').length - 1) >= 3 &&
      seg.indexOf('This panel was opened for a different account') !== -1;
  })());
check('IN-FLIGHT persist disables Save, Unlink and Cancel while the write is in flight and re-enables them on failure',
  (function () {
    const seg = sliceBetween(appSrc, 'function persist(res, doneText)', 'row.addEventListener');
    return seg.indexOf('saveBtn.disabled = true') !== -1 &&
      seg.indexOf('unlinkBtn.disabled = true') !== -1 &&
      seg.indexOf('cancelBtn.disabled = true') !== -1 &&
      seg.indexOf('saveBtn.disabled = false') !== -1 &&
      seg.indexOf('unlinkBtn.disabled = false') !== -1 &&
      seg.indexOf('cancelBtn.disabled = false') !== -1;
  })());
check('PERSIST-HONESTY the post-write loadWalletPeople refresh runs in its own catch after the success path is committed, so a landed save is never reported as failed',
  (function () {
    const seg = sliceBetween(appSrc, 'function persist(res, doneText)', 'row.addEventListener');
    return seg.indexOf('return loadWalletPeople().then(function () {') !== -1 &&
      seg.indexOf('The link is saved on this device; only the cached') !== -1 &&
      seg.indexOf("msg.innerHTML = '<div class=\"success\">' + doneText + '</div>';") !== -1 &&
      seg.indexOf("msg.innerHTML = '<div class=\"success\">' + doneText + '</div>';") < seg.indexOf('return loadWalletPeople()');
  })());
check('WIRING the row value text is provider + masked number via B.maskWalletNumber',
  (function () {
    const seg = sliceBetween(appSrc, 'function payWalletRowText(me)', 'function wirePayWalletLink()');
    return seg.indexOf("me.walletProvider + ' ' + B.maskWalletNumber(me.walletNumber)") !== -1 &&
      seg.indexOf("'Not linked'") !== -1;
  })());

console.log(fail === 0 ? 'ALL V72 LINK-WALLET TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
