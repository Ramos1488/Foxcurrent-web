/* ===== STORAGE KEYS ===== */
const KEYS = {
  projects: 'rr_projects',
  blog: 'rr_blog',
  news: 'rr_news',
  team: 'rr_team',
  admin: 'rr_admin_session'
};

/* ===== ADMIN AUTH (SHA-256 hash — plaintext password is not stored) ===== */
// Hash of the admin password. To set a new password:
//   echo -n "your_password" | sha256sum
// and replace the value below.
const ADMIN_HASH = '2b0abf97e4d1ae0f6c950e3dfd93ba3b4f81de2485e11f075d4cdcd007b068c7';
let isAdmin = false;

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function checkAdminSession() {
  try {
    const raw = sessionStorage.getItem(KEYS.admin);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data && data.ok && Date.now() - data.ts < 8 * 60 * 60 * 1000) {
      return true;
    }
  } catch (_) {}
  return false;
}

function setAdminSession(ok) {
  if (ok) {
    sessionStorage.setItem(KEYS.admin, JSON.stringify({ ok: true, ts: Date.now() }));
    isAdmin = true;
  } else {
    sessionStorage.removeItem(KEYS.admin);
    isAdmin = false;
  }
  updateAdminUI();
}

function updateAdminUI() {
  document.body.classList.toggle('is-admin', isAdmin);

  const btn = document.getElementById('adminBtn');
  const label = document.getElementById('adminBtnLabel');
  if (btn) {
    btn.classList.toggle('logged-in', isAdmin);
    if (label) label.textContent = isAdmin ? t('admin.logout') : t('admin.login');
  }

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  renderProjects();
  renderBlog();
  renderNews();
  renderTeam();
  renderHero();
}

/* ===== HELPERS ===== */
function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}
function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function formatNumber(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(currentLang === 'ru' ? 'ru-RU' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => el.classList.remove('show'), 3200);
}
function parsePlaceId(input) {
  if (!input) return null;
  input = input.trim();
  // Pure number
  if (/^\d+$/.test(input)) return input;
  // URL patterns
  const m = input.match(/roblox\.com\/(?:games|experiences)\/(\d+)/i)
    || input.match(/[?&]placeId=(\d+)/i)
    || input.match(/\/(\d{6,})/);
  return m ? m[1] : null;
}

/* ===== ROBLOX API (via roproxy to avoid CORS) ===== */
async function fetchRobloxGame(placeId) {
  // 1. Get universeId
  const uniRes = await fetch(`https://apis.roproxy.com/universes/v1/places/${placeId}/universe`);
  if (!uniRes.ok) throw new Error('universe');
  const uniData = await uniRes.json();
  const universeId = uniData.universeId;
  if (!universeId) throw new Error('no universe');

  // 2. Game details
  const gameRes = await fetch(`https://games.roproxy.com/v1/games?universeIds=${universeId}`);
  if (!gameRes.ok) throw new Error('game');
  const gameData = await gameRes.json();
  const game = gameData.data && gameData.data[0];
  if (!game) throw new Error('no game');

  // 3. Thumbnail (icon)
  let thumbnail = null;
  try {
    const thumbRes = await fetch(
      `https://thumbnails.roproxy.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`
    );
    if (thumbRes.ok) {
      const thumbData = await thumbRes.json();
      if (thumbData.data && thumbData.data[0] && thumbData.data[0].imageUrl) {
        thumbnail = thumbData.data[0].imageUrl;
      }
    }
  } catch (_) {}

  // Fallback thumbnail via place
  if (!thumbnail) {
    try {
      const thumbRes2 = await fetch(
        `https://thumbnails.roproxy.com/v1/places/gameicons?placeIds=${placeId}&size=512x512&format=Png&isCircular=false`
      );
      if (thumbRes2.ok) {
        const t2 = await thumbRes2.json();
        if (t2.data && t2.data[0] && t2.data[0].imageUrl) {
          thumbnail = t2.data[0].imageUrl;
        }
      }
    } catch (_) {}
  }

  return {
    placeId: String(placeId),
    universeId: String(universeId),
    name: game.name || 'Unknown Game',
    description: game.description || '',
    creator: game.creator?.name || 'Unknown',
    creatorType: game.creator?.type || 'User',
    visits: game.visits || 0,
    playing: game.playing || 0,
    maxPlayers: game.maxPlayers || 0,
    created: game.created,
    updated: game.updated,
    rootPlaceId: game.rootPlaceId || placeId,
    thumbnail: thumbnail || `https://www.roblox.com/asset-thumbnail/image?assetId=${placeId}&width=768&height=432&format=png`,
    url: `https://www.roblox.com/games/${placeId}`
  };
}

