// -- compose --
const composeText = document.getElementById('compose-text');
const composeSend = document.getElementById('compose-send');
const composeMediaInput = document.getElementById('compose-media-input');
const composeMediaBtn = document.getElementById('compose-media-btn');
const composeScheduleBtn = document.getElementById('compose-schedule-btn');
const composeMediaStatus = document.getElementById('compose-media-status');
const composePreview = document.getElementById('compose-preview');
const composeIdentity = document.getElementById('compose-identity');
const composeCount = document.getElementById('compose-count');
const composeMentionSuggest = document.getElementById('compose-mention-suggest');
const scheduleModal = document.getElementById('schedule-modal');
const scheduleCloseBtn = document.getElementById('schedule-close-btn');
const scheduleCancelBtn = document.getElementById('schedule-cancel');
const scheduleForm = document.getElementById('schedule-form');
const scheduleDatetime = document.getElementById('schedule-datetime');
const scheduleStatus = document.getElementById('schedule-status');
const scheduleList = document.getElementById('schedule-list');
const scheduleRefreshBtn = document.getElementById('schedule-refresh');
const scheduleTimezone = document.getElementById('schedule-timezone');
const composeMentionState = { open: false, query: '', start: -1, end: -1, selected: 0, matches: [] };
let composeMediaUploadInFlight = false;
composeMediaBtn.querySelector('.compose-media-icon').innerHTML = iconSvg('image');
composeScheduleBtn.querySelector('.compose-schedule-icon').innerHTML = iconSvg('clock');
scheduleCloseBtn.innerHTML = iconSvg('x');

// -- compose modal (opened from the sidebar button or the mobile FAB) --
const composeModal = document.getElementById('compose-modal');
const composeOpenBtn = document.getElementById('compose-open-btn');
const composeFab = document.getElementById('compose-fab');
const composeCloseBtn = document.getElementById('compose-close-btn');
composeOpenBtn.querySelector('.compose-open-icon').innerHTML = iconSvg('pen');
composeFab.querySelector('.compose-fab-icon').innerHTML = iconSvg('pen');
composeCloseBtn.innerHTML = iconSvg('x');

function openCompose() {
  closeMobileMenu();
  renderComposeIdentity();
  updateComposeSendState();
  composeModal.classList.add('open');
  // Let the modal paint before focusing so iOS reliably raises the keyboard.
  requestAnimationFrame(() => composeText.focus());
}

function closeCompose() {
  composeModal.classList.remove('open');
  hideComposeMentionSuggestions();
}

function openScheduleModal() {
  const raw = composeText.value.trim();
  if (!raw) {
    showComposeMediaMessage('Write the note before scheduling it.', true);
    return;
  }
  const timezone = browserTimezone();
  scheduleTimezone.textContent = `Uses your local timezone: ${timezone}`;
  scheduleDatetime.min = localDatetimeValue(addMinutes(new Date(), 1));
  if (!scheduleDatetime.value || Date.parse(scheduleDatetime.value) <= Date.now()) {
    scheduleDatetime.value = localDatetimeValue(addMinutes(new Date(), 15));
  }
  setScheduleStatus('', false);
  scheduleModal.classList.add('open');
  refreshScheduledPosts();
  requestAnimationFrame(() => scheduleDatetime.focus());
}

function closeScheduleModal() {
  scheduleModal.classList.remove('open');
}

composeOpenBtn.onclick = openCompose;
composeFab.onclick = openCompose;
composeCloseBtn.onclick = closeCompose;
composeModal.onclick = (e) => { if (e.target === composeModal) closeCompose(); };
composeScheduleBtn.onclick = openScheduleModal;
scheduleCloseBtn.onclick = closeScheduleModal;
scheduleCancelBtn.onclick = closeScheduleModal;
scheduleModal.onclick = (e) => { if (e.target === scheduleModal) closeScheduleModal(); };
scheduleRefreshBtn.onclick = refreshScheduledPosts;
scheduleForm.addEventListener('submit', handleScheduleSubmit);
// Cmd/Ctrl+Enter posts from anywhere in the textarea.
composeText.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !composeSend.disabled) {
    e.preventDefault();
    composeSend.click();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (scheduleModal.classList.contains('open')) {
    closeScheduleModal();
    return;
  }
  // Let Escape close the mention popover first; only then the compose modal.
  if (composeModal.classList.contains('open')) {
    if (!composeMentionState.open) closeCompose();
    return;
  }
  // Otherwise close the add-column / settings modal if it's open.
  if (modal.classList.contains('open')) closeModal();
});

