// -- interactions --
function setInlineReplyActive(active) {
  document.body.classList.toggle('inline-reply-active', Boolean(active));
}

function refreshInlineReplyActive() {
  setInlineReplyActive(Boolean(document.querySelector('.reply-box:focus-within')));
}

function removeReplyBox(box) {
  box?.remove();
  refreshInlineReplyActive();
}

function toggleReply(noteEl, event) {
  const parent = noteEl.parentElement;
  const escapedId = window.CSS?.escape ? CSS.escape(event.id) : event.id;
  const existing = parent?.querySelector(`:scope > .reply-box[data-reply-for="${escapedId}"]`);
  if (existing) { removeReplyBox(existing); return; }

  const actorProfile = state.profiles.get(event.pubkey) ?? {};
  const actorName = profileDisplayName(actorProfile, event.pubkey);
  const box = document.createElement('div');
  box.className = 'reply-box';
  box.dataset.replyFor = event.id;
  box.innerHTML = `
    <div class="reply-box-head">
      <div class="reply-box-title">
        ${renderAvatar(actorProfile, event.pubkey, 'reply-target-avatar')}
        <div><span>Replying to</span><strong>${esc(actorName)}</strong></div>
      </div>
      <button class="reply-close-btn" type="button" aria-label="Cancel reply">${iconSvg('x')}</button>
    </div>
    <textarea placeholder="Write a thoughtful reply..."></textarea>
    <div class="reply-helper-row"><span>Quote links and images preview before posting.</span><span class="reply-count">0</span></div>
    <div class="reply-preview compose-preview hidden" aria-label="Attachment preview"></div>
    <div class="reply-media-status compose-media-status hidden" role="status" aria-live="polite"></div>
    <div class="reply-actions">
      <input class="reply-media-input compose-media-input" type="file" accept="image/*" hidden aria-hidden="true" tabindex="-1" />
      <button class="btn btn-ghost btn-sm compose-media-btn reply-media-btn" type="button" title="Insert photo" aria-label="Insert photo from this device">
        <span class="compose-media-icon" aria-hidden="true"></span>
        <span class="compose-media-text">Photo</span>
      </button>
      <button class="btn btn-ghost btn-sm">Cancel</button>
      <button class="btn btn-primary btn-sm">Reply</button>
    </div>
  `;
  const textarea = box.querySelector('textarea');
  attachComposePreview(textarea, box.querySelector('.reply-preview'));
  const mediaInput = box.querySelector('.reply-media-input');
  const mediaBtn = box.querySelector('.reply-media-btn');
  const mediaStatus = box.querySelector('.reply-media-status');
  const closeBtn = box.querySelector('.reply-close-btn');
  const replyCount = box.querySelector('.reply-count');
  const cancelBtn = box.querySelectorAll('.reply-actions button')[1];
  const sendBtn = box.querySelectorAll('.reply-actions button')[2];
  let mediaUploadInFlight = false;
  mediaBtn.querySelector('.compose-media-icon').innerHTML = iconSvg('image');
  mediaBtn.onclick = () => {
    if (mediaUploadInFlight) return;
    mediaInput.click();
  };
  mediaInput.onchange = async () => {
    if (mediaUploadInFlight) return;
    const file = mediaInput.files?.[0];
    mediaInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setInlineMediaStatus(mediaBtn, mediaStatus, 'Images only', true);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setInlineMediaStatus(mediaBtn, mediaStatus, 'Too large', true, 'Images must be under 20 MB.');
      setTimeout(() => setInlineMediaStatus(mediaBtn, mediaStatus, 'Photo', false, ''), 2600);
      return;
    }
    mediaUploadInFlight = true;
    mediaBtn.disabled = true;
    mediaInput.disabled = true;
    updateReplyState();
    setInlineMediaStatus(mediaBtn, mediaStatus, 'Uploading...', false, 'Uploading image to nostr.build...');
    try {
      const url = await uploadComposeMedia(file);
      appendMediaUrlToTextarea(textarea, url);
      setInlineMediaStatus(mediaBtn, mediaStatus, 'Added', false, `Uploaded: ${url}`, url);
      setTimeout(() => setInlineMediaStatus(mediaBtn, mediaStatus, 'Photo', false, ''), 1500);
    } catch (err) {
      console.error('Reply media upload failed:', err);
      setInlineMediaStatus(mediaBtn, mediaStatus, 'Failed', true, err.message || 'Upload failed');
      setTimeout(() => setInlineMediaStatus(mediaBtn, mediaStatus, 'Photo', false, ''), 2200);
    } finally {
      mediaUploadInFlight = false;
      mediaBtn.disabled = false;
      mediaInput.disabled = false;
      updateReplyState();
    }
  };
  const updateReplyState = () => {
    const length = textarea.value.trim().length;
    sendBtn.disabled = mediaUploadInFlight || !length;
    if (replyCount) {
      replyCount.textContent = `${length}`;
      replyCount.classList.toggle('active', length > 0);
    }
  };
  textarea.addEventListener('input', updateReplyState);
  closeBtn.onclick = () => removeReplyBox(box);
  cancelBtn.onclick = () => removeReplyBox(box);
  updateReplyState();
  sendBtn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    try {
      await publishEvent(1, text, [
        ['e', event.id, '', 'root'],
        ['p', event.pubkey]
      ]);
      removeReplyBox(box);
    } catch (err) {
      sendBtn.textContent = 'Failed';
      setTimeout(() => { sendBtn.textContent = 'Reply'; sendBtn.disabled = false; }, 2000);
    }
  };
  noteEl.after(box);
  box.addEventListener('focusin', () => setInlineReplyActive(true));
  box.addEventListener('focusout', () => setTimeout(refreshInlineReplyActive, 0));
  box.addEventListener('pointerdown', () => setInlineReplyActive(true));
  textarea.focus();
}

