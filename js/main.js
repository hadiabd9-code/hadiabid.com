/* ============================================
   hadiabid.com — Shared JS
   ============================================ */

// --- Mobile Nav Toggle ---
document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.querySelector('.nav__hamburger');
  const mobileMenu = document.querySelector('.nav__mobile-menu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      mobileMenu.classList.toggle('open');
      document.body.style.overflow = mobileMenu.classList.contains('open') ? 'hidden' : '';
    });

    // Close menu when a link is clicked
    mobileMenu.querySelectorAll('.nav__link').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // --- Smooth scroll for #contact links ---
  document.querySelectorAll('a[href="#contact"], a[href="index.html#contact"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const contactEl = document.getElementById('contact');
      if (contactEl) {
        e.preventDefault();
        contactEl.scrollIntoView({ behavior: 'smooth' });
        // Close mobile menu if open
        if (hamburger) hamburger.classList.remove('open');
        if (mobileMenu) mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
      }
    });
  });
});