// Relative timestamps go stale ("5m" forever); re-stamp every minute. Piggyback
// the periodic memory prune on the same tick.
setInterval(() => {
  document.querySelectorAll('.note-time[data-ts]').forEach(el => {
    el.textContent = relativeTime(Number(el.dataset.ts));
  });
  pruneMemory();
}, 60000);

composeText.addEventListener('input', () => {
  updateComposeSendState();
  syncComposeMentions();
  updateComposeMentionSuggestions();
});
attachComposePreview(composeText, composePreview);
composeText.addEventListener('click', updateComposeMentionSuggestions);
composeText.addEventListener('keydown', handleComposeMentionKeydown);
composeText.addEventListener('blur', () => setTimeout(hideComposeMentionSuggestions, 120));
composeMediaBtn.addEventListener('click', () => {
  if (composeMediaUploadInFlight) return;
  composeMediaInput.click();
});
composeMediaInput.addEventListener('change', handleComposeMediaChange);

function updateComposeSendState() {
  const length = composeText.value.trim().length;
  composeSend.disabled = composeMediaUploadInFlight || !length;
  if (composeCount) {
    composeCount.textContent = `${length}`;
    composeCount.classList.toggle('active', length > 0);
  }
}

function renderComposeIdentity() {
  if (!composeIdentity) return;
  const pubkey = state.identity?.pubkey;
  const profile = pubkey ? (state.profiles.get(pubkey) ?? state.identity ?? {}) : {};
  const name = pubkey ? mentionDisplayName(pubkey, profile) : 'Unknown identity';
  const avatarHost = composeIdentity.querySelector('.compose-identity-avatar');
  const strong = composeIdentity.querySelector('strong');
  const small = composeIdentity.querySelector('small');
  if (avatarHost) {
    avatarHost.outerHTML = pubkey
      ? renderAvatar(profile, pubkey, 'compose-identity-avatar')
      : '<div class="note-avatar compose-identity-avatar"></div>';
  }
  if (strong) strong.textContent = name;
  if (small) small.textContent = pubkey ? shortNpub(pubkey) : 'Connect Idenstr to post';
}

async function handleComposeMediaChange() {
  if (composeMediaUploadInFlight) return;
  const file = composeMediaInput.files?.[0];
  composeMediaInput.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setComposeMediaStatus('Images only', true);
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setComposeMediaStatus('Too large', true);
    setTimeout(() => setComposeMediaStatus('Photo', false), 2600);
    return;
  }
  composeMediaUploadInFlight = true;
  composeMediaBtn.disabled = true;
  composeMediaInput.disabled = true;
  updateComposeSendState();
  setComposeMediaStatus('Uploading...', false);
  showComposeMediaMessage('Uploading image to nostr.build...', false);
  try {
    const url = await uploadComposeMedia(file);
    appendComposeMediaUrl(url);
    composeText.dispatchEvent(new Event('input'));
    setComposeMediaStatus('Added', false);
    showComposeMediaMessage(`Uploaded: ${url}`, false, url);
    setTimeout(() => setComposeMediaStatus('Photo', false), 1500);
  } catch (err) {
    console.error('Media upload failed:', err);
    setComposeMediaStatus('Failed', true);
    showComposeMediaMessage(err.message || 'Upload failed', true);
    setTimeout(() => setComposeMediaStatus('Photo', false), 2200);
  } finally {
    composeMediaUploadInFlight = false;
    composeMediaBtn.disabled = false;
    composeMediaInput.disabled = false;
    updateComposeSendState();
  }
}

