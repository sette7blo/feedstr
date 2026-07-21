// -- boot --
async function boot() {
  try {
    state.config = await api('/api/v1/config');
    requiredIdenstrScopes = state.config.requiredIdenstrScopes ?? requiredIdenstrScopes;
    state.idenstrStatus = await api('/api/v1/idenstr/status');
    renderIdenstrSummary();
    renderZapWalletSummary();

    if (!state.config.idenstrTokenConfigured) {
      setStatus(false, 'Idenstr token missing');
      showIdenstrSettings('Feedstr needs an Idenstr-issued token before it can load feeds or publish.');
      return;
    }
    if (state.idenstrStatus.missingScopes?.length) {
      setStatus(false, 'Idenstr token missing scopes');
      showIdenstrSettings(`Token is missing: ${state.idenstrStatus.missingScopes.join(', ')}`);
      return;
    }

    const [identity, relays, directoryResponse, mutesResponse] = await Promise.all([
      api('/api/v1/idenstr/identity'),
      api('/api/v1/idenstr/relays'),
      api('/api/v1/idenstr/following/directory'),
      api('/api/v1/idenstr/mutes').catch(() => null)
    ]);
    const directory = Array.isArray(directoryResponse) ? directoryResponse : (directoryResponse.entries ?? directoryResponse.following ?? []);
    state.identity = identity;
    const privateRelayUrl = state.config.privateRelayUrl || '';
    state.relays.read = relays.read ?? [];
    state.relays.write = relays.write ?? [];
    if (privateRelayUrl) state.relays.read = [privateRelayUrl, ...state.relays.read];
    state.following = directory.map(e => ({
      pubkey: e.pubkey,
      npub: '',
      petname: e.petname ?? '',
      name: e.name ?? e.petname ?? '',
      picture: e.picture ?? ''
    }));
    refreshFollowingSet();

    // Seed profile cache from Idenstr's directory. Keep the full profile payload
    // when available so zap fields such as lud16/lud06/lightningAddress are not
    // discarded before Feedstr's own kind:0 refresh runs.
    for (const e of directory) {
      if (e.pubkey) {
        const profile = e.profile ?? {};
        state.profiles.set(e.pubkey, {
          ...profile,
          name: profile.name ?? e.name ?? '',
          display_name: profile.display_name ?? profile.displayName ?? e.name ?? '',
          picture: profile.picture ?? e.picture ?? '',
          created_at: profile.created_at ?? e.profileEvent?.created_at ?? 0
        });
      }
    }

    buildComposeMentionIndex();
    renderComposeMentionPicker();

    setStatus(true, `${state.relays.read.length} relays · ${state.following.length} follows`);

    // load saved columns from Feedstr's DB, migrating any older localStorage copy
    state.columns = await loadColumns();
    state.liked = await loadLiked();
    state.zapDefaultSats = await loadZapDefault();
    state.mutes = normalizeMutes(mutesResponse || await loadMutes());
    refreshMuteSets();
    loadZapWalletCached();
    renderColumns();
    for (const col of state.columns) hydrateColumnCache(col);
    connectRelays();
  } catch (err) {
    setStatus(false, 'Failed to connect to Idenstr');
    renderIdenstrSummary(err);
    state.zapWallet = { loading: false, configured: false, balanceMsat: null, balanceAt: null, error: err.message };
    renderZapWalletSummary();
    showIdenstrSettings(err.message);
    console.error('Boot failed:', err);
  }
}

// -- api helper --
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body.detail || body.message || body.error || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

// Drives the single sidebar connection chip. The full URL/token/scope detail
// lives in the settings modal the chip opens; here we show just the state.
function renderIdenstrSummary(error = null) {
  const chip = document.getElementById('idenstr-settings-btn');
  const el = document.getElementById('idenstr-summary');
  const cfg = state.config;
  const status = state.idenstrStatus;
  let stateClass = 'warn';
  let text = 'Checking Idenstr…';
  if (error) {
    stateClass = 'error';
    text = 'Idenstr unreachable';
  } else if (!cfg) {
    stateClass = 'warn';
    text = 'Idenstr not checked';
  } else if (status?.ok) {
    stateClass = 'ok';
    text = 'Idenstr connected';
  } else {
    stateClass = 'warn';
    text = cfg.idenstrTokenConfigured ? 'Idenstr setup needed' : 'Idenstr token missing';
  }
  if (chip) chip.className = `connection-chip ${stateClass}`;
  el.innerHTML = `<span class="connection-dot"></span><span class="connection-chip-text">${esc(text)}</span>`;
}

