/* TSG BIOM v67 — PROTOTYPE (the Chairman's approved design set,
   v67-mobile-design; build order 2026-11-26 01:10).

   v67 puts the prototype front on the live system: the app
   opens on a role choice (Customer / Merchant); the customer
   face is registration-first, then a wallet home with exactly
   three actions, an Inbox tab fed ONLY by real money events,
   and a Settings tab; the merchant face lands on the terminal
   scanner with a Balance tab computed from the real BIOM-PAY
   records. The owner face and every frozen system (bars,
   guards, encryption, signing, sync) are untouched.

   This suite pins: version coherence at v67 and the identity
   migration step; role routing (factory + wiring); the Inbox
   factory (all four event types, unread state, the cap,
   per-profile isolation) and the wiring rule that events are
   written on success paths ONLY; the Settings actions; the
   merchant balance chain arithmetic on real-shaped records;
   and the scan-speed programme's two code facts (the deep
   pre-warm and the concurrent impostor maxima). */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  const j = b ? src.indexOf(b, i + a.length) : src.length;
  return i === -1 ? '' : src.slice(i, j === -1 ? src.length : j);
}

/* ---------- version coherence + identity migration -------------- */
check('VERSION app, shell, user-visible line and chain agree at v91 (v91 named pin change: liquid glass)',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v91' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v91'") !== -1 &&
  html.indexOf('TSG Biom · App v91 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v91');
check('MIGRATION the v67 step is a pure adoption: a v66 store opens byte-identical',
  (function () {
    const before = JSON.stringify({
      people: [{ id: 'TSG-BIO-1', name: 'Gate Person A', wallet: { balance: 500, statement: [{ kind: 'add', amount: 500, balanceAfter: 500, ref: 'DEMO-1' }], linkedAccounts: [] } }],
      logs: [{ ts: 1, result: 'Verified' }], transactions: [{ id: 'BIOM-PAY-1001', amount: 320 }], meta: [{ key: 'paySeq', value: 1002 }]
    });
    const mig = B.migrateBiomData(JSON.parse(before), 'v66', 'v67');
    return mig.appliedSteps.indexOf('v67') !== -1 && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());

/* ---------- role mode factory ------------------------------------ */
const roleSrc = appSrc.slice(appSrc.indexOf('/* ROLEMODE-BEGIN'), appSrc.indexOf('/* ROLEMODE-END */'));
check('ROLE the role-mode block is extractable from app.js', roleSrc.indexOf('function createRoleMode') !== -1);
const createRoleMode = new Function(roleSrc + '\nreturn createRoleMode;')();
(function () {
  const mem = {};
  const store = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };
  const R = createRoleMode(store);
  check('ROLE no stored role reads as no role (the choice shows)', R.get() === null && !R.isCustomer() && !R.isMerchant());
  R.set('customer');
  check('ROLE customer persists and reads back', R.get() === 'customer' && R.isCustomer() && !R.isMerchant() && mem.tsgbiom_role === 'customer');
  R.set('merchant');
  check('ROLE merchant persists and reads back', R.get() === 'merchant' && R.isMerchant());
  check('ROLE an unknown role is refused, the stored role stands', R.set('owner') === 'merchant' && R.get() === 'merchant');
  R.clear();
  check('ROLE clear returns to no role (log out lands on the choice)', R.get() === null);
  const broken = createRoleMode({ getItem: function () { throw new Error('no storage'); }, setItem: function () { throw new Error('no storage'); }, removeItem: function () { throw new Error('no storage'); } });
  check('ROLE a throwing storage degrades to no role, never a crash', broken.get() === null && broken.set('customer') === null);
})();

/* ---------- role routing wiring ----------------------------------- */
check('WIRING the role page and both choices exist in the markup',
  html.indexOf('id="page-role"') !== -1 && html.indexOf('id="roleCustomer"') !== -1 && html.indexOf('id="roleMerchant"') !== -1);
check('WIRING the boot chain routes by role after the face is applied',
  appSrc.indexOf('applyRoleBoot();') !== -1 && appSrc.indexOf("if (role === 'merchant') { go('terminal'); }") !== -1 &&
  appSrc.indexOf("else if (role === 'customer') { go('wallet'); }") !== -1 && appSrc.indexOf("else { go('role'); }") !== -1);
check('WIRING customer choice is registration-first (no profiles -> enrolment, else the wallet)',
  sliceBetween(appSrc, "$('roleCustomer').addEventListener", "$('roleMerchant')").indexOf("if (!people.length) { go('enroll'); } else { go('wallet'); }") !== -1);
check('WIRING merchant choice lands on the scanner',
  sliceBetween(appSrc, "$('roleMerchant').addEventListener", '/* ---------------- v67 Inbox page').indexOf("go('terminal')") !== -1);
check('WIRING go() resolves owner pages to the scanner in the merchant role, and the Scanner tab to the terminal',
  appSrc.indexOf("if (!FaceMode.isOwner() && RoleMode.isMerchant() && FaceMode.OWNER_PAGES.indexOf(requestedPage) !== -1)") !== -1 &&
  appSrc.indexOf("if (requestedPage === 'scanner')") !== -1 &&
  appSrc.indexOf("if (requestedPage === 'scanner' && page === 'terminal') navPage = 'scanner';") !== -1);
check('WIRING the v63 go() gate line survives verbatim (the role routing composes with it, never replaces it)',
  appSrc.indexOf("if (!FaceMode.isOwner() && FaceMode.OWNER_PAGES.indexOf(page) !== -1) page = 'wallet';") !== -1);
check('WIRING the terminal people load admits owner OR merchant, and go(terminal) uses it',
  appSrc.indexOf('function ensureTerminalPeople()') !== -1 &&
  appSrc.indexOf('if (!FaceMode.isOwner() && !RoleMode.isMerchant()) return Promise.resolve();') !== -1 &&
  appSrc.indexOf('ensureTerminalPeople().then(function () { maybeArmTerminal(); })') !== -1);
check('WIRING the role layer re-attaches ONLY the terminal for the merchant (no other owner surface)',
  appSrc.indexOf('function attachTerminalForMerchant()') !== -1 &&
  appSrc.indexOf("document.getElementById('page-terminal')") !== -1 &&
  (appSrc.match(/attachTerminalForMerchant\(\)/g) || []).length >= 2);
check('WIRING owner lock returns a merchant to the scanner',
  sliceBetween(appSrc, 'function lockOwnerMode()', 'function applyInitialFace()').indexOf("if (RoleMode.isMerchant()) { go('terminal'); } else { go('wallet'); }") !== -1);

/* ---------- nav sets ---------------------------------------------- */
(function () {
  const chrome = sliceBetween(appSrc, 'function applyFaceChrome()', 'function enterOwnerMode()');
  check('NAV the owner face keeps its v66 set (no prototype tabs leak in)',
    chrome.indexOf("p !== 'inbox' && p !== 'settings' && p !== 'scanner' && p !== 'balance'") !== -1);
  check('NAV the customer role shows Wallet / Inbox / Settings; the merchant role Scanner / Balance',
    chrome.indexOf("(p === 'wallet' || p === 'inbox' || p === 'settings')") !== -1 &&
    chrome.indexOf("(p === 'scanner' || p === 'balance')") !== -1);
  check('NAV the markup carries the four prototype tabs alongside the pinned eight',
    ['wallet', 'activity', 'account', 'dashboard', 'enroll', 'terminal', 'registry', 'more', 'inbox', 'settings', 'scanner', 'balance']
      .every(function (p) { return html.indexOf('data-page="' + p + '"') !== -1; }));
  check('NAV the Inbox tab carries the unread badge element',
    html.indexOf('id="inboxBadge"') !== -1 && appSrc.indexOf('function updateInboxBadge()') !== -1);
})();

/* ---------- wallet home structure --------------------------------- */
check('WALLET the shipped wallet actions are Add, Biom Pay, Scan, History, Loyalty (v90: Send Money removed by the Chairman, 2026-11-28)',
  html.indexOf('id="wAddOpen"') !== -1 && html.indexOf('id="wSendOpen"') === -1 && html.indexOf('id="wPayOpen"') !== -1 &&
  html.indexOf('id="wLoyaltyOpen"') !== -1);
check('WALLET the customer-role home hides the extra tiles, points chip, linked/activity cards and close button (owner face untouched)',
  css.indexOf('body.mode-customer.role-customer .balpoints,') !== -1 &&
  css.indexOf('body.mode-customer.role-customer #wQuickScan,') !== -1 &&
  css.indexOf('body.mode-customer.role-customer #wActivityCard,') !== -1 &&
  css.indexOf('body.mode-customer.role-customer .qa-grid{grid-template-columns:repeat(3,1fr)}') !== -1 &&
  html.indexOf('id="wQuickScan"') !== -1 && html.indexOf('id="wActivityCard"') !== -1);
check('WALLET the facts card and greeting are customer-face markup filled from the live record',
  html.indexOf('id="wFactsCard" data-face="customer"') !== -1 && html.indexOf('id="wHomeGreet"') !== -1 &&
  appSrc.indexOf("$('wFactId')") !== -1 && appSrc.indexOf("$('wFactPalm')") !== -1 && appSrc.indexOf("$('wFactPhone')") !== -1);
check('WALLET the honest palm note ships (and the false "palm opens this wallet" line does not)',
  html.indexOf('Your palm approves every payment from this wallet') !== -1 &&
  html.indexOf('Your palm opens this wallet') === -1 && appSrc.indexOf('Your palm opens this wallet') === -1);

/* ---------- inbox factory ------------------------------------------ */
const inboxSrc = appSrc.slice(appSrc.indexOf('/* INBOX-BEGIN'), appSrc.indexOf('/* INBOX-END */'));
check('INBOX the inbox block is extractable from app.js', inboxSrc.indexOf('function createInbox') !== -1);
const createInbox = new Function(inboxSrc + '\nreturn createInbox;')();
function fakeInboxStore() {
  const data = {};
  return {
    data: data,
    load: function (pid) { return Promise.resolve((data[pid] || []).map(function (e) { return JSON.parse(JSON.stringify(e)); })); },
    save: function (pid, events) { data[pid] = events.map(function (e) { return JSON.parse(JSON.stringify(e)); }); return Promise.resolve(); }
  };
}
(async function () {
  const store = fakeInboxStore();
  const Ix = createInbox(store);
  const add = Ix.event('add', { amount: 500, balanceAfter: 500, ref: 'DEMO-1', detail: 'From bKash — 01933-***706 · Demo money', ts: 1000 });
  const send = Ix.event('send', { amount: 200, balanceAfter: 300, ref: 'DEMO-2', counterpartyName: 'Gate Person B', ts: 2000 });
  const pay = Ix.event('pay', { amount: 420, ref: 'BIOM-PAY-1001', detail: 'At FreshMart Supermarket · Demo money', ts: 3000 });
  const recv = Ix.event('receive', { amount: 150, balanceAfter: 450, ref: 'DEMO-3', counterpartyName: 'Gate Person B', ts: 4000 });
  check('INBOX the four event types build with the designed titles',
    add.title === 'Add money successful' && send.title === 'Send money successful' &&
    pay.title === 'Payment done' && recv.title === 'You received money from Gate Person B');
  check('INBOX events carry the real money facts and start unread',
    add.amount === 500 && add.balanceAfter === 500 && add.ref === 'DEMO-1' && add.read === false &&
    recv.counterpartyName === 'Gate Person B' && pay.balanceAfter === null);
  check('INBOX an unknown kind builds nothing', Ix.event('promo', {}) === null);
  check('INBOX add refuses a missing profile or a missing event',
    (await Ix.add(null, add)) === false && (await Ix.add('TSG-BIO-1', null)) === false && Object.keys(store.data).length === 0);
  await Ix.add('TSG-BIO-1', add); await Ix.add('TSG-BIO-1', send); await Ix.add('TSG-BIO-1', pay); await Ix.add('TSG-BIO-1', recv);
  await Ix.add('TSG-BIO-2', Ix.event('add', { amount: 50, balanceAfter: 50, ref: 'DEMO-9', ts: 5000 }));
  const list1 = await Ix.list('TSG-BIO-1');
  check('INBOX the list is newest-first with all four events', list1.length === 4 && list1[0].kind === 'receive' && list1[3].kind === 'add',
    list1.map(function (e) { return e.kind; }).join(','));
  check('INBOX profiles are isolated (another profile sees only its own events)',
    (await Ix.list('TSG-BIO-2')).length === 1 && (await Ix.list('TSG-BIO-404')).length === 0);
  check('INBOX unread counting and mark-all-read persist',
    (await Ix.unreadCount('TSG-BIO-1')) === 4 && (await Ix.markAllRead('TSG-BIO-1')) === true &&
    (await Ix.unreadCount('TSG-BIO-1')) === 0 && (await Ix.list('TSG-BIO-1')).every(function (e) { return e.read; }));
  const big = fakeInboxStore();
  const Ix2 = createInbox(big);
  for (let i = 1; i <= Ix2.CAP + 5; i++) { await Ix2.add('P', Ix2.event('add', { amount: i, balanceAfter: i, ref: 'R' + i, ts: i })); }
  const capped = await Ix2.list('P');
  check('INBOX the cap holds and the oldest events drop first',
    capped.length === Ix2.CAP && capped[capped.length - 1].ref === 'R6' && capped[0].ref === 'R' + (Ix2.CAP + 5),
    'cap=' + Ix2.CAP + ' len=' + capped.length);

  /* ---------- inbox wiring: success paths only -------------------- */
  const addSites = (appSrc.match(/Inbox\.add\(/g) || []).length;
  const eventSites = (appSrc.match(/Inbox\.event\(/g) || []).length;
  check('INBOX-WIRING exactly four event writes exist (add, wallet pay, terminal pay, bKash sandbox — v90 named pin change: the two Send events left with the removed Send flow)',
    addSites === 4 && eventSites === 4, 'add=' + addSites + ' event=' + eventSites);
  check('INBOX-WIRING the bKash sandbox event follows the sandbox record write and carries the TEST MODE kind',
    (function () {
      const seg = sliceBetween(appSrc, 'function handleBkashReturn()', '/* ---------------- My Account (v52)');
      return seg.indexOf("DB.put('transactions', rec)") !== -1 &&
        seg.indexOf("Inbox.add(person.id, Inbox.event('bkash'") > seg.indexOf("DB.put('transactions', rec)") &&
        seg.indexOf("rail: 'bkash-sandbox'") !== -1;
    })());
  check('INBOX-WIRING the Add Money event is written after the updated record is stored',
    (function () {
      const seg = sliceBetween(appSrc, "return DB.put('people', res.person).then(function () {", 'Demo money added');
      return seg.indexOf("Inbox.add(res.person.id, Inbox.event('add'") !== -1;
    })());
  check('INBOX-WIRING the Send events are REMOVED with the Send flow (v90, Chairman 2026-11-28)',
    appSrc.indexOf("Inbox.event('send'") === -1 && appSrc.indexOf("Inbox.event('receive'") === -1 &&
    appSrc.indexOf('Demo money sent') === -1);
  check('INBOX-WIRING the wallet pay event follows the payment record write',
    (function () {
      const seg = sliceBetween(appSrc, 'var createWalletPay = function ()', 'Biom Pay complete');
      return seg.indexOf("DB.put('transactions', tx)") !== -1 &&
        seg.indexOf("Inbox.add(fresh.id, Inbox.event('pay'") > seg.indexOf("DB.put('transactions', tx)");
    })());
  check('INBOX-WIRING the terminal pay event follows the payment record write',
    (function () {
      const seg = sliceBetween(appSrc, 'var createPay = function ()', 'Biom Pay — Payment Authorized');
      return seg.indexOf("DB.put('transactions', tx)") !== -1 &&
        seg.indexOf("Inbox.add(person.id, Inbox.event('pay'") > seg.indexOf("DB.put('transactions', tx)");
    })());
  check('INBOX-WIRING no failure helper writes an event (walletScanFailed and the refusal paths stay silent)',
    appSrc.substr(appSrc.indexOf('function walletScanFailed'), 4000).indexOf('Inbox') === -1 &&
    sliceBetween(appSrc, 'function spoofOut', 'function livenessFailOut').indexOf('Inbox') === -1);
  check('INBOX-WIRING events persist per profile in the meta store (outside the synced bank shape)',
    appSrc.indexOf("DB.getMeta('inbox:' + personId, [])") !== -1 && appSrc.indexOf("DB.setMeta('inbox:' + personId, events)") !== -1);
  check('INBOX the page renders, groups by day and marks read on open',
    html.indexOf('id="page-inbox"') !== -1 && appSrc.indexOf('function renderInbox()') !== -1 &&
    appSrc.indexOf('function inboxDayLabel(ts)') !== -1 && appSrc.indexOf('Inbox.markAllRead(me.id)') !== -1 &&
    html.indexOf('You are all caught up.') !== -1);

  /* ---------- settings wiring -------------------------------------- */
  check('SETTINGS the page and its four rows exist as designed',
    html.indexOf('id="page-settings"') !== -1 && html.indexOf('id="setSwitchRow"') !== -1 &&
    html.indexOf('id="setCreateRow"') !== -1 && html.indexOf('id="setMerchantRow"') !== -1 && html.indexOf('id="setLogoutRow"') !== -1 &&
    html.indexOf('Use as Merchant') !== -1);
  check('SETTINGS switch account routes to the existing multi-profile wallet entry',
    sliceBetween(appSrc, "$('setSwitchRow').addEventListener", "$('setCreateRow')").indexOf("closeWalletSession(); go('wallet');") !== -1);
  check('SETTINGS create another account is a new enrolment',
    sliceBetween(appSrc, "$('setCreateRow').addEventListener", "$('setMerchantRow')").indexOf("go('enroll')") !== -1);
  check('SETTINGS Use as Merchant sets the merchant role and lands on the scanner',
    (function () {
      const seg = sliceBetween(appSrc, "$('setMerchantRow').addEventListener", "$('setLogoutRow')");
      return seg.indexOf("RoleMode.set('merchant')") !== -1 && seg.indexOf("go('terminal')") !== -1;
    })());
  check('SETTINGS log out closes the wallet, clears the role and returns to the choice',
    (function () {
      const seg = sliceBetween(appSrc, "$('setLogoutRow').addEventListener", '/* ---------------- v67 merchant Balance page');
      return seg.indexOf('closeWalletSession();') !== -1 && seg.indexOf('RoleMode.clear();') !== -1 && seg.indexOf("go('role')") !== -1;
    })());
  check('SETTINGS render reads the live profile (name, phone, Biom ID, account count)',
    appSrc.indexOf('function renderSettings()') !== -1 && appSrc.indexOf("$('setSwitchVal')") !== -1);

  /* ---------- merchant balance ------------------------------------- */
  const balSrc = appSrc.slice(appSrc.indexOf('/* MERCHANT-BALANCE-BEGIN'), appSrc.indexOf('/* MERCHANT-BALANCE-END */'));
  check('BALANCE the merchant-balance block is extractable from app.js', balSrc.indexOf('function merchantBalanceSummary') !== -1);
  const merchantBalanceSummary = new Function(balSrc + '\nreturn merchantBalanceSummary;')();
  (function () {
    const day = new Date(); day.setHours(12, 0, 0, 0);
    const t0 = day.getTime();
    const people = { 'TSG-BIO-2842': { id: 'TSG-BIO-2842', name: 'Gate Person A', phone: '01933-038706' } };
    const txs = [
      { id: 'BIOM-PAY-1003', ts: t0 + 3000, personId: 'TSG-BIO-2842', personName: 'Gate Person A', provider: 'bKash', walletMasked: '01933-***706', store: 'FreshMart Supermarket', amount: 500, method: 'palm', status: 'Biometric Authorised — Pending Provider Settlement' },
      { id: 'BIOM-PAY-1001', ts: t0 + 1000, personId: 'TSG-BIO-2842', personName: 'Gate Person A', provider: 'bKash', walletMasked: '01933-***706', store: 'FreshMart Supermarket', amount: 320, method: 'palm', status: 'Biometric Authorised — Pending Provider Settlement' },
      { id: 'BIOM-PAY-1002', ts: t0 + 2000, personId: 'TSG-BIO-2842', personName: 'Gate Person A', provider: 'bKash', walletMasked: '01933-***706', store: 'FreshMart Supermarket', amount: 420, method: 'palm', status: 'Biometric Authorised — Pending Provider Settlement' }
    ];
    const s = merchantBalanceSummary(txs, people, t0 + 4000);
    check('BALANCE receipts are newest-first over the real record shape', s.rows.length === 3 && s.rows[0].amount === 500 && s.rows[2].amount === 320);
    check('BALANCE the running-balance chain holds (320 -> 740 -> 1,240, the design mockup arithmetic)',
      s.rows[2].balanceAfter === 320 && s.rows[1].balanceAfter === 740 && s.rows[0].balanceAfter === 1240,
      s.rows.map(function (r) { return r.balanceAfter; }).join(','));
    check('BALANCE totals: all-time and today agree on same-day records',
      s.totalReceived === 1240 && s.todayTotal === 1240 && s.todayCount === 3);
    check('BALANCE the customer number joins from the profile, falling back to the record masked wallet',
      s.rows[0].number === '01933-038706' &&
      merchantBalanceSummary(txs, {}, t0 + 4000).rows[0].number === '01933-***706');
    const yday = t0 - 86400000;
    const mixed = merchantBalanceSummary(txs.concat([{ id: 'BIOM-PAY-1000', ts: yday, personId: 'TSG-BIO-2842', personName: 'Gate Person A', walletMasked: '01933-***706', amount: 100 }]), people, t0 + 4000);
    check('BALANCE a yesterday receipt counts in the chain and the total, not in today',
      mixed.totalReceived === 1340 && mixed.todayTotal === 1240 && mixed.todayCount === 3 && mixed.rows[3].balanceAfter === 100);
    const empty = merchantBalanceSummary([], people, t0);
    check('BALANCE no records means an honest empty summary', empty.rows.length === 0 && empty.totalReceived === 0 && empty.todayCount === 0);
    check('BALANCE a record with no numeric amount contributes nothing',
      merchantBalanceSummary([{ id: 'X', ts: t0, amount: '500' }], people, t0).rows.length === 0);
  })();
  check('BALANCE the page renders from the transactions store with the designed summary strip',
    html.indexOf('id="page-balance"') !== -1 && html.indexOf('id="balTodayTotal"') !== -1 && html.indexOf('id="balList"') !== -1 &&
    appSrc.indexOf('function renderMerchantBalance()') !== -1 && appSrc.indexOf('merchantBalanceSummary(r[0], peopleById, Date.now())') !== -1);

  /* ---------- defects the gate exposed, fixed in v67 --------------- */
  check('FIX a refused wallet scan in the customer face renders its verdict (logVerification guards the detached terminal store select)',
    (function () {
      const seg = sliceBetween(appSrc, 'function logVerification(person, method, measured, result)', '/* ---------------- Field Test Mode');
      return seg.indexOf("var storeEl = $('termStore');") !== -1 &&
        seg.indexOf("store: storeEl ? storeEl.value : ''") !== -1 &&
        seg.indexOf("store: $('termStore').value") === -1;
    })());
  check('FIX Create another account after a completed enrolment presents the fresh form (go(enroll) resets a resting Done step, never an in-progress one)',
    sliceBetween(appSrc, "if (page === 'enroll') {", 'window.scrollTo(0, 0);').indexOf("if (!enroll.details && !$('enroll-done').classList.contains('hidden'))") !== -1 &&
    sliceBetween(appSrc, "if (page === 'enroll') {", 'window.scrollTo(0, 0);').indexOf("setStep('details')") !== -1);
  check('FIX the enrolment Done screen states the palm truthfully for current (v4) profiles',
    appSrc.indexOf('bit-packed templates banked, movement-checked') !== -1);

  /* ---------- the camera law (Chairman's order, 2026-11-26) ---------
     On his phone the scanner auto-switched cameras in a loop:
     no hand on the back camera -> flip to front -> no hand ->
     flip back. The law now: the camera NEVER changes on its
     own, during or between scans; the facing the user chose
     stays until the user taps the manual switch. And a
     detector that cannot run says so honestly instead of
     reporting "no hand". */
  check('CAMERA the auto-swap message and machinery are deleted from every stream (not damped — gone)',
    appSrc.indexOf('switching to the other camera') === -1 &&
    appSrc.indexOf('swapCamera()') === -1 &&
    appSrc.indexOf('function walletSwapCamera') === -1 &&
    appSrc.indexOf('walletSwapCamera,') === -1 &&
    appSrc.indexOf("=== 'user' ? 'environment' : 'user'") === -1);
  check('CAMERA the only facing assignment in the app is the user\'s own toggle tap (wireCamToggles reads the tapped button)',
    (appSrc.match(/camFacing\[key\] = b\.dataset\.facing;/g) || []).length === 1 &&
    sliceBetween(appSrc, 'function wireCamToggles()', 'function applyMirror').indexOf('camFacing[key] = b.dataset.facing;') !== -1);
  check('CAMERA every scan call site passes no swap callback (enrol, top-up, terminal, wallet verify/identify, owner unlock)',
    appSrc.indexOf("streamEnrolPalm($('palmVideo'), $('palmStatus'), null, null, control)") !== -1 &&
    appSrc.indexOf("streamEnrolPalm($('topVideo'), $('topStatus'), null, null, control)") !== -1 &&
    /* v82 PIN CHANGE (named openly): the terminal call passes
       an empty people array + opts.peopleReady now; the swap
       argument this pin guards is still the literal null. */
    appSrc.indexOf("streamVerifyPalm($('termVideo'), $('termStatus'), person, [], null, fieldRec") !== -1 &&
    (appSrc.match(/people, null, function \(\) \{\}, walletControl/g) || []).length >= 2 &&
    /* v90: the send receiver-identify site (the old third match) is gone with the Send flow */
    appSrc.indexOf('fresh, null, walletControl') !== -1);
  check('CAMERA the pinned stream signatures keep the (now always-null) swapCamera parameter — the freeze is honoured',
    appSrc.indexOf('function streamVerifyPalm(video, statusEl, person, people, swapCamera, fieldRec, control, opts)') !== -1 &&
    appSrc.indexOf('function streamIdentifyPalm(video, statusEl, people, swapCamera, control, opts)') !== -1 &&
    appSrc.indexOf('function streamEnrolPalm(video, statusEl, sequence, swapCamera, control)') !== -1);
  check('DETECTOR PalmProc reports per-call health: a delivered result clears the failure flag; send failure, results timeout and init throw each set it',
    appSrc.indexOf('lastCallFailed: function () { return this._frameFailed; }') !== -1 &&
    appSrc.indexOf('self._frameFailed = false; // v67: this call ran the detector') !== -1 &&
    (appSrc.match(/_frameFailed = true/g) || []).length >= 3 &&
    appSrc.indexOf('var detFailed = PalmProc.lastCallFailed();') !== -1 &&
    appSrc.indexOf('detFailed: detFailed') !== -1);
  check('DETECTOR a still-loading detector is never torn down (the first-load rebuild race that wedged the runtime is fixed): the 4 s rebuild applies only after the first result ever',
    appSrc.indexOf('_everResulted: false') !== -1 &&
    appSrc.indexOf('self._everResulted = true;') !== -1 &&
    appSrc.indexOf('}, self._everResulted ? 4000 : 45000);') !== -1 &&
    appSrc.indexOf('if (self._everResulted) {') !== -1);
  check('DETECTOR each stream counts its OWN consecutive failed frames (warm-up failures during the runtime load cannot poison a scan) and ends honestly at three (v69 named pin change: the verify stream also counts total detector-failed frames for the frame cap, so its increment sits in a block)',
    (appSrc.match(/if \(r\.detFailed\)[^}]*detFails\+\+/g) || []).length >= 3 &&
    (appSrc.match(/detFails >= 3/g) || []).length >= 3 &&
    appSrc.indexOf('var DETECTOR_FAIL_MSG = ') !== -1 &&
    appSrc.indexOf('The hand detector could not run on this device') !== -1 &&
    appSrc.indexOf("return Promise.resolve('detector')") !== -1 &&
    appSrc.indexOf('detectorFailed: true') !== -1);
  check('DETECTOR the enrolment, top-up and re-registration callers render the detector outcome plainly (nothing stored/changed)',
    (appSrc.match(/res\.detectorFailed/g) || []).length >= 2 &&
    appSrc.indexOf('if (res.detectorFailed) return DETECTOR_FAIL_MSG') !== -1);
  check('CAMERA a no-hand scan stays a calm guidance outcome on the same camera (the shipped no-palm verdict text is intact)',
    appSrc.indexOf('No usable open palm with readable print detail found in the scan. Nothing was verified. Show one open palm to the camera, fingers spread, in good light, and run the scan again.') !== -1);

  /* ---------- scan-speed programme ---------------------------------- */
  check('SPEED the deep pre-warm pays the tracking branch and one dummy PalmNet embedding at boot',
    appSrc.indexOf('PalmNet.embedPair(dummyRoi)') !== -1 &&
    appSrc.indexOf('PalmProc.landmarks(dc).then(function () { return PalmProc.landmarks(dc); })') !== -1 &&
    appSrc.indexOf('var dummyRoi = new Uint8Array(B.PALMPRINT_ROI_SIZE * B.PALMPRINT_ROI_SIZE);') !== -1);
  check('SPEED the verify verdict computes both impostor maxima concurrently (same values, same judgement)',
    /* v82 PIN CHANGE (named openly): the neural maximum now
       also receives win.frameIdx so it can reuse the win
       frame's already-computed PalmNet pair — the same
       embeddings, the same maximum, the same judgement; the
       concurrency this pin guards is unchanged. */
    appSrc.indexOf('Promise.all([impostorMaxFor(win.rois, winHand), neuralImpostorMaxFor(win.rois, winHand, win.frameIdx)])') !== -1 &&
    appSrc.indexOf('B.moneyMarginCheck(win.res, impMax, nImpMax)') !== -1);
  check('SPEED the frozen bars are untouched by the prototype (EDCC 0.32 / PalmNet 0.5895 still the shipped constants)',
    B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

  console.log(fail === 0 ? 'ALL V67 PROTOTYPE TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.log('FAIL  suite crashed: ' + (e && e.stack || e));
  process.exit(1);
});

/* v67 gate-found fix: the terminal section carries .owner-only,
   which the customer face hides with !important — the merchant
   role must have a scoped exception or its scanner page renders
   blank (found by reading the gate screenshots, 2026-11-26). */
check('merchant terminal renders: the owner-only hide has a role-scoped .active exception',
  css.indexOf('body.mode-customer.role-merchant #page-terminal.owner-only.active{display:block!important}') !== -1);
