# Feedstr module map

Where things live, so you can open one file instead of reading the app. Sizes are a hint
about what a full read costs.

## Frontend — `public/app/*.js`

Plain classic scripts loaded in order by `index.html`. No modules, no bundler: every
top-level function and `const` is shared globally, so load order only matters for code that
runs at load time. `state.js` must be first, `init.js` last; the rest is order-tolerant.

| File | Lines | Owns |
|---|---:|---|
| `state.js` | 34 | Global mutable app state. Read this first when tracing data flow. |
| `icons.js` | 26 | Inline SVG icon strings |
| `helpers.js` | 439 | Formatting, escaping, NIP-19 parsing, content rendering, `toast()` |
| `boot.js` | 571 | Startup, Idenstr config/handshake, settings modal, connection chip |
| `relays.js` | 171 | Relay sockets, reconnect/backoff, subscription plumbing |
| `events.js` | 148 | Inbound event intake, dedup, sorted insert |
| `profiles.js` | 231 | kind:0 metadata cache, fetch scheduler, avatar resolution |
| `columns.js` | 419 | Column shell, headers/metadata, **feed-mode filters**, subscriptions |
| `column-feed.js` | 228 | Profile-column hero, feed rendering, "N new notes" pill |
| `notifications.js` | 284 | Notifications column: normalize, group, filter, rows |
| `notes.js` | 246 | Note rendering + the DOM reconciler that patches rows in place |
| `threads.js` | 163 | Conversation view: open, fetch replies, build the chain |
| `interactions.js` | 591 | Note actions: like, boost sheet, zap, raw JSON, overflow menu |
| `compose.js` | 490 | Composer and inline replies, image upload, live previews |
| `overlays.js` | 198 | Modal chrome, mobile drawer, **media lightbox** |
| `add-column.js` | 201 | Add-column modal, hashtag/profile/custom-feed forms |
| `follow.js` | 83 | Follow/unfollow through Idenstr; open profile/hashtag columns |
| `column-store.js` | 80 | Column list defaults, load/save, reload, remove |
| `mutes.js` | 219 | Liked state, default zap amount, keyword/profile/thread mutes |
| `counts-cache.js` | 210 | Reply + engagement counts, per-column note cache, memory pruning |

`public/styles.css` is ~3,280 lines — **do not read it whole**. Its header explains the
layout; `grep -n "^/\*" public/styles.css` is the live section index.

## Backend — `src/`

| File | Lines | Owns |
|---|---:|---|
| `server.js` | 450 | HTTP API, static serving, Idenstr proxying, image upload |
| `app/db.js` | 112 | `node:sqlite` schema and prepared statements |

## Common tasks

| Task | Open |
|---|---|
| Timeline filter behavior | `columns.js` |
| A note renders wrong | `notes.js`, then `helpers.js` for content parsing |
| Lightbox / image viewing | `overlays.js` + the lightbox CSS block |
| Note action buttons | `interactions.js` |
| Posting, replying, uploads | `compose.js` |
| Follow or mute behavior | `follow.js` / `mutes.js` |
| Relay connection problems | `relays.js`, then `boot.js` for config |
| Anything persisted | `column-store.js`, `mutes.js`, `src/app/db.js` |

## Rules that bite

- **Bump the `?v=` cache-buster** in `index.html` for every edited JS/CSS file. Assets are
  immutable-cached; skip this and devices keep running old code.
- **Feedstr never signs.** Unsigned events go to Idenstr. `kind:3` is Idenstr-owned.
- Adding or splitting a module means adding its `<script>` tag — the test suite derives the
  module list from `index.html` and fails on any orphan or mismatch.
