/* TSG BIOM v94 — DECLUTTER (the Chairman's word, 2026-11-28, on
   the v93 renders): the buttons are "clutter with fills", the
   header and the sidebar clutter each other on desktop, the
   installed app must not show the install header at all, and
   the Create your Biom wallet page gets a redesign. The layer
   flattens every button fill (one solid fill, one soft shadow,
   no gel gradients, no glow halos — the hero capsule keeps its
   v93 Deep Ocean glow), turns the desktop top bar transparent
   with its brand text aside (the logo stays: it is the owner
   long-press door), removes the top bar entirely in standalone
   (installed) mode via CSS and a JS body class, and brings the
   enrol side panel into the glass system with one connected
   step rail. CSS + the install-block wiring only; no data,
   scan or security surface moves. */
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
const at = cssSrc.indexOf('v94 — DECLUTTER');
const dc = at === -1 ? '' : cssSrc.slice(at);

check('DC the v94 layer exists in styles.css, after the v93 layer',
  at !== -1 && at > cssSrc.indexOf('v93 — DEEP OCEAN, LIGHT MODE'));
check('DC buttons go FLAT: the primary is one solid fill with one soft shadow',
  dc.indexOf('.btn.primary{background:#1951FC') !== -1 &&
  dc.indexOf('box-shadow:0 10px 22px rgba(25,81,252,.28)') !== -1);
check('DC the v94 layer carries no gel gradient and no glow halo of its own',
  dc.indexOf('linear-gradient') === -1 && dc.indexOf(', 0 0 ') === -1 && dc.indexOf('box-shadow:0 0 ') === -1);
check('DC the tile icon glow from v93 is switched off',
  dc.indexOf('.qa-tile svg{filter:none}') !== -1);
check('DC the active nav capsule is the same flat blue',
  dc.indexOf('.nav button.active{background:#1951FC') !== -1);
check('DC desktop: the top bar is no longer a second navy bar (transparent, brand text aside, logo kept)',
  dc.indexOf('.topbar{background:transparent') !== -1 &&
  dc.indexOf('.brand>div{display:none}') !== -1 &&
  htmlSrc.indexOf('id="brandLogo"') !== -1);
check('DC installed app: the header goes away (CSS display-mode + the JS standalone class)',
  dc.indexOf('@media (display-mode:standalone)') !== -1 &&
  dc.indexOf('body.standalone .topbar{display:none}') !== -1 &&
  appSrc.indexOf("classList.add('standalone')") !== -1 &&
  appSrc.indexOf("addEventListener('appinstalled', markStandalone)") !== -1);
check('DC the surviving header install route is untouched',
  appSrc.indexOf("$('installBtn').addEventListener('click', install);") !== -1 &&
  htmlSrc.indexOf('id="installBtn"') !== -1);
check('DC enrol redesign: the side panel joins the glass system, icons on flat blue discs',
  dc.indexOf('.enroll-side{background:var(--lg-scrim)') !== -1 &&
  dc.indexOf('.enroll-ic{background:#1951FC}') !== -1);
check('DC enrol redesign: the step dots become one connected rail',
  dc.indexOf('.enrolldots{width:max-content;position:relative}') !== -1 &&
  dc.indexOf('.enrolldots::before') !== -1);
check('DC scan surfaces stay solid (no camera selector in the v94 layer)',
  !/camwrap|scanpill|video/.test(dc));
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v94',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v94' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v94'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v94">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v94 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v94');
check('CHAIN the migration chain has 58 links and the v94 step is a pure adoption',
  B.BIOM_DATA_VERSIONS.length === 58 &&
  (function () {
    const mig = B.migrateBiomData({ people: [], logs: [], transactions: [], meta: [] }, 'v93', 'v94');
    return mig.appliedSteps.indexOf('v94') !== -1 && mig.changed === false;
  })());

console.log('\nv94-declutter: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
