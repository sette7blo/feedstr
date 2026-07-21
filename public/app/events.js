// -- event handling --
function handleEvent(subId, event, relayUrl = '') {
  if (!event || !event.id) return;
  rememberEventRelay(event.id, relayUrl);

  // private-relay backfill of your own kind:7 reactions — record liked note ids
  // without caching the reaction events themselves.
  const backfillSub = state.subs.get(subId);
  if (backfillSub?.likedBackfill) {
    const likedId = firstTagValue(event, 'e');
    if (likedId) {
      if (!state.liked.has(likedId)) {
        state.liked.add(likedId);
        backfillSub._found = (backfillSub._found ?? 0) + 1;
      }
      state.likeEvents.set(likedId, event.id); // remember reaction id so it can be un-liked
    }
    return;
  }

  // reply-count subscription: tally toward tracked notes, don't add to a column.
  if (backfillSub?.replyCount) {
    registerReplyEvent(event);
    return;
  }

  // engagement-count subscription: tally reposts (kind:6) and reactions (kind:7).
  if (backfillSub?.engagementCount) {
    registerEngagementEvent(event);
    return;
  }

  // thread-replies subscription: cache the reply so the open thread can show it.
  if (backfillSub?.threadReplies) {
    if (event.kind === 1) {
      state.notes.set(event.id, event);
      const actor = getEventActorPubkey(event);
      if (profileNeedsRefresh(actor)) queueProfileFetch(actor);
      const col = state.columns.find(c => c.id === backfillSub.columnId);
      if (col?.thread) scheduleThreadRerender(col);
    }
    return;
  }

  // cache note
  if (event.kind === 1 || event.kind === 6 || event.kind === 7 || event.kind === 9735) {
    const wasMissing = !state.notes.has(event.id);
    state.notes.set(event.id, event);
    if (wasMissing) scheduleRerenderAllColumns();
  }

  // cache profile
  if (event.kind === 0) {
    const existing = state.profiles.get(event.pubkey);
    let changed = false;
    if (!existing || event.created_at > (existing.created_at ?? 0)) {
      try {
        const profile = JSON.parse(event.content);
        const next = { ...profile, created_at: event.created_at };
        changed = profileDisplayChanged(existing, next);
        state.profiles.set(event.pubkey, next);
        // Profile is now complete — stop tracking retries for it so these guard
        // sets stay bounded to pubkeys we're still chasing.
        if (next.picture) {
          state.profileFetchAttempts.delete(event.pubkey);
          state.profileFetchTried.delete(event.pubkey);
        }
      } catch {}
    }
    if (changed) {
      updateOpenZapModal(event.pubkey);
      rerenderColumnsForAuthor(event.pubkey);
      rerenderColumnsForReferencedProfile(event.pubkey);
    }
    return;
  }

  // route to column
  const sub = state.subs.get(subId);
  if (!sub) return;
  const col = state.columns.find(c => c.id === sub.columnId);
  if (!col) return;

  if (!col.events) col.events = [];
  if (!col._ids) col._ids = new Set(col.events.map(e => e.id));
  if (col._ids.has(event.id)) return;
  col._ids.add(event.id);
  // Keep the array sorted-desc by created_at with O(log n) placement instead of a
  // full re-sort on every event; trim the oldest past the 500 cap.
  insertEventSorted(col.events, event);
  if (col.events.length > 500) {
    for (const e of col.events.splice(500)) col._ids.delete(e.id);
  }

  // queue profile fetch for visible actors whose cache is missing or lacks an avatar.
  // Idenstr's following directory can provide names without pictures, so presence
  // in state.profiles is not enough for mention/notification avatars.
  const actorPubkey = getEventActorPubkey(event);
  if (profileNeedsRefresh(actorPubkey)) queueProfileFetch(actorPubkey);

  // Don't repaint while a thread is open over this column — it would reset the
  // reader's scroll. The cached events are still stored for when they go back.
  if (!col.thread) scheduleRenderColumnFeed(col);
  scheduleCacheColumn(col);
}

function rememberEventRelay(eventId, relayUrl) {
  if (!eventId || !relayUrl) return;
  let relays = state.eventRelays.get(eventId);
  if (!relays) {
    relays = new Set();
    state.eventRelays.set(eventId, relays);
  }
  relays.add(relayUrl);
}

function handleEose(subId, relayUrl = '') {
  const sub = state.subs.get(subId);
  if (!sub) return;
  if (sub.likedBackfill) {
    unsubscribe(subId);
    if (sub._found) {
      persistLiked();
      scheduleRerenderAllColumns();
    }
    return;
  }
  if (sub.oneshot) {
    if (sub.expectedEoses > 1) {
      if (!sub._eoseRelays) sub._eoseRelays = new Set();
      sub._eoseRelays.add(relayUrl || `unknown-${sub._eoseRelays.size}`);
      if (sub._eoseRelays.size < sub.expectedEoses) return;
    }
    clearTimeout(sub._closeTimer);
    unsubscribe(subId);
    if (sub.embedded) {
      scheduleRerenderAllColumns();
    }
    for (const col of state.columns) {
      if (col.type === 'mentions' || col.type === 'notifications') renderColumnFeed(col);
    }
    return;
  }
}
