// People search: local profile cache, exact NIP-19/pubkeys, NIP-05, and NIP-50 relay search.
const feedstrSearchBtn = document.getElementById('feedstr-search-btn');
let peopleSearchRun = 0;

feedstrSearchBtn?.addEventListener('click', () => showPeopleSearch());

document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-search-open-profile]');
  if (open) {
    const pubkey = open.dataset.searchOpenProfile;
    const result = state.peopleSearchResults?.get(pubkey);
    if (result?.profile) seedSearchProfile(pubkey, result.profile);
    closeModal();
    openProfileColumn(pubkey, result?.displayName || result?.name || shortNpub(pubkey));
    return;
  }

  const follow = e.target.closest('[data-search-follow]');
  if (follow) {
    const pubkey = follow.dataset.searchFollow;
    const result = state.peopleSearchResults?.get(pubkey);
    follow.disabled = true;
    followUser(pubkey, result?.displayName || result?.name || '', null).finally(() => renderPeopleSearchResults([...state.peopleSearchResults.values()]));
  }
});

function showPeopleSearch(initialQuery = '') {
  closeMobileMenu?.();
  const overlay = document.getElementById('add-column-modal');
  const mc = document.getElementById('modal-content');
  mc.className = 'modal people-search-modal';
  mc.innerHTML = `
    <div class="people-search-head">
      <span class="people-search-badge" aria-hidden="true">${iconSvg('search')}</span>
      <div class="people-search-title">
        <h2>Search people</h2>
        <p>Find profiles from follows, cache, NIP-05, npub, and search-capable relays.</p>
      </div>
      <button class="compose-close-btn people-search-close" type="button" id="people-search-close" aria-label="Close search">${iconSvg('x')}</button>
    </div>
    <form class="people-search-form" id="people-search-form">
      <label class="field people-search-field">
        <span>Person, npub, or NIP-05</span>
        <input id="people-search-input" type="search" placeholder="odell, walker, name@domain.com" autocomplete="off" autofocus />
      </label>
      <button class="btn btn-primary people-search-submit" type="submit">Search</button>
    </form>
    <div class="people-search-status" id="people-search-status">Search a name, NIP-05, npub, nprofile, or hex pubkey.</div>
    <div class="people-search-results" id="people-search-results"></div>
  `;
  overlay.classList.add('open');
  document.getElementById('people-search-close').onclick = closeModal;
  const input = document.getElementById('people-search-input');
  const form = document.getElementById('people-search-form');
  form.onsubmit = (e) => {
    e.preventDefault();
    runPeopleSearch(input.value);
  };
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length >= 2 || q.startsWith('npub') || q.startsWith('nprofile')) timer = setTimeout(() => runPeopleSearch(q), 450);
  });
  input.value = initialQuery;
  input.focus();
  if (initialQuery) runPeopleSearch(initialQuery);
}

async function runPeopleSearch(rawQuery) {
  const query = String(rawQuery ?? '').trim();
  const status = document.getElementById('people-search-status');
  const resultsEl = document.getElementById('people-search-results');
  const runId = ++peopleSearchRun;
  state.peopleSearchResults = new Map();
  resultsEl.innerHTML = '';
  if (!query) {
    status.textContent = 'Type a name, NIP-05, npub, nprofile, or hex pubkey.';
    return;
  }
  status.textContent = `Searching for ${query}...`;

  const results = [];
  addPeopleSearchResults(results, exactPeopleSearch(query));
  addPeopleSearchResults(results, localPeopleSearch(query));
  renderPeopleSearchResults(results);

  const tasks = [];
  if (looksLikeNip05(query)) tasks.push(resolveSearchNip05(query));
  if (query.length >= 2 && !toHexPubkey(query)) tasks.push(searchRelayProfiles(query));

  const settled = await Promise.allSettled(tasks);
  if (runId !== peopleSearchRun) return;
  for (const item of settled) {
    if (item.status === 'fulfilled') addPeopleSearchResults(results, item.value);
  }
  renderPeopleSearchResults(results);
  const relayCount = results.filter(r => r.sourceType === 'relay').length;
  status.textContent = results.length
    ? `Found ${results.length} profile${results.length === 1 ? '' : 's'}${relayCount ? `, including ${relayCount} from relay search` : ''}.`
    : 'No profiles found. Try an npub/NIP-05 or another search term; arbitrary names depend on relay NIP-50 support.';
}

function addPeopleSearchResults(results, nextResults) {
  for (const result of nextResults ?? []) {
    if (!result?.pubkey || !isHex(result.pubkey, 64)) continue;
    const existing = state.peopleSearchResults.get(result.pubkey);
    const merged = mergeSearchResult(existing, result);
    state.peopleSearchResults.set(result.pubkey, merged);
  }
  results.splice(0, results.length, ...state.peopleSearchResults.values());
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(a.displayName || a.name || '').localeCompare(String(b.displayName || b.name || '')));
}

function mergeSearchResult(existing, next) {
  if (!existing) return next;
  return {
    ...existing,
    ...next,
    profile: { ...(existing.profile ?? {}), ...(next.profile ?? {}) },
    sources: [...new Set([...(existing.sources ?? [existing.source].filter(Boolean)), ...(next.sources ?? [next.source].filter(Boolean))])],
    score: Math.max(existing.score ?? 0, next.score ?? 0)
  };
}

function exactPeopleSearch(query) {
  const pubkey = toHexPubkey(query);
  if (!pubkey) return [];
  const profile = state.profiles.get(pubkey) ?? {};
  return [normalizeSearchResult({ pubkey, profile, source: 'Exact npub/pubkey', sourceType: 'exact', score: 100 })];
}

