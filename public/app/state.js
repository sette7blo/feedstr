/** Feedstr process-wide browser state. Loaded before main.js. */
var state = {
  identity: null,
  relays: { read: [], write: [] },
  following: [],
  columns: [],
  subs: new Map(),
  sockets: new Map(),
  profileSockets: new Map(),
  embeddedSockets: new Map(),
  notes: new Map(),
  eventRelays: new Map(), // eventId -> Set of relay URLs where the event was seen
  liked: new Set(),
  mutes: { entries: [] }, // Idenstr kind:10000 mute list; suppresses keywords, people, threads, and events
  likeEvents: new Map(), // noteId -> our own kind:7 reaction event id (for un-like)
  replyCounts: new Map(), // noteId -> Set of reply event ids
  reactionCounts: new Map(), // noteId -> Set of kind:7 event ids
  repostCounts: new Map(), // noteId -> Set of kind:6 event ids
  embeddedEventFetchTried: new Set(),
  profiles: new Map(),
  profileFetchTried: new Set(),
  profileFetchAttempts: new Map(),
  config: null,
  idenstrStatus: null,
  composeMentionIndex: [],
  composeMentions: [],
  zapDefaultSats: 100, // one-tap zap amount; overridden from the state store at boot
  zapWallet: { loading: true, configured: false, balanceMsat: null, balanceAt: null, error: '' }
};

// Populated from /api/v1/config at boot — Feedstr's server is the single source
// of truth for the scope list, so it can't drift from a hardcoded frontend copy.
var requiredIdenstrScopes = [];
var profileDiscoveryRelays = ['wss://purplepag.es', 'wss://user.kindpag.es'];
