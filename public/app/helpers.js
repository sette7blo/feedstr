// -- helpers --
function genId() { return Math.random().toString(36).slice(2, 10); }

// Lightweight snackbar. type: 'info' (default) | 'success' | 'error'.
let toastTimer = null;
function toast(message, type = 'info', action = null) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const remove = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); };
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.onclick = (e) => { e.stopPropagation(); remove(); action.onAction(); };
    el.appendChild(btn);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(remove, action ? 6000 : 3200);
  el.onclick = remove;
}

// npub / nprofile / 64-char hex -> hex pubkey, or null if unrecognisable.
function toHexPubkey(input) {
  const value = String(input ?? '').trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  const ref = parseNostrRef(value);
  return ref?.kind === 'profile' ? ref.pubkey : null;
}

function shortNpub(key) {
  if (!key) return '?';
  if (key.startsWith('npub')) return key.slice(0, 8) + '...' + key.slice(-4);
  return key.slice(0, 8) + '...';
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function getEventActorPubkey(event) {
  if (event?.kind === 9735) return getZapSenderPubkey(event);
  return event?.pubkey;
}

function getZapSenderPubkey(event) {
  const pTag = firstTagValue(event, 'P');
  if (pTag) return pTag;
  const description = firstTagValue(event, 'description');
  if (description) {
    try {
      const request = JSON.parse(description);
      if (request?.pubkey) return request.pubkey;
    } catch {}
  }
  return event?.pubkey;
}

function firstTagValue(event, name) {
  return (event?.tags ?? []).find(tag => tag[0] === name)?.[1] || '';
}

function parseZapComment(event) {
  const description = firstTagValue(event, 'description');
  if (!description) return '';
  try {
    const request = JSON.parse(description);
    return request?.content || '';
  } catch {
    return '';
  }
}

function parseZapAmountSats(event) {
  const millisats = Number(firstTagValue(event, 'amount'));
  if (Number.isFinite(millisats) && millisats > 0) return Math.round(millisats / 1000);

  const bolt11 = firstTagValue(event, 'bolt11').toLowerCase();
  const match = bolt11.match(/^lnbc(\d+)([munp]?)/);
  if (!match) return null;
  const value = Number(match[1]);
  const multiplier = { '': 100000000, m: 100000, u: 100, n: 0.1, p: 0.0001 }[match[2]];
  const sats = value * multiplier;
  return Number.isFinite(sats) && sats > 0 ? Math.round(sats) : null;
}

function formatContent(text, event = null) {
  const raw = expandIndexedNostrReferences(String(text ?? ''), event);
  const urls = extractUrls(raw);
  const nostrRefs = extractNostrRefs(raw);
  const eventRefs = nostrRefs.filter(ref => ref.kind === 'event');
  const imageUrls = urls.filter(isImageUrl);
  const visibleText = removePreviewedTokens(raw, [...imageUrls, ...eventRefs.map(ref => ref.raw)]);
  return `${linkifyText(visibleText)}${renderLinkPreviews(urls)}${renderNostrEventPreviews(eventRefs)}`;
}

function expandIndexedNostrReferences(text, event) {
  if (!event?.tags?.length) return text;
  return String(text ?? '').replace(/#\[(\d+)\]/g, (match, indexText) => {
    const tag = event.tags[Number(indexText)];
    if (!tag) return match;
    if (tag[0] === 'p' && isHex(tag[1], 64)) {
      seedProfileHintFromTag(tag);
      return `nostr:${encodeNprofile(tag[1], tag[2] ? [tag[2]] : [])}`;
    }
    if (tag[0] === 'e' && isHex(tag[1], 64)) return `nostr:${encodeNote(tag[1])}`;
    if (tag[0] === 't' && tag[1]) return `#${tag[1]}`;
    return match;
  });
}