function renderZapWalletSummary() {
  const statusEl = document.getElementById('zap-wallet-chip');
  const chip = document.getElementById('zap-settings-btn');
  if (!statusEl || !chip) return;
  const wallet = state.zapWallet || {};
  let stateClass = 'warn';
  let value = 'checking balance…';
  if (wallet.loading) {
    stateClass = 'running';
  } else if (wallet.error) {
    stateClass = 'error';
    value = 'wallet unavailable';
  } else if (!wallet.configured) {
    stateClass = 'warn';
    value = 'connect NWC in Idenstr';
  } else if (Number.isFinite(wallet.balanceMsat)) {
    stateClass = wallet.balanceMsat > 0 ? 'ok' : 'warn';
    value = `${formatWalletSats(wallet.balanceMsat)}${wallet.balanceAt ? ` · ${walletRelativeTime(wallet.balanceAt)}` : ''}`;
  } else {
    stateClass = 'warn';
    value = 'balance unknown';
  }
  chip.className = `connection-chip zap-settings-chip ${stateClass}`;
  statusEl.querySelector('.connection-chip-text').textContent = value;
  // Keep the zap-settings modal terminal in sync without re-rendering the
  // whole modal (which would wipe the default-amount input mid-edit).
  const term = document.getElementById('zap-wallet-terminal');
  if (term) {
    term.className = `terminal-mini ${wallet.error ? 'bad' : (wallet.configured ? 'ok' : 'warn')}`;
    term.textContent = `$ feedstr zap-wallet\n${zapWalletSummaryText()}`;
  }
  const orb = document.getElementById('zap-wallet-orb');
  if (orb) {
    orb.className = `status-orb ${wallet.configured ? 'ok' : 'warn'}`;
    orb.textContent = wallet.configured ? 'ready' : 'setup';
  }
}

let zapWalletRefreshTimer = null;
// Coalesce bursts of zaps into a single live NWC balance check.
function scheduleZapWalletRefresh() {
  clearTimeout(zapWalletRefreshTimer);
  zapWalletRefreshTimer = setTimeout(() => { zapWalletRefreshTimer = null; refreshZapWalletBalance(); }, 4000);
}

// Boot path: read Idenstr's cached wallet state (db-only, no NWC round-trip).
// The live balance check runs only on demand — opening zap settings, the
// Refresh button, or after a zap.
async function loadZapWalletCached() {
  try {
    state.zapWallet = { ...(await api('/api/v1/idenstr/zaps/wallet')), loading: false };
  } catch (err) {
    state.zapWallet = { loading: false, configured: false, balanceMsat: null, balanceAt: null, error: err.message };
  }
  renderZapWalletSummary();
}

async function refreshZapWalletBalance() {
  state.zapWallet = { ...(state.zapWallet || {}), loading: true, error: '' };
  renderZapWalletSummary();
  try {
    state.zapWallet = await api('/api/v1/idenstr/zaps/wallet/balance', { method: 'POST' });
  } catch (err) {
    // Live balance failed — fall back to Idenstr's cached wallet state so an
    // unconfigured wallet reads "connect NWC" and a cached balance stays
    // visible. Only surface the error when even the cached read fails.
    try {
      state.zapWallet = await api('/api/v1/idenstr/zaps/wallet');
    } catch {
      state.zapWallet = { ...(state.zapWallet || {}), error: err.message };
    }
  } finally {
    state.zapWallet.loading = false;
    renderZapWalletSummary();
  }
}

