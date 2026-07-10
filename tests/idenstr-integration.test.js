import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = new URL('../public/index.html', import.meta.url);
const styles = new URL('../public/styles.css', import.meta.url);
const server = new URL('../src/server.js', import.meta.url);

test('mobile form controls stay at the iOS no-zoom font size', async () => {
  const source = await readFile(html, 'utf8');
  const css = await readFile(styles, 'utf8');
  assert.match(source, /maximum-scale=1/);
  assert.match(source, /styles\.css\?v=compose-preview-1/);
  assert.match(css, /iOS Safari auto-zooms focused form controls below 16px/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\), \(max-width: 900px\) \{[\s\S]*input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\),[\s\S]*textarea,[\s\S]*select[\s\S]*font-size: 16px !important;/);
});

test('sidebar column list can close columns directly on mobile', async () => {
  const source = await readFile(html, 'utf8');
  const css = await readFile(styles, 'utf8');
  assert.match(source, /className = 'sidebar-column-item'/);
  assert.match(source, /className = 'sidebar-item sidebar-column-jump'/);
  assert.match(source, /className = 'sidebar-column-close'/);
  assert.match(source, /aria-label', `Close \$\{col\.name\} column`/);
  assert.match(source, /event\.stopPropagation\(\);\s*removeColumn\(col\.id\);/);
  assert.match(source, /#column-list \[data-side-col="\$\{id\}"\]\`\)\?\.remove\(\)/);
  assert.match(css, /\.sidebar-column-close \{[\s\S]*width: 34px;[\s\S]*height: 34px;/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.sidebar-column-close \{[\s\S]*width: 44px;[\s\S]*height: 44px;[\s\S]*opacity: 1;/);
});

test('mobile drawer stays compact on iOS while preserving close tap targets', async () => {
  const css = await readFile(styles, 'utf8');
  assert.match(css, /\.sidebar \{[\s\S]*width: min\(56vw, 228px\);/);
  assert.match(css, /@media \(max-width: 380px\) \{\s*\.sidebar \{ width: min\(58vw, 220px\); \}/);
  assert.match(css, /\.sidebar-item \{[\s\S]*min-height: 44px;[\s\S]*font-size: 14px;/);
  assert.match(css, /\.sidebar-column-close \{[\s\S]*width: 44px;[\s\S]*height: 44px;[\s\S]*margin-right: 6px;/);
});

test('settings entry is a single bottom-left gear chip, not a top-right Idenstr button', async () => {
  const source = await readFile(html, 'utf8');
  const css = await readFile(styles, 'utf8');
  assert.doesNotMatch(source, /mobile-stack-btn|mobile-stack-button/);
  assert.doesNotMatch(css, /mobile-stack-button/);
  assert.match(source, /class="mobile-topbar-spacer"/);
  assert.match(source, /id="idenstr-settings-btn"[^>]*aria-label="Open Feedstr settings"/);
  assert.match(source, /class="connection-chip-icon"/);
  assert.match(source, /class="connection-chip-label">Settings</);
  assert.match(source, /class="connection-chip-status" id="idenstr-summary"/);
  assert.match(source, /Idenstr connected/);
  assert.match(css, /\.connection-chip-main \{[^}]*flex-direction: column/);
  assert.match(css, /\.connection-chip-icon \{/);
  assert.match(css, /grid-template-columns: 44px minmax\(0, 1fr\) 44px/);
});

test('Feedstr signs through Idenstr instead of holding keys or calling admin publish endpoints', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /\/api\/v1\/idenstr\/sign/);
  assert.doesNotMatch(source, /\/api\/v1\/idenstr\/events\/publish/);
  assert.doesNotMatch(source, /IDENSTR_NSEC|FEEDSTR_NSEC|NOSTR_PRIVATE_KEY/);
});

test('Feedstr exposes Idenstr connection guidance and required scoped token permissions', async () => {
  const source = await readFile(html, 'utf8');
  const serverSource = await readFile(server, 'utf8');
  // The server is the single source of truth for the required scope list.
  for (const scope of ['profile:read', 'following:read', 'following:write', 'mutes:read', 'mutes:write', 'relays:read', 'sign:kind:1', 'sign:kind:6', 'sign:kind:7', 'sign:kind:27235', 'zaps:write']) {
    assert.match(serverSource, new RegExp(scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  // The frontend pulls the list from /api/v1/config rather than hardcoding it.
  assert.match(source, /requiredIdenstrScopes = state\.config\.requiredIdenstrScopes/);
  assert.match(source, /Idenstr URL/);
  assert.match(source, /Idenstr token/);
  assert.match(source, /Private relay/);
  assert.match(source, /asks Idenstr for signing/);
  assert.match(source, /connection-card|terminal-mini|status-orb/);
  // The private relay is an editable, testable field saved back to .env.
  assert.match(source, /name="privateRelayUrl"/);
  assert.match(source, /id="relay-test-btn"/);
  assert.match(source, /function testRelayConnection/);
  assert.doesNotMatch(source, /feedstrHostBind|Feedstr bind IP|bind IP changes/);
});

test('Feedstr exposes a zap action that delegates NIP-57 payment to Idenstr', async () => {
  const source = await readFile(html, 'utf8');
  const css = await readFile(styles, 'utf8');
  assert.match(source, /data-action="zap"/);
  assert.match(source, /function showZapModal/);
  assert.match(source, /function sendZap/);
  assert.match(source, /api\('\/api\/v1\/idenstr\/zaps\/pay'/);
  assert.match(source, /Feedstr never sees the wallet secret/);
  assert.match(source, /zapAddressForProfile/);
  assert.match(source, /for \(const field of ZAP_ADDRESS_FIELD_NAMES\)/);
  assert.match(source, /queueProfileFetch\(event\.pubkey, \{ needZap: true, force: true \}\)/);
  assert.match(source, /state\._profileForceQueue/);
  assert.match(source, /forceQueue\.has\(pubkey\) \|\| profileNeedsRefresh\(pubkey\)/);
  assert.match(source, /function updateOpenZapModal/);
  assert.match(source, /checking profile for zap address/);
  assert.match(source, /resolvedZapAddress = zapAddress \|\| zapAddressForProfile/);
  // Both one-tap and the modal pay through the one shared core.
  assert.match(source, /async function zapNote\(/);
  assert.match(source, /zapNote\(\{ event, amountSats, comment: form\.elements\.comment\.value\.trim\(\), zapAddress: resolvedZapAddress \}\)/);
  assert.match(source, /ZAP_ADDRESS_FIELD_NAMES/);
  assert.match(source, /'lud16', 'lud06'/);
  assert.match(source, /'lightning_address', 'lightningAddress', 'lightning'/);
  assert.match(source, /'lnurl', 'lnurlp', 'lnurlPay'/);
  assert.match(source, /function normalizeZapAddress/);
  assert.match(source, /function findNestedZapAddress/);
  assert.match(source, /zapAddressForProfile\(existing\) !== zapAddressForProfile\(next\)/);
  assert.match(source, /\.\.\.profile,\s*name: profile\.name/s);
  assert.doesNotMatch(source, /class="note-action zap-action"/);
  assert.doesNotMatch(source, /<span>Zap<\/span>/);
  assert.match(source, /function flashZapButtonForEvent/);
  assert.match(source, /flashZapButtonForEvent\(event\.id\)/);
  assert.match(source, /button\.classList\.add\('zapped'\)/);
  assert.match(css, /\.note-action\.zapped/);
  assert.match(css, /@keyframes zap-flash/);
  assert.match(css, /var\(--bitcoin-gold\)/);
  assert.match(css, /drop-shadow\(0 0 8px rgba\(247, 147, 26, 0\.9\)\)/);
  assert.match(css, /\.zap-preset\.selected/);
});

test('Feedstr one-tap zaps a configurable default amount and keeps the modal on long-press', async () => {
  const source = await readFile(html, 'utf8');
  const css = await readFile(styles, 'utf8');
  // Bolt button: short tap -> quickZap, hold/right-click -> modal.
  assert.match(source, /function attachZapButton/);
  assert.match(source, /async function quickZap/);
  assert.match(source, /if \(longFired\) \{ longFired = false; return; \}/);
  assert.match(source, /contextmenu', \(e\) => \{ e\.preventDefault\(\); cancelHold\(\); longFired = true; showZapModal\(event\); \}/);
  assert.match(source, /attachZapButton\(el\.querySelector\('\[data-action="zap"\]'\), event\)/);
  // No address yet -> stay in one-tap flow: refresh metadata and toast instead of opening the custom modal.
  assert.match(source, /toast\('Checking profile for zap address…', 'info'\)/);
  assert.match(source, /zapAddress = await waitForZapAddress\(event\.pubkey, 3500\)/);
  assert.match(source, /function waitForZapAddress/);
  assert.doesNotMatch(source, /if \(!zapAddress\) \{ showZapModal\(event\); return; \}/);
  // Default amount persists server-side in Feedstr's own state store.
  assert.match(source, /async function loadZapDefault/);
  assert.match(source, /function persistZapDefault/);
  assert.match(source, /api\('\/api\/v1\/state\/zap-default'/);
  assert.match(source, /zapDefaultSats: 100/);
  assert.match(source, /id="zap-settings-btn"/);
  assert.match(source, /id="zap-wallet-chip"/);
  assert.match(source, /function showZapSettings/);
  assert.match(source, /zapSettingsBtn.onclick = \(\) => \{ closeMobileMenu\(\); showZapSettings\(\); refreshZapWalletBalance\(\); \}/);
  assert.match(source, /function refreshZapWalletBalance/);
  // Boot uses the cached db-only read; the live NWC balance check is on demand
  // and post-zap refreshes are debounced so zap bursts coalesce into one check.
  assert.match(source, /function loadZapWalletCached/);
  assert.match(source, /loadZapWalletCached\(\);/);
  assert.doesNotMatch(source, /refreshMuteSets\(\);\s*refreshZapWalletBalance\(\)/);
  assert.match(source, /function scheduleZapWalletRefresh/);
  assert.match(source, /api\('\/api\/v1\/idenstr\/zaps\/wallet\/balance', \{ method: 'POST' \}/);
  assert.match(source, /formatWalletSats/);
  assert.match(source, /walletRelativeTime/);
  assert.match(css, /\.zap-settings-chip/);
  // The separate zap settings chip exposes the default-amount control.
  assert.match(source, /id="zap-default-form"/);
  assert.match(source, /id="zap-default-input"/);
  assert.match(source, /state\.zapDefaultSats = amount/);
});

test('Feedstr combines repost and quote behind one boost action sheet', async () => {
  const source = await readFile(html, 'utf8');
  const css = await readFile(styles, 'utf8');
  assert.match(source, /data-action="boost"/);
  assert.match(source, /title="Boost or quote"/);
  assert.doesNotMatch(source, /data-action="repost"/);
  assert.doesNotMatch(source, /data-action="quote"/);
  assert.match(source, /function showBoostMenu\(event\)/);
  assert.match(source, /data-boost-action="repost"/);
  assert.match(source, /data-boost-action="quote"/);
  assert.match(source, /await doRepost\(event\)/);
  assert.match(source, /quoteNote\(event\)/);
  assert.match(source, /modal\.classList\.add\('boost-sheet'\)/);
  assert.match(source, /modal\.classList\.remove\('open', 'boost-sheet', 'raw-event-sheet'\)/);
  assert.match(css, /\.boost-modal/);
  assert.match(css, /#add-column-modal\.open\.boost-sheet/);
});

test('Feedstr exposes a dim raw JSON inspector per note', async () => {
  const source = await readFile(html, 'utf8');
  const css = await readFile(styles, 'utf8');
  assert.match(source, /data-action="raw-json"/);
  assert.match(source, /title="Raw event JSON"/);
  assert.match(source, /aria-label="View raw event JSON"/);
  assert.match(source, /function showRawEventModal\(event\)/);
  assert.match(source, /JSON\.stringify\(event, null, 2\)/);
  assert.match(source, /mc\.querySelector\('#raw-json-viewer'\)\.textContent = pretty/);
  assert.match(source, /id="raw-copy-json"/);
  assert.match(source, /id="raw-copy-id"/);
  assert.match(source, /function copyRawEventText/);
  assert.match(source, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(source, /modal\.classList\.add\('raw-event-sheet'\)/);
  assert.match(source, /modal\.classList\.remove\('open', 'boost-sheet', 'raw-event-sheet'\)/);
  assert.match(css, /\.note-action-raw/);
  assert.match(css, /margin-left: auto/);
  assert.match(css, /\.raw-json-viewer/);
  assert.match(css, /\.modal\.raw-event-modal/);
});

test('composer can upload a device image through nostr.build and insert the returned URL', async () => {
  const source = await readFile(html, 'utf8');
  const serverSource = await readFile(server, 'utf8');
  assert.match(source, /id="compose-media-input" type="file" accept="image\/\*" hidden/);
  assert.match(source, /id="compose-media-btn"/);
  assert.match(source, /id="compose-media-status"/);
  assert.match(source, /function handleComposeMediaChange/);
  assert.match(source, /function uploadComposeMedia/);
  assert.match(source, /function appendComposeMediaUrl/);
  assert.match(source, /function showComposeMediaMessage/);
  assert.match(source, /let composeMediaUploadInFlight = false/);
  assert.match(source, /function updateComposeSendState\(\)/);
  assert.match(source, /composeSend\.disabled = composeMediaUploadInFlight \|\| !composeText\.value\.trim\(\)/);
  assert.match(source, /Wait for the image upload to finish before posting/);
  assert.match(source, /file\.size > 20 \* 1024 \* 1024/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 90000\)/);
  assert.match(source, /form\.append\('file'/);
  assert.match(source, /fetch\('\/api\/v1\/media\/upload', \{ method: 'POST', body: form, signal: controller\.signal \}\)/);
  assert.match(source, /appendComposeMediaUrl\(url\)/);
  assert.match(source, /Uploaded: \$\{url\}/);
  assert.match(source, /Compose publish failed:/);
  assert.match(serverSource, /'Content-Length': Buffer\.byteLength\(body\)/);
  // Only upload responses close the socket (mobile networks stall reusing the
  // connection after a large upload body); the chatty API keeps keep-alive on.
  assert.match(serverSource, /res\.setHeader\('Connection', 'close'\)/);
  assert.doesNotMatch(serverSource, /'Connection': 'close'/);
  assert.match(serverSource, /function postNostrBuildUpload/);
  assert.match(serverSource, /\[500, 502, 503, 504\]\.includes\(upstream\.status\)/);
  assert.match(serverSource, /nostr\.build upload transient/);
  assert.match(serverSource, /url\.pathname === '\/api\/v1\/media\/upload'/);
  assert.match(serverSource, /nostrBuildUploadUrl = 'https:\/\/nostr\.build\/api\/v2\/nip96\/upload'/);
  assert.match(serverSource, /readRawBody\(req, 20 \* 1024 \* 1024\)/);
  assert.match(serverSource, /setTimeout\(\(\) => controller\.abort\(\), 90000\)/);
  assert.match(serverSource, /kind: 27235/);
  assert.match(serverSource, /\['u', targetUrl\]/);
  assert.match(serverSource, /\['method', method\.toUpperCase\(\)\]/);
  assert.match(serverSource, /\['payload', payload\]/);
  assert.match(serverSource, /Authorization: auth/);
  assert.match(serverSource, /sign:kind:27235/);
});

test('mentions and notifications refresh author profiles when avatars are missing', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /function profileDisplayChanged/);
  assert.match(source, /if \(changed\) \{/);
  assert.match(source, /rerenderColumnsForAuthor\(event\.pubkey\)/);
  assert.match(source, /!profile\.picture/);
  assert.match(source, /const actorPubkey = getEventActorPubkey\(event\)/);
  assert.match(source, /queueProfileFetch\(actorPubkey\)/);
  assert.match(source, /function refreshVisibleMissingProfiles/);
  assert.match(source, /profileFetchAttempts/);
  assert.match(source, /refreshVisibleMissingProfiles\(\)/);
  assert.match(source, /getEventActorPubkey\(event\) === pubkey \|\| event\.pubkey === pubkey/);
  assert.match(source, /kinds: \[1, 6, 7, 9735\]/);
  assert.doesNotMatch(source, /filters\.push\(\{ kinds: \[0\], limit: 50 \}\)/);
});

test('notifications are the canonical mentions surface with typed filters', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /type: 'notifications', name: 'Notifications', notificationFilter: 'all'/);
  assert.doesNotMatch(source, /data-type="mentions"/);
  for (const label of ['All', 'Replies', 'Mentions', 'Zaps', 'Reposts', 'Reactions']) {
    assert.match(source, new RegExp(`\\['[^']+', '${label}'\\]`));
  }
  assert.match(source, /function normalizeNotification/);
  assert.match(source, /hasEventTag \? 'reply' : 'mention'/);
  assert.match(source, /function notificationCounts/);
  assert.match(source, /function notificationFilterIcon/);
  assert.match(source, /notification-filter-icon/);
  assert.match(source, /notification-filter-label/);
  assert.match(source, /aria-label', `\$\{label\} \$\{counts\[key\]/);
});

test('notifications fan out to all relays so non-followed actors do not disappear', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /function subscribe\(subId, filters, columnId, options = \{\}\)/);
  assert.match(source, /allRelays: Boolean\(options\.allRelays\)/);
  assert.match(source, /sub\.allRelays \? sockets\.length : Math\.min\(3, sockets\.length\)/);
  assert.match(source, /col\.type === 'notifications' \|\| col\.type === 'mentions'/);
  assert.match(source, /allRelays: true/);
});

test('mutes come from Idenstr and filter notifications before counts/rendering', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /api\('\/api\/v1\/idenstr\/mutes'\)/);
  assert.match(source, /function refreshMuteSets/);
  assert.match(source, /function isMutedNotification/);
  assert.match(source, /\.filter\(n => !isMutedNotification\(n\)\)/);
  assert.match(source, /data-action="mute-thread"/);
  assert.match(source, /iconSvg\('volume-x'\)/);
  assert.doesNotMatch(source, /data-action="mute-thread" title="Mute thread">\$\{iconSvg\('bell'\)\}/);
  assert.match(source, /data-action="mute-profile-toggle"/);
  assert.match(source, /function toggleMuteProfile/);
  assert.match(source, /function muteProfile/);
  assert.match(source, /function isMutedProfile/);
  assert.match(source, /function setMuteThreadLocal/);
  assert.match(source, /await api\('\/api\/v1\/idenstr\/mutes\/mute', \{ method: 'POST', body: \{ type: 'thread'/);
  assert.match(source, /setMuteThreadLocal\(threadId, false\);/);
  assert.match(source, /toast\(muteError\(err\), 'error'\);/);
  const muteThreadBody = source.slice(source.indexOf('async function muteThread'), source.indexOf('// One-shot REQ'));
  assert.doesNotMatch(muteThreadBody, /persistMutes|Failed to publish thread mute/);
  assert.match(source, /mutes\/mute/);
  assert.match(source, /mutes\/unmute/);
});

test('note content renders inline image previews and link cards', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /function extractUrls/);
  assert.match(source, /function isImageUrl/);
  assert.match(source, /function renderImagePreview/);
  assert.match(source, /function renderLinkCard/);
  assert.match(source, /note-media-grid/);
  assert.match(source, /note-link-card/);
  assert.match(source, /avif\|gif\|jpe\?g\|png\|webp/);
  assert.match(source, /function removePreviewedTokens/);
  assert.match(source, /tokenSet\.has\(clean\) \? trailing : match/);
  assert.match(source, /rel="noopener noreferrer"/);
});

test('nostr event references render as quote cards instead of raw URLs', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /function extractNostrEventRefs/);
  assert.match(source, /function extractNostrRefs/);
  assert.match(source, /function parseNostrEventRef/);
  assert.match(source, /function decodeNip19/);
  assert.match(source, /function parseNevent/);
  assert.match(source, /function renderNostrEventCard/);
  assert.match(source, /fetchEmbeddedEvent\(ref\.eventId, ref\.relays\)/);
  assert.match(source, /nostr-embed/);
  assert.match(source, /\(\?:n\(\?:profile\|pub\|event\|ote\)\|event\)1/);
  assert.match(source, /eventRelays: new Map\(\)/);
  assert.match(source, /embeddedSockets: new Map\(\)/);
  assert.match(source, /function rememberEventRelay/);
  assert.match(source, /handleEvent\(data\[1\], data\[2\], url\)/);
  assert.match(source, /function eventRelayHints/);
  assert.match(source, /function encodeNevent/);
  assert.match(source, /const expectedEoses = targetSockets\.length \+ pendingHintSockets\.length/);
  assert.match(source, /state\.profileSockets\.values\(\)/);
  assert.match(source, /function connectEmbeddedHintRelay/);
  assert.match(source, /pendingHintSockets/);
  assert.match(source, /ws\.addEventListener\('open', \(\) => ws\.send\(payload\), \{ once: true \}\)/);
  assert.match(source, /state\._embeddedQueue\?\.has\(eventId\)/);
  assert.match(source, /if \(!targetSockets\.length && !pendingHintSockets\.length\)/);
  assert.match(source, /queue\.set\(eventId, hints\)/);
  // offline embedded-fetch retries back off and stop instead of polling forever
  assert.match(source, /let _embeddedRetryDelay = 750/);
  assert.match(source, /if \(_embeddedRetryDelay <= 12000\)/);
  assert.match(source, /_embeddedRetryDelay \*= 2/);
  assert.match(source, /state\.embeddedEventFetchTried\.add\(eventId\)/);
  assert.match(source, /event:\$\{ref\.eventId\}:\$\{state\.notes\.has\(ref\.eventId\) \? 'resolved' : 'missing'\}/);
  assert.match(source, /contentEl\.innerHTML = formatContent\(event\.content, event\)/);
  assert.match(source, /const wasMissing = !state\.notes\.has\(event\.id\)/);
  assert.match(source, /if \(wasMissing\) scheduleRerenderAllColumns\(\)/);
  assert.match(source, /let globalNoteAdded = false/);
  assert.match(source, /if \(!state\.notes\.has\(event\.id\)\) globalNoteAdded = true/);
  assert.match(source, /if \(globalNoteAdded\) scheduleRerenderAllColumns\(\)/);
  assert.match(source, /state\.notes\.set\(event\.id, event\)/);
  assert.match(source, /state\._embeddedQueue\?\.size\) scheduleEmbeddedFetch\(\)/);
  assert.match(source, /sub\._closeTimer = setTimeout/);
  assert.match(source, /sub\._eoseRelays\.size < sub\.expectedEoses\) return/);
  assert.match(source, /handleEose\(data\[1\], url\)/);
  assert.match(source, /relays\.length \? encodeNevent\(event\.id, relays\) : encodeNote\(event\.id\)/);
  assert.match(source, /seenQ\.add\(ref\.eventId\); \/\/ NIP-18 quote reference/);
  assert.match(source, /<span>Quoted note<\/span><strong>Looking across relays\.\.\.<\/strong>/);
  assert.match(source, /<span>Quoted note<\/span><strong>\$\{esc\(name\)\}/);
  // resolved cards must use the real relativeTime helper; timeAgo does not exist
  assert.doesNotMatch(source, /\btimeAgo\(/);
  assert.match(source, /relativeTime\(event\.created_at\)/);
  // private relay URL must never be emitted as a relay hint in published nevents
  assert.match(source, /url !== state\.config\?\.privateRelayUrl/);
});

test('composer and reply boxes live-preview quoted notes and attached images', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /function attachComposePreview/);
  assert.match(source, /id="compose-preview"/);
  assert.match(source, /class="reply-preview compose-preview hidden"/);
  assert.match(source, /attachComposePreview\(composeText, composePreview\)/);
  assert.match(source, /attachComposePreview\(textarea, box\.querySelector\('\.reply-preview'\)\)/);
  // preview reuses the real note renderers so it matches the published look
  assert.match(source, /images\.map\(renderImagePreview\)\.join\(''\)/);
  assert.match(source, /renderNostrEventPreviews\(eventRefs\)/);
  // quote-card links inside the preview must not fire the nostr: protocol handler
  assert.match(source, /if \(link && !link\.target\) e\.preventDefault\(\)/);
  const css = await readFile(styles, 'utf8');
  assert.match(css, /\.compose-preview \{/);
});

test('normal feeds fetch and render deeper timelines instead of stopping early', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /const since = now - 86400 \* 7; \/\/ last 7 days for scrollable timelines/);
  assert.match(source, /\.slice\(0, 500\)/);
  assert.match(source, /authors: followPubkeys, since, limit: 500/);
  assert.match(source, /'#p': \[state\.identity\.pubkey\], since, limit: 500/);
  assert.match(source, /'#t': \[col\.tag\.toLowerCase\(\)\], since, limit: 500/);
  assert.match(source, /authors: \[col\.pubkey\], since: now - 86400 \* 30, limit: 500/);
  assert.match(source, /authors: col\.pubkeys, since, limit: 500/);
});

test('reply boxes support image uploads like the main composer', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /class="reply-media-input compose-media-input" type="file" accept="image\/\*" hidden/);
  assert.match(source, /class="btn btn-ghost btn-sm compose-media-btn reply-media-btn"/);
  assert.match(source, /class="reply-media-status compose-media-status hidden"/);
  assert.match(source, /const mediaInput = box\.querySelector\('\.reply-media-input'\)/);
  assert.match(source, /const mediaBtn = box\.querySelector\('\.reply-media-btn'\)/);
  assert.match(source, /let mediaUploadInFlight = false/);
  assert.match(source, /mediaInput\.onchange = async \(\) =>/);
  assert.match(source, /file\.size > 20 \* 1024 \* 1024/);
  assert.match(source, /const url = await uploadComposeMedia\(file\)/);
  assert.match(source, /appendMediaUrlToTextarea\(textarea, url\)/);
  assert.match(source, /setInlineMediaStatus\(mediaBtn, mediaStatus, 'Added'/);
});

test('reply draft boxes survive feed reconciliation while typing', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /const replyBoxes = new Map\(\)/);
  assert.match(source, /node\.classList\?\.contains\('reply-box'\) && node\.dataset\?\.replyFor/);
  assert.match(source, /if \(keep\.has\(node\.dataset\.replyFor\)\) replyBoxes\.set\(node\.dataset\.replyFor, node\)/);
  assert.match(source, /const replyBox = replyBoxes\.get\(id\)/);
  assert.match(source, /parent\.insertBefore\(replyBox, el\.nextSibling\)/);
  assert.match(source, /box\.dataset\.replyFor = event\.id/);
  assert.match(source, /querySelector\(`:scope > \.reply-box\[data-reply-for=/);
});

test('reply boxes hide the mobile compose FAB only while the reply UI is active', async () => {
  const source = await readFile(html, 'utf8');
  const css = await readFile(styles, 'utf8');
  assert.match(source, /function setInlineReplyActive/);
  assert.match(source, /document\.body\.classList\.toggle\('inline-reply-active'/);
  assert.match(source, /function refreshInlineReplyActive/);
  assert.match(source, /document\.querySelector\('\.reply-box:focus-within'\)/);
  assert.match(source, /function removeReplyBox/);
  assert.match(source, /cancelBtn\.onclick = \(\) => removeReplyBox\(box\)/);
  assert.match(source, /box\.addEventListener\('focusin', \(\) => setInlineReplyActive\(true\)\)/);
  assert.match(source, /box\.addEventListener\('focusout', \(\) => setTimeout\(refreshInlineReplyActive, 0\)\)/);
  assert.match(source, /refreshInlineReplyActive\(\);\n\}/);
  assert.doesNotMatch(css, /body:has\(\.reply-box\) \.compose-fab/);
  assert.match(css, /body\.inline-reply-active \.compose-fab,\s*body:has\(\.reply-box:focus-within\) \.compose-fab \{ display: none; \}/);
});

test('reply notes show a quiet inline cue and open the conversation in-column', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /function renderReplyContext/);
  assert.match(source, /function getReplyParentRef/);
  assert.match(source, /const replyContext = opts\.thread \? '' : renderReplyContext\(event\)/);
  assert.match(source, /class="reply-context/);
  assert.match(source, /data-parent-id="\$\{esc\(parentRef\.eventId\)\}"/);
  assert.match(source, /data-selected-id="\$\{esc\(event\.id\)\}"/);
  assert.match(source, /Replying to \$\{esc\(name\)\}/);
  assert.match(source, /Replying to a note/);
  assert.match(source, /openConversation\(parentRef\.eventId, event\.id, el\.closest\('\.column'\)\?\.dataset\.col\)/);
  // Threads render in-place as a timeline (chain + replies), not a modal dialog.
  assert.match(source, /function renderThread/);
  assert.match(source, /function renderThreadNote/);
  assert.match(source, /function buildConversationChain/);
  assert.match(source, /thread-chain/);
  assert.match(source, /thread-replies/);
  assert.match(source, /thread-selected/);
  assert.match(source, /fetchEmbeddedEvent\(parentRef\.eventId, parentRef\.relays\)/);
  assert.match(source, /function scheduleEmbeddedFetch/);
  assert.match(source, /const filter = \{ kinds: \[1\], ids, limit: ids\.length \}/);
  assert.match(source, /function scheduleRerenderAllColumns/);
  assert.match(source, /extractNostrRefs\(expandIndexedNostrReferences\(event\?\.content \?\? '', event\), \{ queue: false \}\)/);
  assert.match(source, /tag\[3\] === 'reply'/);
});

test('feeds reconcile in place so avatars do not strobe as relays stream events', async () => {
  const source = await readFile(html, 'utf8');
  // A shared keyed reconciler reuses painted rows instead of wiping innerHTML.
  assert.match(source, /function reconcileChildren/);
  assert.match(source, /function noteProfileSignature/);
  assert.match(source, /function actorProfileSignature/);
  // Rows are only rebuilt when their displayed profile signature changed.
  assert.match(source, /el\.dataset\.sig !== sig/);
  assert.match(source, /el\.dataset\.sig = noteProfileSignature\(event\)/);
  // Repaints are coalesced to one per animation frame.
  assert.match(source, /function scheduleRenderColumnFeed/);
  assert.match(source, /requestAnimationFrame/);
  // All three surfaces go through the reconciler.
  assert.match(source, /reconcileChildren\(feedEl, events,/);
  assert.match(source, /reconcileChildren\(feedEl, visible,/);
  assert.match(source, /reconcileChildren\(chainEl, chain,/);
  assert.match(source, /reconcileChildren\(repliesEl, replies,/);
  // When a row's profile loads it is patched in place, not rebuilt, so the
  // hovered note's element and its avatar <img> survive.
  assert.match(source, /function updateNoteProfile/);
  assert.match(source, /function updateNotificationRowProfile/);
  assert.match(source, /function updateAvatarEl/);
  assert.match(source, /patch: \(el, e\) => updateNoteProfile\(el, e\)/);
  // The avatar img is only swapped when the picture URL actually changed.
  assert.match(source, /if \(newSrc === curSrc\) return;/);
});

test('nostr profile tags render as people and composer can tag follows', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /function expandIndexedNostrReferences/);
  assert.ok(source.includes('replace(/#\\[(\\d+)\\]/g'));
  assert.match(source, /tag\[0\] === 'p'/);
  assert.match(source, /function parseNprofile/);
  assert.match(source, /decoded\.prefix === 'npub'/);
  assert.match(source, /decoded\.prefix === 'nprofile'/);
  assert.match(source, /function renderNostrProfileMention/);
  assert.match(source, /class=\"nostr-person\"/);
  assert.match(source, /id=\"compose-mention-suggest\"/);
  assert.match(source, /function updateComposeMentionSuggestions/);
  assert.match(source, /function getComposeMentionTrigger/);
  assert.match(source, /function selectComposeMention/);
  assert.match(source, /composeText\.addEventListener\('keydown', handleComposeMentionKeydown\)/);
  assert.match(source, /function mentionTagsFromContent/);
  assert.match(source, /function getEventProfilePubkeys/);
  assert.match(source, /function rerenderColumnsForReferencedProfile/);
  assert.match(source, /function seedProfileHintFromTag/);
  assert.match(source, /profileDiscoveryRelays/);
  assert.match(source, /sendProfileReqToDiscoveryRelays\(subId, filter\)/);
  assert.match(source, /profileSockets/);
  assert.match(source, /publishEvent\(1, text, mentionTagsFromContent\(text\)\)/);
  assert.match(source, /function encodeNprofile/);
});

test('zap notifications resolve human zapper and amount before rendering', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /function getZapSenderPubkey/);
  assert.match(source, /firstTagValue\(event, 'P'\)/);
  assert.match(source, /JSON\.parse\(description\)/);
  assert.match(source, /request\?\.pubkey/);
  assert.match(source, /function parseZapAmountSats/);
  assert.match(source, /firstTagValue\(event, 'amount'\)/);
  assert.match(source, /amountSats: parseZapAmountSats\(event\)/);
  assert.match(source, /zapped your note/);
});

test('broken avatar images retry profile lookups instead of staying as placeholders', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /function renderAvatar/);
  assert.match(source, /data-pubkey="\$\{esc\(pubkey\)\}"/);
  assert.match(source, /onerror="handleAvatarImageError\(this\)"/);
  assert.match(source, /function handleAvatarImageError/);
  assert.match(source, /picture_failed: profile\.picture/);
  assert.match(source, /queueProfileFetch\(pubkey\)/);
});

test('server supports Feedstr-specific Idenstr env names and never returns raw token in config', async () => {
  const source = await readFile(server, 'utf8');
  assert.match(source, /FEEDSTR_IDENSTR_URL/);
  assert.match(source, /FEEDSTR_IDENSTR_TOKEN/);
  assert.match(source, /url\.pathname === '\/api\/v1\/config'/);
  assert.match(source, /updateEnvFile/);
  assert.match(source, /tokenStatusLabel\(cfg\.idenstrToken\)|tokenStatusLabel\(runtimeConfig\.idenstrToken\)/);
  assert.match(source, /return token \? 'configured' : ''/);
  assert.match(source, /\/api\/v1\/stack/);
  assert.doesNotMatch(source, /slice\(0, 8\).*slice\(-4\)/s);
  assert.doesNotMatch(source, /idenstrToken,\s*$/m);
  assert.doesNotMatch(source, /FEEDSTR_HOST_BIND|feedstrHostBind|normalizeBind/);
});
