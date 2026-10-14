// Real-time work: hover-play cards + beauty / lighting / wireframe compare slider.

// Cards: play the muted preview on hover, rewind on leave.
document.querySelectorAll('.rt-card').forEach((card) => {
  const v = card.querySelector('video');
  if (!v) return;
  card.addEventListener('mouseenter', () => { v.currentTime = 0; v.play().catch(() => {}); });
  card.addEventListener('mouseleave', () => v.pause());
});

// Compare slider. Markup:
// <div class="compare" data-sets='{"Lighting": ["a.mp4","b.mp4"], ...}'>
//   <video class="compare__under">  (beauty, full frame)
//   <div class="compare__top"><video></div>  (pass, clipped to the left part)
document.querySelectorAll('[data-compare]').forEach((root) => {
  const box = root.querySelector('.compare');
  const under = box.querySelector('.compare__under');
  const top = box.querySelector('.compare__top');
  const topVid = top.querySelector('video');
  const handle = box.querySelector('.compare__handle');
  const labelL = box.querySelector('.compare__label--l');
  const tabs = root.querySelectorAll('.compare-tab');

  const setPos = (pct) => {
    pct = Math.max(0, Math.min(100, pct));
    top.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    handle.style.left = pct + '%';
  };
  const fromEvent = (e) => {
    const r = box.getBoundingClientRect();
    setPos(((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width * 100);
  };
  let dragging = false;
  box.addEventListener('pointerdown', (e) => { dragging = true; box.setPointerCapture(e.pointerId); fromEvent(e); });
  box.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  box.addEventListener('pointerup', () => { dragging = false; });
  setPos(50);

  // Keep the two layers frame-locked.
  const sync = () => {
    if (Math.abs(topVid.currentTime - under.currentTime) > 0.05) topVid.currentTime = under.currentTime;
  };
  under.addEventListener('play', () => { topVid.play().catch(() => {}); });
  under.addEventListener('pause', () => topVid.pause());
  under.addEventListener('seeked', sync);
  setInterval(sync, 500);

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
    // A tab can also switch the beauty layer (other camera / aspect), restarting both in sync.
    const newUnder = tab.dataset.under && !under.src.endsWith(tab.dataset.under);
    const t = newUnder ? 0 : under.currentTime;
    if (newUnder) { under.src = tab.dataset.under; under.play().catch(() => {}); }
    topVid.src = tab.dataset.src;
    topVid.currentTime = t;
    topVid.play().catch(() => {});
    if (labelL) labelL.textContent = tab.dataset.label || tab.textContent;
  }));
});