function formatWalletSats(msat) {
  const sats = Math.floor(Number(msat) / 1000);
  if (!Number.isFinite(sats)) return 'balance unknown';
  if (sats >= 1000000) return `${Number((sats / 1000000).toFixed(2))}M sats`;
  if (sats >= 1000) return `${Number((sats / 1000).toFixed(sats >= 10000 ? 0 : 1))}k sats`;
  return `${sats} sats`;
}

function walletRelativeTime(value) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return 'cached';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function zapWalletSummaryText() {
  const wallet = state.zapWallet || {};
  if (wallet.loading) return 'checking balance…';
  if (wallet.error) return `wallet unavailable: ${wallet.error}`;
  if (!wallet.configured) return 'NWC is not connected in Idenstr yet.';
  if (Number.isFinite(wallet.balanceMsat)) return `${formatWalletSats(wallet.balanceMsat)}${wallet.balanceAt ? ` · ${walletRelativeTime(wallet.balanceAt)}` : ''}`;
  return 'balance unknown';
}

function handleZapDefaultSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('zap-default-input');
  const status = document.getElementById('zap-default-status');
  const amount = Math.round(Number(input.value.trim()));
  status.classList.remove('hidden');
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    status.className = 'terminal-mini error';
    status.textContent = '$ feedstr zap\nerror: enter a whole number of sats between 1 and 100000';
    return;
  }
  state.zapDefaultSats = amount;
  input.value = String(amount);
  persistZapDefault();
  status.className = 'terminal-mini ok';
  status.textContent = `$ feedstr zap\nsaved: one tap now sends ${amount} sats`;
}

function showZapSettings() {
  const mc = document.getElementById('modal-content');
  mc.innerHTML = `
    <div class="connection-head">
      <div>
        <div class="section-label">Zap settings</div>
        <h2>Zap wallet</h2>
        <p class="settings-copy">Set the default one-tap zap amount. Hold a note's lightning bolt, or right-click it, when you want a custom amount and comment.</p>
      </div>
      <span id="zap-wallet-orb" class="status-orb ${state.zapWallet?.configured ? 'ok' : 'warn'}">${state.zapWallet?.configured ? 'ready' : 'setup'}</span>
    </div>

    <div class="connection-section">
      <div class="subsection-head">
        <span>Wallet</span>
        <button class="btn btn-ghost btn-mini" type="button" id="zap-wallet-refresh">Refresh</button>
      </div>
      <div id="zap-wallet-terminal" class="terminal-mini ${state.zapWallet?.error ? 'bad' : (state.zapWallet?.configured ? 'ok' : 'warn')}">$ feedstr zap-wallet\n${esc(zapWalletSummaryText())}</div>
    </div>

    <div class="connection-section">
      <div class="subsection-head"><span>Default zap</span><small>one-tap amount</small></div>
      <form id="zap-default-form" class="relay-input-row">
        <input id="zap-default-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(String(state.zapDefaultSats ?? 100))}" aria-label="Default zap amount in sats" />
        <button class="btn btn-ghost" type="submit">Save</button>
      </form>
      <p class="settings-copy">Short tap sends this many sats immediately through Idenstr's wallet.</p>
      <div id="zap-default-status" class="terminal-mini hidden"></div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" id="zap-settings-close">Close</button>
    </div>
  `;
  document.getElementById('zap-settings-close').onclick = closeModal;
  document.getElementById('zap-default-form')?.addEventListener('submit', handleZapDefaultSubmit);
  document.getElementById('zap-wallet-refresh')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setButtonState(btn, 'busy', 'Refreshing...');
    await refreshZapWalletBalance();
    setButtonState(btn, 'reset');
  });
  modal.classList.add('open');
}

