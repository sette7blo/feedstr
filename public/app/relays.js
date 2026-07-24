// -- relay connections --
function connectRelays() {
  const relays = [...new Set([...state.relays.read, ...state.relays.write])];
  for (const url of relays) connectRelay(url);
}

function connectRelay(url) {
  if (state.sockets.has(url)) return;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch { return; }

  ws.onopen = () => {
    state.sockets.set(url, ws);
    state._relayRetries?.delete(url);
    distributeSubscriptions();
    if (typeof updateAllColumnHeaderMeta === 'function') updateAllColumnHeaderMeta();
    refreshVisibleMissingProfiles();
    if (state._embeddedQueue?.size) scheduleEmbeddedFetch();
    // The private relay vaults every event you signed, so backfill your own
    // kind:7 reactions from it once to light up hearts on previously liked notes.
    if (url === state.config?.privateRelayUrl && !state._likedBackfilled) {
      state._likedBackfilled = true;
      backfillLiked();
    }
  };

  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      if (data[0] === 'EVENT') handleEvent(data[1], data[2], url);
      if (data[0] === 'EOSE') handleEose(data[1], url);
    } catch {}
  };

  ws.onclose = () => {
    state.sockets.delete(url);
    if (typeof updateAllColumnHeaderMeta === 'function') updateAllColumnHeaderMeta();
    if (!state._relayRetries) state._relayRetries = new Map();
    const attempts = (state._relayRetries.get(url) ?? 0) + 1;
    state._relayRetries.set(url, attempts);
    // Exponential backoff with jitter, capped at 30s, so a dead relay isn't
    // reconnected every 5s indefinitely.
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)) + Math.random() * 1000;
    setTimeout(() => connectRelay(url), delay);
  };

  ws.onerror = () => ws.close();
}

// spread subscriptions across relays so they process in parallel without
// flooding every relay with every filter. Each subscription remembers which
// socket/filter pairs were already sent, so a later relay connection does not
// replay the full deck to already-open sockets.
function openSocketEntries() {
  return [...state.sockets.entries()].filter(([, ws]) => ws.readyState === WebSocket.OPEN);
}

function relaySendKey(url, filterIndex = -1) {
  return `${url}|${filterIndex}`;
}

function sendSubToSockets(subId, sub, socketEntries) {
  if (!socketEntries.length) return;
  if (!sub._sent) sub._sent = new Set();

  if (sub.shardFilters) {
    const replicas = Math.max(1, Number(sub.relayReplicas ?? 1));
    const offset = sub.relayOffset ?? 0;
    for (let i = 0; i < sub.filters.length; i++) {
      const filter = sub.filters[i];
      for (let r = 0; r < Math.min(replicas, socketEntries.length); r++) {
        const [url, ws] = socketEntries[(offset + i + r) % socketEntries.length];
        const key = relaySendKey(url, i);
        if (sub._sent.has(key)) continue;
        sub._sent.add(key);
        ws.send(JSON.stringify(['REQ', subId, filter]));
      }
    }
    return;
  }

  // Timelines are round-robin sampled for performance, but notification and
  // profile lookups must fan out to every connected relay. Otherwise people
  // who only appear on a relay outside the sampled 2-3 relays seem to vanish.
  const count = sub.allRelays ? socketEntries.length : Math.min(3, socketEntries.length);
  const offset = sub.relayOffset ?? 0;
  for (let j = 0; j < count; j++) {
    const [url, ws] = socketEntries[(offset + j) % socketEntries.length];
    const key = relaySendKey(url);
    if (sub._sent.has(key)) continue;
    sub._sent.add(key);
    ws.send(JSON.stringify(['REQ', subId, ...sub.filters]));
  }
}

function distributeSubscriptions() {
  const socketEntries = openSocketEntries();
  if (!socketEntries.length) return;
  const subs = [...state.subs.entries()];
  for (const [subId, sub] of subs) sendSubToSockets(subId, sub, socketEntries);
}

function sendToAll(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of state.sockets.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function sendProfileReqToDiscoveryRelays(subId, filter) {
  const payload = JSON.stringify(['REQ', subId, filter]);
  for (const url of profileDiscoveryRelays) {
    let ws = state.profileSockets.get(url);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(payload);
      continue;
    }
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener('open', () => ws.send(payload), { once: true });
      continue;
    }
    try {
      ws = new WebSocket(url);
    } catch { continue; }
    state.profileSockets.set(url, ws);
    ws.addEventListener('open', () => ws.send(payload), { once: true });
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data[0] === 'EVENT') handleEvent(data[1], data[2], url);
        if (data[0] === 'EOSE') handleEose(data[1], url);
      } catch {}
    };
    ws.onclose = () => state.profileSockets.delete(url);
    ws.onerror = () => {};
  }
}

function subscribe(subId, filters, columnId, options = {}) {
  const sub = {
    filters,
    columnId,
    allRelays: Boolean(options.allRelays),
    shardFilters: Boolean(options.shardFilters),
    relayReplicas: options.relayReplicas ?? 1,
    relayOffset: Math.floor(Math.random() * 1000),
    _sent: new Set()
  };
  state.subs.set(subId, sub);
  sendSubToSockets(subId, sub, openSocketEntries());
}

function unsubscribe(subId) {
  state.subs.delete(subId);
  sendToAll(['CLOSE', subId]);
}

// Insert into an array kept sorted descending by created_at, using binary search
// for the position. Avoids re-sorting the whole column on every incoming event.
function insertEventSorted(events, event) {
  const ts = event.created_at ?? 0;
  let lo = 0, hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((events[mid].created_at ?? 0) > ts) lo = mid + 1;
    else hi = mid;
  }
  events.splice(lo, 0, event);
}