async function doRepost(event) {
  try {
    await publishEvent(6, JSON.stringify(event), [
      ['e', event.id, ''],
      ['p', event.pubkey]
    ]);
    toast('Reposted', 'success');
  } catch (err) {
    console.error('Repost failed:', err);
    toast('Repost failed', 'error');
  }
}

function showBoostMenu(event) {
  const mc = document.getElementById('modal-content');
  mc.className = 'modal boost-modal';
  mc.innerHTML = `
    <h2>Boost note</h2>
    <button class="modal-option boost-option" type="button" data-boost-action="repost">
      ${iconSvg('repost')}
      <div class="modal-option-text"><strong>Repost</strong><span>Share this note as a Nostr repost.</span></div>
    </button>
    <button class="modal-option boost-option" type="button" data-boost-action="quote">
      ${iconSvg('pen')}
      <div class="modal-option-text"><strong>Quote note</strong><span>Open the composer with this note attached.</span></div>
    </button>
    <div class="modal-actions boost-actions">
      <button class="btn btn-ghost" type="button" id="boost-cancel">Cancel</button>
    </div>
  `;
  mc.querySelector('[data-boost-action="repost"]').onclick = async () => {
    closeModal();
    await doRepost(event);
  };
  mc.querySelector('[data-boost-action="quote"]').onclick = () => {
    closeModal();
    quoteNote(event);
  };
  mc.querySelector('#boost-cancel').onclick = () => closeModal();
  modal.classList.add('boost-sheet');
  modal.classList.add('open');
  requestAnimationFrame(() => mc.querySelector('[data-boost-action="repost"]')?.focus());
}

function showNoteMoreMenu(event) {
  const mc = document.getElementById('modal-content');
  mc.className = 'modal note-more-modal';
  mc.innerHTML = `
    <h2>Note actions</h2>
    <button class="modal-option note-more-option" type="button" data-note-action="mute-thread">
      ${iconSvg('volume-x')}
      <div class="modal-option-text"><strong>Mute thread</strong><span>Hide this conversation across feeds and notifications.</span></div>
    </button>
    <button class="modal-option note-more-option" type="button" data-note-action="raw-json">
      <span class="raw-option-icon" aria-hidden="true">{}</span>
      <div class="modal-option-text"><strong>Raw event JSON</strong><span>Inspect and copy the original Nostr event.</span></div>
    </button>
    <div class="modal-actions note-more-actions">
      <button class="btn btn-ghost" type="button" id="note-more-cancel">Cancel</button>
    </div>
  `;
  mc.querySelector('[data-note-action="mute-thread"]').onclick = () => {
    closeModal();
    muteThread(event);
  };
  mc.querySelector('[data-note-action="raw-json"]').onclick = () => {
    closeModal();
    showRawEventModal(event);
  };
  mc.querySelector('#note-more-cancel').onclick = () => closeModal();
  modal.classList.add('note-more-sheet');
  modal.classList.add('open');
  requestAnimationFrame(() => mc.querySelector('[data-note-action="mute-thread"]')?.focus());
}

