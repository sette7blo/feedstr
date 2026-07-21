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

function showAddColumnModal() {
  const mc = document.getElementById('modal-content');
  mc.innerHTML = `
    <h2>Add column</h2>
    <button class="modal-option" data-type="home">
      ${iconSvg('home')}
      <div class="modal-option-text"><strong>Home</strong><span>Your own posts</span></div>
    </button>
    <button class="modal-option" data-type="following">
      ${iconSvg('user')}
      <div class="modal-option-text"><strong>Following</strong><span>Notes from people you follow</span></div>
    </button>
    <button class="modal-option" data-type="notifications">
      ${iconSvg('bell')}
      <div class="modal-option-text"><strong>Notifications</strong><span>Replies, mentions, reactions, reposts, zaps</span></div>
    </button>
    <button class="modal-option" data-type="hashtag">
      ${iconSvg('hash')}
      <div class="modal-option-text"><strong>Hashtag</strong><span>Follow a topic</span></div>
    </button>
    <button class="modal-option" data-type="profile">
      ${iconSvg('user')}
      <div class="modal-option-text"><strong>Profile</strong><span>One person's posts</span></div>
    </button>
    <button class="modal-option" data-type="custom">
      ${iconSvg('layers')}
      <div class="modal-option-text"><strong>Custom Feed</strong><span>Pick specific follows</span></div>
    </button>
  `;

  mc.querySelectorAll('.modal-option').forEach(btn => {
    btn.onclick = () => handleColumnTypeSelect(btn.dataset.type);
  });
  modal.classList.add('open');
}

function handleColumnTypeSelect(type) {
  if (type === 'hashtag') return showHashtagForm();
  if (type === 'profile') return showProfileForm();
  if (type === 'custom') return showCustomFeedForm();

  const names = { home: 'Home', following: 'Following', mentions: 'Mentions', notifications: 'Notifications' };
  const config = { type, name: names[type] ?? type };
  if (type === 'notifications') config.notificationFilter = 'all';
  addColumn(config);
  closeModal();
}

function showHashtagForm() {
  const mc = document.getElementById('modal-content');
  mc.innerHTML = `
    <h2>Hashtag column</h2>
    <div class="field">
      <label>Hashtag</label>
      <input type="text" id="hashtag-input" placeholder="bitcoin" autofocus />
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="showAddColumnModal()">Back</button>
      <button class="btn btn-primary" id="hashtag-add">Add</button>
    </div>
  `;
  document.getElementById('hashtag-add').onclick = () => {
    const tag = document.getElementById('hashtag-input').value.trim().replace(/^#/, '');
    if (!tag) return;
    addColumn({ type: 'hashtag', name: `#${tag}`, tag });
    closeModal();
  };
  document.getElementById('hashtag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('hashtag-add').click();
  });
}

function showProfileForm() {
  const mc = document.getElementById('modal-content');
  mc.innerHTML = `
    <h2>Profile column</h2>
    <div class="field">
      <label>npub or hex pubkey</label>
      <input type="text" id="profile-input" placeholder="npub1..." autofocus />
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="showAddColumnModal()">Back</button>
      <button class="btn btn-primary" id="profile-add">Add</button>
    </div>
  `;
  document.getElementById('profile-add').onclick = () => {
    const input = document.getElementById('profile-input').value.trim();
    if (!input) return;
    const pubkey = toHexPubkey(input);
    if (!pubkey) { toast('Not a valid npub or hex pubkey', 'error'); return; }
    openOrFocusColumn(
      { type: 'profile', name: shortNpub(input), pubkey },
      c => c.type === 'profile' && c.pubkey === pubkey
    );
    closeModal();
  };
  document.getElementById('profile-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('profile-add').click();
  });
}