/* ===== STATE ===== */
let projects = load(KEYS.projects);
let blogPosts = load(KEYS.blog);
let newsItems = load(KEYS.news);
let teamMembers = load(KEYS.team);

/* ===== RENDER PROJECTS ===== */
function statusLabel(s) {
  return t('status.' + s) || s;
}

function renderProjects() {
  const grid = document.getElementById('projectsGrid');
  const empty = document.getElementById('projectsEmpty');
  grid.innerHTML = '';

  if (projects.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  projects.forEach(p => {
    const card = document.createElement('article');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-thumb">
        <img src="${p.thumbnail}" alt="${escapeHtml(p.name)}" loading="lazy"
             onerror="this.src='https://tr.rbxcdn.com/180DAY-placeholder/512/512/Image/Png/noFilter'">
        <span class="project-status status-${p.status}">${statusLabel(p.status)}</span>
      </div>
      <div class="project-body">
        <h3 class="project-name">${escapeHtml(p.name)}</h3>
        <p class="project-desc">${escapeHtml(p.description || '')}</p>
        <div class="project-meta">
          <span>${formatNumber(p.visits)} ${t('meta.visits')}</span>
          <span>${formatNumber(p.playing)} ${t('meta.playing')}</span>
          <span>${t('meta.creator')} ${escapeHtml(p.creator)}</span>
        </div>
        <div class="project-actions">
          <a href="${p.url}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">${t('btn.play')}</a>
          ${isAdmin ? `
          <button class="btn btn-ghost btn-sm" data-action="edit-status" data-id="${p.id}">${t('btn.edit')}</button>
          <button class="btn btn-danger btn-sm" data-action="delete-project" data-id="${p.id}">${t('btn.delete')}</button>
          ` : ''}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function linkify(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?"')\]])/g,
    '<a href="$1" class="post-link" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

const SOCIAL_KEYS = [
  { key: 'roblox', label: 'Roblox' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'x', label: 'X' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'discord', label: 'Discord' },
  { key: 'github', label: 'GitHub' }
];

/* ===== IMAGE UPLOAD (base64, resized) ===== */
const MAX_IMG_SIDE = 1200;
const MAX_IMG_QUALITY = 0.72;

function readImageAsDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('not-image'));
      return;
    }
    // ~2.5MB limit before resize
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('too-large'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, MAX_IMG_SIDE / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', MAX_IMG_QUALITY));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function bindImagePicker(inputId, previewId, stateRef) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input) return;
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const dataUrl = await readImageAsDataURL(file);
      stateRef.image = dataUrl;
      if (preview) {
        preview.innerHTML = `<img src="${dataUrl}" alt=""><button type="button" class="btn btn-ghost btn-sm" id="removeImgBtn">${t('btn.removeImage')}</button>`;
        document.getElementById('removeImgBtn').onclick = () => {
          stateRef.image = null;
          preview.innerHTML = '';
          input.value = '';
        };
      }
    } catch (err) {
      toast(err.message === 'too-large' ? t('toast.imageLarge') : t('toast.imageError'), 'error');
      input.value = '';
    }
  };
}


/* ===== RENDER BLOG ===== */
function renderBlog() {
  const list = document.getElementById('blogList');
  const empty = document.getElementById('blogEmpty');
  list.innerHTML = '';

  if (blogPosts.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // newest first
  [...blogPosts].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(post => {
    const card = document.createElement('article');
    card.className = 'blog-card';
    const imgHtml = post.image ? `<div class="post-image"><img src="${post.image}" alt="" loading="lazy"></div>` : '';
    card.innerHTML = `
      ${imgHtml}
      <div class="blog-meta">
        <span>${formatDate(post.date)}</span>
      </div>
      <h3 class="blog-title">${escapeHtml(post.title)}</h3>
      <div class="blog-excerpt">${linkify(post.content)}</div>
      ${isAdmin ? `
      <div class="blog-actions-row">
        <button class="btn btn-ghost btn-sm" data-action="edit-blog" data-id="${post.id}">${t('btn.edit')}</button>
        <button class="btn btn-danger btn-sm" data-action="delete-blog" data-id="${post.id}">${t('btn.delete')}</button>
      </div>` : ''}
    `;
    list.appendChild(card);
  });
}

/* ===== RENDER NEWS ===== */
function renderNews() {
  const grid = document.getElementById('newsGrid');
  const empty = document.getElementById('newsEmpty');
  grid.innerHTML = '';

  if (newsItems.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  [...newsItems].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(item => {
    const card = document.createElement('article');
    card.className = 'news-card';
    const imgHtml = item.image ? `<div class="post-image"><img src="${item.image}" alt="" loading="lazy"></div>` : '';
    card.innerHTML = `
      ${imgHtml}
      <div class="news-date">${formatDate(item.date)}</div>
      <h3 class="news-title">${escapeHtml(item.title)}</h3>
      <div class="news-body">${linkify(item.content)}</div>
      ${isAdmin ? `
      <div class="blog-actions-row">
        <button class="btn btn-ghost btn-sm" data-action="edit-news" data-id="${item.id}">${t('btn.edit')}</button>
        <button class="btn btn-danger btn-sm" data-action="delete-news" data-id="${item.id}">${t('btn.delete')}</button>
      </div>` : ''}
    `;
    grid.appendChild(card);
  });
}

/* ===== HERO STATS ===== */
function renderHero() {
  const g = document.getElementById('statGames');
  const o = document.getElementById('statOnline');
  const teamEl = document.getElementById('statTeam');
  if (g) g.textContent = projects.length;
  if (o) o.textContent = projects.filter(p => p.status === 'online').length;
  if (teamEl) teamEl.textContent = teamMembers.length;
}

function renderAll() {
  renderProjects();
  renderBlog();
  renderNews();
  renderTeam();
  renderHero();
}

/* ===== ADD GAME ===== */
async function addGame() {
  const input = document.getElementById('gameUrlInput');
  const statusSelect = document.getElementById('gameStatusSelect');
  const placeId = parsePlaceId(input.value);

  if (!placeId) {
    toast(t('toast.notFound'), 'error');
    return;
  }

  // prevent duplicates
  if (projects.some(p => p.placeId === placeId)) {
    toast(currentLang === 'ru' ? 'Эта игра уже добавлена' : 'Game already added', 'error');
    return;
  }

  const btn = document.getElementById('addGameBtn');
  btn.disabled = true;
  btn.textContent = '…';
  toast(t('toast.fetching'));

  try {
    const data = await fetchRobloxGame(placeId);
    const project = {
      id: uid(),
      status: statusSelect.value,
      addedAt: new Date().toISOString(),
      ...data
    };
    projects.unshift(project);
    save(KEYS.projects, projects);
    input.value = '';
    renderAll();
    toast(t('toast.added'));
  } catch (err) {
    console.error(err);
    toast(t('toast.notFound'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('projects.add');
  }
}

/* ===== MODAL ===== */
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modalContent');

function openModal(html) {
  modalContent.innerHTML = html;
  modal.classList.add('open');
}
function closeModal() {
  modal.classList.remove('open');
}

document.getElementById('modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

/* ===== EDIT STATUS ===== */
function openEditStatus(id) {
  const p = projects.find(x => x.id === id);
  if (!p) return;

  const options = ['in_dev', 'coming_soon', 'online', 'beta', 'maintenance', 'offline']
    .map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`)
    .join('');

  openModal(`
    <h3>${t('modal.editStatus')}</h3>
    <p style="margin-bottom:16px;color:var(--text-muted);">${escapeHtml(p.name)}</p>
    <label>${t('modal.status')}</label>
    <select id="editStatusSelect">${options}</select>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">${t('btn.cancel')}</button>
      <button class="btn btn-primary" id="modalSaveStatus">${t('btn.save')}</button>
    </div>
  `);

  document.getElementById('modalCancel').onclick = closeModal;
  document.getElementById('modalSaveStatus').onclick = () => {
    p.status = document.getElementById('editStatusSelect').value;
    save(KEYS.projects, projects);
    closeModal();
    renderAll();
    toast(t('toast.updated'));
  };
}

/* ===== BLOG / NEWS CRUD ===== */
function openBlogModal(id = null) {
  const post = id ? blogPosts.find(x => x.id === id) : null;
  const imgState = { image: post && post.image ? post.image : null };
  const previewHtml = imgState.image
    ? `<img src="${imgState.image}" alt=""><button type="button" class="btn btn-ghost btn-sm" id="removeImgBtn">${t('btn.removeImage')}</button>`
    : '';
  openModal(`
    <h3>${post ? t('modal.editBlog') : t('modal.newBlog')}</h3>
    <label>${t('modal.title')}</label>
    <input type="text" id="blogTitle" value="${post ? escapeHtml(post.title) : ''}">
    <label>${t('modal.content')}</label>
    <textarea id="blogContent">${post ? escapeHtml(post.content) : ''}</textarea>
    <label>${t('modal.image')}</label>
    <input type="file" id="blogImage" accept="image/*">
    <div class="image-preview" id="blogImagePreview">${previewHtml}</div>
    <p class="form-hint">${t('modal.imageHint')}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">${t('btn.cancel')}</button>
      <button class="btn btn-primary" id="modalSaveBlog">${t('btn.save')}</button>
    </div>
  `);
  document.getElementById('modalCancel').onclick = closeModal;
  if (document.getElementById('removeImgBtn')) {
    document.getElementById('removeImgBtn').onclick = () => {
      imgState.image = null;
      document.getElementById('blogImagePreview').innerHTML = '';
      document.getElementById('blogImage').value = '';
    };
  }
  bindImagePicker('blogImage', 'blogImagePreview', imgState);
  document.getElementById('modalSaveBlog').onclick = () => {
    const title = document.getElementById('blogTitle').value.trim();
    const content = document.getElementById('blogContent').value.trim();
    if (!title) return;
    if (post) {
      post.title = title;
      post.content = content;
      post.image = imgState.image || null;
    } else {
      blogPosts.unshift({
        id: uid(),
        title,
        content,
        image: imgState.image || null,
        date: new Date().toISOString()
      });
    }
    try {
      save(KEYS.blog, blogPosts);
    } catch (e) {
      toast(t('toast.storageFull'), 'error');
      return;
    }
    closeModal();
    renderAll();
    toast(t('toast.updated'));
  };
}

function openNewsModal(id = null) {
  const item = id ? newsItems.find(x => x.id === id) : null;
  const imgState = { image: item && item.image ? item.image : null };
  const previewHtml = imgState.image
    ? `<img src="${imgState.image}" alt=""><button type="button" class="btn btn-ghost btn-sm" id="removeImgBtn">${t('btn.removeImage')}</button>`
    : '';
  openModal(`
    <h3>${item ? t('modal.editNews') : t('modal.newNews')}</h3>
    <label>${t('modal.title')}</label>
    <input type="text" id="newsTitle" value="${item ? escapeHtml(item.title) : ''}">
    <label>${t('modal.content')}</label>
    <textarea id="newsContent">${item ? escapeHtml(item.content) : ''}</textarea>
    <label>${t('modal.image')}</label>
    <input type="file" id="newsImage" accept="image/*">
    <div class="image-preview" id="newsImagePreview">${previewHtml}</div>
    <p class="form-hint">${t('modal.imageHint')}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">${t('btn.cancel')}</button>
      <button class="btn btn-primary" id="modalSaveNews">${t('btn.save')}</button>
    </div>
  `);
  document.getElementById('modalCancel').onclick = closeModal;
  if (document.getElementById('removeImgBtn')) {
    document.getElementById('removeImgBtn').onclick = () => {
      imgState.image = null;
      document.getElementById('newsImagePreview').innerHTML = '';
      document.getElementById('newsImage').value = '';
    };
  }
  bindImagePicker('newsImage', 'newsImagePreview', imgState);
  document.getElementById('modalSaveNews').onclick = () => {
    const title = document.getElementById('newsTitle').value.trim();
    const content = document.getElementById('newsContent').value.trim();
    if (!title) return;
    if (item) {
      item.title = title;
      item.content = content;
      item.image = imgState.image || null;
    } else {
      newsItems.unshift({
        id: uid(),
        title,
        content,
        image: imgState.image || null,
        date: new Date().toISOString()
      });
    }
    try {
      save(KEYS.news, newsItems);
    } catch (e) {
      toast(t('toast.storageFull'), 'error');
      return;
    }
    closeModal();
    renderAll();
    toast(t('toast.updated'));
  };
}


/* ===== TEAM / CONTRIBUTORS ===== */
function renderTeam() {
  const grid = document.getElementById('teamGrid');
  const empty = document.getElementById('teamEmpty');
  if (!grid) return;
  grid.innerHTML = '';
  if (teamMembers.length === 0) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  teamMembers.forEach((m, i) => {
    const card = document.createElement('article');
    card.className = 'team-card';
    card.style.animationDelay = (i * 0.05) + 's';
    const initial = (m.name || '?').charAt(0).toUpperCase();
    const av = m.avatar
      ? `<img class="team-avatar" src="${m.avatar}" alt="">`
      : `<div class="team-avatar-placeholder">${escapeHtml(initial)}</div>`;
    const links = SOCIAL_KEYS
      .filter(s => m.links && m.links[s.key])
      .map(s => `<a class="team-link" href="${escapeHtml(m.links[s.key])}" target="_blank" rel="noopener">${s.label}</a>`)
      .join('');
    card.innerHTML = `
      <div class="team-top">
        ${av}
        <div>
          <div class="team-name">${escapeHtml(m.name)}</div>
          <div class="team-role">${escapeHtml(m.role || '')}</div>
        </div>
      </div>
      ${links ? `<div class="team-links">${links}</div>` : ''}
      ${isAdmin ? `
      <div class="blog-actions-row">
        <button class="btn btn-ghost btn-sm" data-action="edit-team" data-id="${m.id}">${t('btn.edit')}</button>
        <button class="btn btn-danger btn-sm" data-action="delete-team" data-id="${m.id}">${t('btn.delete')}</button>
      </div>` : ''}
    `;
    grid.appendChild(card);
  });
}

function openTeamModal(id = null) {
  const member = id ? teamMembers.find(x => x.id === id) : null;
  const links = (member && member.links) || {};
  const imgState = { image: member && member.avatar ? member.avatar : null };
  const previewHtml = imgState.image
    ? `<img src="${imgState.image}" alt=""><button type="button" class="btn btn-ghost btn-sm" id="removeImgBtn">${t('btn.removeImage')}</button>`
    : '';
  const linkFields = SOCIAL_KEYS.map(s => `
    <div>
      <label>${s.label}</label>
      <input type="url" id="link_${s.key}" placeholder="https://..." value="${escapeHtml(links[s.key] || '')}">
    </div>
  `).join('');

  openModal(`
    <h3>${member ? t('team.edit') : t('team.add')}</h3>
    <label>${t('team.name')}</label>
    <input type="text" id="teamName" value="${member ? escapeHtml(member.name) : ''}">
    <label>${t('team.role')}</label>
    <input type="text" id="teamRole" value="${member ? escapeHtml(member.role || '') : ''}" placeholder="Developer, Designer...">
    <label>${t('modal.image')}</label>
    <input type="file" id="teamImage" accept="image/*">
    <div class="image-preview" id="teamImagePreview">${previewHtml}</div>
    <label>${t('team.links')}</label>
    <div class="link-grid">${linkFields}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">${t('btn.cancel')}</button>
      <button class="btn btn-primary" id="modalSaveTeam">${t('btn.save')}</button>
    </div>
  `);
  document.getElementById('modalCancel').onclick = closeModal;
  if (document.getElementById('removeImgBtn')) {
    document.getElementById('removeImgBtn').onclick = () => {
      imgState.image = null;
      document.getElementById('teamImagePreview').innerHTML = '';
      document.getElementById('teamImage').value = '';
    };
  }
  bindImagePicker('teamImage', 'teamImagePreview', imgState);
  document.getElementById('modalSaveTeam').onclick = () => {
    const name = document.getElementById('teamName').value.trim();
    if (!name) return;
    const role = document.getElementById('teamRole').value.trim();
    const newLinks = {};
    SOCIAL_KEYS.forEach(s => {
      const v = document.getElementById('link_' + s.key).value.trim();
      if (v) newLinks[s.key] = v;
    });
    if (member) {
      member.name = name;
      member.role = role;
      member.avatar = imgState.image || null;
      member.links = newLinks;
    } else {
      teamMembers.push({
        id: uid(),
        name,
        role,
        avatar: imgState.image || null,
        links: newLinks
      });
    }
    try {
      save(KEYS.team, teamMembers);
    } catch (e) {
      toast(t('toast.storageFull'), 'error');
      return;
    }
    closeModal();
    renderAll();
    toast(t('toast.updated'));
  };
}

/* ===== DELEGATED CLICKS ===== */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (!isAdmin) {
    toast(t('admin.title'), 'error');
    openLoginModal();
    return;
  }
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'edit-status') openEditStatus(id);
  if (action === 'delete-project') {
    if (confirm(currentLang === 'ru' ? 'Удалить игру?' : 'Delete this game?')) {
      projects = projects.filter(p => p.id !== id);
      save(KEYS.projects, projects);
      renderAll();
      toast(t('toast.deleted'));
    }
  }
  if (action === 'edit-blog') openBlogModal(id);
  if (action === 'delete-blog') {
    if (confirm(currentLang === 'ru' ? 'Удалить пост?' : 'Delete this post?')) {
      blogPosts = blogPosts.filter(p => p.id !== id);
      save(KEYS.blog, blogPosts);
      renderAll();
      toast(t('toast.deleted'));
    }
  }
  if (action === 'edit-news') openNewsModal(id);
  if (action === 'delete-news') {
    if (confirm(currentLang === 'ru' ? 'Удалить новость?' : 'Delete this news?')) {
      newsItems = newsItems.filter(n => n.id !== id);
      save(KEYS.news, newsItems);
      renderAll();
      toast(t('toast.deleted'));
    }
  }
  if (action === 'edit-team') openTeamModal(id);
  if (action === 'delete-team') {
    if (confirm(currentLang === 'ru' ? 'Удалить участника?' : 'Remove this contributor?')) {
      teamMembers = teamMembers.filter(m => m.id !== id);
      save(KEYS.team, teamMembers);
      renderAll();
      toast(t('toast.deleted'));
    }
  }
});

/* ===== NAV ===== */
const nav = document.getElementById('nav');
const menuBtn = document.getElementById('menuBtn');
menuBtn.addEventListener('click', () => nav.classList.toggle('open'));

document.querySelectorAll('[data-nav]').forEach(link => {
  link.addEventListener('click', () => {
    nav.classList.remove('open');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const target = link.getAttribute('data-nav') || link.getAttribute('href')?.slice(1);
    document.querySelectorAll(`.nav-link[data-nav="${target}"]`).forEach(l => l.classList.add('active'));
  });
});

// Active section on scroll
const sections = document.querySelectorAll('section[id]');
window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(sec => {
    if (window.scrollY >= sec.offsetTop - 120) current = sec.id;
  });
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.getAttribute('data-nav') === current);
  });
});

/* ===== LOGIN MODAL ===== */
const loginModal = document.getElementById('loginModal');

function openLoginModal() {
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('adminPassword').value = '';
  loginModal.classList.add('open');
  setTimeout(() => document.getElementById('adminPassword').focus(), 100);
}
function closeLoginModal() {
  loginModal.classList.remove('open');
}

document.getElementById('loginModalClose').addEventListener('click', closeLoginModal);
document.getElementById('loginCancel').addEventListener('click', closeLoginModal);
loginModal.addEventListener('click', e => { if (e.target === loginModal) closeLoginModal(); });

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pass = document.getElementById('adminPassword').value;
  const hash = await sha256(pass);
  if (hash === ADMIN_HASH) {
    setAdminSession(true);
    closeLoginModal();
    toast(t('admin.welcome'));
  } else {
    document.getElementById('loginError').style.display = 'block';
    document.getElementById('adminPassword').value = '';
    document.getElementById('adminPassword').focus();
  }
});

document.getElementById('adminBtn').addEventListener('click', () => {
  if (isAdmin) {
    setAdminSession(false);
    toast(t('admin.loggedOut'));
  } else {
    openLoginModal();
  }
});

/* ===== INIT ===== */
document.getElementById('addGameBtn').addEventListener('click', () => {
  if (!isAdmin) { openLoginModal(); return; }
  addGame();
});
document.getElementById('gameUrlInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (!isAdmin) { openLoginModal(); return; }
    addGame();
  }
});
document.getElementById('addBlogBtn').addEventListener('click', () => {
  if (!isAdmin) { openLoginModal(); return; }
  openBlogModal();
});
document.getElementById('addNewsBtn').addEventListener('click', () => {
  if (!isAdmin) { openLoginModal(); return; }
  openNewsModal();
});
const addTeamBtn = document.getElementById('addTeamBtn');
if (addTeamBtn) {
  addTeamBtn.addEventListener('click', () => {
    if (!isAdmin) { openLoginModal(); return; }
    openTeamModal();
  });
}
document.getElementById('langToggle').addEventListener('click', toggleLanguage);


/* ===== COOKIE CONSENT ===== */
const COOKIE_KEY = 'rr_cookie_consent';

function getCookieConsent() {
  try {
    return localStorage.getItem(COOKIE_KEY); // 'all' | 'essential' | null
  } catch {
    return null;
  }
}

function setCookieConsent(value) {
  try {
    localStorage.setItem(COOKIE_KEY, value);
  } catch (_) {}
  hideCookieBanner();
}

function hideCookieBanner() {
  const el = document.getElementById('cookieBanner');
  if (el) el.classList.remove('open');
}

function showCookieBanner() {
  const el = document.getElementById('cookieBanner');
  if (el) el.classList.add('open');
}

function initCookieBanner() {
  const consent = getCookieConsent();
  if (!consent) showCookieBanner();

  const acceptAll = document.getElementById('cookieAcceptAll');
  const essential = document.getElementById('cookieEssential');
  const settings = document.getElementById('cookieSettings');

  if (acceptAll) acceptAll.onclick = () => setCookieConsent('all');
  if (essential) essential.onclick = () => setCookieConsent('essential');
  if (settings) settings.onclick = () => { window.location.href = 'cookies.html'; };
}

isAdmin = checkAdminSession();
setLanguage(currentLang);
updateAdminUI();
initCookieBanner();
