// Note rendering and the DOM reconciler that patches rows in place
// (avatars, profile signatures, reply context).
function actorProfileSignature(pubkey) {
  const p = state.profiles.get(pubkey);
  return `${pubkey}:${p?.display_name || p?.displayName || p?.name || ''}:${p?.picture || ''}`;
}

// A compact fingerprint of every dynamic thing a note displays (author/referenced
// profile names + avatars, and whether embedded quote/event cards have resolved).
// The reconciler compares it to decide whether a cached note element can be reused
// as-is or must be repainted because visible content changed.
function noteProfileSignature(event) {
  const pubkeys = new Set([event.pubkey]);
  const actor = getEventActorPubkey(event);
  if (actor) pubkeys.add(actor);
  for (const tag of event.tags ?? []) {
    if (tag[0] === 'p' && isHex(tag[1], 64)) pubkeys.add(tag[1]);
  }
  let sig = '';
  for (const pubkey of pubkeys) sig += actorProfileSignature(pubkey) + '|';
  for (const ref of extractNostrRefs(expandIndexedNostrReferences(event?.content ?? '', event), { queue: false }).filter(ref => ref.kind === 'event')) {
    sig += `event:${ref.eventId}:${state.notes.has(ref.eventId) ? 'resolved' : 'missing'}|`;
  }
  return sig;
}

// Reconcile a parent's keyed children in place instead of wiping innerHTML.
// Nodes whose id and signature are unchanged are reused untouched — which is
// what keeps their avatar <img> elements alive so they never re-fetch and
// strobe. When a row's signature changes (a name or avatar finally loaded) it is
// updated in place via `patch` if one is given — so the element, its avatar
// <img>, and its :hover state all survive — and only fully rebuilt when no patch
// is supplied. New rows are inserted in order and departed ones removed. `after`
// is an optional fixed leading child (a header or label) the rows stay after.
function reconcileChildren(parent, items, { keyOf, sigOf, build, patch = null, after = null }) {
  const keep = new Set(items.map(item => String(keyOf(item))));
  const existing = new Map();
  const replyBoxes = new Map();
  let node = after ? after.nextSibling : parent.firstChild;
  while (node) {
    const next = node.nextSibling;
    if (node.classList?.contains('reply-box') && node.dataset?.replyFor) {
      if (keep.has(node.dataset.replyFor)) replyBoxes.set(node.dataset.replyFor, node);
      else node.remove();
    }
    else if (node.dataset?.id != null) existing.set(node.dataset.id, node);
    else node.remove(); // stray nodes (e.g. a prior empty-state)
    node = next;
  }
  for (const [id, el] of existing) {
    if (!keep.has(id)) {
      el.remove();
      replyBoxes.get(id)?.remove();
      replyBoxes.delete(id);
      existing.delete(id);
    }
  }
  let prev = after;
  for (const item of items) {
    const id = String(keyOf(item));
    const sig = sigOf(item);
    let el = existing.get(id);
    if (!el) {
      el = build(item);
      el.dataset.id = id;
      el.dataset.sig = sig;
    } else if (el.dataset.sig !== sig) {
      if (patch) {
        patch(el, item);
      } else {
        const fresh = build(item);
        fresh.dataset.id = id;
        el.replaceWith(fresh);
        el = fresh;
      }
      el.dataset.sig = sig;
    }
    const ref = prev ? prev.nextSibling : parent.firstChild;
    if (ref !== el) parent.insertBefore(el, ref);
    const replyBox = replyBoxes.get(id);
    if (replyBox) {
      if (el.nextSibling !== replyBox) parent.insertBefore(replyBox, el.nextSibling);
      prev = replyBox;
    } else {
      prev = el;
    }
  }
  refreshInlineReplyActive();
}

