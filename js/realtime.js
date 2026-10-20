// Real-time work: hover-play cards + beauty / pass compare slider + play-only-what's-on-screen.

// Cards: play the muted preview on hover, rewind on leave.
document.querySelectorAll('.rt-card').forEach((card) => {
  const v = card.querySelector('video');
  if (!v) return;
  card.addEventListener('mouseenter', () => { v.currentTime = 0; v.play().catch(() => {}); });
  card.addEventListener('mouseleave', () => v.pause());
});

// Only decode the videos that are on screen. A project page has ~10 looping 1080p videos; letting them all
// play at once starves the decoder and the compare slider's seeks never finish (the "stuck loop" bug, 10-20).
const onScreen = new Map();  // element -> visible?
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    onScreen.set(e.target, e.isIntersecting);
    const v = e.target.matches('video') ? e.target : e.target.querySelector('.compare__under');
    if (!v) return;
    if (e.isIntersecting) v.play().catch(() => {});
    else v.pause();
  });
}, { threshold: 0.15 }) : null;

if (io) {
  // Standalone page videos (hero, angles, vertical). Compare videos are handled by their box below.
  document.querySelectorAll('.rt-detail video').forEach((v) => {
    if (v.closest('.compare')) return;
    v.removeAttribute('autoplay');
    v.pause();
    io.observe(v);
  });
}

// Compare slider. Markup:
// <div data-compare> tabs (data-src = pass, data-under = beauty, data-label) +
//   <div class="compare"> <video class="compare__under"> (beauty, full frame)
//   <div class="compare__top"><video></div> (pass, clipped to the left part)
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

  // Keep the pass layer locked to the beauty layer. Only the top layer is ever seeked, never while a seek
  // is still running, and only for real drift (> 4 frames); small drift is absorbed by nudging its speed.
  // The old version re-seeked every 500 ms at a 0.05 s tolerance: each seek took longer than that to decode,
  // so the top layer kept jumping back and never advanced.
  const sync = () => {
    if (under.paused || topVid.seeking || under.seeking || topVid.readyState < 2) return;
    const d = under.currentTime - topVid.currentTime;
    const loopWrap = Math.abs(d) > under.duration / 2;  // one layer looped a moment before the other
    if (Math.abs(d) > 0.15 && !loopWrap) {
      topVid.playbackRate = 1;
      topVid.currentTime = under.currentTime;
    } else if (!loopWrap) {
      topVid.playbackRate = Math.abs(d) > 0.02 ? 1 + Math.max(-0.1, Math.min(0.1, d)) : 1;
    }
  };
  let timer = null;
  const start = () => { topVid.play().catch(() => {}); if (!timer) timer = setInterval(sync, 250); };
  const stop = () => { topVid.pause(); clearInterval(timer); timer = null; };
  under.addEventListener('play', start);
  under.addEventListener('pause', stop);
  under.addEventListener('seeked', () => { if (!topVid.seeking) topVid.currentTime = under.currentTime; });

  if (io) {
    under.removeAttribute('autoplay');
    topVid.removeAttribute('autoplay');
    under.pause();
    io.observe(box);
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
    // A tab can also switch the beauty layer (other camera / aspect); both restart together from 0.
    const newUnder = tab.dataset.under && !under.src.endsWith(tab.dataset.under);
    const t = newUnder ? 0 : under.currentTime;
    if (newUnder) under.src = tab.dataset.under;
    topVid.src = tab.dataset.src;
    topVid.playbackRate = 1;
    topVid.currentTime = t;
    const visible = !io || onScreen.get(box) !== false;
    if (visible) { under.play().catch(() => {}); topVid.play().catch(() => {}); }
    if (labelL) labelL.textContent = tab.dataset.label || tab.textContent;
  }));
});
