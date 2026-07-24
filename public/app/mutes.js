// Liked state, default zap amount, and mute lists (keyword/profile/thread)
// - all persisted through Idenstr.
async function loadLiked() {
  try {
    const { value } = await api('/api/v1/state/liked');
    if (Array.isArray(value)) return new Set(value);
  } catch {}
  return new Set();
}

function persistLiked() {
  api('/api/v1/state/liked', { method: 'PUT', body: { value: [...state.liked] } })
    .catch(err => console.warn('Failed to save liked notes', err.message));
}

// One-tap zap amount. A Feedstr UX preference (not a wallet credential), so it
// lives in Feedstr's own state store, server-side, and syncs across devices.
async function loadZapDefault() {
  try {
    const { value } = await api('/api/v1/state/zap-default');
    const n = Math.round(Number(value));
    if (Number.isFinite(n) && n >= 1) return n;
  } catch {}
  return 100;
}

function persistZapDefault() {
  api('/api/v1/state/zap-default', { method: 'PUT', body: { value: state.zapDefaultSats } })
    .catch(err => console.warn('Failed to save default zap amount', err.message));
}

// Mutes come from Idenstr's kind:10000 identity policy when available. The
// Feedstr local state fallback keeps older keyword mutes alive until Idenstr is linked.
async function loadMutes() {
  try {
    const { value } = await api('/api/v1/state/mutes');
    return normalizeMutes(value);
  } catch {}
  return { entries: [] };
}

function normalizeMutes(value) {
  if (Array.isArray(value)) {
    return { entries: value.map((s, i) => ({ id: `legacy-${i}`, type: 'keyword', value: String(s).toLowerCase(), label: '', addedAt: '' })) };
  }
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  return { ...value, entries: entries.map((entry, i) => ({ id: entry.id || `mute-${i}`, type: entry.type || 'keyword', value: String(entry.value ?? entry.keyword ?? '').toLowerCase(), label: entry.label || '', addedAt: entry.addedAt || '' })).filter(e => e.value) };
}

