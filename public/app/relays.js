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

// spread subscriptions across relays so they process in parallel
function distributeSubscriptions() {
  const sockets = [...state.sockets.values()].filter(ws => ws.readyState === WebSocket.OPEN);
  if (!sockets.length) return;
  const subs = [...state.subs.entries()];
  for (let i = 0; i < subs.length; i++) {
    const [subId, sub] = subs[i];
    // Timelines are round-robin sampled for performance, but notification and
    // profile lookups must fan out to every connected relay. Otherwise people
    // who only appear on a relay outside the sampled 2-3 relays seem to vanish.
    const count = sub.allRelays ? sockets.length : Math.min(3, sockets.length);
    for (let j = 0; j < count; j++) {
      const ws = sockets[(i + j) % sockets.length];
      ws.send(JSON.stringify(['REQ', subId, ...sub.filters]));
    }
  }
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
  state.subs.set(subId, { filters, columnId, allRelays: Boolean(options.allRelays) });
  const sockets = [...state.sockets.values()].filter(ws => ws.readyState === WebSocket.OPEN);
  if (!sockets.length) return;
  const count = options.allRelays ? sockets.length : Math.min(3, sockets.length);
  const offset = state.subs.size;
  for (let j = 0; j < count; j++) {
    sockets[(offset + j) % sockets.length].send(JSON.stringify(['REQ', subId, ...filters]));
  }
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