function showCustomFeedForm(existing = null) {
  const mc = document.getElementById('modal-content');
  const selectedPubkeys = new Set(existing?.pubkeys ?? []);

  mc.innerHTML = `
    <h2>${existing ? 'Edit' : 'Custom'} feed</h2>
    <div class="field">
      <label>Name</label>
      <input type="text" id="custom-name" placeholder="Privacy Tools" value="${esc(existing?.name ?? '')}" />
    </div>
    <div class="field">
      <label>Select follows (${state.following.length})</label>
      <input type="text" class="follow-picker-search" id="follow-search" placeholder="Search..." />
      <div class="follow-picker" id="follow-picker"></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" id="custom-back">Back</button>
      <button class="btn btn-primary" id="custom-add">${existing ? 'Save' : 'Add'}</button>
    </div>
  `;

  function renderPicker(filter = '') {
    const picker = document.getElementById('follow-picker');
    const lf = filter.toLowerCase();
    const filtered = state.following.filter(f =>
      !lf || f.name.toLowerCase().includes(lf) || f.petname.toLowerCase().includes(lf) || f.pubkey.includes(lf)
    );
    picker.innerHTML = '';
    for (const f of filtered) {
      const item = document.createElement('label');
      item.className = `follow-picker-item${selectedPubkeys.has(f.pubkey) ? ' selected' : ''}`;
      item.innerHTML = `
        <input type="checkbox" ${selectedPubkeys.has(f.pubkey) ? 'checked' : ''} />
        <span>${esc(f.name || f.petname || shortNpub(f.pubkey))}</span>
      `;
      item.querySelector('input').onchange = (e) => {
        if (e.target.checked) selectedPubkeys.add(f.pubkey);
        else selectedPubkeys.delete(f.pubkey);
        item.classList.toggle('selected', e.target.checked);
      };
      picker.appendChild(item);
    }
  }

  renderPicker();
  document.getElementById('follow-search').oninput = (e) => renderPicker(e.target.value);
  document.getElementById('custom-back').onclick = () => existing ? closeModal() : showAddColumnModal();
  document.getElementById('custom-add').onclick = () => {
    const name = document.getElementById('custom-name').value.trim() || 'Custom';
    const pubkeys = [...selectedPubkeys];
    if (!pubkeys.length) return;
    if (existing) {
      existing.name = name;
      existing.pubkeys = pubkeys;
      renderColumns();
    } else {
      addColumn({ type: 'custom', name, pubkeys });
    }
    closeModal();
  };
}

function editCustomColumn(col) {
  showCustomFeedForm(col);
  modal.classList.add('open');
}

