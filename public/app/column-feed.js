// Column body: profile-column hero header, feed rendering, "N new notes" pill.
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
    col ? feedModeForColumn(col) : '',
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
    <div class="profile-notes-label"><span>${esc(feedModeLabel(feedModeForColumn(col), col))}</span><span>${formatCount(noteCount, 'visible note')}</span></div>
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
  const modeBar = ensureFeedModeBar(feedEl, col, profileHeader);
  const events = filterEventsForMode(baseFeedEvents(col), feedModeForColumn(col))
    .slice(0, RENDER_NOTE_LIMIT);

  if (!events.length) {
    clearFeedAfter(feedEl, modeBar ?? profileHeader);
    const empty = document.createElement('div');
    if (profileHeader) empty.className = 'profile-notes-empty';
    const [emptyTitle, emptySub] = emptyCopyForFeedMode(col);
    empty.innerHTML = emptyState(emptyTitle, emptySub);
    feedEl.appendChild(empty);
    updateColumnHeaderMeta(col);
    return;
  }

  const scrollTop = feedEl.scrollTop;
  const wasAtTop = scrollTop < 20;

  reconcileChildren(feedEl, events, {
    keyOf: e => e.id,
    sigOf: e => noteProfileSignature(e),
    build: e => renderNote(e),
    patch: (el, e) => updateNoteProfile(el, e),
    after: modeBar ?? profileHeader
  });

  if (wasAtTop) feedEl.scrollTop = 0;
  else feedEl.scrollTop = scrollTop;

  // Show "N replies" on visible notes. Tapping the note card opens the full
  // conversation; the reply icon stays dedicated to composing a reply.
  if (isFeedModeColumn(col)) scheduleReplyCounts(col);
  // Show repost/reaction counts only on narrow feeds. On Following, a single
  // 462-author timeline can stream hundreds of notes; asking every relay for
  // engagement on the visible set right after load creates a second heavy burst
  // that makes the tab feel jammed on mobile.
  if (col.type !== 'following') scheduleEngagementCounts(col);
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

