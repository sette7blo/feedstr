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
      <button class="column-btn" data-action="reload" title="Reload ${esc(col.name)}" aria-label="Reload ${esc(col.name)}">${iconSvg('reload')}</button>
      ${col.type === 'custom' ? `<button class="column-btn" data-action="edit" title="Edit ${esc(col.name)}" aria-label="Edit ${esc(col.name)}">${iconSvg('settings')}</button>` : ''}
      <button class="column-btn" data-action="close" title="Remove ${esc(col.name)}" aria-label="Remove ${esc(col.name)}">${iconSvg('x')}</button>
    </div>
  `;
}

function wireColumnHeader(colEl, col) {
  colEl.querySelector('[data-action="reload"]')?.addEventListener('click', () => reloadColumn(col));
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

function columnVisibleEventCount(col) {
  if (col.type === 'notifications') {
    return (col.events ?? [])
      .map(normalizeNotification)
      .filter(Boolean)
      .filter(n => !isMutedNotification(n)).length;
  }
  return (col.events ?? [])
    .filter(e => e.kind === 1 && !isMuted(e)).length;
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
  if (col.type === 'home') return `${formatCount(events, 'post')} · ${relayCopy}`;
  if (col.type === 'following') return `${formatCount(state.following.length, 'follow')} · ${relayCopy}`;
  if (col.type === 'mentions') return `${formatCount(events, 'mention')} · legacy`;
  if (col.type === 'hashtag') return `#${col.tag} · ${formatCount(events, 'note')}`;
  if (col.type === 'profile') return `${shortNpub(col.pubkey)} · ${formatCount(events, 'note')}`;
  if (col.type === 'notifications') return `${formatCount(events, 'notification')} · ${relayCopy}`;
  if (col.type === 'custom') return `${formatCount((col.pubkeys ?? []).length, 'account')} · ${formatCount(events, 'note')}`;
  return relayCopy;
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
}

function updateAllColumnHeaderMeta() {
  for (const col of state.columns) updateColumnHeaderMeta(col);
}

