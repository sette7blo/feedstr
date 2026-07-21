// -- on-demand profile fetch for visible note authors --
let _profileTimer = null;
function profileNeedsRefresh(pubkey, options = {}) {
  if (!pubkey) return false;
  const profile = state.profiles.get(pubkey);
  const attempts = state.profileFetchAttempts.get(pubkey) ?? 0;
  const needsCoreProfile = !profile || !profile.picture;
  const needsZapAddress = Boolean(options.needZap) && !zapAddressForProfile(profile ?? {});
  return (needsCoreProfile || needsZapAddress) && attempts < 4;
}

function profileDisplayChanged(existing, next) {
  if (!existing) return true;
  const fields = ['name', 'display_name', 'displayName', 'username', 'picture', 'banner', 'about', 'nip05', 'website', 'location', ...ZAP_ADDRESS_FIELD_NAMES];
  return fields.some(field => (existing?.[field] ?? '') !== (next?.[field] ?? '')) || zapAddressForProfile(existing) !== zapAddressForProfile(next);
}

function queueProfileFetch(pubkey, options = {}) {
  if (!options.force && !profileNeedsRefresh(pubkey, options)) return;
  if (!state._profileQueue) state._profileQueue = new Set();
  if (!state._profileForceQueue) state._profileForceQueue = new Set();
  state._profileQueue.add(pubkey);
  if (options.force) state._profileForceQueue.add(pubkey);
  scheduleProfileFetch();
}

function scheduleProfileFetch() {
  if (_profileTimer) return;
  _profileTimer = setTimeout(() => {
    _profileTimer = null;
    const queue = state._profileQueue;
    if (!queue || !queue.size) return;
    const forceQueue = state._profileForceQueue ?? new Set();
    const pubkeys = [...queue].filter(pubkey => forceQueue.has(pubkey) || profileNeedsRefresh(pubkey)).slice(0, 50);
    for (const pubkey of pubkeys) {
      queue.delete(pubkey);
      forceQueue.delete(pubkey);
      state.profileFetchTried.add(pubkey);
      state.profileFetchAttempts.set(pubkey, (state.profileFetchAttempts.get(pubkey) ?? 0) + 1);
    }
    if (!pubkeys.length) return;
    const subId = `profiles_${Date.now()}`;
    const filter = { kinds: [0], authors: pubkeys, limit: pubkeys.length };
    // one-shot REQ, auto-close on EOSE. Ask every connected relay because
    // profile metadata may live on different relays than the note itself.
    state.subs.set(subId, { filters: [filter], columnId: null, oneshot: true, allRelays: true });
    sendToAll(['REQ', subId, filter]);
    sendProfileReqToDiscoveryRelays(subId, filter);
    if (queue.size) scheduleProfileFetch();
  }, 350);
}

// Coalesce the full column scan: every relay that connects calls this, so at boot
// a dozen sockets would otherwise each walk all events. One pass covers them all.
let _missingProfilesTimer = null;
function refreshVisibleMissingProfiles() {
  if (_missingProfilesTimer) return;
  _missingProfilesTimer = setTimeout(() => {
    _missingProfilesTimer = null;
    for (const col of state.columns) {
      for (const event of col.events ?? []) {
        for (const pubkey of getEventProfilePubkeys(event)) {
          if (profileNeedsRefresh(pubkey)) queueProfileFetch(pubkey);
        }
      }
    }
  }, 300);
}

// Parsing an event's referenced profile pubkeys means a regex pass over its
// content, and this runs across every event in every column on each profile
// update — so memoize the result per event id (an event is immutable).
const _profilePubkeyCache = new Map();
function getEventProfilePubkeys(event) {
  if (!event?.id) return computeEventProfilePubkeys(event);
  const cached = _profilePubkeyCache.get(event.id);
  if (cached) return cached;
  const result = computeEventProfilePubkeys(event);
  _profilePubkeyCache.set(event.id, result);
  return result;
}

function computeEventProfilePubkeys(event) {
  const pubkeys = new Set();
  const actorPubkey = getEventActorPubkey(event);
  if (actorPubkey) pubkeys.add(actorPubkey);
  for (const tag of event?.tags ?? []) {
    if (tag[0] === 'p' && isHex(tag[1], 64)) pubkeys.add(tag[1]);
  }
  for (const ref of extractNostrRefs(expandIndexedNostrReferences(event?.content ?? '', event), { queue: false }).filter(ref => ref.kind === 'profile')) {
    if (ref.pubkey) pubkeys.add(ref.pubkey);
  }
  return [...pubkeys];
}

function handleAvatarImageError(img) {
  const pubkey = img?.dataset?.pubkey;
  img?.remove();
  if (!pubkey) return;
  const profile = state.profiles.get(pubkey);
  if (profile?.picture) {
    state.profiles.set(pubkey, { ...profile, picture_failed: profile.picture, picture: '' });
  }
  // A broken image means cached metadata was unusable. Retry kind:0 lookups
  // across connected relays instead of keeping the purple placeholder forever.
  state.profileFetchTried.delete(pubkey);
  queueProfileFetch(pubkey);
}

// Coalesce repaints for a column. Relays stream events independently, so a
// single scroll of the feed can trigger dozens of render requests in one frame;
// batching them into one paint per animation frame is what stops the feed from
// flashing as different relays answer at different times.
const _colRenderFrames = new Map();
function scheduleRenderColumnFeed(col) {
  if (!col?.id) return;
  if (_colRenderFrames.has(col.id)) return;
  _colRenderFrames.set(col.id, requestAnimationFrame(() => {
    _colRenderFrames.delete(col.id);
    renderColumnFeed(col);
  }));
}