// Swap an avatar's <img> only when the picture URL actually changed, so a note
// whose profile updated (e.g. just its name) never reloads an unchanged avatar.
function updateAvatarEl(wrap, profile, pubkey) {
  if (!wrap) return;
  const newSrc = profile?.picture || '';
  const img = wrap.querySelector('img');
  const curSrc = img ? (img.getAttribute('src') || '') : '';
  if (newSrc === curSrc) return;
  wrap.innerHTML = newSrc
    ? `<img src="${esc(newSrc)}" data-pubkey="${esc(pubkey)}" loading="lazy" onerror="handleAvatarImageError(this)" />`
    : '';
}

// Update the dynamic bits of an existing note in place: author/avatar, reply cue,
// and note content. Content must be refreshed because quote cards, profile mentions,
// media previews, and parent previews can resolve after the row first painted.
function updateNoteProfile(el, event) {
  const profile = state.profiles.get(event.pubkey) ?? {};
  const name = profile.display_name || profile.displayName || profile.name || shortNpub(event.pubkey);
  const authorEl = el.querySelector(':scope > .note-header > .note-meta > .note-author');
  if (authorEl) authorEl.textContent = name;
  updateAvatarEl(el.querySelector(':scope > .note-header > .note-avatar'), profile, event.pubkey);

  const contentEl = el.querySelector(':scope > .note-content');
  if (contentEl) contentEl.innerHTML = formatContent(event.content, event);

  const rc = el.querySelector(':scope > .reply-context');
  if (rc) {
    const parentRef = getReplyParentRef(event);
    const parent = parentRef?.eventId ? state.notes.get(parentRef.eventId) : null;
    if (parent) {
      const pProfile = state.profiles.get(parent.pubkey) ?? {};
      const pName = pProfile.display_name || pProfile.displayName || pProfile.name || shortNpub(parent.pubkey);
      const span = rc.querySelector('span');
      if (span) span.textContent = `Replying to ${pName}`;
      rc.classList.remove('loading');
    }
  }
}

// Same, for a notification row (actor name + avatar).
function updateNotificationRowProfile(el, notification) {
  const profile = state.profiles.get(notification.actorPubkey) ?? {};
  const name = notificationActorLabel(notification);
  const strong = el.querySelector('.notification-line > strong');
  if (strong) strong.textContent = name;
  const summary = el.querySelector('.notification-line > span');
  if (summary) summary.textContent = notificationSummary(notification);
  const detail = notificationDetail(notification);
  const body = el.querySelector('.notification-body');
  let detailEl = el.querySelector('.notification-detail');
  if (detail && detailEl) detailEl.innerHTML = detail;
  else if (detail && body) {
    detailEl = document.createElement('div');
    detailEl.className = 'notification-detail';
    detailEl.innerHTML = detail;
    body.appendChild(detailEl);
  } else if (!detail) detailEl?.remove();
  updateAvatarEl(el.querySelector(':scope > .notification-avatar'), profile, notification.actorPubkey);
}

