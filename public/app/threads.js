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

// Live-fetch every reply that references the focused note. NIP-10 descendants
// keep the focused note as their root `e` tag, so this pulls the full subtree,
// not just the direct children.
function fetchThreadReplies(col, noteId) {
  if (!noteId) return;
  const subId = `thread_replies_${col.id}`;
  unsubscribe(subId);
  const filter = { kinds: [1], '#e': [noteId] };
  state.subs.set(subId, { filters: [filter], columnId: col.id, threadReplies: true, allRelays: true });
  const sockets = [...state.sockets.values()].filter(ws => ws.readyState === WebSocket.OPEN);
  for (const ws of sockets) ws.send(JSON.stringify(['REQ', subId, filter]));
}

function eventReferencesNote(event, noteId) {
  return (event?.tags ?? []).some(tag => tag[0] === 'e' && tag[1] === noteId);
}

// Notes already in cache that belong under this note. Other clients count all
// descendants in a conversation, so Feedstr renders the whole NIP-10 subtree too:
// direct replies first, then nested replies indented below their parent.
function threadReplyItemsFor(noteId) {
  const candidates = [];
  for (const ev of state.notes.values()) {
    if (ev.kind !== 1 || ev.id === noteId || isMuted(ev)) continue;
    if (eventReferencesNote(ev, noteId)) candidates.push(ev);
  }

  const byParent = new Map();
  const byId = new Map(candidates.map(ev => [ev.id, ev]));
  for (const ev of candidates) {
    const parentId = getReplyParentRef(ev)?.eventId;
    if (!parentId) continue;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(ev);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));

  const out = [];
  const seen = new Set();
  const walk = (parentId, depth) => {
    for (const ev of byParent.get(parentId) ?? []) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push({ event: ev, depth: Math.min(depth, 8) });
      walk(ev.id, depth + 1);
    }
  };
  walk(noteId, 1);

  // If a relay gave us descendants before their intermediate parent arrived,
  // still show them rather than hiding visible thread activity.
  const orphans = candidates
    .filter(ev => !seen.has(ev.id) && getRootRef(ev)?.eventId === noteId)
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  for (const ev of orphans) {
    seen.add(ev.id);
    out.push({ event: ev, depth: byId.has(getReplyParentRef(ev)?.eventId) ? 2 : 1 });
  }
  return out;
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
  const replyItems = threadReplyItemsFor(focusedId);
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

  // Full descendant tree for the focused note, flattened in thread order and
  // indented by depth so nested conversations do not disappear behind a count.
  label.textContent = replyItems.length
    ? (replyItems.length === 1 ? '1 reply in thread' : `${replyItems.length} replies in thread`)
    : 'No replies yet';
  reconcileChildren(repliesEl, replyItems, {
    keyOf: item => item.event.id,
    sigOf: item => `${item.depth}:${noteProfileSignature(item.event)}`,
    build: item => renderThreadReplyItem(item),
    patch: (el, item) => {
      updateNoteProfile(el, item.event);
      el.style.marginLeft = `${10 + (Math.min(Math.max(1, item.depth || 1), 8) - 1) * 18}px`;
    },
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

function renderThreadReplyItem(item) {
  const el = renderNote(item.event, { thread: true, reply: true });
  el.classList.add('thread-reply');
  el.style.marginLeft = `${10 + (Math.min(Math.max(1, item.depth || 1), 8) - 1) * 18}px`;
  return el;
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


function getRootRef(event) {
  const eTags = (event?.tags ?? []).filter(tag => tag[0] === 'e' && isHex(tag[1], 64));
  if (!eTags.length) return null;
  const rootTag = eTags.find(tag => tag[3] === 'root');
  const firstTag = rootTag ?? eTags[0];
  return { eventId: firstTag[1], relays: firstTag[2] ? [firstTag[2]] : [] };
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