function showIdenstrSettings(reason = '') {
  const cfg = state.config || {};
  const status = state.idenstrStatus || {};
  const required = cfg.requiredIdenstrScopes || requiredIdenstrScopes;
  const granted = status.grantedScopes || [];
  const missing = status.missingScopes || required;
  const privateRelay = cfg.privateRelayUrl || '';
  const linked = Boolean(status.ok && cfg.idenstrTokenConfigured && !missing.length);
  const tokenLabel = cfg.idenstrTokenConfigured ? 'configured' : 'missing';
  const mc = document.getElementById('modal-content');
  const relayOk = Boolean(privateRelay);
  const tokenOk = Boolean(cfg.idenstrTokenConfigured);
  const scopesOk = !missing.length;
  const apiOk = Boolean(cfg.idenstrUrl) && Boolean(status.ok);
  const flag = (ok, okText, warnText) =>
    `<span class="stack-flag ${ok ? 'ok' : 'warn'}">${ok ? okText : warnText}</span>`;
  mc.innerHTML = `
    <div class="connection-head">
      <div>
        <div class="section-label">Settings</div>
        <h2>Feedstr</h2>
        <p class="settings-copy">Feedstr keeps no nsec. It stores only Idenstr's URL, a scoped token, and the relay address you set, then asks Idenstr for signing.</p>
      </div>
      <span class="status-orb ${linked ? 'ok' : 'warn'}">${linked ? 'linked' : 'setup'}</span>
    </div>
    ${reason ? `<div class="terminal-mini ${linked ? 'ok' : 'warn'}">$ feedstr stack check\n${esc(reason)}</div>` : ''}

    <div class="connection-section">
      <div class="subsection-head">
        <span>Stack connection</span>
        <button class="btn btn-ghost btn-mini" type="button" id="settings-recheck">Recheck</button>
      </div>
      <div class="stack-summary">
        <div class="stack-row">
          <span class="stack-row-label">Idenstr</span>
          <span class="stack-row-value"><strong>${esc(cfg.idenstrUrl || 'not configured')}</strong>${flag(apiOk, 'reachable', cfg.idenstrUrl ? 'no response' : 'not set')}</span>
        </div>
        <div class="stack-row">
          <span class="stack-row-label">Private relay</span>
          <span class="stack-row-value"><strong>${esc(privateRelay || 'not set')}</strong>${flag(relayOk, 'set', 'not set')}</span>
        </div>
        <div class="stack-row">
          <span class="stack-row-label">Scoped token</span>
          <span class="stack-row-value"><strong>${esc(tokenLabel)}</strong>${flag(tokenOk, 'present', 'missing')}</span>
        </div>
        <div class="stack-row">
          <span class="stack-row-label">Token scopes</span>
          <span class="stack-row-value"><strong>${scopesOk ? 'all granted' : `${missing.length} missing`}</strong>${flag(scopesOk, 'ok', 'incomplete')}</span>
        </div>
      </div>

      <details class="setup-details" id="edit-connection"${linked ? '' : ' open'}>
        <summary>Edit connection</summary>
        <form id="idenstr-config-form" class="settings-form">
          <div class="form-grid settings-form-grid">
            <label>
              Idenstr URL
              <input name="idenstrUrl" type="url" placeholder="http://100.x.y.z:3000" value="${esc(cfg.idenstrUrl || '')}" required />
            </label>
            <label>
              Idenstr token
              <input name="idenstrToken" type="password" autocomplete="off" placeholder="Paste new idstr_ token, or leave blank" />
              <small>Current token: ${cfg.idenstrTokenConfigured ? 'configured' : 'missing'}.</small>
            </label>
          </div>
          <label class="relay-field">
            Private relay
            <div class="relay-input-row">
              <input name="privateRelayUrl" type="text" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="ws://192.168.x.x:7777" value="${esc(cfg.privateRelayUrl || '')}" />
              <button class="btn btn-ghost relay-test-btn" type="button" id="relay-test-btn">Test</button>
            </div>
            <small>Idenstr's private relay (LAN or Tailscale address). Saved to <code>FEEDSTR_PRIVATE_RELAY_URL</code>. Test checks it from this browser, exactly how the feed reads it.</small>
          </label>
          <div id="relay-test-status" class="terminal-mini hidden"></div>

          <div class="scope-detail">
            <div class="subsection-head"><span>Required token scopes</span><small>${missing.length ? `${missing.length} missing` : 'all granted'}</small></div>
            <div class="scope-list">
              ${required.map(scope => `<span class="scope ${missing.includes(scope) ? 'missing' : 'ok'}">${esc(scope)}</span>`).join('')}
            </div>
            ${granted.length ? `<div class="terminal-mini ok">$ idenstr token scopes\n${esc(granted.join('\n'))}</div>` : ''}
          </div>

          <details class="setup-details setup-steps-details">
            <summary>How to create the token</summary>
            <ol class="setup-steps">
              <li>Open Idenstr and go to the API tokens section.</li>
              <li>Create a token named <code>feedstr</code>.</li>
              <li>Select: <code>${esc(required.join(', '))}</code>.</li>
              <li>Paste the token above and save; Idenstr only shows it once.</li>
            </ol>
          </details>

          <div class="modal-actions">
            <button class="btn btn-primary" type="submit" id="settings-save">Save link</button>
          </div>
          <div id="settings-save-status" class="terminal-mini hidden"></div>
        </form>
      </details>
    </div>

    <div class="connection-section">
      <div class="subsection-head"><span>Muted keywords</span><small>${muteEntriesByType('keyword').length} active</small></div>
      <p class="settings-copy">Notes containing any of these words are hidden from every feed.</p>
      <form id="mute-add-form" class="relay-input-row">
        <input id="mute-input" type="text" placeholder="word or phrase" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <button class="btn btn-ghost" type="submit">Mute</button>
      </form>
      <div class="mute-list" id="mute-list"></div>
    </div>

    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" id="settings-close">Close</button>
    </div>
  `;
  document.getElementById('settings-close').onclick = closeModal;
  document.getElementById('settings-recheck').onclick = recheckIdenstrSettings;
  document.getElementById('relay-test-btn').onclick = testRelayConnection;
  document.getElementById('idenstr-config-form').addEventListener('submit', saveIdenstrSettings);

  renderMuteList();
  document.getElementById('mute-add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('mute-input');
    const term = input.value.trim().toLowerCase();
    input.value = '';
    if (!term || muteEntriesByType('keyword').some(entry => entry.value === term)) return;
    muteKeyword(term);
  });
  document.getElementById('mute-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.mute-remove');
    if (!btn) return;
    unmuteKeyword(btn.dataset.mute);
  });

  modal.classList.add('open');
}

