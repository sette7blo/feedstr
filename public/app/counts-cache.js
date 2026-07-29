// Reply and engagement counts, per-column note cache, memory pruning.
function backfillLiked() {
  const pubkey = state.identity?.pubkey;
  const url = state.config?.privateRelayUrl;
  if (!pubkey || !url) return;
  const ws = state.sockets.get(url);
  if (ws?.readyState !== WebSocket.OPEN) return;
  const subId = `liked_backfill_${Date.now()}`;
  const filter = { kinds: [7], authors: [pubkey] };
  state.subs.set(subId, { filters: [filter], columnId: null, oneshot: true, likedBackfill: true });
  ws.send(JSON.stringify(['REQ', subId, filter]));
}

// Reply counts: how many notes e-tag a visible note. These are displayed in the
// reply action while the full conversation opens by tapping the note card.
function replyCountLabel(noteId) {
  const n = state.replyCounts.get(noteId)?.size ?? 0;
  return n ? String(n) : '';
}

function updateReplyBadge(noteId) {
  const label = replyCountLabel(noteId);
  const sel = window.CSS?.escape ? CSS.escape(noteId) : noteId;
  document.querySelectorAll(`.note[data-id="${sel}"] [data-action="reply"] span`)
    .forEach(span => { span.textContent = label; });
}

// A kind:1 reply event came back on a reply-count subscription: credit it to
// every tracked note it references, then refresh those badges.
function registerReplyEvent(event) {
  if (!event || event.kind !== 1) return;
  for (const tag of event.tags ?? []) {
    if (tag[0] !== 'e') continue;
    const noteId = tag[1];
    const set = state.replyCounts.get(noteId);
    if (!set || event.id === noteId) continue; // only count toward tracked notes
    if (!set.has(event.id)) {
      set.add(event.id);
      updateReplyBadge(noteId);
    }
  }
}

// (Re)subscribe for replies to the notes currently shown in a column. Debounced
// because the column re-renders on every incoming note.
const replyCountTimers = new Map();
function scheduleReplyCounts(col) {
  if (!col?.id) return;
  clearTimeout(replyCountTimers.get(col.id));
  replyCountTimers.set(col.id, setTimeout(() => {
    replyCountTimers.delete(col.id);
    fetchReplyCounts(col);
  }, 800));
}

function fetchReplyCounts(col) {
  const mode = typeof feedModeForColumn === 'function' ? feedModeForColumn(col) : 'all';
  const base = typeof baseFeedEvents === 'function' ? baseFeedEvents(col) : (col.events ?? []).filter(e => e.kind === 1);
  const visible = typeof filterEventsForMode === 'function' ? filterEventsForMode(base, mode) : base;
  const limit = typeof RENDER_NOTE_LIMIT === 'number' ? RENDER_NOTE_LIMIT : 80;
  const ids = visible.map(e => e.id).slice(0, limit);
  if (!ids.length) return;
  for (const id of ids) if (!state.replyCounts.has(id)) state.replyCounts.set(id, new Set());
  const subId = `replies_${col.id}`;
  unsubscribe(subId);
  const filter = { kinds: [1], '#e': ids };
  state.subs.set(subId, { filters: [filter], columnId: null, replyCount: true, allRelays: true });
  const sockets = [...state.sockets.values()].filter(ws => ws.readyState === WebSocket.OPEN);
  for (const ws of sockets) ws.send(JSON.stringify(['REQ', subId, filter]));
}

// Engagement counts: how many reposts (kind:6) and reactions (kind:7) e-tag a note.
function repostCountLabel(noteId) {
  const n = state.repostCounts.get(noteId)?.size ?? 0;
  return n ? String(n) : '';
}

function reactionCountLabel(noteId) {
  const n = state.reactionCounts.get(noteId)?.size ?? 0;
  return n ? String(n) : '';
}

function updateEngagementBadges(noteId) {
  const sel = window.CSS?.escape ? CSS.escape(noteId) : noteId;
  document.querySelectorAll(`.note[data-id="${sel}"] [data-action="boost"] span`)
    .forEach(span => { span.textContent = repostCountLabel(noteId); });
  document.querySelectorAll(`.note[data-id="${sel}"] [data-action="like"] span`)
    .forEach(span => { span.textContent = reactionCountLabel(noteId); });
}

function registerEngagementEvent(event) {
  if (!event || (event.kind !== 6 && event.kind !== 7)) return;
  const counts = event.kind === 6 ? state.repostCounts : state.reactionCounts;
  for (const tag of event.tags ?? []) {
    if (tag[0] !== 'e') continue;
    const noteId = tag[1];
    const set = counts.get(noteId);
    if (!set) continue; // only count toward tracked notes
    if (!set.has(event.id)) {
      set.add(event.id);
      updateEngagementBadges(noteId);
    }
  }
}

