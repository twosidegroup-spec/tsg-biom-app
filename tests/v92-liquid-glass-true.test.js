/* TSG BIOM v92 — TRUE LIQUID GLASS (the Chairman's verdict on
   v91, 2026-11-28: "not feeling glassy — just button colour
   changed, old structure"). Built from two reference sets:
   (1) his own images — the glossy blue capsule stack in his
   exact ramp, the gel pill buttons + floating glass panel of
   his Liquid Glass UI Kit, the bubble's iridescent rim light
   (edge only), the styleguide's token discipline; (2) the
   Pinterest board checked live in his browser (18 pins):
   ice-blue aurora + glow orbs, frosted white at 10–25% with
   heavy blur, 1px white rim brightest top-left, ONE radius
   scale, soft blue-grey shadows, floating detached chrome.
   This suite pins the recipe, the two tints of it (clear +
   scrim), the capsule hero, the gel primary, the floating
   nav/sidebar, and that scan surfaces still carry no blur. */
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
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const at = cssSrc.indexOf('v92 — TRUE LIQUID GLASS');
const lg = at === -1 ? '' : cssSrc.slice(at);

check('LG2 the v92 layer exists in styles.css', at !== -1);
check('LG2 the aurora background is vivid (blue orb at .50, violet .36, teal .30 over an ice field)',
  lg.indexOf('rgba(55,129,252,.50)') !== -1 && lg.indexOf('rgba(139,124,255,.36)') !== -1 &&
  lg.indexOf('rgba(45,212,191,.30)') !== -1 && lg.indexOf('#D8E9FC') !== -1);
check('LG2 clear glass is truly translucent (white .44 → .20 gradient, never a solid card)',
  lg.indexOf('--lg-clear:linear-gradient(135deg, rgba(255,255,255,.44), rgba(255,255,255,.20)') !== -1);
check('LG2 the scrim tier exists for text-heavy surfaces (white .80 → .64)',
  lg.indexOf('--lg-scrim:linear-gradient(135deg, rgba(255,255,255,.80), rgba(255,255,255,.64)') !== -1);
check('LG2 the blur is heavy (22px, saturate 1.75) and the rim is a white light edge',
  lg.indexOf('--lg-blur:blur(22px) saturate(1.75)') !== -1 && lg.indexOf('--lg-rim:rgba(255,255,255,.75)') !== -1);
check('LG2 cards are clear glass at the 24px radius with the lit top edge',
  lg.indexOf('.card{background:var(--lg-clear);border:1px solid var(--lg-rim);box-shadow:var(--lg-shadow);border-radius:24px}') !== -1 &&
  lg.indexOf('inset 0 1px 0 rgba(255,255,255,.85)') !== -1);
check('LG2 the balance hero is his capsule stack (ramp gradient + glossy top streak + blue shadow)',
  lg.indexOf('linear-gradient(150deg,#0B2CB1 0%, #1951FC 52%, #3781FC 100%)') !== -1 &&
  lg.indexOf('linear-gradient(180deg, rgba(255,255,255,.38), rgba(255,255,255,0) 42%)') !== -1 &&
  lg.indexOf('--lg-hero-shadow:0 26px 52px rgba(25,81,252,.38)') !== -1 && lg.indexOf('border-radius:28px') !== -1);
check('LG2 primary buttons are gel capsules (glossy top, deep base, blue shadow)',
  lg.indexOf('linear-gradient(180deg,#5B97FF 0%, #3781FC 30%, #1951FC 68%, #0B2CB1 100%)') !== -1 &&
  lg.indexOf('0 16px 30px rgba(25,81,252,.42)') !== -1);
check('LG2 the bottom nav is a floating glass pill and the active tab a blue capsule inside it',
  lg.indexOf('blur(24px) saturate(1.8)') !== -1 && lg.indexOf('border-radius:30px') !== -1 &&
  lg.indexOf('.nav button.active{background:linear-gradient(180deg,#3781FC,#1951FC 60%,#0B2CB1)') !== -1);
check('LG2 the desktop sidebar floats detached (16px inset, 28px radius, navy glass)',
  lg.indexOf('.nav{left:16px;top:16px;bottom:16px;width:236px;border-radius:28px') !== -1);
check('LG2 the customer face rides the same glass (nav + hero scoped overrides)',
  lg.indexOf('body.mode-customer.role-customer .nav, body.mode-customer.role-merchant .nav{') !== -1 &&
  lg.indexOf('body.mode-customer.role-customer .balcard') !== -1);
check('LG2 no backdrop blur is scoped onto the camera wrap or the scan pages in this layer',
  lg.indexOf('.camwrap') === -1 && lg.indexOf('#page-terminal') === -1 &&
  lg.indexOf('#page-enroll') === -1 && lg.indexOf('#page-topup') === -1);
check('LG2 version coherence at v92 (app, sw, html, chain length 56)',
  appSrc.indexOf("var APP_DATA_VERSION = 'v94';") !== -1 &&
  swSrc.indexOf('tsg-biom-shell-v94') !== -1 &&
  htmlSrc.indexOf('content="v94"') !== -1 && htmlSrc.indexOf('App v94') !== -1 &&
  B.BIOM_DATA_VERSIONS.length === 58 && B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v94');

console.log('\nv92-liquid-glass-true: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