async function uploadComposeMedia(file) {
  const form = new FormData();
  form.append('file', file, file.name || 'feedstr-image.jpg');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  let res;
  try {
    res = await fetch('/api/v1/media/upload', { method: 'POST', body: form, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Upload timed out. Try a smaller image or a different file.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(body?.message || body?.error || `${res.status} ${res.statusText}`);
  const url = body?.url || body?.urls?.[0];
  if (!url) throw new Error('Upload finished without a media URL');
  return url;
}

function appendComposeMediaUrl(url) {
  appendMediaUrlToTextarea(composeText, url);
}

function setComposeMediaStatus(label, failed) {
  composeMediaBtn.classList.toggle('error', Boolean(failed));
  composeMediaBtn.querySelector('.compose-media-text').textContent = label;
}

// Live preview under a composer textarea: shows attached images and quoted-note
// cards as they will render in the published note. extractNostrRefs queues the
// relay fetch for quoted notes that are not cached yet, so the preview polls a
// few rounds to swap "Looking across relays..." for the resolved card.
function attachComposePreview(textarea, container) {
  let timer = null;
  let polls = 0;
  const render = () => {
    timer = null;
    const raw = String(textarea.value ?? '');
    const eventRefs = extractNostrRefs(raw).filter(ref => ref.kind === 'event');
    const images = extractUrls(raw).filter(isImageUrl);
    if (!eventRefs.length && !images.length) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    const imageHtml = images.length
      ? `<div class="note-media-grid">${images.map(renderImagePreview).join('')}</div>`
      : '';
    container.innerHTML = `${imageHtml}${renderNostrEventPreviews(eventRefs)}`;
    container.classList.remove('hidden');
    if (eventRefs.some(ref => !state.notes.has(ref.eventId)) && polls < 12 && container.isConnected) {
      polls += 1;
      schedule(900);
    }
  };
  const schedule = (delay = 200) => {
    if (timer) return;
    timer = setTimeout(render, delay);
  };
  textarea.addEventListener('input', () => { polls = 0; schedule(); });
  // The preview is informational: quote cards must not trigger the nostr:
  // protocol handler. Images keep their target=_blank so they can be inspected.
  container.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && !link.target) e.preventDefault();
  });
}