function localPeopleSearch(query) {
  const q = query.toLowerCase();
  if (!q || toHexPubkey(query)) return [];
  const rows = [];
  for (const follow of state.following ?? []) {
    const profile = { ...(state.profiles.get(follow.pubkey) ?? {}), ...follow };
    const haystack = searchProfileText(follow.pubkey, profile);
    if (haystack.includes(q)) rows.push(normalizeSearchResult({ pubkey: follow.pubkey, profile, source: 'Your follows', sourceType: 'local', score: 80 }));
  }
  for (const [pubkey, profile] of state.profiles.entries()) {
    if (rows.some(r => r.pubkey === pubkey)) continue;
    if (searchProfileText(pubkey, profile).includes(q)) rows.push(normalizeSearchResult({ pubkey, profile, source: 'Cached profile', sourceType: 'cache', score: 55 }));
  }
  return rows.slice(0, 30);
}

async function resolveSearchNip05(address) {
  const response = await fetch(`/api/v1/nostr/nip05?address=${encodeURIComponent(address)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.pubkey) return [];
  return [normalizeSearchResult({
    pubkey: body.pubkey,
    profile: { name: body.name, nip05: body.address },
    relays: body.relays ?? [],
    source: `NIP-05 ${body.address}`,
    sourceType: 'nip05',
    score: 95
  })];
}

function looksLikeNip05(query) {
  return /^[a-z0-9_.-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(query ?? '').trim());
}

function searchRelayProfiles(query) {
  const relays = [...new Set([...(state.relays.read ?? []), ...(state.relays.write ?? []), ...profileDiscoveryRelays])]
    .filter(url => /^wss?:\/\//i.test(url))
    .slice(0, 10);
  return Promise.allSettled(relays.map(relay => searchRelayProfile(relay, query, 16, 4200)))
    .then(items => items.flatMap(item => item.status === 'fulfilled' ? item.value : []));
}

function searchRelayProfile(relay, query, limit, timeoutMs) {
  return new Promise((resolve) => {
    const rows = [];
    let ws;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { ws?.close(); } catch {}
      resolve(rows);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      ws = new WebSocket(relay);
    } catch {
      clearTimeout(timer);
      return resolve([]);
    }
    const subId = `people_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    ws.onopen = () => ws.send(JSON.stringify(['REQ', subId, { kinds: [0], search: query, limit }]));
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data[0] === 'EOSE') return finish();
        if (data[0] !== 'EVENT') return;
        const event = data[2];
        if (event?.kind !== 0 || !isHex(event.pubkey, 64)) return;
        const profile = JSON.parse(event.content || '{}');
        profile.created_at = Math.max(profile.created_at ?? 0, event.created_at ?? 0);
        rows.push(normalizeSearchResult({ pubkey: event.pubkey, profile, source: `Relay search ${relay}`, sourceType: 'relay', relay, score: 65 }));
      } catch {}
    };
    ws.onerror = finish;
    ws.onclose = finish;
  });
}

function normalizeSearchResult({ pubkey, profile = {}, source, sourceType, relay = '', relays = [], score = 0 }) {
  const displayName = profile.display_name || profile.displayName || profile.name || profile.username || '';
  return { pubkey, profile, displayName, name: profile.name || profile.username || '', nip05: profile.nip05 || '', about: profile.about || '', picture: profile.picture || '', source, sources: [source].filter(Boolean), sourceType, relay, relays, score };
}

function searchProfileText(pubkey, profile = {}) {
  return [pubkey, profile.name, profile.username, profile.display_name, profile.displayName, profile.nip05, profile.about, profile.petname]
    .filter(Boolean).join(' ').toLowerCase();
}

function seedSearchProfile(pubkey, profile) {
  if (!pubkey || !profile) return;
  const existing = state.profiles.get(pubkey) ?? {};
  state.profiles.set(pubkey, { ...existing, ...profile });
  queueProfileFetch(pubkey, { force: false });
}

function renderPeopleSearchResults(results) {
  const el = document.getElementById('people-search-results');
  if (!el) return;
  if (!results.length) {
    el.innerHTML = '<div class="people-search-empty">No results yet.</div>';
    return;
  }
  el.innerHTML = results.slice(0, 40).map(renderPeopleSearchResult).join('');
}

function renderPeopleSearchResult(result) {
  seedSearchProfile(result.pubkey, result.profile);
  const title = result.displayName || result.name || shortNpub(result.pubkey);
  const handle = result.name && result.name !== title ? `@${result.name}` : shortNpub(result.pubkey);
  const sources = result.sources?.length ? result.sources.join(' + ') : result.source;
  const following = isFollowing(result.pubkey);
  const avatar = result.picture
    ? `<img src="${esc(result.picture)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  return `
    <article class="people-result-card">
      <button class="people-result-main" type="button" data-search-open-profile="${esc(result.pubkey)}" aria-label="Open ${esc(title)} profile">
        <span class="note-avatar people-result-avatar ${following ? 'following' : ''}" data-pubkey="${esc(result.pubkey)}">${avatar}</span>
        <span class="people-result-copy">
          <strong>${esc(title)}</strong>
          <small>${esc(handle)}${result.nip05 ? ` · ${esc(result.nip05)}` : ''}</small>
          ${result.about ? `<span>${esc(result.about).slice(0, 180)}</span>` : ''}
          <em>${esc(sources || 'Profile result')}</em>
        </span>
      </button>
      <div class="people-result-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-search-open-profile="${esc(result.pubkey)}">Open profile</button>
        <button class="btn btn-primary btn-sm" type="button" data-search-follow="${esc(result.pubkey)}" ${following ? 'disabled' : ''}>${following ? 'Following' : 'Follow'}</button>
      </div>
    </article>
  `;
}
