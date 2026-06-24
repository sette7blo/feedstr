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
  assert.match(source, /styles\.css\?v=mobile-input-zoom-fix-2/);
  assert.match(css, /iOS Safari auto-zooms focused form controls below 16px/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\), \(max-width: 900px\) \{[\s\S]*input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\),[\s\S]*textarea,[\s\S]*select[\s\S]*font-size: 16px !important;/);
});

test('Feedstr signs through Idenstr instead of holding keys or calling admin publish endpoints', async () => {
  const source = await readFile(html, 'utf8');
  assert.match(source, /\/api\/v1\/idenstr\/sign/);
  assert.doesNotMatch(source, /\/api\/v1\/idenstr\/events\/publish/);
  assert.doesNotMatch(source, /IDENSTR_NSEC|FEEDSTR_NSEC|NOSTR_PRIVATE_KEY/);
});

test('Feedstr exposes Idenstr connection guidance and required scoped token permissions', async () => {
  const source = await readFile(html, 'utf8');
  for (const scope of ['profile:read', 'following:read', 'following:write', 'mutes:read', 'mutes:write', 'relays:read', 'sign:kind:1', 'sign:kind:6', 'sign:kind:7', 'sign:kind:27235']) {
    assert.match(source, new RegExp(scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
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
  assert.match(source, /composeMediaUploadInFlight/);
  assert.match(source, /file\.size > 20 \* 1024 \* 1024/);
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 90000\)/);
  assert.match(source, /form\.append\('file'/);
  assert.match(source, /fetch\('\/api\/v1\/media\/upload', \{ method: 'POST', body: form, signal: controller\.signal \}\)/);
  assert.match(source, /appendComposeMediaUrl\(url\)/);
  assert.match(source, /Uploaded: \$\{url\}/);
  assert.match(serverSource, /'Content-Length': Buffer\.byteLength\(body\)/);
  assert.match(serverSource, /'Connection': 'close'/);
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

test('nostr event references render as event cards instead of raw URLs', async () => {
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
  assert.match(source, /maskToken\(cfg\.idenstrToken\)|maskToken\(runtimeConfig\.idenstrToken\)/);
  assert.match(source, /return token \? 'configured' : ''/);
  assert.match(source, /\/api\/v1\/stack/);
  assert.doesNotMatch(source, /slice\(0, 8\).*slice\(-4\)/s);
  assert.doesNotMatch(source, /idenstrToken,\s*$/m);
  assert.doesNotMatch(source, /FEEDSTR_HOST_BIND|feedstrHostBind|normalizeBind/);
});