function renderMuteList() {
  const list = document.getElementById('mute-list');
  if (!list) return;
  const keywords = muteEntriesByType('keyword');
  list.innerHTML = keywords.length
    ? keywords.map(m => `<span class="mute-chip">${esc(m.value)}<button type="button" class="mute-remove" data-mute="${esc(m.value)}" aria-label="Unmute ${esc(m.value)}">&times;</button></span>`).join('')
    : '<span class="settings-copy">No muted keywords.</span>';
  const count = list.closest('.connection-section')?.querySelector('.subsection-head small');
  if (count) count.textContent = `${keywords.length} active`;
}

async function recheckIdenstrSettings() {
  const button = document.getElementById('settings-recheck');
  setButtonState(button, 'busy', 'Checking...');
  try {
    state.config = await api('/api/v1/config');
    state.idenstrStatus = await api('/api/v1/idenstr/status');
    renderIdenstrSummary();
    showIdenstrSettings(state.idenstrStatus.ok ? 'Connection is healthy.' : 'Connection still needs attention.');
  } finally {
    setButtonState(button, 'idle');
  }
}

async function saveIdenstrSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById('settings-save');
  const status = document.getElementById('settings-save-status');
  const payload = {
    idenstrUrl: form.elements.idenstrUrl.value.trim(),
    privateRelayUrl: form.elements.privateRelayUrl.value.trim()
  };
  const token = form.elements.idenstrToken.value.trim();
  if (token) payload.idenstrToken = token;
  status.className = 'terminal-mini running';
  status.textContent = '$ feedstr save-link\nwriting .env...';
  setButtonState(button, 'busy', 'Saving...');
  try {
    await api('/api/v1/config', { method: 'PUT', body: payload });
    state.config = await api('/api/v1/config');
    state.idenstrStatus = await api('/api/v1/idenstr/status');
    renderIdenstrSummary();
    status.className = 'terminal-mini ok';
    status.textContent = '$ feedstr save-link\nok: saved link + private relay';
    setButtonState(button, 'done', 'Saved');
    setTimeout(() => setButtonState(button, 'idle'), 1200);
  } catch (err) {
    status.className = 'terminal-mini bad';
    status.textContent = `$ feedstr save-link\nerror: ${err.message}`;
    setButtonState(button, 'idle');
  }
}

