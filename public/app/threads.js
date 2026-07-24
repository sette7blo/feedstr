// Conversation/thread view: opening, fetching replies, chain building.
function openConversation(parentId, selectedId = parentId, columnId = null) {
  const col = columnId ? state.columns.find(c => c.id === columnId) : null;
  if (!col) return;
  if (parentId && !state.notes.has(parentId)) fetchEmbeddedEvent(parentId);
  if (selectedId && !state.notes.has(selectedId)) fetchEmbeddedEvent(selectedId);
  col.thread = { parentId, selectedId };
  closeMobileMenu();
  updateColumnHeader(col);
  fetchThreadReplies(col, selectedId || parentId);
  renderThread(col, undefined, true);
}

function closeThread(col) {
  col.thread = null;
  unsubscribe(`thread_replies_${col.id}`);
  updateColumnHeader(col);
  renderColumnFeed(col);
}

// Live-fetch direct replies to the focused note so they render under it.
function fetchThreadReplies(col, noteId) {
  if (!noteId) return;
  const subId = `thread_replies_${col.id}`;
  unsubscribe(subId);
  const filter = { kinds: [1], '#e': [noteId] };
  state.subs.set(subId, { filters: [filter], columnId: col.id, threadReplies: true, allRelays: true });
  const sockets = [...state.sockets.values()].filter(ws => ws.readyState === WebSocket.OPEN);
  for (const ws of sockets) ws.send(JSON.stringify(['REQ', subId, filter]));
}

// Notes already in cache whose computed reply parent is this note (NIP-10).
function threadRepliesFor(noteId) {
  const out = [];
  for (const ev of state.notes.values()) {
    if (ev.kind !== 1 || ev.id === noteId || isMuted(ev)) continue;
    if (getReplyParentRef(ev)?.eventId === noteId) out.push(ev);
  }
  return out.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

const threadRerenderTimers = new Map();
function scheduleThreadRerender(col) {
  if (!col?.id) return;
  clearTimeout(threadRerenderTimers.get(col.id));
  threadRerenderTimers.set(col.id, setTimeout(() => {
    threadRerenderTimers.delete(col.id);
    if (col.thread) renderColumnFeed(col);
  }, 300));
}

function renderThread(col, feedEl = document.querySelector(`[data-col="${col.id}"] .column-feed`), scrollToTarget = false) {
  if (!feedEl || !col.thread) return;
  const { parentId, selectedId } = col.thread;
  const focusedId = selectedId || parentId;
  const chain = buildConversationChain(focusedId, parentId);
  const replies = threadRepliesFor(focusedId);
  const prevScroll = feedEl.scrollTop;

  // Build the thread skeleton once, then reconcile its two lists in place so
  // avatars survive the repaints that fire as replies and profiles stream in.
  // Reuse it across renders; if the column was showing something else, the stray
  // nodes are cleared and the skeleton rebuilt.
  let wrap = feedEl.querySelector(':scope > .thread');
  let chainEl, repliesEl, label;
  if (!wrap) {
    feedEl.innerHTML = '';
    wrap = document.createElement('div');
    wrap.className = 'thread';
    chainEl = document.createElement('div');
    chainEl.className = 'thread-chain';
    repliesEl = document.createElement('div');
    repliesEl.className = 'thread-replies';
    label = document.createElement('div');
    label.className = 'thread-replies-label';
    repliesEl.appendChild(label);
    wrap.appendChild(chainEl);
    wrap.appendChild(repliesEl);
    feedEl.appendChild(wrap);
  } else {
    chainEl = wrap.querySelector(':scope > .thread-chain');
    repliesEl = wrap.querySelector(':scope > .thread-replies');
    label = repliesEl.querySelector(':scope > .thread-replies-label');
  }

  // Ancestor chain (root → focused), connected by the thread line. The selected
  // state is folded into the signature so refocusing repaints the right note.
  reconcileChildren(chainEl, chain, {
    keyOf: item => item.id,
    sigOf: item => (item.id === selectedId ? 'sel:' : '') + (item.event ? noteProfileSignature(item.event) : 'missing'),
    build: item => renderThreadNote(item, selectedId)
  });

  // Direct replies to the focused note, listed below.
  label.textContent = replies.length
    ? (replies.length === 1 ? '1 reply' : `${replies.length} replies`)
    : 'No replies yet';
  reconcileChildren(repliesEl, replies, {
    keyOf: r => r.id,
    sigOf: r => noteProfileSignature(r),
    build: r => renderNote(r, { thread: true, reply: true }),
    patch: (el, r) => updateNoteProfile(el, r),
    after: label
  });

  if (scrollToTarget) {
    const targetId = selectedId || parentId;
    setTimeout(() => {
      const escapedId = window.CSS?.escape ? CSS.escape(targetId) : targetId;
      wrap.querySelector(`[data-id="${escapedId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
  } else {
    feedEl.scrollTop = prevScroll;
  }
}

function renderThreadNote(item, selectedId) {
  if (!item.event) {
    fetchEmbeddedEvent(item.id);
    const ph = document.createElement('div');
    ph.className = 'note thread-note thread-missing';
    ph.dataset.id = item.id;
    ph.innerHTML = `<span>Loading note from relays…</span>`;
    return ph;
  }
  return renderNote(item.event, { thread: true, selected: item.id === selectedId });
}

function buildConversationChain(selectedId, fallbackParentId) {
  const ids = [];
  const seen = new Set();
  let currentId = selectedId || fallbackParentId;
  while (currentId && !seen.has(currentId) && ids.length < 12) {
    seen.add(currentId);
    ids.unshift(currentId);
    const event = state.notes.get(currentId);
    if (!event) break;
    const parentRef = getReplyParentRef(event);
    if (!parentRef?.eventId || parentRef.eventId === currentId) break;
    fetchEmbeddedEvent(parentRef.eventId, parentRef.relays);
    currentId = parentRef.eventId;
  }
  if (fallbackParentId && !seen.has(fallbackParentId)) ids.unshift(fallbackParentId);
  return ids.map(id => ({ id, event: state.notes.get(id) }));
}


function getReplyParentRef(event) {
  const eTags = (event?.tags ?? []).filter(tag => tag[0] === 'e' && isHex(tag[1], 64));
  if (!eTags.length) return null;
  const replyTag = eTags.find(tag => tag[3] === 'reply');
  const parentTag = replyTag ?? eTags[eTags.length - 1];
  return { eventId: parentTag[1], relays: parentTag[2] ? [parentTag[2]] : [] };
}

function renderAvatar(profile, pubkey, extraClass = '') {
  const followClass = isFollowing(pubkey) ? ' following' : '';
  const classes = `note-avatar${extraClass ? ` ${extraClass}` : ''}${followClass}`;
  const image = profile?.picture
    ? `<img src="${esc(profile.picture)}" data-pubkey="${esc(pubkey)}" loading="lazy" onerror="handleAvatarImageError(this)" />`
    : '';
  return `<div class="${classes}" data-pubkey="${esc(pubkey)}">${image}</div>`;
}
