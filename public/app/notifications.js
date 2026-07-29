// Notifications column: normalizing, grouping, filters, rows.
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
    ['quote', 'Quotes'],
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
  if (type === 'quote') return iconSvg('repost');
  if (type === 'zap') return iconSvg('zap');
  if (type === 'repost') return iconSvg('repost');
  if (type === 'reaction') return iconSvg('heart');
  return iconSvg('bell');
}

function notificationCounts(notifications) {
  const counts = { all: notifications.length, reply: 0, mention: 0, quote: 0, zap: 0, repost: 0, reaction: 0 };
  for (const n of notifications) counts[n.type] = (counts[n.type] ?? 0) + 1;
  return counts;
}

function normalizeNotification(event) {
  if (!event || !state.identity?.pubkey) return null;
  const tags = event.tags ?? [];
  const quotedOwnNoteId = quotedOwnNoteTarget(event);
  if (event.kind === 1 && quotedOwnNoteId && event.pubkey !== state.identity.pubkey) {
    return {
      id: event.id,
      type: 'quote',
      actorPubkey: event.pubkey,
      targetEventId: quotedOwnNoteId,
      createdAt: event.created_at,
      contentPreview: event.content ?? '',
      rawEvent: event
    };
  }
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

function quotedOwnNoteTarget(event) {
  if (!event || event.kind !== 1) return '';
  for (const tag of event.tags ?? []) {
    if (tag[0] !== 'q' || !tag[1]) continue;
    if (state.ownNoteIds?.has(tag[1]) || tag[3] === state.identity?.pubkey) return tag[1];
  }
  return '';
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
  if (n.type === 'quote') return { parentId: n.id, selectedId: n.id };
  if (n.type === 'reply' && n.targetEventId) return { parentId: n.targetEventId, selectedId: n.id };
  if (n.targetEventId) return { parentId: n.targetEventId, selectedId: n.targetEventId };
  return null;
}

function notificationIcon(notification) {
  if (notification.type === 'zap') return `${iconSvg('zap')}${notification.amountSats ? `<small>${esc(notification.amountSats)}</small>` : ''}`;
  if (notification.type === 'reply') return iconSvg('reply');
  if (notification.type === 'mention') return iconSvg('at');
  if (notification.type === 'quote') return iconSvg('repost');
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
  if (notification.type === 'quote') return 'quoted your note';
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
