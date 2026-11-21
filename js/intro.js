// First-start introduction (U4): four hints, each with a spotlight on the real control.
// Shown once after the first "Tap to start audio"; can be replayed from the ☰ menu.

const STEPS = [
  { target: () => document.querySelector('#rack .knob'),
    title: 'Turn a knob',
    text: 'Drag up or down on a knob to turn it. Double-tap a knob to put it back to its starting value.' },
  { target: () => document.querySelector('#rack .mname'),
    title: 'Module menu',
    text: 'Drag a module by its name to move it. Drop it on the bin that appears at the top to remove it. Tap the name for its menu. Tap + at the top to add new modules.' },
  { target: () => document.querySelector('#infoBtn'),
    title: 'Learn what anything does',
    text: 'Tap ? to switch on Info Mode. Then tap any knob, jack or module to read what it does. Tap ? again to play normally.' },
  { target: () => document.querySelector('#guideBtn'),
    title: 'Build step by step',
    text: 'New to synthesizers? Tap Guide to build your first patch one step at a time, with an explanation for every step.' }
];

export function initIntro({ store }) {
  const ring = document.createElement('div'); ring.id = 'introSpot'; ring.hidden = true;
  const card = document.createElement('div'); card.id = 'introCard'; card.hidden = true;
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
  document.body.append(ring, card);
  let i = -1, raf = null;

  function place() {
    const el = STEPS[i] && STEPS[i].target();
    if (!el) { ring.hidden = true; card.style.top = '30%'; card.style.bottom = ''; raf = requestAnimationFrame(place); return; } // e.g. empty rack: no knob to point at
    const r = el.getBoundingClientRect(), pad = 8;
    ring.hidden = false;
    Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    // card below the target when it is in the upper half, above it otherwise
    const below = r.top + r.height / 2 < window.innerHeight / 2;
    card.style.top = below ? Math.min(window.innerHeight - card.offsetHeight - 12, r.bottom + 18) + 'px' : '';
    card.style.bottom = below ? '' : Math.max(12, window.innerHeight - r.top + 18) + 'px';
    raf = requestAnimationFrame(place);
  }
  function show(n) {
    i = n;
    const s = STEPS[i], last = i === STEPS.length - 1;
    const el = s.target(); if (el && el.closest('#rackWrap')) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    card.innerHTML = `
      <button class="winbtn intro-x" id="introX" aria-label="Close the introduction">✕</button>
      <div class="intro-count">${i + 1} / ${STEPS.length}</div>
      <h3>${s.title}</h3><p>${s.text}</p>
      <div class="row"><button class="btn" id="introSkip">${last ? 'Back' : 'Skip'}</button><button class="btn primary" id="introNext">${last ? 'Got it' : 'Next'}</button></div>`;
    card.hidden = false;
    card.querySelector('#introNext').onclick = () => last ? finish() : show(i + 1);
    card.querySelector('#introX').onclick = finish;
    card.querySelector('#introSkip').onclick = () => last ? show(i - 1) : finish();
    if (!raf) place();
  }
  function finish() {
    cancelAnimationFrame(raf); raf = null; i = -1;
    ring.hidden = card.hidden = true;
    store.set('mss.seenIntro', 1);
  }
  return {
    start: () => show(0),
    startOnce: () => { if (!store.get('mss.seenIntro')) show(0); },
    active: () => i >= 0
  };
}