function startColumnSub(col) {
  const subId = `col_${col.id}`;
  unsubscribe(subId);

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
      filters = [{ kinds: [1], authors: followPubkeys, since, limit: 500 }];
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

  subscribe(subId, filters, col.id, { allRelays: col.type === 'notifications' || col.type === 'mentions' });
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

function profileDisplayName(profile, pubkey) {
  return profile?.display_name || profile?.displayName || profile?.name || profile?.username || shortNpub(pubkey);
}

function profileUsername(profile, pubkey) {
  const value = profile?.name || profile?.username || '';
  const display = profileDisplayName(profile, pubkey);
  return value && value !== display ? value : '';
}

function profileInitial(profile, pubkey) {
  const name = profileDisplayName(profile, pubkey).trim();
  return (name[0] || '?').toUpperCase();
}

function profileBannerUrl(profile) {
  return profile?.banner || profile?.image || '';
}

function profileHeaderSignature(pubkey, col = null) {
  const p = state.profiles.get(pubkey) ?? {};
  return [
    pubkey,
    profileDisplayName(p, pubkey),
    profileUsername(p, pubkey),
    p.picture || '',
    profileBannerUrl(p),
    p.about || '',
    p.nip05 || '',
    p.website || '',
    p.location || '',
    zapAddressForProfile(p) || '',
    col ? columnVisibleEventCount(col) : '',
    isFollowing(pubkey) ? 'following' : 'not-following',
    isMutedProfile(pubkey) ? 'muted' : 'not-muted'
  ].join('|');
}

function ensureProfileHeader(feedEl, col) {
  const pubkey = col.pubkey;
  if (profileNeedsRefresh(pubkey)) queueProfileFetch(pubkey, { force: true });
  let hero = feedEl.querySelector(':scope > .profile-hero');
  const sig = profileHeaderSignature(pubkey, col);
  if (!hero) {
    hero = document.createElement('section');
    hero.className = 'profile-hero';
    feedEl.prepend(hero);
  }
  if (hero.dataset.sig !== sig) {
    hero.dataset.sig = sig;
    hero.innerHTML = profileHeroHtml(col);
    wireProfileHero(hero, col);
  }
  return hero;
}

function profileHeroHtml(col) {
  const pubkey = col.pubkey;
  const profile = state.profiles.get(pubkey) ?? {};
  const name = profileDisplayName(profile, pubkey);
  const username = profileUsername(profile, pubkey);
  const nprofile = encodeNprofile(pubkey);
  const zapAddress = zapAddressForProfile(profile);
  const banner = profileBannerUrl(profile);
  const picture = profile.picture || '';
  const about = profile.about || '';
  const noteCount = columnVisibleEventCount(col);
  const meta = [
    profile.nip05 ? `<span class="profile-meta-chip nip05"><span class="profile-meta-label">NIP-05</span>${esc(profile.nip05)}</span>` : '',
    profile.website ? `<a class="profile-meta-chip" href="${esc(profileWebsiteHref(profile.website))}" target="_blank" rel="noopener noreferrer">${iconSvg('globe')}${esc(prettyUrl(profile.website))}</a>` : '',
    profile.location ? `<span class="profile-meta-chip location"><span class="profile-meta-label">Location</span>${esc(profile.location)}</span>` : '',
    zapAddress ? `<span class="profile-meta-chip zap">${iconSvg('zap')}${esc(zapAddress)}</span>` : ''
  ].filter(Boolean).join('');
  return `
    <div class="profile-banner${banner ? '' : ' empty'}">${banner ? `<img src="${esc(banner)}" loading="lazy" alt="" onerror="this.closest('.profile-banner')?.classList.add('empty'); this.remove()" />` : ''}</div>
    <div class="profile-identity">
      <div class="profile-avatar-xl" aria-hidden="true">${picture ? `<img src="${esc(picture)}" data-pubkey="${esc(pubkey)}" loading="lazy" alt="${esc(name)}" onerror="handleAvatarImageError(this)" />` : `<span>${esc(profileInitial(profile, pubkey))}</span>`}</div>
      <div class="profile-actions">
        <button class="follow-toggle profile-primary-action${isFollowing(pubkey) ? ' following' : ''}" type="button" data-profile-action="follow">${isFollowing(pubkey) ? 'Following' : '+ Follow'}</button>
        <button class="follow-toggle mute-profile-toggle${isMutedProfile(pubkey) ? ' following' : ''}" type="button" data-profile-action="mute">${isMutedProfile(pubkey) ? 'Muted' : 'Mute'}</button>
      </div>
    </div>
    <div class="profile-info">
      <div class="profile-title-row">
        <div class="profile-title-copy">
          <h3>${esc(name)}</h3>
          ${username ? `<div class="profile-handle">@${esc(username)}</div>` : ''}
        </div>
        <button class="profile-npub" type="button" data-profile-action="copy-npub" title="Copy nprofile" data-nprofile="${esc(nprofile)}"><span>Copy nprofile</span><code>${esc(shortNpub(pubkey))}</code></button>
      </div>
      <div class="profile-stats" aria-label="Profile summary">
        <div class="profile-stat" data-profile-note-count><strong>${noteCount}</strong><span>${noteCount === 1 ? 'note' : 'notes'}</span></div>
        <div class="profile-stat"><strong>${isFollowing(pubkey) ? 'Following' : 'Not following'}</strong><span>relationship</span></div>
        <div class="profile-stat"><strong>${zapAddress ? 'Zap ready' : 'No zap'}</strong><span>wallet</span></div>
      </div>
      ${about ? `<p class="profile-about">${formatProfileAbout(about)}</p>` : '<p class="profile-about muted">No profile bio found yet. Feedstr will fill this in when relays return kind:0 metadata.</p>'}
      ${meta ? `<div class="profile-meta-grid">${meta}</div>` : ''}
    </div>
    <div class="profile-notes-label"><span>Notes</span><span>${formatCount(noteCount, 'visible note')}</span></div>
  `;
}

function wireProfileHero(hero, col) {
  hero.querySelector('[data-profile-action="follow"]')?.addEventListener('click', (e) => { e.stopPropagation(); toggleFollow(col); });
  hero.querySelector('[data-profile-action="mute"]')?.addEventListener('click', (e) => { e.stopPropagation(); toggleMuteProfile(col); });
  hero.querySelector('[data-profile-action="copy-npub"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(encodeNprofile(col.pubkey));
      toast('Profile copied', 'success');
    } catch {
      toast('Could not copy profile', 'error');
    }
  });
}

