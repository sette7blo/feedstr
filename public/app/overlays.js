// Modal chrome, mobile drawer, and the full-screen media lightbox.
// Lightbox note: one flat `position: fixed; inset: 0` layer, image as a direct
// flex child. Do not nest full-screen layers or use vh/dvh here - iOS renders
// that as a black pane in portrait.
// -- add column modal --
const addColumnBtn = document.getElementById('add-column-btn');
const modal = document.getElementById('add-column-modal');
const idenstrSettingsBtn = document.getElementById('idenstr-settings-btn');
const zapSettingsBtn = document.getElementById('zap-settings-btn');
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const mobileMenuBackdrop = document.getElementById('mobile-menu-backdrop');

addColumnBtn.onclick = () => { closeMobileMenu(); showAddColumnModal(); };

// Delegated in-app navigation for content links: hashtags open a hashtag column,
// nostr: references open a profile column or a thread instead of dead-ending.
document.getElementById('columns').addEventListener('click', (e) => {
  const hashtag = e.target.closest('a.hashtag');
  if (hashtag) { e.preventDefault(); openHashtagColumn(hashtag.dataset.tag); return; }
  const nostrLink = e.target.closest('a[href^="nostr:"], a[href^="web+nostr:"]');
  if (nostrLink) {
    e.preventDefault();
    const ref = parseNostrRef(nostrLink.getAttribute('href'));
    if (ref?.kind === 'profile') openProfileColumn(ref.pubkey);
    else if (ref?.kind === 'event') openConversation(ref.eventId, ref.eventId, nostrLink.closest('.column')?.dataset.col);
    else toast('Could not open that reference', 'error');
  }
});
document.addEventListener('click', (e) => {
  const media = e.target.closest('a.note-media[data-media-url]');
  if (!media) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();
  openMediaLightbox(media);
}, true);
idenstrSettingsBtn.onclick = () => { closeMobileMenu(); showIdenstrSettings(); };
zapSettingsBtn.onclick = () => { closeMobileMenu(); showZapSettings(); refreshZapWalletBalance(); };
mobileMenuToggle.onclick = () => toggleMobileMenu();
mobileMenuBackdrop.onclick = () => closeMobileMenu();
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

// Basic focus trap: keep Tab cycling inside the add-column / settings modal.
modal.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !modal.classList.contains('open')) return;
  const focusables = modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function toggleMobileMenu() {
  const open = !document.body.classList.contains('mobile-menu-open');
  document.body.classList.toggle('mobile-menu-open', open);
  mobileMenuToggle.setAttribute('aria-expanded', String(open));
  mobileMenuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

function closeMobileMenu() {
  document.body.classList.remove('mobile-menu-open');
  mobileMenuToggle.setAttribute('aria-expanded', 'false');
  mobileMenuToggle.setAttribute('aria-label', 'Open menu');
}

function closeModal() {
  modal.classList.remove('open', 'boost-sheet', 'raw-event-sheet', 'note-more-sheet');
  document.getElementById('modal-content').className = 'modal';
}

function mediaGroupForLink(link) {
  const grid = link.closest('.note-media-grid');
  const links = grid ? [...grid.querySelectorAll('a.note-media[data-media-url]')] : [link];
  const urls = [...new Set(links.map(el => el.dataset.mediaUrl || el.href).filter(Boolean))];
  return { urls, index: Math.max(0, urls.indexOf(link.dataset.mediaUrl || link.href)) };
}

// Fullscreen image viewer. Deliberately flat DOM: one fixed overlay sized by
// inset:0 (never vh/dvh — that renders black on iOS Safari in portrait), the
// <img> as a direct flex child so its max-height resolves against a single
// definite container, and the controls positioned absolutely over the image.
function ensureMediaLightbox() {
  let box = document.getElementById('media-lightbox');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'media-lightbox';
  box.className = 'media-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Image viewer');
  box.innerHTML = `
    <img class="media-lightbox-img" id="media-lightbox-img" alt="Expanded note attachment" />
    <div class="media-lightbox-bar">
      <span class="media-lightbox-count" id="media-lightbox-count"></span>
      <a class="media-lightbox-open" id="media-lightbox-open" target="_blank" rel="noopener noreferrer">Open original</a>
      <button class="media-lightbox-close" type="button" data-media-action="close" aria-label="Close image viewer">${iconSvg('x')}</button>
    </div>
    <button class="media-lightbox-nav prev" type="button" data-media-action="prev" aria-label="Previous image">${iconSvg('arrow-left')}</button>
    <button class="media-lightbox-nav next" type="button" data-media-action="next" aria-label="Next image">${iconSvg('arrow-left')}</button>
  `;
  const step = (delta) => showLightboxImage((Number(box.dataset.index) || 0) + delta);
  box.addEventListener('click', (e) => {
    const action = e.target.closest('[data-media-action]')?.dataset.mediaAction;
    if (action) {
      e.preventDefault();
      if (action === 'close') closeMediaLightbox();
      if (action === 'prev') step(-1);
      if (action === 'next') step(1);
      return;
    }
    // Tap on the letterbox area (anywhere that isn't the image or a control) closes.
    if (e.target === box) closeMediaLightbox();
  });
  // Touch gestures: horizontal swipe navigates, downward swipe dismisses.
  let sx = 0, sy = 0, tracking = false;
  box.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    tracking = true;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) { step(dx < 0 ? 1 : -1); return; }
    if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.4) closeMediaLightbox();
  }, { passive: true });
  document.body.appendChild(box);
  return box;
}

