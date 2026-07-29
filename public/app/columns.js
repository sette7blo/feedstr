// Column shell: render/build column DOM, headers and metadata, feed-mode
// filters (Notes/Replies/All/Media), relay subscriptions, empty states.
// -- column rendering --
function renderColumns() {
  const container = document.getElementById('columns');
  container.innerHTML = '';
  const listEl = document.getElementById('column-list');
  listEl.innerHTML = '';
  for (const col of state.columns) buildColumnDom(col, container, listEl);
  saveColumns();
}

// Build the sidebar entry, column element, and subscription for a single column.
// Used both for the full render (boot) and for appending one new column, so
// adding a column doesn't tear down and re-subscribe every other column.
function buildColumnDom(col, container, listEl) {
  const sideItem = document.createElement('div');
  sideItem.className = 'sidebar-column-item';
  sideItem.dataset.sideCol = col.id;

  const jumpButton = document.createElement('button');
  jumpButton.className = 'sidebar-item sidebar-column-jump';
  jumpButton.type = 'button';
  jumpButton.innerHTML = `<span class="sidebar-column-name">${esc(col.name)}</span>`;
  jumpButton.onclick = () => {
    closeMobileMenu();
    document.querySelector(`.column[data-col="${col.id}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'start' });
  };

  const closeButton = document.createElement('button');
  closeButton.className = 'sidebar-column-close';
  closeButton.type = 'button';
  closeButton.title = `Close ${col.name}`;
  closeButton.setAttribute('aria-label', `Close ${col.name} column`);
  closeButton.innerHTML = iconSvg('x');
  closeButton.onclick = (event) => {
    event.stopPropagation();
    removeColumn(col.id);
  };

  sideItem.append(jumpButton, closeButton);
  listEl.appendChild(sideItem);

  const colEl = document.createElement('div');
  colEl.className = 'column';
  colEl.dataset.col = col.id;
  colEl.innerHTML = `
    <div class="column-header">${columnHeaderHtml(col)}</div>
    <div class="column-feed">
      ${emptyState('Waiting for notes', 'Live updates will appear here')}
    </div>
  `;
  wireColumnHeader(colEl, col);
  container.appendChild(colEl);

  if (!col.events) col.events = [];
  startColumnSub(col);
}

// Column header swaps to a "Thread" + back-arrow layout while a conversation is
// open in that column, so threads read as in-place navigation, not a popup.
function columnHeaderHtml(col) {
  if (col.thread) {
    return `
      <div class="column-head-thread">
        <button class="column-btn column-btn-back" data-action="thread-back" title="Back to ${esc(col.name)}" aria-label="Back to ${esc(col.name)}">${iconSvg('arrow-left')}</button>
        <div class="column-head-main">
          <div class="column-kicker"><span class="column-status-dot live"></span><span class="column-kind-label">Conversation</span></div>
          <div class="column-title">Thread</div>
          <div class="column-subtitle">${esc(threadSubtitle(col))}</div>
        </div>
      </div>
      <div class="column-actions"></div>
    `;
  }
  const stats = columnHeaderStats(col);
  return `
    <div class="column-head-main">
      <div class="column-kicker"><span class="column-status-dot ${stats.statusClass}"></span><span class="column-kind-label" data-column-kind-label>${esc(stats.kindLabel)}</span></div>
      <div class="column-title">${esc(col.name)}</div>
      <div class="column-subtitle" data-column-subtitle>${esc(stats.subtitle)}</div>
    </div>
    <div class="column-actions">
      <button class="column-btn${col._refreshing ? ' refreshing' : ''}" data-action="reload" title="Reload ${esc(col.name)}" aria-label="Reload ${esc(col.name)}" aria-busy="${col._refreshing ? 'true' : 'false'}">${iconSvg('reload')}</button>
      ${col.type === 'custom' ? `<button class="column-btn" data-action="edit" title="Edit ${esc(col.name)}" aria-label="Edit ${esc(col.name)}">${iconSvg('settings')}</button>` : ''}
      <button class="column-btn" data-action="close" title="Remove ${esc(col.name)}" aria-label="Remove ${esc(col.name)}">${iconSvg('x')}</button>
    </div>
  `;
}

function wireColumnHeader(colEl, col) {
  colEl.querySelector('[data-action="reload"]')?.addEventListener('click', (event) => {
    event.currentTarget.blur();
    reloadColumn(col);
  });
  colEl.querySelector('[data-action="close"]')?.addEventListener('click', () => removeColumn(col.id));
  colEl.querySelector('[data-action="edit"]')?.addEventListener('click', () => editCustomColumn(col));
  colEl.querySelector('[data-action="thread-back"]')?.addEventListener('click', () => closeThread(col));
  colEl.querySelector('[data-action="follow-toggle"]')?.addEventListener('click', () => toggleFollow(col));
  colEl.querySelector('[data-action="mute-profile-toggle"]')?.addEventListener('click', () => toggleMuteProfile(col));
}

function updateColumnHeader(col) {
  const colEl = document.querySelector(`[data-col="${col.id}"]`);
  if (!colEl) return;
  colEl.classList.toggle('thread-open', Boolean(col.thread));
  const header = colEl.querySelector('.column-header');
  header.innerHTML = columnHeaderHtml(col);
  wireColumnHeader(colEl, col);
}

function openRelayCount() {
  return [...state.sockets.values()].filter(ws => ws.readyState === WebSocket.OPEN).length;
}

function columnConnectionClass(col) {
  if (col.thread) return 'live';
  const open = openRelayCount();
  if (open > 0) return 'live';
  const configured = new Set([...(state.relays.read ?? []), ...(state.relays.write ?? [])]).size;
  return configured ? 'connecting' : 'idle';
}

function formatCount(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const FEED_MODES = ['top', 'replies', 'all', 'media'];
const RENDER_NOTE_LIMIT = 80;

function isFeedModeColumn(col) {
  return ['home', 'following', 'hashtag', 'profile', 'custom'].includes(col?.type);
}

function feedModeForColumn(col) {
  if (FEED_MODES.includes(col?.feedMode)) return col.feedMode;
  return col?.type === 'following' ? 'all' : 'top';
}

function feedModeLabel(mode, col = null) {
  if (mode === 'top') return 'Notes';
  if (mode === 'replies') return 'Replies';
  if (mode === 'media') return 'Media';
  return 'All';
}

function feedModeSummary(count, mode, col = null) {
  if (mode === 'replies') return formatCount(count, 'reply', 'replies');
  if (mode === 'media') return formatCount(count, 'media note');
  if (mode === 'all') return `${formatCount(count, 'note')} all`;
  if (col?.type === 'home') return formatCount(count, 'post');
  return formatCount(count, 'note');
}

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isReplyEvent(event) {
  const parentRef = getReplyParentRef(event);
  return Boolean(parentRef?.eventId && parentRef.eventId !== event?.id);
}

function isMediaEvent(event) {
  return extractUrls(event?.content ?? '').some(isImageUrl);
}

function baseFeedEvents(col) {
  return (col.events ?? [])
    .filter(e => e.kind === 1 && !isMuted(e));
}

function filterEventsForMode(events, mode) {
  if (mode === 'replies') return events.filter(isReplyEvent);
  if (mode === 'media') return events.filter(isMediaEvent);
  if (mode === 'all') return events;
  return events.filter(e => !isReplyEvent(e));
}

function feedModeCounts(col) {
  const events = baseFeedEvents(col);
  return {
    top: events.filter(e => !isReplyEvent(e)).length,
    replies: events.filter(isReplyEvent).length,
    all: events.length,
    media: events.filter(isMediaEvent).length
  };
}

function columnVisibleEventCount(col) {
  if (col.type === 'notifications') {
    return (col.events ?? [])
      .map(normalizeNotification)
      .filter(Boolean)
      .filter(n => !isMutedNotification(n)).length;
  }
  if (isFeedModeColumn(col)) return filterEventsForMode(baseFeedEvents(col), feedModeForColumn(col)).length;
  return baseFeedEvents(col).length;
}

function columnKindLabel(col) {
  if (col.type === 'home') return 'Personal';
  if (col.type === 'following') return 'Timeline';
  if (col.type === 'notifications') return 'Inbox';
  if (col.type === 'mentions') return 'Legacy';
  if (col.type === 'hashtag') return 'Hashtag';
  if (col.type === 'profile') return 'Profile';
  if (col.type === 'custom') return 'Custom';
  return 'Column';
}

function columnSubtitle(col) {
  const open = openRelayCount();
  const totalRelays = new Set([...(state.relays.read ?? []), ...(state.relays.write ?? [])]).size;
  const relayCopy = totalRelays ? `${open}/${totalRelays} relays` : 'relay setup pending';
  const events = columnVisibleEventCount(col);
  const mode = feedModeForColumn(col);
  const modeCopy = isFeedModeColumn(col) ? feedModeSummary(events, mode, col) : '';
  const refreshPrefix = col._refreshing ? 'refreshing · ' : '';
  if (col.type === 'home') return `${refreshPrefix}${modeCopy} · ${relayCopy}`;
  if (col.type === 'following') return `${refreshPrefix}${formatCount(state.following.length, 'follow')} · ${modeCopy} · ${relayCopy}`;
  if (col.type === 'mentions') return `${refreshPrefix}${formatCount(events, 'mention')} · legacy`;
  if (col.type === 'hashtag') return `${refreshPrefix}#${col.tag} · ${modeCopy}`;
  if (col.type === 'profile') return `${refreshPrefix}${shortNpub(col.pubkey)} · ${modeCopy}`;
  if (col.type === 'notifications') return `${refreshPrefix}${formatCount(events, 'notification')} · ${relayCopy}`;
  if (col.type === 'custom') return `${refreshPrefix}${formatCount((col.pubkeys ?? []).length, 'account')} · ${modeCopy}`;
  return `${refreshPrefix}${relayCopy}`;
}

function threadSubtitle(col) {
  const replies = (col.events ?? []).filter(e => e.kind === 1 && !isMuted(e)).length;
  return `${col.name} · ${formatCount(replies, 'visible note')}`;
}

function columnHeaderStats(col) {
  return {
    kindLabel: columnKindLabel(col),
    subtitle: columnSubtitle(col),
    statusClass: columnConnectionClass(col)
  };
}

function updateColumnHeaderMeta(col) {
  const colEl = document.querySelector(`[data-col="${col.id}"]`);
  if (!colEl || col.thread) return;
  const stats = columnHeaderStats(col);
  const subtitle = colEl.querySelector('[data-column-subtitle]');
  if (subtitle) subtitle.textContent = stats.subtitle;
  const label = colEl.querySelector('[data-column-kind-label]');
  if (label) label.textContent = stats.kindLabel;
  const dot = colEl.querySelector('.column-status-dot');
  if (dot) dot.className = `column-status-dot ${stats.statusClass}`;
  const reload = colEl.querySelector('[data-action="reload"]');
  if (reload) {
    reload.classList.toggle('refreshing', Boolean(col._refreshing));
    reload.setAttribute('aria-busy', col._refreshing ? 'true' : 'false');
    reload.title = `${col._refreshing ? 'Refreshing' : 'Reload'} ${col.name}`;
    reload.setAttribute('aria-label', `${col._refreshing ? 'Refreshing' : 'Reload'} ${col.name}`);
  }
}

function setColumnRefreshing(col, refreshing) {
  if (!col) return;
  col._refreshing = Boolean(refreshing);
  clearTimeout(col._refreshTimer);
  if (refreshing) {
    col._refreshStartedAt = Date.now();
    // Some relays never send EOSE. Always clear the visible spinner quickly so
    // refresh cannot look permanently stuck just because a relay is slow/noisy.
    col._refreshTimer = setTimeout(() => setColumnRefreshing(col, false), 2600);
  } else {
    col._refreshTimer = null;
  }
  updateColumnHeaderMeta(col);
}

function finishColumnRefreshForSub(subId) {
  const sub = state.subs.get(subId);
  if (!sub?.columnId) return;
  const col = state.columns.find(c => c.id === sub.columnId);
  if (!col?._refreshing) return;
  // Keep the flash perceptible but do not wait for every relay/chunk.
  const elapsed = Date.now() - (col._refreshStartedAt || 0);
  const delay = Math.max(0, 450 - elapsed);
  clearTimeout(col._refreshTimer);
  col._refreshTimer = setTimeout(() => setColumnRefreshing(col, false), delay);
}

function updateAllColumnHeaderMeta() {
  for (const col of state.columns) updateColumnHeaderMeta(col);
}

function startColumnSub(col) {
  const subId = `col_${col.id}`;
  unsubscribe(subId);
  unsubscribe(`notification_own_${col.id}`);
  unsubscribe(`quotes_${col.id}`);

  const now = Math.floor(Date.now() / 1000);
  const since = now - 86400 * 7; // last 7 days for scrollable timelines
  let filters;

  const followPubkeys = state.following.map(f => f.pubkey).filter(Boolean);

  switch (col.type) {
    case 'home':
      if (!state.identity?.pubkey) return;
      filters = [{ kinds: [1], authors: [state.identity.pubkey], since: now - 86400 * 30, limit: 500 }];
      break;
    case 'following':
      if (!followPubkeys.length) return;
      // Large follow lists can exceed relay filter limits or become very slow as
      // one huge authors array. Split them into bounded OR filters while keeping
      // the same seven-day window; each relay can answer manageable chunks.
      filters = chunkArray(followPubkeys, 100).map(authors => ({ kinds: [1], authors, since, limit: 120 }));
      break;
    case 'mentions':
      if (!state.identity?.pubkey) return;
      filters = [{ kinds: [1], '#p': [state.identity.pubkey], since, limit: 500 }];
      break;
    case 'hashtag':
      if (!col.tag) return;
      filters = [{ kinds: [1], '#t': [col.tag.toLowerCase()], since, limit: 500 }];
      break;
    case 'profile':
      if (!col.pubkey) return;
      filters = [{ kinds: [1], authors: [col.pubkey], since: now - 86400 * 30, limit: 500 }];
      break;
    case 'notifications':
      if (!state.identity?.pubkey) return;
      // Notifications are a finite per-user stream, so reach back much further
      // than the 24h timeline window and lift the cap — otherwise replies,
      // reactions, reposts and zaps older than a day silently never load.
      filters = [{ kinds: [1, 6, 7, 9735], '#p': [state.identity.pubkey], since: now - 86400 * 30, limit: 500 }];
      break;
    case 'custom':
      if (!col.pubkeys?.length) return;
      filters = [{ kinds: [1], authors: col.pubkeys, since, limit: 500 }];
      break;
    default: return;
  }

  // Profiles are fetched on-demand for visible note authors so mentions and
  // notifications can resolve avatars even when Idenstr's local directory only
  // had a name/pubkey cache.
  if (col.type === 'profile') {
    filters.push({ kinds: [0], authors: [col.pubkey], limit: 1 });
  }

  const options = { allRelays: col.type === 'notifications' || col.type === 'mentions' };
  if (col.type === 'following') {
    options.shardFilters = true;
    options.relayReplicas = 2;
  }
  subscribe(subId, filters, col.id, options);
  if (col.type === 'notifications') startQuoteNotificationDiscovery(col, now);
}

function startQuoteNotificationDiscovery(col, now = Math.floor(Date.now() / 1000)) {
  if (!state.identity?.pubkey) return;
  const since = now - 86400 * 30;
  // Quotes use #q:<event-id>, so first learn our recent note ids. Keep this
  // subscription separate from the visible notification stream: own notes are
  // quote targets, not notification rows.
  subscribe(
    `notification_own_${col.id}`,
    [{ kinds: [1], authors: [state.identity.pubkey], since, limit: 500 }],
    col.id,
    { allRelays: true, notificationOwnNotes: true }
  );
}

function scheduleQuoteNotificationSub(col) {
  clearTimeout(col._quoteSubTimer);
  col._quoteSubTimer = setTimeout(() => refreshQuoteNotificationSub(col), 250);
}

function refreshQuoteNotificationSub(col) {
  if (!state.identity?.pubkey) return;
  const ids = [...state.ownNoteIds].slice(0, 500);
  const subId = `quotes_${col.id}`;
  unsubscribe(subId);
  if (!ids.length) return;
  const since = Math.floor(Date.now() / 1000) - 86400 * 30;
  const filters = chunkArray(ids, 100).map(chunk => ({ kinds: [1], '#q': chunk, since, limit: 120 }));
  subscribe(subId, filters, col.id, { allRelays: true, quoteNotifications: true });
}

// One consistent empty/waiting state across every column and the notifications feed.
function emptyState(text, sub = '') {
  return `<div class="column-empty">
    <div class="column-empty-icon">${iconSvg('inbox')}</div>
    <div class="column-empty-text">${esc(text)}</div>
    ${sub ? `<div class="column-empty-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

function clearFeedAfter(feedEl, after = null) {
  let node = after ? after.nextSibling : feedEl.firstChild;
  while (node) {
    const next = node.nextSibling;
    node.remove();
    node = next;
  }
}

function ensureFeedModeBar(feedEl, col, after = null) {
  if (!isFeedModeColumn(col)) return after;
  let bar = feedEl.querySelector(':scope > .timeline-filters');
  const mode = feedModeForColumn(col);
  const counts = feedModeCounts(col);
  const sig = `${mode}|${counts.top}|${counts.replies}|${counts.all}|${counts.media}|${col.type}`;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'timeline-filters';
  }
  if (bar.dataset.sig !== sig) {
    bar.dataset.sig = sig;
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', col.type === 'profile' ? 'Profile feed filter' : 'Timeline filter');
    bar.innerHTML = FEED_MODES.map((key) => `
      <button class="timeline-filter${mode === key ? ' active' : ''} ${key}" type="button" role="tab" aria-selected="${mode === key}" data-feed-mode="${key}" title="${esc(feedModeLabel(key, col))} ${counts[key] ?? 0}">
        <span class="timeline-filter-label">${esc(feedModeLabel(key, col))}</span>
        <span class="timeline-filter-count">${esc(counts[key] ?? 0)}</span>
      </button>
    `).join('');
    bar.querySelectorAll('[data-feed-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.feedMode;
        if (!FEED_MODES.includes(nextMode) || feedModeForColumn(col) === nextMode) return;
        col.feedMode = nextMode;
        saveColumns();
        renderColumnFeed(col);
        updateColumnHeaderMeta(col);
      });
    });
  }
  const ref = after ? after.nextSibling : feedEl.firstChild;
  if (ref !== bar) feedEl.insertBefore(bar, ref);
  return bar;
}

function emptyCopyForFeedMode(col) {
  const mode = feedModeForColumn(col);
  if (mode === 'replies') return ['No replies here', 'Switch to All or Notes if you want the broader timeline'];
  if (mode === 'media') return ['No media notes here', 'Image posts from this source will appear in Media'];
  if (mode === 'all') return ['No notes yet', 'Nothing from this source in the selected window'];
  return ['No notes yet', 'Original notes appear here; replies are tucked behind the Replies and All tabs'];
}