function rerenderColumnsForAuthor(pubkey) {
  for (const col of state.columns) {
    // A profile column must re-render even with zero loaded notes, or its hero
    // (follow/mute buttons, late-arriving kind:0 banner/bio) goes stale.
    if (col.type === 'profile' && col.pubkey === pubkey) { scheduleRenderColumnFeed(col); continue; }
    if ((col.events ?? []).some(event => getEventActorPubkey(event) === pubkey || event.pubkey === pubkey)) scheduleRenderColumnFeed(col);
  }
}

function rerenderColumnsForReferencedProfile(pubkey) {
  for (const col of state.columns) {
    if ((col.events ?? []).some(event => getEventProfilePubkeys(event).includes(pubkey))) scheduleRenderColumnFeed(col);
  }
}

function rerenderAllColumns() {
  for (const col of state.columns) renderColumnFeed(col);
}

let _rerenderAllTimer = null;
function scheduleRerenderAllColumns() {
  if (_rerenderAllTimer) return;
  _rerenderAllTimer = setTimeout(() => {
    _rerenderAllTimer = null;
    rerenderAllColumns();
  }, 250);
}

function fetchEmbeddedEvent(eventId, relayHints = []) {
  if (!eventId || state.notes.has(eventId) || state.embeddedEventFetchTried.has(eventId) || state._embeddedQueue?.has(eventId)) return;
  if (!state._embeddedQueue) state._embeddedQueue = new Map();
  state._embeddedQueue.set(eventId, relayHints);
  scheduleEmbeddedFetch();
}

let _embeddedFetchTimer = null;
let _embeddedRetryDelay = 750; // backoff while no relay socket is open
function scheduleEmbeddedFetch() {
  if (_embeddedFetchTimer) return;
  _embeddedFetchTimer = setTimeout(() => {
    _embeddedFetchTimer = null;
    const queue = state._embeddedQueue;
    if (!queue?.size) return;
    const entries = [...queue.entries()].slice(0, 50);
    for (const [eventId] of entries) queue.delete(eventId);
    const ids = entries.map(([eventId]) => eventId);
    const subId = `embed_${Date.now()}`;
    const filter = { kinds: [1], ids, limit: ids.length };
    const hintUrls = [...new Set(entries.flatMap(([, hints]) => hints ?? []))].filter(Boolean);
    const targetSockets = [...new Set([
      ...state.sockets.values(),
      ...state.profileSockets.values(),
      ...state.embeddedSockets.values(),
      ...hintUrls.map(url => state.sockets.get(url) || state.profileSockets.get(url) || state.embeddedSockets.get(url)).filter(Boolean)
    ])].filter(ws => ws?.readyState === WebSocket.OPEN);
    const pendingHintSockets = hintUrls
      .filter(url => !(state.sockets.get(url)?.readyState === WebSocket.OPEN || state.profileSockets.get(url)?.readyState === WebSocket.OPEN || state.embeddedSockets.get(url)?.readyState === WebSocket.OPEN))
      .map(connectEmbeddedHintRelay)
      .filter(Boolean);
    if (!targetSockets.length && !pendingHintSockets.length) {
      for (const [eventId, hints] of entries) queue.set(eventId, hints);
      // No relay socket to ask yet. Retry with backoff instead of polling
      // forever while offline; once any relay connects, its onopen drains the
      // queue anyway, so after ~30s of failures just wait for that.
      if (_embeddedRetryDelay <= 12000) {
        setTimeout(scheduleEmbeddedFetch, _embeddedRetryDelay);
        _embeddedRetryDelay *= 2;
      }
      return;
    }
    _embeddedRetryDelay = 750;
    for (const [eventId] of entries) state.embeddedEventFetchTried.add(eventId);
    const expectedEoses = targetSockets.length + pendingHintSockets.length;
    const sub = { filters: [filter], columnId: null, oneshot: true, embedded: true, allRelays: true, expectedEoses };
    sub._closeTimer = setTimeout(() => {
      if (!state.subs.has(subId)) return;
      unsubscribe(subId);
      scheduleRerenderAllColumns();
    }, 4500);
    state.subs.set(subId, sub);
    for (const ws of targetSockets) ws.send(JSON.stringify(['REQ', subId, filter]));
    const payload = JSON.stringify(['REQ', subId, filter]);
    for (const ws of pendingHintSockets) ws.addEventListener('open', () => ws.send(payload), { once: true });
    if (queue.size) scheduleEmbeddedFetch();
  }, 350);
}

function connectEmbeddedHintRelay(url) {
  if (!url || state.sockets.has(url) || state.profileSockets.has(url)) return null;
  let ws = state.embeddedSockets.get(url);
  if (ws && ws.readyState !== WebSocket.CLOSED) return ws;
  try {
    ws = new WebSocket(url);
  } catch {
    return null;
  }
  state.embeddedSockets.set(url, ws);
  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      if (data[0] === 'EVENT') handleEvent(data[1], data[2], url);
      if (data[0] === 'EOSE') handleEose(data[1], url);
    } catch {}
  };
  ws.onclose = () => state.embeddedSockets.delete(url);
  ws.onerror = () => ws.close();
  return ws;
}