function showRawEventModal(event) {
  const mc = document.getElementById('modal-content');
  const pretty = JSON.stringify(event, null, 2);
  mc.className = 'modal raw-event-modal';
  mc.innerHTML = `
    <div class="raw-event-head">
      <div>
        <div class="section-label">Raw event</div>
        <h2>JSON</h2>
      </div>
      <span class="raw-kind-pill">kind:${esc(String(event?.kind ?? '?'))}</span>
    </div>
    <div class="raw-event-meta">
      <span title="Event ID">${esc(shortNpub(event?.id))}</span>
      <span title="Author pubkey">${esc(shortNpub(event?.pubkey))}</span>
      <span>${esc(relativeTime(event?.created_at))}</span>
    </div>
    <pre class="raw-json-viewer" id="raw-json-viewer" tabindex="0"></pre>
    <div class="modal-actions raw-event-actions">
      <button class="btn btn-ghost" type="button" id="raw-copy-json">Copy JSON</button>
      <button class="btn btn-ghost" type="button" id="raw-copy-id">Copy event ID</button>
      <button class="btn btn-primary" type="button" id="raw-close">Close</button>
    </div>
  `;
  mc.querySelector('#raw-json-viewer').textContent = pretty;
  mc.querySelector('#raw-copy-json').onclick = () => copyRawEventText(pretty, 'JSON copied');
  mc.querySelector('#raw-copy-id').onclick = () => copyRawEventText(event?.id ?? '', 'Event ID copied');
  mc.querySelector('#raw-close').onclick = () => closeModal();
  modal.classList.add('raw-event-sheet');
  modal.classList.add('open');
  requestAnimationFrame(() => mc.querySelector('#raw-json-viewer')?.focus());
}

async function copyRawEventText(text, successMessage) {
  if (!text) {
    toast('Nothing to copy', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(successMessage, 'success');
  } catch (err) {
    console.error('Copy failed:', err);
    toast('Could not copy', 'error');
  }
}

// Quote-repost: open the composer prefilled with a nostr: reference to the note.
// mentionTagsFromContent turns that reference into a NIP-18 `q` tag on publish.
function quoteNote(event) {
  openCompose();
  const relays = eventRelayHints(event.id);
  const ref = `nostr:${relays.length ? encodeNevent(event.id, relays) : encodeNote(event.id)}`;
  composeText.value = composeText.value.trim() ? `${composeText.value}\n\n${ref}` : `\n\n${ref}`;
  composeText.dispatchEvent(new Event('input'));
  composeText.focus();
  composeText.setSelectionRange(0, 0);
}

// Relay hints for nevent references. The private relay is excluded: its URL is
// a LAN address that must never leak into published notes and is unreachable
// for anyone else anyway.
function eventRelayHints(eventId) {
  return [...(state.eventRelays.get(eventId) ?? [])]
    .filter(url => url && url !== state.config?.privateRelayUrl)
    .slice(0, 3);
}

// Bolt button: a short tap one-tap zaps the saved default; a deliberate
// long-press (touch or mouse held) or right-click opens the custom modal.
function attachZapButton(button, event) {
  let timer = null;
  let longFired = false;
  const LONG_MS = 700;
  const startHold = () => {
    longFired = false;
    timer = setTimeout(() => { longFired = true; timer = null; showZapModal(event); }, LONG_MS);
  };
  const cancelHold = () => { if (timer) { clearTimeout(timer); timer = null; } };
  button.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; startHold(); });
  button.addEventListener('pointerup', cancelHold);
  button.addEventListener('pointerleave', cancelHold);
  button.addEventListener('pointercancel', cancelHold);
  button.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelHold(); longFired = true; showZapModal(event); });
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (longFired) { longFired = false; return; } // the hold already opened the modal
    quickZap(event, button);
  });
}