function refreshMuteSets() {
  state.muteSets = {
    keyword: new Set(muteEntriesByType('keyword').map(e => e.value)),
    pubkey: new Set(muteEntriesByType('pubkey').map(e => e.value)),
    thread: new Set([...muteEntriesByType('thread'), ...muteEntriesByType('event')].map(e => e.value)),
    hashtag: new Set(muteEntriesByType('hashtag').map(e => e.value.replace(/^#/, '')))
  };
}

function muteEntriesByType(type) {
  return (state.mutes?.entries ?? []).filter(entry => entry.type === type);
}

// Keyword mutes publish through Idenstr's signed kind:10000 list, exactly like
// profile and thread mutes, so a muted word reaches the relays and other clients
// instead of sitting as an unpublished local draft. Optimistic with rollback.
async function muteKeyword(term) {
  state.mutes.entries.push({ id: `local-${Date.now()}`, type: 'keyword', value: term, label: '', addedAt: new Date().toISOString() });
  refreshMuteSets();
  renderMuteList();
  scheduleRerenderAllColumns();
  try {
    await api('/api/v1/idenstr/mutes/mute', { method: 'POST', body: { type: 'keyword', value: term } });
    toast(`Muted "${term}"`, 'success');
  } catch (err) {
    state.mutes.entries = (state.mutes.entries ?? []).filter(m => !(m.type === 'keyword' && m.value === term));
    refreshMuteSets();
    renderMuteList();
    scheduleRerenderAllColumns();
    toast(muteError(err), 'error');
  }
}

async function unmuteKeyword(term) {
  const removed = (state.mutes.entries ?? []).filter(m => m.type === 'keyword' && m.value === term);
  state.mutes.entries = (state.mutes.entries ?? []).filter(m => !(m.type === 'keyword' && m.value === term));
  refreshMuteSets();
  renderMuteList();
  scheduleRerenderAllColumns();
  try {
    await api('/api/v1/idenstr/mutes/unmute', { method: 'POST', body: { idOrValue: term } });
    toast(`Unmuted "${term}"`, 'success');
  } catch (err) {
    state.mutes.entries.push(...removed);
    refreshMuteSets();
    renderMuteList();
    scheduleRerenderAllColumns();
    toast(muteError(err), 'error');
  }
}

function isMuted(event) {
  if (!event) return false;
  const sets = state.muteSets || {};
  if (sets.pubkey?.has(event.pubkey)) return true;
  if (isMutedThreadEvent(event)) return true;
  if (event.kind === 1) {
    const content = (event.content || '').toLowerCase();
    for (const term of sets.keyword ?? []) if (term && content.includes(term)) return true;
    for (const tag of event.tags ?? []) if (tag[0] === 't' && sets.hashtag?.has(String(tag[1] || '').toLowerCase().replace(/^#/, ''))) return true;
  }
  return false;
}

function isMutedThreadEvent(event) {
  const muted = state.muteSets?.thread;
  if (!muted?.size || !event) return false;
  if (muted.has(event.id)) return true;
  const parent = getReplyParentRef(event)?.eventId;
  if (parent && muted.has(parent)) return true;
  return (event.tags ?? []).some(tag => tag[0] === 'e' && muted.has(tag[1]));
}

function isMutedNotification(notification) {
  if (!notification) return false;
  if (state.muteSets?.pubkey?.has(notification.actorPubkey)) return true;
  if (notification.targetEventId && state.muteSets?.thread?.has(notification.targetEventId)) return true;
  return isMuted(notification.rawEvent);
}

function isMutedProfile(pubkey) {
  return Boolean(pubkey) && Boolean(state.muteSets?.pubkey?.has(pubkey));
}

function setMuteProfileLocal(pubkey, name, muted) {
  if (!pubkey) return;
  if (muted) {
    if (!isMutedProfile(pubkey)) {
      state.mutes.entries.push({ id: `pubkey-${pubkey}`, type: 'pubkey', value: pubkey, label: name || '', addedAt: new Date().toISOString() });
    }
  } else {
    state.mutes.entries = (state.mutes.entries ?? []).filter(e => !(e.type === 'pubkey' && e.value === pubkey));
  }
  refreshMuteSets();
  rerenderColumnsForAuthor(pubkey);
}

function setMuteThreadLocal(threadId, muted) {
  if (!threadId) return;
  if (muted) {
    if (!state.muteSets?.thread?.has(threadId)) {
      state.mutes.entries.push({ id: `thread-${threadId}`, type: 'thread', value: threadId, label: 'Muted thread', addedAt: new Date().toISOString() });
    }
  } else {
    state.mutes.entries = (state.mutes.entries ?? []).filter(e => !((e.type === 'thread' || e.type === 'event') && e.value === threadId));
  }
  refreshMuteSets();
}

function toggleMuteProfile(col) {
  if (!col?.pubkey) return;
  return isMutedProfile(col.pubkey) ? unmuteProfile(col.pubkey, col.name, col) : muteProfile(col.pubkey, col.name, col);
}

async function muteProfile(pubkey, name, col) {
  const label = name || shortNpub(pubkey);
  setMuteProfileLocal(pubkey, name, true);
  if (col) updateColumnHeader(col);
  scheduleRerenderAllColumns();
  try {
    await api('/api/v1/idenstr/mutes/mute', { method: 'POST', body: { type: 'pubkey', value: pubkey, label } });
    toast(`Muted ${label}`, 'success');
  } catch (err) {
    setMuteProfileLocal(pubkey, name, false);
    if (col) updateColumnHeader(col);
    scheduleRerenderAllColumns();
    toast(muteError(err), 'error');
  }
}

async function unmuteProfile(pubkey, name, col) {
  const label = name || shortNpub(pubkey);
  setMuteProfileLocal(pubkey, name, false);
  if (col) updateColumnHeader(col);
  scheduleRerenderAllColumns();
  try {
    await api('/api/v1/idenstr/mutes/unmute', { method: 'POST', body: { idOrValue: pubkey } });
    toast(`Unmuted ${label}`, 'success');
  } catch (err) {
    setMuteProfileLocal(pubkey, name, true);
    if (col) updateColumnHeader(col);
    scheduleRerenderAllColumns();
    toast(muteError(err), 'error');
  }
}

function muteError(err) {
  const m = String(err?.message || err || '');
  if (/403|forbidden|scope|mutes:write/i.test(m)) return "Grant Feedstr the 'mutes:write' scope in Idenstr to mute";
  return 'Mute update failed';
}

async function muteThread(event) {
  const threadId = getReplyParentRef(event)?.eventId || event.id;
  if (!threadId) return;
  if (state.muteSets?.thread?.has(threadId)) return;
  setMuteThreadLocal(threadId, true);
  scheduleRerenderAllColumns();
  try {
    await api('/api/v1/idenstr/mutes/mute', { method: 'POST', body: { type: 'thread', value: threadId, label: 'Muted thread' } });
    toast('Thread muted', 'success');
  } catch (err) {
    setMuteThreadLocal(threadId, false);
    scheduleRerenderAllColumns();
    toast(muteError(err), 'error');
  }
}

// One-shot REQ to the private relay only (it holds everything you signed) for your
// own reactions. handleEvent collects the e-tags; handleEose persists and rerenders.