// Smoothly bring a column into view. On mobile each column is 100vw, so a column
// added at the end of the deck would otherwise sit off-screen to the right and the
// viewport would stay pinned to the first column. rAF lets the new DOM lay out first.
function scrollColumnIntoView(id) {
  requestAnimationFrame(() => {
    document.querySelector(`.column[data-col="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  });
}

function addColumn(config) {
  const id = genId();
  const col = { id, events: [], ...config };
  state.columns.push(col);
  buildColumnDom(col, document.getElementById('columns'), document.getElementById('column-list'));
  saveColumns();
  scrollColumnIntoView(id);
  return id;
}

// Open a column, or focus the matching existing one instead of stacking a duplicate.
function openOrFocusColumn(config, matchFn) {
  const existing = matchFn ? state.columns.find(matchFn) : null;
  if (existing) {
    scrollColumnIntoView(existing.id);
    return existing;
  }
  addColumn(config);
  return state.columns[state.columns.length - 1];
}

// Fast lookup set for the avatar follow-ring, rebuilt whenever the follow list changes.
function refreshFollowingSet() {
  state.followingSet = new Set((state.following ?? []).map(f => f.pubkey).filter(Boolean));
}

function isFollowing(pubkey) {
  return Boolean(pubkey) && (state.followingSet?.has(pubkey) ?? false);
}

// Mutate the local follow list + ring instantly (optimistic); the server call follows.
function setFollowLocal(pubkey, name, following) {
  if (following) {
    if (!state.following.some(f => f.pubkey === pubkey)) {
      state.following.push({ pubkey, npub: '', petname: name || '', name: name || '', picture: '' });
    }
  } else {
    state.following = state.following.filter(f => f.pubkey !== pubkey);
  }
  refreshFollowingSet();
  document.querySelectorAll(`.note-avatar[data-pubkey="${CSS.escape(pubkey)}"]`)
    .forEach(el => el.classList.toggle('following', following));
  rerenderColumnsForAuthor(pubkey);
}

function toggleFollow(col) {
  if (!col?.pubkey) return;
  return isFollowing(col.pubkey) ? unfollowUser(col.pubkey, col.name, col) : followUser(col.pubkey, col.name, col);
}

async function followUser(pubkey, name, col) {
  const label = name || shortNpub(pubkey);
  setFollowLocal(pubkey, name, true);
  if (col) updateColumnHeader(col);
  try {
    await api('/api/v1/idenstr/following/follow', { method: 'POST', body: { pubkey, petname: name || '' } });
    toast(`Following ${label}`, 'success');
  } catch (err) {
    setFollowLocal(pubkey, name, false);
    if (col) updateColumnHeader(col);
    toast(followError(err), 'error');
  }
}

async function unfollowUser(pubkey, name, col) {
  const label = name || shortNpub(pubkey);
  setFollowLocal(pubkey, name, false);
  if (col) updateColumnHeader(col);
  try {
    await api('/api/v1/idenstr/following/unfollow', { method: 'POST', body: { pubkey } });
    toast(`Unfollowed ${label}`, 'info', { label: 'Undo', onAction: () => followUser(pubkey, name, col) });
  } catch (err) {
    setFollowLocal(pubkey, name, true);
    if (col) updateColumnHeader(col);
    toast(followError(err), 'error');
  }
}

function followError(err) {
  const m = String(err?.message || err || '');
  if (/403|forbidden|scope|following:write/i.test(m)) {
    return "Grant Feedstr the 'following:write' scope in Idenstr to follow";
  }
  return 'Follow update failed';
}

function openProfileColumn(pubkey, name) {
  if (!pubkey) { toast('Could not resolve that profile', 'error'); return; }
  openOrFocusColumn(
    { type: 'profile', name: name || shortNpub(pubkey), pubkey },
    c => c.type === 'profile' && c.pubkey === pubkey
  );
}

function openHashtagColumn(rawTag) {
  const tag = String(rawTag || '').replace(/^#/, '').toLowerCase();
  if (!tag) return;
  openOrFocusColumn(
    { type: 'hashtag', name: `#${tag}`, tag },
    c => c.type === 'hashtag' && c.tag?.toLowerCase() === tag
  );
}

function removeColumnCache(id) {
  clearTimeout(cacheTimers.get(id));
  cacheTimers.delete(id);
  api(`/api/v1/cache/${id}`, { method: 'DELETE' }).catch(() => {});
}

function reloadColumn(col) {
  col.events = [];
  col._ids = new Set();
  renderColumnFeed(col);
  startColumnSub(col);
}

function removeColumn(id) {
  unsubscribe(`col_${id}`);
  unsubscribe(`replies_${id}`);
  unsubscribe(`engagement_${id}`);
  unsubscribe(`thread_replies_${id}`);
  state.columns = state.columns.filter(c => c.id !== id);
  removeColumnCache(id);
  document.querySelector(`.column[data-col="${id}"]`)?.remove();
  document.querySelector(`#column-list [data-side-col="${id}"]`)?.remove();
  pruneMemory();
  saveColumns();
}

const DEFAULT_COLUMNS = () => [
  { id: genId(), type: 'home', name: 'Home' },
  { id: genId(), type: 'following', name: 'Following' },
  { id: genId(), type: 'notifications', name: 'Notifications', notificationFilter: 'all' }
];

async function loadColumns() {
  try {
    const { value } = await api('/api/v1/state/columns');
    if (Array.isArray(value) && value.length) return value;
  } catch {}
  // One-time migration of columns saved by older versions in browser storage.
  const legacy = localStorage.getItem('feedstr:columns');
  if (legacy) {
    try {
      const cols = JSON.parse(legacy);
      if (Array.isArray(cols) && cols.length) {
        await persistColumns(cols);
        localStorage.removeItem('feedstr:columns');
        return cols;
      }
    } catch {}
  }
  return DEFAULT_COLUMNS();
}

async function persistColumns(columns) {
  // Persist only column configuration; everything else (events, dedup set, open
  // thread, scroll markers) is runtime state that must not survive a reload.
  const serializable = columns.map((c) => {
    const out = { id: c.id, type: c.type, name: c.name };
    if (c.pubkey) out.pubkey = c.pubkey;
    if (c.pubkeys) out.pubkeys = c.pubkeys;
    if (c.tag) out.tag = c.tag;
    if (c.notificationFilter) out.notificationFilter = c.notificationFilter;
    return out;
  });
  try {
    await api('/api/v1/state/columns', { method: 'PUT', body: { value: serializable } });
  } catch (err) {
    console.warn('Failed to save columns', err.message);
  }
}

// Liked note ids live in Feedstr's DB so the heart stays filled across reloads;
// the like itself is the published kind:7 reaction vaulted in the private relay.
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

// Reply counts: how many notes e-tag a given note. Used to show "N replies" on
// the reply action of your own posts in the Home column.
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
  const ids = (col.events ?? []).filter(e => e.kind === 1).map(e => e.id).slice(0, 200);
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

async function hydrateColumnCache(col) {
  if (!col?.id) return;
  try {
    const { events } = await api(`/api/v1/cache/${col.id}`);
    if (!Array.isArray(events) || !events.length) return;
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
    if (globalNoteAdded) scheduleRerenderAllColumns();
  } catch {}
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