// Shared zap core used by both one-tap and the modal, so they validate and pay
// identically. Resolves with Idenstr's pay result, or throws a readable error.
async function zapNote({ event, amountSats, comment = '', zapAddress }) {
  const lnurl = zapAddress || zapAddressForProfile(state.profiles.get(event.pubkey) ?? {});
  if (!lnurl) throw new Error('recipient has no zap address in kind:0 metadata');
  if (!Number.isFinite(amountSats) || amountSats < 1) throw new Error('amount must be at least 1 sat');
  return api('/api/v1/idenstr/zaps/pay', {
    method: 'POST',
    body: {
      pubkey: event.pubkey,
      eventId: event.id,
      amountSats,
      comment,
      lnurl,
      relays: [...new Set([...(state.relays.write ?? []), ...(state.relays.read ?? [])])]
    }
  });
}

async function quickZap(event, button) {
  if (button.dataset.zapping === '1') return;
  const amountSats = Number(state.zapDefaultSats) || 100;
  let zapAddress = zapAddressForProfile(state.profiles.get(event.pubkey) ?? {});
  button.dataset.zapping = '1';
  button.style.opacity = '0.5';
  try {
    if (!zapAddress) {
      // Short taps should stay one-tap on mobile: refresh the recipient kind:0
      // metadata in-place instead of opening the custom amount/comment modal.
      queueProfileFetch(event.pubkey, { needZap: true, force: true });
      toast('Checking profile for zap address…', 'info');
      zapAddress = await waitForZapAddress(event.pubkey, 3500);
    }
    const result = await zapNote({ event, amountSats, zapAddress });
    flashZapButtonForEvent(event.id);
    toast(`Zapped ${result.amountSats ?? amountSats} sats`, 'success');
    scheduleZapWalletRefresh();
  } catch (err) {
    toast(`Zap failed: ${err.message}`, 'error');
  } finally {
    button.dataset.zapping = '0';
    button.style.opacity = '';
  }
}

function waitForZapAddress(pubkey, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const zapAddress = zapAddressForProfile(state.profiles.get(pubkey) ?? {});
      if (zapAddress) return resolve(zapAddress);
      if (Date.now() - started >= timeoutMs) return reject(new Error('recipient has no zap address in kind:0 yet; hold the bolt for custom zap details'));
      setTimeout(tick, 150);
    };
    tick();
  });
}

function flashZapButtonForEvent(eventId) {
  if (!eventId) return;
  const escapedId = window.CSS?.escape ? CSS.escape(eventId) : eventId;
  document.querySelectorAll(`.note[data-id="${escapedId}"] [data-action="zap"]`).forEach((button) => {
    button.classList.remove('zapped');
    // Restart the animation when the same visible note is zapped more than once.
    void button.offsetWidth;
    button.classList.add('zapped');
    clearTimeout(button._zapFlashTimer);
    button._zapFlashTimer = setTimeout(() => button.classList.remove('zapped'), 1400);
  });
}

