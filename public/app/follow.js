// Follow/unfollow via Idenstr (kind:3 is Idenstr-owned; Feedstr never signs it)
// and the openProfileColumn / openHashtagColumn entry points.
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

