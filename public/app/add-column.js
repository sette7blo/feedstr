// Add-column modal: type picker, hashtag/profile/custom-feed forms, addColumn.
function showAddColumnModal() {
  const mc = document.getElementById('modal-content');
  mc.innerHTML = `
    <h2>Add column</h2>
    <button class="modal-option" data-type="home">
      ${iconSvg('home')}
      <div class="modal-option-text"><strong>Home</strong><span>Your own posts</span></div>
    </button>
    <button class="modal-option" data-type="following">
      ${iconSvg('user')}
      <div class="modal-option-text"><strong>Following</strong><span>Notes from people you follow</span></div>
    </button>
    <button class="modal-option" data-type="notifications">
      ${iconSvg('bell')}
      <div class="modal-option-text"><strong>Notifications</strong><span>Replies, mentions, reactions, reposts, zaps</span></div>
    </button>
    <button class="modal-option" data-type="hashtag">
      ${iconSvg('hash')}
      <div class="modal-option-text"><strong>Hashtag</strong><span>Follow a topic</span></div>
    </button>
    <button class="modal-option" data-type="profile">
      ${iconSvg('user')}
      <div class="modal-option-text"><strong>Profile</strong><span>One person's posts</span></div>
    </button>
    <button class="modal-option" data-type="custom">
      ${iconSvg('layers')}
      <div class="modal-option-text"><strong>Custom Feed</strong><span>Pick specific follows</span></div>
    </button>
  `;

  mc.querySelectorAll('.modal-option').forEach(btn => {
    btn.onclick = () => handleColumnTypeSelect(btn.dataset.type);
  });
  modal.classList.add('open');
}

function handleColumnTypeSelect(type) {
  if (type === 'hashtag') return showHashtagForm();
  if (type === 'profile') return showProfileForm();
  if (type === 'custom') return showCustomFeedForm();

  const names = { home: 'Home', following: 'Following', mentions: 'Mentions', notifications: 'Notifications' };
  const config = { type, name: names[type] ?? type };
  if (type === 'notifications') config.notificationFilter = 'all';
  addColumn(config);
  closeModal();
}

function showHashtagForm() {
  const mc = document.getElementById('modal-content');
  mc.innerHTML = `
    <h2>Hashtag column</h2>
    <div class="field">
      <label>Hashtag</label>
      <input type="text" id="hashtag-input" placeholder="bitcoin" autofocus />
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="showAddColumnModal()">Back</button>
      <button class="btn btn-primary" id="hashtag-add">Add</button>
    </div>
  `;
  document.getElementById('hashtag-add').onclick = () => {
    const tag = document.getElementById('hashtag-input').value.trim().replace(/^#/, '');
    if (!tag) return;
    addColumn({ type: 'hashtag', name: `#${tag}`, tag });
    closeModal();
  };
  document.getElementById('hashtag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('hashtag-add').click();
  });
}

function showProfileForm() {
  const mc = document.getElementById('modal-content');
  mc.innerHTML = `
    <h2>Profile column</h2>
    <div class="field">
      <label>npub or hex pubkey</label>
      <input type="text" id="profile-input" placeholder="npub1..." autofocus />
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="showAddColumnModal()">Back</button>
      <button class="btn btn-primary" id="profile-add">Add</button>
    </div>
  `;
  document.getElementById('profile-add').onclick = () => {
    const input = document.getElementById('profile-input').value.trim();
    if (!input) return;
    const pubkey = toHexPubkey(input);
    if (!pubkey) { toast('Not a valid npub or hex pubkey', 'error'); return; }
    openOrFocusColumn(
      { type: 'profile', name: shortNpub(input), pubkey },
      c => c.type === 'profile' && c.pubkey === pubkey
    );
    closeModal();
  };
  document.getElementById('profile-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('profile-add').click();
  });
}

function showCustomFeedForm(existing = null) {
  const mc = document.getElementById('modal-content');
  const selectedPubkeys = new Set(existing?.pubkeys ?? []);

  mc.innerHTML = `
    <h2>${existing ? 'Edit' : 'Custom'} feed</h2>
    <div class="field">
      <label>Name</label>
      <input type="text" id="custom-name" placeholder="Privacy Tools" value="${esc(existing?.name ?? '')}" />
    </div>
    <div class="field">
      <label>Select follows (${state.following.length})</label>
      <input type="text" class="follow-picker-search" id="follow-search" placeholder="Search..." />
      <div class="follow-picker" id="follow-picker"></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" id="custom-back">Back</button>
      <button class="btn btn-primary" id="custom-add">${existing ? 'Save' : 'Add'}</button>
    </div>
  `;

  function renderPicker(filter = '') {
    const picker = document.getElementById('follow-picker');
    const lf = filter.toLowerCase();
    const filtered = state.following.filter(f =>
      !lf || f.name.toLowerCase().includes(lf) || f.petname.toLowerCase().includes(lf) || f.pubkey.includes(lf)
    );
    picker.innerHTML = '';
    for (const f of filtered) {
      const item = document.createElement('label');
      item.className = `follow-picker-item${selectedPubkeys.has(f.pubkey) ? ' selected' : ''}`;
      item.innerHTML = `
        <input type="checkbox" ${selectedPubkeys.has(f.pubkey) ? 'checked' : ''} />
        <span>${esc(f.name || f.petname || shortNpub(f.pubkey))}</span>
      `;
      item.querySelector('input').onchange = (e) => {
        if (e.target.checked) selectedPubkeys.add(f.pubkey);
        else selectedPubkeys.delete(f.pubkey);
        item.classList.toggle('selected', e.target.checked);
      };
      picker.appendChild(item);
    }
  }

  renderPicker();
  document.getElementById('follow-search').oninput = (e) => renderPicker(e.target.value);
  document.getElementById('custom-back').onclick = () => existing ? closeModal() : showAddColumnModal();
  document.getElementById('custom-add').onclick = () => {
    const name = document.getElementById('custom-name').value.trim() || 'Custom';
    const pubkeys = [...selectedPubkeys];
    if (!pubkeys.length) return;
    if (existing) {
      existing.name = name;
      existing.pubkeys = pubkeys;
      renderColumns();
    } else {
      addColumn({ type: 'custom', name, pubkeys });
    }
    closeModal();
  };
}

function editCustomColumn(col) {
  showCustomFeedForm(col);
  modal.classList.add('open');
}

// Smoothly bring a column into view. On mobile each column is 100vw, so a column
// added at the end of the deck would otherwise sit off-screen to the right and the
// viewport would stay pinned to the first column. rAF lets the new DOM lay out first.
function scrollColumnIntoView(id) {
  requestAnimationFrame(() => {
    document.querySelector(`.column[data-col="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  });
}

function addColumn(config) {
  const id = genId();
  const col = { id, events: [], ...config };
  state.columns.push(col);
  buildColumnDom(col, document.getElementById('columns'), document.getElementById('column-list'));
  saveColumns();
  scrollColumnIntoView(id);
  return id;
}

// Open a column, or focus the matching existing one instead of stacking a duplicate.
function openOrFocusColumn(config, matchFn) {
  const existing = matchFn ? state.columns.find(matchFn) : null;
  if (existing) {
    scrollColumnIntoView(existing.id);
    return existing;
  }
  addColumn(config);
  return state.columns[state.columns.length - 1];
}

// Fast lookup set for the avatar follow-ring, rebuilt whenever the follow list changes.