function showZapModal(event) {
  const profile = state.profiles.get(event.pubkey) ?? {};
  const name = profile.display_name || profile.displayName || profile.name || shortNpub(event.pubkey);
  const zapAddress = zapAddressForProfile(profile);
  if (!zapAddress) queueProfileFetch(event.pubkey, { needZap: true, force: true });
  const mc = document.getElementById('modal-content');
  mc.innerHTML = `
    <h2>Zap ${esc(name)}</h2>
    <p class="modal-help">Send a NIP-57 zap through Idenstr's connected NWC wallet. Feedstr never sees the wallet secret.</p>
    <form id="zap-form" class="zap-form" data-zap-pubkey="${esc(event.pubkey)}" data-zap-event-id="${esc(event.id)}">
      <label class="form-row">
        <span>Amount</span>
        <div class="zap-amounts" role="group" aria-label="Zap amount">
          ${[...new Set([21, 100, 500, 1000, state.zapDefaultSats])].sort((a, b) => a - b).map((amount) => `<button type="button" class="zap-preset${amount === state.zapDefaultSats ? ' selected' : ''}" data-amount="${amount}">${amount}</button>`).join('')}
        </div>
        <input name="amount" inputmode="numeric" pattern="[0-9]*" value="${state.zapDefaultSats}" aria-label="Custom zap amount in sats" />
      </label>
      <label class="form-row">
        <span>Comment</span>
        <textarea name="comment" maxlength="500" placeholder="optional zap note"></textarea>
      </label>
      <div class="terminal-mini ${zapAddress ? '' : 'running'}" id="zap-status">${zapAddress ? `$ feedstr zap\nrecipient: ${esc(zapAddress)}\nready: choose amount and send` : '$ feedstr zap\nstatus: checking profile for zap address…'}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-zap-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary" ${zapAddress ? '' : 'disabled'}>${iconSvg('zap')} Send zap</button>
      </div>
    </form>
  `;
  modal.classList.add('open');
  const form = mc.querySelector('#zap-form');
  const amountInput = form.elements.amount;
  for (const preset of mc.querySelectorAll('.zap-preset')) {
    preset.addEventListener('click', () => {
      mc.querySelectorAll('.zap-preset').forEach(btn => btn.classList.remove('selected'));
      preset.classList.add('selected');
      amountInput.value = preset.dataset.amount;
    });
  }
  amountInput.addEventListener('input', () => mc.querySelectorAll('.zap-preset').forEach(btn => btn.classList.toggle('selected', btn.dataset.amount === amountInput.value.trim())));
  mc.querySelector('[data-zap-cancel]')?.addEventListener('click', closeModal);
  form.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    await sendZap(event, form, zapAddress);
  });
}

const ZAP_ADDRESS_FIELD_NAMES = [
  'lud16', 'lud06',
  'lightning_address', 'lightningAddress', 'lightning', 'lightningAddressUrl',
  'lnurl', 'lnurlp', 'lnurlPay', 'lnurlpay', 'lnurl_pay',
  'zap', 'zapAddress', 'zap_address'
];
const ZAP_ADDRESS_FIELD_RE = /^(lud16|lud06|lightning[_-]?address|lightning|lnurlp?|lnurl[_-]?pay|zap[_-]?address|zap)$/i;

function zapAddressForProfile(profile = {}) {
  for (const field of ZAP_ADDRESS_FIELD_NAMES) {
    const address = normalizeZapAddress(profile?.[field]);
    if (address) return address;
  }
  return findNestedZapAddress(profile);
}

function findNestedZapAddress(value, depth = 0) {
  if (!value || depth > 2 || typeof value !== 'object') return '';
  for (const [key, child] of Object.entries(value)) {
    if (!ZAP_ADDRESS_FIELD_RE.test(key)) continue;
    const direct = normalizeZapAddress(child);
    if (direct) return direct;
    const nested = findNestedZapAddress(child, depth + 1);
    if (nested) return nested;
  }
  return '';
}