function appendMediaUrlToTextarea(textarea, url) {
  const before = textarea.value;
  try {
    insertAtCursor(textarea, url);
  } catch (err) {
    const spacer = before.trim() ? '\n' : '';
    textarea.value = `${before}${spacer}${url}`;
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function setInlineMediaStatus(button, statusEl, label, failed, message = '', url = '') {
  button.classList.toggle('error', Boolean(failed));
  button.querySelector('.compose-media-text').textContent = label;
  if (!statusEl) return;
  statusEl.classList.toggle('hidden', !message);
  statusEl.classList.toggle('error', Boolean(failed));
  statusEl.innerHTML = url
    ? `<span>${esc(message.replace(url, '').trim())}</span> <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`
    : esc(message);
}

function showComposeMediaMessage(message, failed, url = '') {
  if (!composeMediaStatus) return;
  composeMediaStatus.classList.toggle('hidden', !message);
  composeMediaStatus.classList.toggle('error', Boolean(failed));
  composeMediaStatus.innerHTML = url
    ? `<span>${esc(message.replace(url, '').trim())}</span> <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`
    : esc(message);
}

function renderComposeMentionPicker() {
  // Kept as the boot-time hook: suggestions are rendered on demand from state.following.
  hideComposeMentionSuggestions();
}

function buildComposeMentionIndex() {
  state.composeMentionIndex = state.following
    .filter(f => f.pubkey)
    .map(f => {
      const label = mentionDisplayName(f.pubkey, f);
      const search = `${label} ${f.petname ?? ''} ${f.name ?? ''} ${f.pubkey}`.toLowerCase();
      return { pubkey: f.pubkey, label, petname: f.petname ?? '', picture: f.picture ?? '', search };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getComposeMentionTrigger() {
  const cursor = composeText.selectionStart ?? composeText.value.length;
  const before = composeText.value.slice(0, cursor);
  const match = before.match(/(^|\s)@([\p{L}\p{N}_.-]*)$/u);
  if (!match) return null;
  const atIndex = cursor - match[2].length - 1;
  return { start: atIndex, end: cursor, query: match[2] };
}

function updateComposeMentionSuggestions() {
  const trigger = getComposeMentionTrigger();
  if (!trigger) return hideComposeMentionSuggestions();
  const query = trigger.query.toLowerCase();
  const follows = state.composeMentionIndex
    .filter(f => !query || f.search.includes(query))
    .slice(0, 8);
  composeMentionState.open = true;
  composeMentionState.query = trigger.query;
  composeMentionState.start = trigger.start;
  composeMentionState.end = trigger.end;
  composeMentionState.selected = Math.min(composeMentionState.selected, Math.max(0, follows.length - 1));
  composeMentionState.matches = follows;
  renderComposeMentionSuggestions();
}

function renderComposeMentionSuggestions() {
  if (!composeMentionSuggest) return;
  if (!composeMentionState.open) return hideComposeMentionSuggestions();
  const matches = composeMentionState.matches;
  composeMentionSuggest.classList.remove('hidden');
  composeMentionSuggest.innerHTML = matches.length
    ? matches.map((follow, index) => renderComposeMentionOption(follow, index)).join('')
    : '<div class="mention-suggest-empty">No matching follows</div>';
  composeMentionSuggest.querySelectorAll('.mention-suggest-option').forEach((button, index) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => selectComposeMention(index));
  });
}

function renderComposeMentionOption(follow, index) {
  const profile = state.profiles.get(follow.pubkey) ?? follow;
  const active = index === composeMentionState.selected;
  const label = follow.label;
  const secondary = follow.petname && follow.petname !== label ? follow.petname : shortNpub(follow.pubkey);
  return `
    <button class="mention-suggest-option${active ? ' active' : ''}" type="button" role="option" aria-selected="${active}" data-index="${index}">
      ${renderAvatar(profile, follow.pubkey, 'mention-suggest-avatar')}
      <span><strong>${esc(label)}</strong><small>${esc(secondary)}</small></span>
    </button>
  `;
}

function handleComposeMentionKeydown(event) {
  if (!composeMentionState.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    hideComposeMentionSuggestions();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = composeMentionState.matches.length;
    if (!count) return;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    composeMentionState.selected = (composeMentionState.selected + delta + count) % count;
    renderComposeMentionSuggestions();
    return;
  }
  if ((event.key === 'Enter' || event.key === 'Tab') && composeMentionState.matches.length) {
    event.preventDefault();
    selectComposeMention(composeMentionState.selected);
  }
}

function selectComposeMention(index = 0) {
  const follow = composeMentionState.matches[index];
  if (!follow) return;
  // Insert a readable @Name (not a raw nostr:nprofile blob) and remember the
  // pubkey behind it. The token is resolved to a nostr:nprofile ref + p-tag only
  // at publish time, so the writer always sees a clean name.
  const label = mentionDisplayName(follow.pubkey, follow);
  const token = mentionToken(label);
  replaceComposeRange(composeMentionState.start, composeMentionState.end, `${token} `);
  if (!state.composeMentions.some(m => m.pubkey === follow.pubkey)) {
    const profile = state.profiles.get(follow.pubkey) ?? follow;
    state.composeMentions.push({ token, pubkey: follow.pubkey, label, profile });
  }
  renderComposeTags();
  hideComposeMentionSuggestions();
  composeText.focus();
  composeText.dispatchEvent(new Event('input'));
}

// A mention reads as "@Display Name" in the box; we track the pubkey separately
// so spaces in names are fine.
function mentionToken(label) {
  return `@${label}`;
}

// Keep the tag chips in sync with what is actually written: drop any tracked
// mention whose @token the user has edited or deleted out of the text.
function syncComposeMentions() {
  const text = composeText.value;
  state.composeMentions = state.composeMentions.filter(m => text.includes(m.token));
  renderComposeTags();
}

function renderComposeTags() {
  const wrap = document.getElementById('compose-tags');
  if (!wrap) return;
  const mentions = state.composeMentions;
  if (!mentions.length) {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    return;
  }
  wrap.classList.remove('hidden');
  wrap.innerHTML = `<span class="compose-tags-label">Tagging</span>` + mentions.map((m, i) => `
    <span class="compose-tag" data-index="${i}">
      ${renderAvatar(state.profiles.get(m.pubkey) ?? m.profile, m.pubkey, 'compose-tag-avatar')}
      <span class="compose-tag-name">${esc(m.label)}</span>
      <button class="compose-tag-remove" type="button" data-index="${i}" title="Remove" aria-label="Remove ${esc(m.label)}">${iconSvg('x')}</button>
    </span>`).join('');
  wrap.querySelectorAll('.compose-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => removeComposeMention(Number(btn.dataset.index)));
  });
}

function removeComposeMention(index) {
  const mention = state.composeMentions[index];
  if (!mention) return;
  state.composeMentions.splice(index, 1);
  // Strip the @token (and a trailing space) from the text so the box matches.
  composeText.value = composeText.value.replace(`${mention.token} `, '').replace(mention.token, '');
  composeSend.disabled = !composeText.value.trim();
  renderComposeTags();
  composeText.focus();
}

function hideComposeMentionSuggestions() {
  composeMentionState.open = false;
  composeMentionState.matches = [];
  composeMentionState.selected = 0;
  composeMentionSuggest?.classList.add('hidden');
}

function mentionDisplayName(pubkey, fallback = {}) {
  const profile = state.profiles.get(pubkey) ?? fallback;
  return profile.display_name || profile.displayName || profile.name || profile.petname || shortNpub(pubkey);
}

function replaceComposeRange(start, end, text) {
  const prefix = composeText.value.slice(0, start);
  const suffix = composeText.value.slice(end);
  composeText.value = `${prefix}${text}${suffix}`;
  const cursor = prefix.length + text.length;
  composeText.setSelectionRange(cursor, cursor);
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const prefix = input.value.slice(0, start);
  const suffix = input.value.slice(end);
  const spacer = prefix && !/\s$/.test(prefix) ? ' ' : '';
  input.value = `${prefix}${spacer}${text}${suffix}`;
  const cursor = prefix.length + spacer.length + text.length;
  input.setSelectionRange(cursor, cursor);
}

function mentionTagsFromContent(text) {
  const tags = [];
  const seenP = new Set();
  const seenQ = new Set();
  for (const ref of extractNostrRefs(text, { queue: false })) {
    const relay = ref.relays?.[0] || '';
    if (ref.kind === 'profile' && ref.pubkey && !seenP.has(ref.pubkey)) {
      seenP.add(ref.pubkey);
      tags.push(relay ? ['p', ref.pubkey, relay] : ['p', ref.pubkey]);
    } else if (ref.kind === 'event' && ref.eventId && !seenQ.has(ref.eventId)) {
      seenQ.add(ref.eventId); // NIP-18 quote reference
      tags.push(relay ? ['q', ref.eventId, relay] : ['q', ref.eventId]);
    }
  }
  return tags;
}

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function localDatetimeValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatScheduledTime(post) {
  const at = new Date(Number(post.publishAt) * 1000);
  if (!Number.isFinite(at.getTime())) return 'invalid time';
  return at.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function setScheduleStatus(message, failed) {
  if (!scheduleStatus) return;
  scheduleStatus.classList.toggle('hidden', !message);
  scheduleStatus.classList.toggle('error', Boolean(failed));
  scheduleStatus.textContent = message;
}

async function refreshScheduledPosts() {
  if (!scheduleList) return;
  scheduleList.innerHTML = '<div class="schedule-empty">Loading scheduled posts...</div>';
  try {
    const response = await api('/api/v1/idenstr/scheduled-posts');
    state.scheduledPosts = response.scheduledPosts ?? response.posts ?? [];
    renderScheduledPosts();
  } catch (err) {
    scheduleList.innerHTML = `<div class="schedule-empty error">${esc(err.message || 'Could not load scheduled posts')}</div>`;
  }
}

function renderScheduledPosts() {
  const posts = (state.scheduledPosts || []).filter(post => ['pending', 'failed', 'publishing'].includes(post.status));
  if (!posts.length) {
    scheduleList.innerHTML = '<div class="schedule-empty">No scheduled posts yet.</div>';
    return;
  }
  scheduleList.innerHTML = posts.map(post => `
    <article class="schedule-item ${esc(post.status)}" data-scheduled-id="${esc(post.id)}">
      <div class="schedule-item-main">
        <div class="schedule-item-time">${esc(formatScheduledTime(post))}</div>
        <div class="schedule-item-content">${esc(post.content || '')}</div>
        ${post.lastError ? `<div class="schedule-item-error">${esc(post.lastError)}</div>` : ''}
      </div>
      <div class="schedule-item-actions">
        <button class="btn btn-ghost btn-mini" type="button" data-schedule-action="publish-now">Publish now</button>
        <button class="btn btn-ghost btn-mini" type="button" data-schedule-action="cancel">Cancel</button>
      </div>
    </article>
  `).join('');
  scheduleList.querySelectorAll('[data-schedule-action]').forEach(btn => {
    btn.addEventListener('click', handleScheduledPostAction);
  });
}

async function handleScheduledPostAction(e) {
  const btn = e.currentTarget;
  const item = btn.closest('[data-scheduled-id]');
  const id = item?.dataset.scheduledId;
  const action = btn.dataset.scheduleAction;
  if (!id || !action) return;
  setButtonState(btn, 'busy', action === 'cancel' ? 'Cancelling...' : 'Publishing...');
  try {
    if (action === 'cancel') {
      await api(`/api/v1/idenstr/scheduled-posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Scheduled post cancelled', 'info');
    } else {
      const post = await api(`/api/v1/idenstr/scheduled-posts/${encodeURIComponent(id)}/publish-now`, { method: 'POST' });
      if (post.status === 'failed') throw new Error(post.lastError || 'Publish failed');
      toast('Scheduled post published', 'success');
    }
    await refreshScheduledPosts();
  } catch (err) {
    toast(err.message || 'Scheduled post action failed', 'error');
    await refreshScheduledPosts();
  } finally {
    setButtonState(btn, 'reset');
  }
}

async function handleScheduleSubmit(e) {
  e.preventDefault();
  if (composeMediaUploadInFlight) {
    setScheduleStatus('Wait for the image upload to finish before scheduling.', true);
    return;
  }
  const raw = composeText.value.trim();
  if (!raw) {
    setScheduleStatus('Write the note before scheduling it.', true);
    return;
  }
  const selected = new Date(scheduleDatetime.value);
  const publishAt = Math.floor(selected.getTime() / 1000);
  if (!Number.isInteger(publishAt) || publishAt <= Math.floor(Date.now() / 1000)) {
    setScheduleStatus('Pick a future time.', true);
    return;
  }
  const text = resolveComposeMentions(raw);
  const submit = document.getElementById('schedule-submit');
  setButtonState(submit, 'busy', 'Scheduling...');
  try {
    await api('/api/v1/idenstr/scheduled-posts', {
      method: 'POST',
      body: {
        kind: 1,
        content: text,
        tags: mentionTagsFromContent(text),
        publish_at: publishAt,
        timezone: browserTimezone(),
        scheduled_local: scheduleDatetime.value
      }
    });
    composeText.value = '';
    composeText.dispatchEvent(new Event('input'));
    state.composeMentions = [];
    renderComposeTags();
    const label = selected.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    setScheduleStatus(`Scheduled for ${label}.`, false);
    toast(`Scheduled for ${label}`, 'success');
    await refreshScheduledPosts();
    setTimeout(() => { closeScheduleModal(); closeCompose(); }, 700);
  } catch (err) {
    setScheduleStatus(err.message || 'Could not schedule post.', true);
  } finally {
    setButtonState(submit, 'reset');
  }
}

composeSend.addEventListener('click', async () => {
  if (composeMediaUploadInFlight) {
    showComposeMediaMessage('Wait for the image upload to finish before posting.', true);
    return;
  }
  const raw = composeText.value.trim();
  if (!raw) return;
  // Resolve readable @Name tokens to nostr:nprofile refs so other clients render
  // the mention; mentionTagsFromContent then derives the p-tags from those refs.
  const text = resolveComposeMentions(raw);
  composeSend.disabled = true;
  composeSend.textContent = 'Posting...';
  try {
    await publishEvent(1, text, mentionTagsFromContent(text));
    composeText.value = '';
    composeText.dispatchEvent(new Event('input')); // hides the attachment preview
    state.composeMentions = [];
    renderComposeTags();
    composeSend.textContent = 'Posted!';
    setTimeout(() => { composeSend.textContent = 'Post'; closeCompose(); }, 700);
  } catch (err) {
    console.error('Compose publish failed:', err);
    composeSend.textContent = 'Failed';
    showComposeMediaMessage(err.message || 'Post failed', true);
    setTimeout(() => { composeSend.textContent = 'Post'; updateComposeSendState(); }, 2000);
  }
});

function resolveComposeMentions(text) {
  let out = text;
  // Longest tokens first so "@Al" can't clobber the inside of "@Alice".
  const mentions = [...state.composeMentions].sort((a, b) => b.token.length - a.token.length);
  for (const m of mentions) out = out.split(m.token).join(`nostr:${encodeNprofile(m.pubkey)}`);
  return out;
}