function formatProfileAbout(text) {
  return linkifyText(String(text ?? '')).replace(/\n/g, '<br>');
}

function prettyUrl(url) {
  try {
    const parsed = new URL(profileWebsiteHref(url));
    return parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function profileWebsiteHref(url) {
  const value = String(url ?? '').trim();
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function renderColumnFeed(col) {
  const feedEl = document.querySelector(`[data-col="${col.id}"] .column-feed`);
  if (!feedEl) return;

  if (col.thread) return renderThread(col, feedEl);
  if (col.type === 'notifications') return renderNotificationFeed(col, feedEl);

  const profileHeader = col.type === 'profile' ? ensureProfileHeader(feedEl, col) : null;
  const events = (col.events ?? [])
    .filter(e => e.kind === 1 && !isMuted(e))
    .slice(0, 500);

  if (!events.length) {
    clearFeedAfter(feedEl, profileHeader);
    const empty = document.createElement('div');
    if (profileHeader) empty.className = 'profile-notes-empty';
    empty.innerHTML = emptyState('No notes yet', 'Nothing from this source in the last 24h');
    feedEl.appendChild(empty);
    return;
  }

  const scrollTop = feedEl.scrollTop;
  const wasAtTop = scrollTop < 20;

  reconcileChildren(feedEl, events, {
    keyOf: e => e.id,
    sigOf: e => noteProfileSignature(e),
    build: e => renderNote(e),
    patch: (el, e) => updateNoteProfile(el, e),
    after: profileHeader
  });

  if (wasAtTop) feedEl.scrollTop = 0;
  else feedEl.scrollTop = scrollTop;

  // Show "N replies" on your own posts in Home.
  if (col.type === 'home') scheduleReplyCounts(col);
  // Show repost/reaction counts on every feed.
  scheduleEngagementCounts(col);
  updateColumnHeaderMeta(col);
  // Surface newly-arrived notes when the reader is scrolled away from the top.
  updateNewNotesPill(col, feedEl, events, wasAtTop);
}

// A floating "N new notes" pill: when fresh notes land while the reader is scrolled
// down, the feed doesn't yank them to the top — this pill lets them jump up on tap.
function updateNewNotesPill(col, feedEl, events, wasAtTop) {
  const colEl = feedEl.closest('.column');
  if (!colEl) return;
  const newestId = events[0]?.id;

  if (wasAtTop || !col._lastTopId) {
    col._lastTopId = newestId;
    colEl.querySelector('.new-notes-pill')?.remove();
    return;
  }

  const idx = events.findIndex(e => e.id === col._lastTopId);
  const count = idx === -1 ? events.length : idx;
  let pill = colEl.querySelector('.new-notes-pill');
  if (count <= 0) { pill?.remove(); return; }

  if (!pill) {
    pill = document.createElement('button');
    pill.className = 'new-notes-pill';
    pill.onclick = () => {
      feedEl.scrollTo({ top: 0, behavior: 'smooth' });
      col._lastTopId = newestId;
      pill.remove();
    };
    colEl.appendChild(pill);
  }
  pill.textContent = `${count} new note${count === 1 ? '' : 's'}`;

  if (!feedEl.dataset.pillBound) {
    feedEl.dataset.pillBound = '1';
    feedEl.addEventListener('scroll', () => {
      if (feedEl.scrollTop < 20) {
        colEl.querySelector('.new-notes-pill')?.remove();
        col._lastTopId = (col.events?.filter(e => e.kind === 1 && !isMuted(e))[0])?.id;
      }
    });
  }
}

function renderNotificationFeed(col, feedEl) {
  const notifications = (col.events ?? [])
    .map(normalizeNotification)
    .filter(Boolean)
    .filter(n => !isMutedNotification(n))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 500);
  const counts = notificationCounts(notifications);
  const activeFilter = col.notificationFilter || 'all';
  const visible = notifications.filter(n => activeFilter === 'all' || n.type === activeFilter);
  const rows = groupNotifications(visible);
  const scrollTop = feedEl.scrollTop;
  const wasAtTop = scrollTop < 20;

  // Keep the filter bar pinned as the first child and rebuild it in place (it
  // has no avatars, so nothing reloads) so counts and the active filter stay
  // fresh. Rows are then reconciled after it, the same as the note feed.
  let header = feedEl.querySelector(':scope > .notification-filters');
  const freshHeader = renderNotificationFilters(col, counts);
  if (header) header.replaceWith(freshHeader);
  else feedEl.prepend(freshHeader);
  header = freshHeader;

  feedEl.querySelector(':scope > .notification-empty')?.remove();

  if (!rows.length) {
    for (const row of feedEl.querySelectorAll(':scope > .notification-row')) row.remove();
    const empty = document.createElement('div');
    empty.className = 'notification-empty';
    empty.innerHTML = notifications.length
      ? emptyState('Nothing here', 'No notifications match this filter')
      : emptyState('No notifications yet', 'Replies, mentions, reposts, reactions and zaps land here');
    feedEl.appendChild(empty);
  } else {
    reconcileChildren(feedEl, rows, {
      keyOf: n => n.id,
      sigOf: n => notificationProfileSignature(n),
      build: n => renderNotificationRow(n, col),
      patch: (el, n) => updateNotificationRowProfile(el, n),
      after: header
    });
  }

  if (wasAtTop) feedEl.scrollTop = 0;
  else feedEl.scrollTop = scrollTop;
  updateColumnHeaderMeta(col);
}

function renderNotificationFilters(col, counts) {
  const wrap = document.createElement('div');
  wrap.className = 'notification-filters';
  const filters = [
    ['all', 'All'],
    ['reply', 'Replies'],
    ['mention', 'Mentions'],
    ['zap', 'Zaps'],
    ['repost', 'Reposts'],
    ['reaction', 'Reactions']
  ];
  const active = col.notificationFilter || 'all';
  for (const [key, label] of filters) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `notification-filter${active === key ? ' active' : ''} ${key}`;
    btn.title = `${label} ${counts[key] ?? 0}`;
    btn.setAttribute('aria-label', `${label} ${counts[key] ?? 0}`);
    btn.innerHTML = `
      <span class="notification-filter-icon">${notificationFilterIcon(key)}</span>
      <span class="notification-filter-label">${esc(label)}</span>
      <span class="notification-filter-count">${esc(counts[key] ?? 0)}</span>
    `;
    btn.addEventListener('click', () => {
      col.notificationFilter = key;
      saveColumns();
      renderColumnFeed(col);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function notificationFilterIcon(type) {
  if (type === 'all') return iconSvg('bell');
  if (type === 'reply') return iconSvg('reply');
  if (type === 'mention') return iconSvg('at');
  if (type === 'zap') return iconSvg('zap');
  if (type === 'repost') return iconSvg('repost');
  if (type === 'reaction') return iconSvg('heart');
  return iconSvg('bell');
}

function notificationCounts(notifications) {
  const counts = { all: notifications.length, reply: 0, mention: 0, zap: 0, repost: 0, reaction: 0 };
  for (const n of notifications) counts[n.type] = (counts[n.type] ?? 0) + 1;
  return counts;
}

function normalizeNotification(event) {
  if (!event || !state.identity?.pubkey) return null;
  const tags = event.tags ?? [];
  const mentionsMe = tags.some(tag => tag[0] === 'p' && tag[1] === state.identity.pubkey);
  if (!mentionsMe) return null;

  if (event.kind === 1) {
    const hasEventTag = tags.some(tag => tag[0] === 'e' && tag[1]);
    return {
      id: event.id,
      type: hasEventTag ? 'reply' : 'mention',
      actorPubkey: event.pubkey,
      targetEventId: firstTagValue(event, 'e'),
      createdAt: event.created_at,
      contentPreview: event.content ?? '',
      rawEvent: event
    };
  }

  if (event.kind === 7) {
    return { id: event.id, type: 'reaction', actorPubkey: event.pubkey, targetEventId: firstTagValue(event, 'e'), createdAt: event.created_at, reaction: event.content || '+', rawEvent: event };
  }

  if (event.kind === 6) {
    return { id: event.id, type: 'repost', actorPubkey: event.pubkey, targetEventId: firstTagValue(event, 'e'), createdAt: event.created_at, rawEvent: event };
  }

  if (event.kind === 9735) {
    return {
      id: event.id,
      type: 'zap',
      actorPubkey: getZapSenderPubkey(event),
      targetEventId: firstTagValue(event, 'e'),
      createdAt: event.created_at,
      amountSats: parseZapAmountSats(event),
      contentPreview: parseZapComment(event),
      rawEvent: event
    };
  }

  return null;
}

function groupNotifications(notifications) {
  const buckets = new Map();
  const rows = [];
  for (const n of notifications) {
    const canGroup = ['reaction', 'repost', 'zap'].includes(n.type) && n.targetEventId;
    if (!canGroup) {
      rows.push(n);
      continue;
    }
    const key = `${n.type}:${n.targetEventId}`;
    let group = buckets.get(key);
    if (!group) {
      group = { ...n, id: `group:${key}`, grouped: true, items: [], actors: [], totalSats: 0 };
      buckets.set(key, group);
      rows.push(group);
    }
    group.items.push(n);
    if (!group.actors.includes(n.actorPubkey)) group.actors.push(n.actorPubkey);
    group.createdAt = Math.max(group.createdAt ?? 0, n.createdAt ?? 0);
    group.actorPubkey = group.actors[0];
    if (n.amountSats) group.totalSats += n.amountSats;
    if (!group.contentPreview && n.contentPreview) group.contentPreview = n.contentPreview;
  }
  return rows.map(row => row.grouped && row.items.length === 1 ? row.items[0] : row);
}

function notificationActorName(pubkey) {
  const profile = state.profiles.get(pubkey) ?? {};
  return profile.display_name || profile.displayName || profile.name || shortNpub(pubkey);
}

function notificationActorLabel(notification) {
  if (!notification.grouped) return notificationActorName(notification.actorPubkey);
  const names = (notification.actors ?? []).map(notificationActorName);
  if (names.length <= 1) return names[0] || shortNpub(notification.actorPubkey);
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length === 3 ? '' : 's'}`;
}

function notificationProfileSignature(notification) {
  if (!notification.grouped) return actorProfileSignature(notification.actorPubkey);
  return [
    notification.id,
    notification.items?.length ?? 0,
    notification.totalSats ?? 0,
    ...(notification.actors ?? []).map(actorProfileSignature)
  ].join('|');
}

function renderNotificationRow(notification, col) {
  const profile = state.profiles.get(notification.actorPubkey) ?? {};
  const name = notificationActorLabel(notification);
  const time = relativeTime(notification.createdAt);
  const icon = notificationIcon(notification);
  const summary = notificationSummary(notification);
  const detail = notificationDetail(notification);

  const el = document.createElement('div');
  el.className = `notification-row ${notification.type}${notification.grouped ? ' grouped' : ''}`;
  el.dataset.id = notification.id;
  el.innerHTML = `
    <div class="notification-type">${icon}</div>
    ${renderAvatar(profile, notification.actorPubkey, 'notification-avatar')}
    <div class="notification-body">
      <div class="notification-line"><strong>${esc(name)}</strong> <span>${esc(summary)}</span></div>
      ${detail ? `<div class="notification-detail">${detail}</div>` : ''}
    </div>
    <div class="note-time notification-time">${esc(time)}</div>
  `;
  // Tapping the actor's avatar or name opens their profile, matching the feed;
  // tapping anywhere else on the row opens the note (handler below).
  const openActor = (event) => { event.stopPropagation(); openProfileColumn(notification.actorPubkey, notificationActorName(notification.actorPubkey)); };
  for (const sel of ['.notification-avatar', '.notification-line > strong']) {
    const target = el.querySelector(sel);
    if (target) { target.style.cursor = 'pointer'; target.addEventListener('click', openActor); }
  }

  const link = notificationLink(notification);
  if (link) {
    el.classList.add('clickable');
    el.title = notification.type === 'reply' || notification.type === 'mention'
      ? 'Open conversation' : 'Open note';
    el.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) return;
      openConversation(link.parentId, link.selectedId, col?.id);
    });
  }
  return el;
}

// Where tapping a notification takes you. Replies open the reply in its thread;
// mentions open the mentioning note itself; reactions/reposts/zaps open the note of
// yours they acted on. Returns null when there's no note to open (e.g. a profile zap).
function notificationLink(n) {
  if (n.type === 'mention') return { parentId: n.id, selectedId: n.id };
  if (n.type === 'reply' && n.targetEventId) return { parentId: n.targetEventId, selectedId: n.id };
  if (n.targetEventId) return { parentId: n.targetEventId, selectedId: n.targetEventId };
  return null;
}

function notificationIcon(notification) {
  if (notification.type === 'zap') return `${iconSvg('zap')}${notification.amountSats ? `<small>${esc(notification.amountSats)}</small>` : ''}`;
  if (notification.type === 'reply') return iconSvg('reply');
  if (notification.type === 'mention') return iconSvg('at');
  if (notification.type === 'repost') return iconSvg('repost');
  if (notification.type === 'reaction') return iconSvg('heart');
  return iconSvg('bell');
}

function notificationSummary(notification) {
  const count = notification.grouped ? notification.items.length : 1;
  if (notification.type === 'zap') {
    if (notification.grouped) return `zapped your note ${count} times`;
    return notification.targetEventId ? 'zapped your note' : 'zapped you';
  }
  if (notification.type === 'reply') return 'replied';
  if (notification.type === 'mention') return 'mentioned you';
  if (notification.type === 'reaction') return notification.grouped ? `reacted ${count} times` : 'reacted';
  if (notification.type === 'repost') return notification.grouped ? `reposted your note ${count} times` : 'reposted your note';
  return 'notified you';
}

function notificationDetail(notification) {
  if (notification.type === 'zap') {
    const pieces = [];
    const sats = notification.grouped ? notification.totalSats : notification.amountSats;
    if (sats) pieces.push(`${sats} sats${notification.grouped ? ' total' : ''}`);
    if (notification.contentPreview) pieces.push(`“${notification.contentPreview}”`);
    return pieces.map(esc).join(' · ');
  }
  if (notification.type === 'reaction') {
    if (notification.grouped) {
      const reactions = [...new Set((notification.items ?? []).map(n => n.reaction || '+'))].slice(0, 6).join(' ');
      return esc(reactions || '+');
    }
    return esc(notification.reaction || '+');
  }
  if (notification.grouped) return `${notification.items.length} events on the same note`;
  if (notification.contentPreview) return formatContent(notification.contentPreview, notification.rawEvent);
  return '';
}

// Fingerprint of a single profile as it would be displayed (name + avatar).
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