async function testRelayConnection() {
  const form = document.getElementById('idenstr-config-form');
  const button = document.getElementById('relay-test-btn');
  const out = document.getElementById('relay-test-status');
  const url = form.elements.privateRelayUrl.value.trim();
  if (!url) return showRelayTest(out, 'warn', '$ feedstr relay-test\nenter a ws:// relay URL first');
  if (!/^wss?:\/\//i.test(url)) return showRelayTest(out, 'bad', '$ feedstr relay-test\nURL must start with ws:// or wss://');

  setButtonState(button, 'busy', 'Testing...');
  showRelayTest(out, 'running', `$ feedstr relay-test\nconnecting to ${url} ...`);
  const result = await probeRelay(url, 6000);
  if (result.ok) {
    const nostr = result.nostrMs != null
      ? `\nrelay answered REQ in ${result.nostrMs}ms — speaks Nostr`
      : '\nsocket open, but no EOSE within timeout (reachable, response unconfirmed)';
    showRelayTest(out, 'ok', `$ feedstr relay-test\nconnected in ${result.openMs}ms${nostr}`);
    setButtonState(button, 'done', 'Reachable');
    setTimeout(() => setButtonState(button, 'idle'), 1600);
  } else {
    showRelayTest(out, 'bad', `$ feedstr relay-test\nfailed: ${result.error}`);
    setButtonState(button, 'idle');
  }
}

// Probe the relay the same way the feed does: open a WebSocket from this browser,
// then send a tiny REQ and wait for EOSE/EVENT to confirm it speaks Nostr.
function probeRelay(url, timeoutMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    let openMs = null;
    let settled = false;
    let ws;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws && ws.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => {
      done(openMs != null ? { ok: true, openMs, nostrMs: null } : { ok: false, error: 'timed out — relay not reachable from this browser (check address, port, and that you are on the same LAN/Tailnet)' });
    }, timeoutMs);
    try { ws = new WebSocket(url); } catch (err) { return done({ ok: false, error: err.message }); }
    ws.onopen = () => {
      openMs = Math.round(performance.now() - start);
      try { ws.send(JSON.stringify(['REQ', 'feedstr-relay-test', { kinds: [1], limit: 1 }])); } catch {}
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data[0] === 'EOSE' || data[0] === 'EVENT') {
          try { ws.send(JSON.stringify(['CLOSE', 'feedstr-relay-test'])); } catch {}
          done({ ok: true, openMs, nostrMs: Math.round(performance.now() - start) });
        }
      } catch {}
    };
    ws.onerror = () => done(openMs != null ? { ok: true, openMs, nostrMs: null } : { ok: false, error: 'connection failed — address unreachable or port closed' });
    ws.onclose = () => done(openMs != null ? { ok: true, openMs, nostrMs: null } : { ok: false, error: 'closed before opening — unreachable or wrong port' });
  });
}

function showRelayTest(el, cls, text) {
  if (!el) return;
  el.className = `terminal-mini ${cls}`;
  el.classList.remove('hidden');
  el.textContent = text;
}

function setButtonState(button, stateName, text) {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.classList.remove('busy', 'done');
  button.disabled = false;
  if (stateName === 'busy') {
    button.classList.add('busy');
    button.disabled = true;
    if (text) button.textContent = text;
  } else if (stateName === 'done') {
    button.classList.add('done');
    if (text) button.textContent = text;
  } else {
    button.textContent = button.dataset.originalText;
  }
}