function openMediaLightbox(link) {
  const { urls, index } = mediaGroupForLink(link);
  if (!urls.length) return;
  const box = ensureMediaLightbox();
  box._urls = urls;
  box._previewSrc = link.querySelector('img')?.currentSrc || link.querySelector('img')?.src || '';
  box._previewIndex = index;
  box.classList.add('open');
  document.body.classList.add('media-lightbox-open');
  showLightboxImage(index);
  const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
  if (fine) requestAnimationFrame(() => box.querySelector('.media-lightbox-close')?.focus());
}

function closeMediaLightbox() {
  const box = document.getElementById('media-lightbox');
  if (!box) return;
  box.classList.remove('open');
  document.body.classList.remove('media-lightbox-open');
}

function showLightboxImage(index) {
  const box = document.getElementById('media-lightbox');
  const urls = box?._urls ?? [];
  if (!box || !urls.length) return;
  const next = (index + urls.length) % urls.length;
  const url = urls[next];
  box.dataset.index = String(next);
  const img = box.querySelector('#media-lightbox-img');
  const open = box.querySelector('#media-lightbox-open');
  const count = box.querySelector('#media-lightbox-count');
  if (open) open.textContent = 'Open original';
  if (img) {
    const previewSrc = (box._previewSrc && next === box._previewIndex) ? box._previewSrc : '';
    img.classList.remove('loaded');
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => {
      if (previewSrc && img.src !== previewSrc) {
        img.src = previewSrc;
        if (open) open.textContent = 'Open original to view image';
        return;
      }
      img.classList.add('loaded', 'failed');
      img.removeAttribute('src');
      if (open) open.textContent = 'Open original to view image';
    };
    img.classList.remove('failed');
    img.src = previewSrc || url;
    if (previewSrc && img.src !== url) requestAnimationFrame(() => { img.src = url; });
  }
  if (open) open.href = url;
  if (count) count.textContent = urls.length > 1 ? `${next + 1} / ${urls.length}` : 'Image';
  box.querySelectorAll('.media-lightbox-nav').forEach(btn => { btn.hidden = urls.length < 2; });
}

document.addEventListener('keydown', (e) => {
  const box = document.getElementById('media-lightbox');
  if (!box?.classList.contains('open')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeMediaLightbox(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); showLightboxImage((Number(box.dataset.index) || 0) - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); showLightboxImage((Number(box.dataset.index) || 0) + 1); }
});

