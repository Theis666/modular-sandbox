// Dev helper: plays a Guided Build like a user, tapping wherever the spotlight points.
// In the browser console: (await import('/tools/guide-walkthrough.js')).run(0)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = (el, t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 7, isPrimary: true }));
// Uses the guide's own target (what the spotlight draws), so it also works while the tab is in the background.
const spotCenter = () => {
  const [t] = window.mssGuide.currentTargets(); if (!t) return null;
  let r = t.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) { t.scrollIntoView({ block: 'center', inline: 'center' }); r = t.getBoundingClientRect(); }
  return [r.x + r.width / 2, r.y + r.height / 2];
};

export async function run(index) {
  // a first-start introduction may be open: click through it
  for (let k = 0; k < 6 && document.querySelector('#introCard') && !document.querySelector('#introCard').hidden; k++) { document.querySelector('#introNext').click(); await sleep(50); }
  // start fresh: forget saved progress, so the chooser does not offer "Continue"
  try { const d = JSON.parse(localStorage.getItem('mss.guides') || '{}'); d.progress = {}; localStorage.setItem('mss.guides', JSON.stringify(d)); } catch (e) {}
  document.querySelector('#guideBtn').click(); await sleep(200);
  document.querySelector(`[data-g="${index}"]`).click(); await sleep(250);
  if (document.querySelector('#askOk')) document.querySelector('#askOk').click();
  await sleep(400);
  return resume();
}

// Continue the guide that is currently open (e.g. after a run hit its limit).
export async function resume() {
  const log = window.__walk = [];
  for (let guard = 0; guard < 400; guard++) {
    const title = (document.querySelector('.g-title') || {}).textContent.replace('✓', '');
    if (/You built/.test(title)) { log.push('FINISHED'); break; }
    if (window.mss.infoMode) { log.push('INFO MODE ON?!'); break; }
    await sleep(350);
    const c = spotCenter(); if (!c) continue;
    // ignore overlays that do not belong to the app (e.g. a browser extension's empty shadow host on <body>)
    const own = e => e.id || e.className || e.parentElement !== document.body;
    const hits = document.elementsFromPoint(c[0], c[1]).filter(own);
    const top = hits[0];
    if (!top) { log.push(title + ' -> OFFSCREEN'); continue; }
    // what a finger hits first (may be a cable lying on top) vs. what is underneath
    const el = hits.find(e => !e.closest('svg')) || top;
    const what = el.closest('.knob') ? 'knob' : el.closest('.sel') ? 'sel' : el.closest('.tog') ? 'tog' : el.closest('.pages button') ? 'page'
      : el.closest('.jack-wrap') ? 'jack:' + el.closest('.module').querySelector('.mname').textContent + '.' + el.closest('.jack-wrap').dataset.jack
      : el.closest('#keys') ? 'keys' : el.closest('.additem') ? 'add:' + el.closest('.additem').dataset.t
      : el.closest('#addBtn') ? '+' : el.closest('#guideNext') ? 'next' : '?' + (el.id || el.className);
    log.push(title + ' -> ' + what);
    if (what === 'knob') {
      const k = el.closest('.knob'), txt = (document.querySelector('.g-text') || {}).textContent || '';
      const first = /past|up to/i.test(txt) || (/ up\b/i.test(title) && !/below|lower|down/i.test(txt));
      for (const up of [first, !first]) { // try the likely direction, then the other one
        ev(top, 'pointerdown', c[0], c[1]); await sleep(30);
        for (let dy = 3; dy <= 300; dy += 3) { ev(k, 'pointermove', c[0], c[1] + (up ? -dy : dy)); await sleep(5); if (window.mssGuide.goalReached()) break; }
        ev(k, 'pointerup', c[0], c[1]);
        if (window.mssGuide.goalReached()) break;
        await sleep(350); // let a double-tap window pass
      }
    } else if (what === 'keys') {
      for (let n = 0; n < 2; n++) { ev(el, 'pointerdown', c[0], c[1]); await sleep(150); ev(el, 'pointerup', c[0], c[1]); await sleep(100); }
    } else if (what.startsWith('jack')) {
      const jw = el.closest('.jack-wrap'); ev(top, 'pointerdown', c[0], c[1]); ev(jw, 'pointerup', c[0], c[1]); jw.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (top.closest('svg')) log.push('   (tapped through a cable)');
    } else if (what.startsWith('?')) { /* spotlight still moving: try again */ }
    else el.click();
  }
  return log;
}