const engagementCountTimers = new Map();
function scheduleEngagementCounts(col) {
  if (!col?.id) return;
  clearTimeout(engagementCountTimers.get(col.id));
  engagementCountTimers.set(col.id, setTimeout(() => {
    engagementCountTimers.delete(col.id);
    fetchEngagementCounts(col);
  }, 800));
}

function fetchEngagementCounts(col) {
  const ids = (col.events ?? []).filter(e => e.kind === 1).map(e => e.id).slice(0, 200);
  if (!ids.length) return;
  for (const id of ids) {
    if (!state.repostCounts.has(id)) state.repostCounts.set(id, new Set());
    if (!state.reactionCounts.has(id)) state.reactionCounts.set(id, new Set());
  }
  const subId = `engagement_${col.id}`;
  unsubscribe(subId);
  const filter = { kinds: [6, 7], '#e': ids };
  state.subs.set(subId, { filters: [filter], columnId: null, engagementCount: true, allRelays: true });
  const sockets = [...state.sockets.values()].filter(ws => ws.readyState === WebSocket.OPEN);
  for (const ws of sockets) ws.send(JSON.stringify(['REQ', subId, filter]));
}

function saveColumns() {
  persistColumns(state.columns);
}

// Cached observed notes are persisted per column (debounced) so feeds are warm
// on the next visit; the live subscription dedupes against them on reconnect.
const cacheTimers = new Map();
function scheduleCacheColumn(col) {
  if (!col?.id) return;
  col._cacheDirty = true;
  // Coalesce: at most one snapshot write per 5s window per column, no matter how
  // fast events stream. Each write rewrites the whole snapshot, so this caps the
  // churn instead of rewriting on every burst.
  if (cacheTimers.has(col.id)) return;
  cacheTimers.set(col.id, setTimeout(() => {
    cacheTimers.delete(col.id);
    flushColumnCache(col);
  }, 5000));
}

function flushColumnCache(col) {
  if (!col?.id || !col._cacheDirty) return;
  col._cacheDirty = false;
  api(`/api/v1/cache/${col.id}`, { method: 'PUT', body: { events: (col.events ?? []).slice(0, 500) } }).catch(() => {});
}

// Persist pending snapshots when the tab is backgrounded or closed, so a fast
// streaming column isn't lost between coalesce windows (covers mobile too).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  for (const col of state.columns) {
    clearTimeout(cacheTimers.get(col.id));
    cacheTimers.delete(col.id);
    flushColumnCache(col);
  }
});

function runWhenBrowserIsIdle(fn) {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(fn, { timeout: 700 });
  return setTimeout(fn, 0);
}

function nextIdleFrame() {
  return new Promise((resolve) => runWhenBrowserIsIdle(resolve));
}

async function hydrateColumnCaches(columns) {
  let globalNoteAdded = false;
  for (const col of columns ?? []) {
    await nextIdleFrame();
    globalNoteAdded = (await hydrateColumnCache(col)) || globalNoteAdded;
  }
  if (globalNoteAdded) scheduleRerenderAllColumns();
}

async function hydrateColumnCache(col) {
  if (!col?.id) return;
  try {
    const { events } = await api(`/api/v1/cache/${col.id}`);
    if (!Array.isArray(events) || !events.length) return false;
    if (!col.events) col.events = [];
    const seen = new Set(col.events.map(e => e.id));
    let globalNoteAdded = false;
    for (const event of events) {
      if (!event?.id) continue;
      if (!state.notes.has(event.id)) globalNoteAdded = true;
      state.notes.set(event.id, event);
      if (!seen.has(event.id)) { col.events.push(event); seen.add(event.id); }
    }
    col.events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
    if (col.events.length > 500) col.events = col.events.slice(0, 500);
    col._ids = new Set(col.events.map(e => e.id));
    renderColumnFeed(col);
    return globalNoteAdded;
  } catch {
    return false;
  }
}

// Bound the long-lived in-memory caches. Notes and engagement counts accumulate
// as events stream in, so a tab left open for hours would grow without limit.
const NOTE_CACHE_LIMIT = 5000;
function pruneMemory() {
  const live = new Set();
  for (const col of state.columns) for (const e of col.events ?? []) live.add(e.id);
  // Reply/reaction/repost counts only matter for notes a column still shows.
  for (const map of [state.replyCounts, state.reactionCounts, state.repostCounts]) {
    for (const id of map.keys()) if (!live.has(id)) map.delete(id);
  }
  // Trim the global note cache oldest-first, protecting notes still on screen.
  if (state.notes.size > NOTE_CACHE_LIMIT) {
    for (const id of state.notes.keys()) {
      if (state.notes.size <= NOTE_CACHE_LIMIT) break;
      if (live.has(id)) continue;
      state.notes.delete(id);
      _profilePubkeyCache.delete(id);
      state.embeddedEventFetchTried.delete(id);
    }
  }
}