function normalizeZapAddress(value) {
  if (typeof value !== 'string') return '';
  let raw = value.trim();
  if (!raw) return '';
  raw = raw.replace(/^lightning:/i, '').trim();
  if (/^lnurl[0-9a-z]+$/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw;
  return '';
}

function updateOpenZapModal(pubkey) {
  const form = document.getElementById('zap-form');
  if (!form || form.dataset.zapPubkey !== pubkey) return;
  const zapAddress = zapAddressForProfile(state.profiles.get(pubkey) ?? {});
  const status = document.getElementById('zap-status');
  const submit = form.querySelector('button[type="submit"]');
  if (!status || !submit) return;
  if (zapAddress) {
    status.className = 'terminal-mini';
    status.textContent = `$ feedstr zap\nrecipient: ${zapAddress}\nready: choose amount and send`;
    submit.disabled = false;
  } else {
    status.className = 'terminal-mini warn';
    status.textContent = '$ feedstr zap\nrecipient profile loaded, but no zap address was found in known kind:0 fields.';
  }
}

async function sendZap(event, form, zapAddress) {
  const submit = form.querySelector('button[type="submit"]');
  const cancel = form.querySelector('[data-zap-cancel]');
  const status = form.querySelector('#zap-status');
  const resolvedZapAddress = zapAddress || zapAddressForProfile(state.profiles.get(event.pubkey) ?? {});
  const amountSats = Number(form.elements.amount.value);
  if (!Number.isFinite(amountSats) || amountSats < 1) {
    status.className = 'terminal-mini error';
    status.textContent = '$ feedstr zap\nerror: enter an amount of at least 1 sat';
    return;
  }
  if (!resolvedZapAddress) {
    status.className = 'terminal-mini warn';
    status.textContent = '$ feedstr zap\nerror: still waiting for a zap address from the recipient profile';
    queueProfileFetch(event.pubkey, { needZap: true, force: true });
    return;
  }
  submit.disabled = true;
  status.className = 'terminal-mini';
  status.textContent = `$ feedstr zap\namount: ${amountSats} sats\nstatus: requesting invoice + paying via Idenstr...`;
  try {
    const result = await zapNote({ event, amountSats, comment: form.elements.comment.value.trim(), zapAddress: resolvedZapAddress });
    status.className = 'terminal-mini ok';
    status.textContent = `$ feedstr zap\nok: paid ${result.amountSats ?? amountSats} sats${result.feesPaid != null ? `\nfee: ${result.feesPaid} msat` : ''}${result.preimage ? `\npreimage: ${result.preimage.slice(0, 16)}…` : ''}`;
    flashZapButtonForEvent(event.id);
    toast(`Zapped ${amountSats} sats`, 'success');
    scheduleZapWalletRefresh();
    // The zap is done — drop the dead "Send zap" button and turn the only
    // remaining action into a clear Close.
    submit.remove();
    if (cancel) cancel.textContent = 'Close';
  } catch (err) {
    status.className = 'terminal-mini error';
    status.textContent = `$ feedstr zap\nerror: ${err.message}`;
    toast('Zap failed', 'error');
    submit.disabled = false;
  }
}

async function doLike(event, btn) {
  // Already liked -> undo by deleting our reaction (NIP-09 kind:5).
  if (state.liked.has(event.id)) {
    const reactionId = state.likeEvents.get(event.id);
    btn.classList.remove('liked');
    state.liked.delete(event.id);
    state.likeEvents.delete(event.id);
    persistLiked();
    if (!reactionId) { toast('Like removed', 'success'); return; }
    try {
      await publishEvent(5, '', [['e', reactionId]]);
      toast('Like removed', 'success');
    } catch (err) {
      console.error('Unlike failed:', err);
      toast('Could not remove like', 'error');
    }
    return;
  }
  // Optimistic like.
  btn.classList.add('liked');
  state.liked.add(event.id);
  persistLiked();
  try {
    const { event: reaction } = await publishEvent(7, '+', [
      ['e', event.id],
      ['p', event.pubkey]
    ]);
    if (reaction?.id) state.likeEvents.set(event.id, reaction.id);
  } catch (err) {
    btn.classList.remove('liked');
    state.liked.delete(event.id);
    persistLiked();
    console.error('Like failed:', err);
    toast('Like failed', 'error');
  }
}

async function publishEvent(kind, content, tags = []) {
  const createdAt = Math.floor(Date.now() / 1000);
  const { event } = await api('/api/v1/idenstr/sign', {
    method: 'POST',
    body: { kind, created_at: createdAt, content, tags }
  });
  const results = await publishSignedEvent(event);
  return { event, results };
}

function publishSignedEvent(event) {
  const writeRelays = new Set(state.relays.write ?? []);
  if (state.config?.privateRelayUrl) writeRelays.delete(state.config.privateRelayUrl);
  const targets = [...writeRelays]
    .map(url => state.sockets.get(url))
    .filter(ws => ws?.readyState === WebSocket.OPEN);
  if (!targets.length) throw new Error('No configured write relays are connected. Idenstr signed and vaulted the event, but Feedstr could not broadcast it.');
  return Promise.all(targets.map(ws => publishToRelay(ws, event)));
}

function publishToRelay(ws, event) {
  const relay = [...state.sockets.entries()].find(([, socket]) => socket === ws)?.[0] ?? 'relay';
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ relay, accepted: false, message: 'timeout' });
    }, 5000);
    const handler = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data[0] !== 'OK' || data[1] !== event.id) return;
        cleanup();
        resolve({ relay, accepted: Boolean(data[2]), message: data[3] ?? '' });
      } catch {}
    };
    function cleanup() {
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
    }
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify(['EVENT', event]));
  });
}