function renderNote(event, opts = {}) {
  const profile = state.profiles.get(event.pubkey) ?? {};
  const name = profile.display_name || profile.displayName || profile.name || shortNpub(event.pubkey);
  const npub = shortNpub(event.pubkey);
  const time = relativeTime(event.created_at);
  const content = formatContent(event.content, event);
  // In a thread the chain already shows the parent above, so the inline
  // "replying to" line is redundant there.
  const replyContext = opts.thread ? '' : renderReplyContext(event);

  const el = document.createElement('div');
  el.className = `note${opts.thread ? ' thread-note' : ''}${opts.selected ? ' thread-selected' : ''}${opts.reply ? ' thread-reply' : ''}`;
  el.dataset.id = event.id;
  // Records which profile data this note was painted with so renderColumnFeed
  // can tell when a reuse is safe vs. when an avatar/name actually changed.
  el.dataset.sig = noteProfileSignature(event);
  el.innerHTML = `
    ${replyContext}
    <div class="note-header">
      ${renderAvatar(profile, event.pubkey)}
      <div class="note-meta">
        <div class="note-author">${esc(name)}</div>
        <div class="note-npub">${esc(npub)}</div>
      </div>
      <div class="note-time" data-ts="${event.created_at}">${esc(time)}</div>
    </div>
    <div class="note-content">${content}</div>
    <div class="note-actions">
      <button class="note-action" data-action="reply" title="Reply">${iconSvg('reply')}<span>${replyCountLabel(event.id)}</span></button>
      <button class="note-action" data-action="boost" title="Boost or quote" aria-haspopup="dialog">${iconSvg('repost')}<span>${repostCountLabel(event.id)}</span></button>
      <button class="note-action" data-action="zap" title="Zap ${state.zapDefaultSats} sats — hold or right-click for options">${iconSvg('zap')}<span></span></button>
      <button class="note-action${state.liked.has(event.id) ? ' liked' : ''}" data-action="like" title="Like">${iconSvg('heart')}<span>${reactionCountLabel(event.id)}</span></button>
      <button class="note-action note-action-more" data-action="more" title="More note actions" aria-label="More note actions" aria-haspopup="dialog"><span aria-hidden="true">⋯</span></button>
    </div>
  `;

  el.querySelector('[data-action="reply"]').onclick = () => toggleReply(el, event);
  el.querySelector('[data-action="boost"]').onclick = () => showBoostMenu(event);
  attachZapButton(el.querySelector('[data-action="zap"]'), event);
  el.querySelector('[data-action="like"]').onclick = (e) => doLike(event, e.currentTarget);
  el.querySelector('[data-action="more"]').onclick = (e) => { e.stopPropagation(); showNoteMoreMenu(event); };

  // Tapping a name or avatar opens that person's profile column (not the thread).
  const openAuthor = (clickEvent) => {
    clickEvent.stopPropagation();
    openProfileColumn(event.pubkey, name);
  };
  for (const sel of ['.note-author', '.note-avatar']) {
    const target = el.querySelector(sel);
    if (target) { target.style.cursor = 'pointer'; target.addEventListener('click', openAuthor); }
  }
  const parentRef = getReplyParentRef(event);
  el.querySelector('.reply-context')?.addEventListener('click', (clickEvent) => {
    clickEvent.preventDefault();
    if (parentRef?.eventId) openConversation(parentRef.eventId, event.id, el.closest('.column')?.dataset.col);
  });

  // Tap anywhere on a note (outside links/buttons) to open its thread, the way
  // Damus/Nostur do. Ignore taps that are really text selections.
  if (!opts.thread) {
    el.addEventListener('click', (clickEvent) => {
      if (clickEvent.target.closest('a, button')) return;
      if (window.getSelection && String(window.getSelection())) return;
      openConversation(event.id, event.id, el.closest('.column')?.dataset.col);
    });
  }

  return el;
}

function renderReplyContext(event) {
  const parentRef = getReplyParentRef(event);
  if (!parentRef?.eventId || parentRef.eventId === event.id) return '';
  const parent = state.notes.get(parentRef.eventId);
  if (!parent) {
    fetchEmbeddedEvent(parentRef.eventId, parentRef.relays);
    return `
      <button class="reply-context loading" type="button" data-parent-id="${esc(parentRef.eventId)}" data-selected-id="${esc(event.id)}" title="Open conversation">
        ${iconSvg('reply')}<span>Replying to a note</span>
      </button>
    `;
  }

  const profile = state.profiles.get(parent.pubkey) ?? {};
  if (profileNeedsRefresh(parent.pubkey)) queueProfileFetch(parent.pubkey);
  const name = profile.display_name || profile.displayName || profile.name || shortNpub(parent.pubkey);
  return `
    <button class="reply-context" type="button" data-parent-id="${esc(parent.id)}" data-selected-id="${esc(event.id)}" title="Open conversation">
      ${iconSvg('reply')}<span>Replying to ${esc(name)}</span>
    </button>
  `;
}

// Threads open in-place inside the column the note was clicked in, with a back
// arrow in the header — navigation, not a popup dialog.