function seedProfileHintFromTag(tag) {
  const pubkey = tag?.[1];
  const petname = tag?.[3];
  if (!isHex(pubkey, 64) || !petname) return;
  const existing = state.profiles.get(pubkey);
  if (existing?.name || existing?.display_name || existing?.displayName) return;
  state.profiles.set(pubkey, { ...(existing ?? {}), name: petname, display_name: petname, created_at: existing?.created_at ?? 0 });
}

function linkifyText(text) {
  return esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, (match) => {
      const clean = normalizeUrlForDisplay(match);
      const trailing = match.slice(clean.length);
      return `<a href="${esc(clean)}" target="_blank" rel="noopener noreferrer">${esc(clean)}</a>${esc(trailing)}`;
    })
    .replace(/((?:web\+)?nostr:[^\s<]+|(?:n(?:profile|pub|event|ote)|event)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi, (match) => {
      const clean = normalizeUrlForDisplay(match);
      const ref = parseNostrRef(clean);
      const trailing = match.slice(clean.length);
      if (ref?.kind === 'profile') return `${renderNostrProfileMention(ref)}${esc(trailing)}`;
      const href = clean.startsWith('nostr:') || clean.startsWith('web+nostr:') ? clean : `nostr:${clean}`;
      return `<a href="${esc(href)}" class="nostr-ref-link">${esc(clean)}</a>${esc(trailing)}`;
    })
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, '$1<a href="#" class="hashtag" data-tag="$2">#$2</a>')
    .replace(/\n/g, '<br>');
}

