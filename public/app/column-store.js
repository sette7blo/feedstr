// Column list persistence: defaults, load/save, reload, remove.
function removeColumnCache(id) {
  clearTimeout(cacheTimers.get(id));
  cacheTimers.delete(id);
  api(`/api/v1/cache/${id}`, { method: 'DELETE' }).catch(() => {});
}

function reloadColumn(col) {
  // Refresh should be additive and non-destructive. Keep the visible cache on
  // screen, keep the de-dupe set, and only replace the live relay subscription.
  // Clearing first makes large Following columns look empty and forces a full DOM
  // rebuild while relays are already busy answering the new request.
  unsubscribe(`replies_${col.id}`);
  unsubscribe(`engagement_${col.id}`);
  col._ids = new Set((col.events ?? []).map(e => e.id));
  setColumnRefreshing(col, true);
  startColumnSub(col);
  updateColumnHeaderMeta(col);
}

function removeColumn(id) {
  unsubscribe(`col_${id}`);
  unsubscribe(`notification_own_${id}`);
  unsubscribe(`quotes_${id}`);
  unsubscribe(`replies_${id}`);
  unsubscribe(`engagement_${id}`);
  unsubscribe(`thread_replies_${id}`);
  state.columns = state.columns.filter(c => c.id !== id);
  removeColumnCache(id);
  document.querySelector(`.column[data-col="${id}"]`)?.remove();
  document.querySelector(`#column-list [data-side-col="${id}"]`)?.remove();
  pruneMemory();
  saveColumns();
}

const DEFAULT_COLUMNS = () => [
  { id: genId(), type: 'home', name: 'Home' },
  { id: genId(), type: 'following', name: 'Following' },
  { id: genId(), type: 'notifications', name: 'Notifications', notificationFilter: 'all' }
];

async function loadColumns() {
  try {
    const { value } = await api('/api/v1/state/columns');
    if (Array.isArray(value) && value.length) return value;
  } catch {}
  // One-time migration of columns saved by older versions in browser storage.
  const legacy = localStorage.getItem('feedstr:columns');
  if (legacy) {
    try {
      const cols = JSON.parse(legacy);
      if (Array.isArray(cols) && cols.length) {
        await persistColumns(cols);
        localStorage.removeItem('feedstr:columns');
        return cols;
      }
    } catch {}
  }
  return DEFAULT_COLUMNS();
}

async function persistColumns(columns) {
  // Persist only column configuration; everything else (events, dedup set, open
  // thread, scroll markers) is runtime state that must not survive a reload.
  const serializable = columns.map((c) => {
    const out = { id: c.id, type: c.type, name: c.name };
    if (c.pubkey) out.pubkey = c.pubkey;
    if (c.pubkeys) out.pubkeys = c.pubkeys;
    if (c.tag) out.tag = c.tag;
    if (c.notificationFilter) out.notificationFilter = c.notificationFilter;
    if (c.feedMode) out.feedMode = c.feedMode;
    return out;
  });
  try {
    await api('/api/v1/state/columns', { method: 'PUT', body: { value: serializable } });
  } catch (err) {
    console.warn('Failed to save columns', err.message);
  }
}

// Liked note ids live in Feedstr's DB so the heart stays filled across reloads;
// the like itself is the published kind:7 reaction vaulted in the private relay.