function removePreviewedTokens(text, tokens) {
  if (!tokens.length) return text;
  const tokenSet = new Set(tokens);
  const withoutTokens = String(text ?? '').replace(/(?:https?:\/\/[^\s<>"]+|(?:web\+)?nostr:[^\s<>"]+|(?:n(?:profile|pub|event|ote)|event)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi, (match) => {
    const clean = normalizeUrlForDisplay(match);
    const trailing = match.slice(clean.length);
    return tokenSet.has(clean) ? trailing : match;
  });
  return withoutTokens
    .split('\n')
    .map(line => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .filter(line => line.trim() || withoutTokens.trim().includes('\n'))
    .join('\n')
    .trim();
}

function extractUrls(text) {
  const matches = String(text ?? '').match(/https?:\/\/[^\s<>"]+/g) ?? [];
  return [...new Set(matches.map(normalizeUrlForDisplay).filter(Boolean))];
}

function normalizeUrlForDisplay(url) {
  return String(url ?? '').replace(/[),.!?;:]+$/g, '');
}

function renderLinkPreviews(urls) {
  if (!urls.length) return '';
  const images = urls.filter(isImageUrl);
  const links = urls.filter(url => !isImageUrl(url));
  const imageHtml = images.length
    ? `<div class="note-media-grid">${images.map(renderImagePreview).join('')}</div>`
    : '';
  const linkHtml = links.length
    ? `<div class="note-link-list">${links.slice(0, 3).map(renderLinkCard).join('')}</div>`
    : '';
  return `${imageHtml}${linkHtml}`;
}

function isImageUrl(url) {
  try {
    const parsed = new URL(url);
    return /\.(avif|gif|jpe?g|png|webp)$/i.test(parsed.pathname);
  } catch {
    return /\.(avif|gif|jpe?g|png|webp)(\?|#|$)/i.test(url);
  }
}

function renderImagePreview(url) {
  return `<a class="note-media" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" loading="lazy" alt="Attached image" onerror="this.closest('.note-media')?.remove()" /></a>`;
}

function renderLinkCard(url) {
  const host = linkHost(url);
  return `<a class="note-link-card" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span class="note-link-host">${esc(host)}</span><span class="note-link-url">${esc(url)}</span></a>`;
}

function linkHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function extractNostrRefs(text, options = {}) {
  const shouldQueue = options.queue !== false;
  const matches = String(text ?? '').match(/(?:web\+)?nostr:[^\s<>"]+|(?:n(?:profile|pub|event|ote)|event)1[023456789acdefghjklmnpqrstuvwxyz]+/gi) ?? [];
  const refs = [];
  const seen = new Set();
  for (const match of matches) {
    const raw = normalizeUrlForDisplay(match);
    const ref = parseNostrRef(raw);
    if (!ref) continue;
    const key = `${ref.kind}:${ref.eventId || ref.pubkey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ ...ref, raw });
    if (shouldQueue && ref.kind === 'event') fetchEmbeddedEvent(ref.eventId, ref.relays);
    if (shouldQueue && ref.kind === 'profile' && profileNeedsRefresh(ref.pubkey)) queueProfileFetch(ref.pubkey);
  }
  return refs;
}

function extractNostrEventRefs(text) {
  return extractNostrRefs(text).filter(ref => ref.kind === 'event');
}

function parseNostrRef(value) {
  const entity = String(value ?? '').replace(/^web\+nostr:/i, '').replace(/^nostr:/i, '');
  const decoded = decodeNip19(entity);
  if (!decoded) return null;
  if ((decoded.prefix === 'note' || decoded.prefix === 'event') && decoded.bytes.length >= 32) {
    return { kind: 'event', type: decoded.prefix, eventId: bytesToHex(decoded.bytes.slice(0, 32)), relays: [] };
  }
  if (decoded.prefix === 'nevent') {
    const ref = parseNevent(decoded.bytes);
    return ref ? { kind: 'event', ...ref } : null;
  }
  if (decoded.prefix === 'npub' && decoded.bytes.length >= 32) {
    return { kind: 'profile', type: 'npub', pubkey: bytesToHex(decoded.bytes.slice(0, 32)), relays: [] };
  }
  if (decoded.prefix === 'nprofile') {
    const ref = parseNprofile(decoded.bytes);
    return ref ? { kind: 'profile', ...ref } : null;
  }
  return null;
}

function parseNostrEventRef(value) {
  const ref = parseNostrRef(value);
  return ref?.kind === 'event' ? ref : null;
}

function parseNevent(bytes) {
  let i = 0;
  let eventId = '';
  const relays = [];
  while (i + 2 <= bytes.length) {
    const type = bytes[i++];
    const len = bytes[i++];
    const value = bytes.slice(i, i + len);
    i += len;
    if (type === 0 && len === 32) eventId = bytesToHex(value);
    if (type === 1) relays.push(new TextDecoder().decode(new Uint8Array(value)));
  }
  return eventId ? { type: 'nevent', eventId, relays } : null;
}

function parseNprofile(bytes) {
  let i = 0;
  let pubkey = '';
  const relays = [];
  while (i + 2 <= bytes.length) {
    const type = bytes[i++];
    const len = bytes[i++];
    const value = bytes.slice(i, i + len);
    i += len;
    if (type === 0 && len === 32) pubkey = bytesToHex(value);
    if (type === 1) relays.push(new TextDecoder().decode(new Uint8Array(value)));
  }
  return pubkey ? { type: 'nprofile', pubkey, relays } : null;
}

function renderNostrEventPreviews(refs) {
  if (!refs.length) return '';
  return `<div class="nostr-embed-list">${refs.map(renderNostrEventCard).join('')}</div>`;
}

function renderNostrEventCard(ref) {
  const event = state.notes.get(ref.eventId);
  if (!event) {
    return `<div class="nostr-embed loading" data-event-id="${esc(ref.eventId)}"><span>Quoted note</span><strong>Looking across relays...</strong><small>${esc(shortNpub(ref.eventId))}</small></div>`;
  }
  const profile = state.profiles.get(event.pubkey) ?? {};
  if (profileNeedsRefresh(event.pubkey)) queueProfileFetch(event.pubkey);
  const name = profile.display_name || profile.displayName || profile.name || shortNpub(event.pubkey);
  const preview = stripMarkup(formatContent(event.content ?? '', event)).slice(0, 180) || 'Nostr event';
  const relays = [...new Set([...(ref.relays ?? []), ...eventRelayHints(ref.eventId)])];
  const href = `nostr:${relays.length ? encodeNevent(ref.eventId, relays) : encodeNote(ref.eventId)}`;
  return `<a class="nostr-embed" data-event-id="${esc(ref.eventId)}" href="${esc(href)}" title="Open quoted note"><span>Quoted note</span><strong>${esc(name)}${event.created_at ? ` · ${esc(relativeTime(event.created_at))}` : ''}</strong><small>${esc(preview)}</small></a>`;
}

function renderNostrProfileMention(ref) {
  const profile = state.profiles.get(ref.pubkey) ?? {};
  if (profileNeedsRefresh(ref.pubkey)) queueProfileFetch(ref.pubkey);
  const name = profile.display_name || profile.displayName || profile.name || shortNpub(ref.pubkey);
  const href = `nostr:${encodeNprofile(ref.pubkey, ref.relays ?? [])}`;
  return `<a href="${esc(href)}" class="nostr-person" title="${esc(shortNpub(ref.pubkey))}">@${esc(name)}</a>`;
}

function stripMarkup(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function decodeNip19(value) {
  const bech = String(value ?? '').toLowerCase();
  const pos = bech.lastIndexOf('1');
  if (pos < 1 || pos + 7 > bech.length) return null;
  const prefix = bech.slice(0, pos);
  const payload = bech.slice(pos + 1, -6);
  const words = [];
  for (const ch of payload) {
    const index = BECH32_CHARS.indexOf(ch);
    if (index < 0) return null;
    words.push(index);
  }
  return { prefix, bytes: convertBits(words, 5, 8, false) };
}

const BECH32_CHARS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || (value >> fromBits)) return [];
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits) ret.push((acc << (toBits - bits)) & maxv);
  return ret;
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  return String(hex ?? '').match(/.{1,2}/g)?.map(part => parseInt(part, 16)) ?? [];
}

function isHex(value, length = null) {
  const text = String(value ?? '');
  return /^[0-9a-f]+$/i.test(text) && (length === null || text.length === length);
}

function encodeNote(eventId) {
  return nip19Encode('note', hexToBytes(eventId));
}

function encodeNevent(eventId, relays = []) {
  const bytes = [0, 32, ...hexToBytes(eventId)];
  for (const relay of relays.filter(Boolean).slice(0, 3)) {
    const encoded = [...new TextEncoder().encode(relay)];
    bytes.push(1, encoded.length, ...encoded);
  }
  return nip19Encode('nevent', bytes);
}

function encodeNprofile(pubkey, relays = []) {
  const bytes = [0, 32, ...hexToBytes(pubkey)];
  for (const relay of relays.filter(Boolean).slice(0, 3)) {
    const encoded = [...new TextEncoder().encode(relay)];
    bytes.push(1, encoded.length, ...encoded);
  }
  return nip19Encode('nprofile', bytes);
}

function nip19Encode(prefix, bytes) {
  const words = convertBits(bytes, 8, 5, true);
  const checksum = bech32CreateChecksum(prefix, words);
  return `${prefix}1${[...words, ...checksum].map(i => BECH32_CHARS[i]).join('')}`;
}

function bech32CreateChecksum(prefix, words) {
  const values = [...bech32HrpExpand(prefix), ...words, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  const checksum = [];
  for (let p = 0; p < 6; p++) checksum.push((polymod >> (5 * (5 - p))) & 31);
  return checksum;
}

function bech32HrpExpand(prefix) {
  const out = [];
  for (let i = 0; i < prefix.length; i++) out.push(prefix.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < prefix.length; i++) out.push(prefix.charCodeAt(i) & 31);
  return out;
}

function bech32Polymod(values) {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= generator[i];
  }
  return chk;
}

function esc(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setStatus(ok, text) {
  const el = document.getElementById('status-bar');
  el.className = `sidebar-status${ok ? '' : ' error'}`;
  el.innerHTML = `<span class="dot"></span>${esc(text)}`;
}
