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

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  const panelBtn = document.getElementById('panelBtn');
  if (panelBtn) panelBtn.style.display = isAdmin ? '' : 'none';

  applyMaintenance();

  renderProjects();
  renderBlog();
  renderNews();
  renderTeam();
  renderHero();
  renderChat();
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
let projects = [];
let blogPosts = [];
let newsItems = [];
let teamMembers = [];
let chatMessages = [];
let siteSettings = { maintenance: false, maintenanceMessage: '' };
let dataOnline = false;
let chatPollTimer = null;
let maintBypass = false;

function updateOnlineBadge() {
  const el = document.getElementById('onlineBadge');
  if (!el) return;
  if (dataOnline) {
    el.textContent = 'Online';
    el.className = 'online-badge online';
  } else {
    el.textContent = 'Local';
    el.className = 'online-badge local';
  }
}

async function persist(key, data) {
  try {
    const res = await window.FoxurrentDB.dbSave(key, data);
    if (res && res.online) dataOnline = true;
    updateOnlineBadge();
  } catch (e) {
    toast(t('toast.storageFull'), 'error');
    throw e;
  }
}

async function initData() {
  const all = await window.FoxurrentDB.dbLoadAll();
  projects = all.projects || [];
  blogPosts = all.blog || [];
  newsItems = all.news || [];
  teamMembers = all.team || [];
  chatMessages = Array.isArray(all.chat) ? all.chat : [];
  siteSettings = all.settings && typeof all.settings === 'object'
    ? all.settings
    : { maintenance: false, maintenanceMessage: '' };
  dataOnline = !!all.online;
  updateOnlineBadge();
  renderAll();
  renderChat();
  applyMaintenance();
  startChatPolling();
}

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
  { key: 'youtube', label: 'YouTube', icon: 'yt' },
  { key: 'roblox', label: 'Roblox', icon: 'rb' },
  { key: 'tiktok', label: 'TikTok', icon: 'tt' },
  { key: 'x', label: 'X', icon: 'x' },
  { key: 'instagram', label: 'Instagram', icon: 'ig' },
  { key: 'telegram', label: 'Telegram', icon: 'tg' },
  { key: 'discord', label: 'Discord', icon: 'dc' },
  { key: 'github', label: 'GitHub', icon: 'gh' }
];

const SOCIAL_SVG = {
  yt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/></svg>',
  rb: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 5.1 12 2 5.1 5.1 2 12l3.1 6.9L12 22l6.9-3.1L22 12l-3.1-6.9zM12 16.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9z"/></svg>',
  tt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.6 6.8A5 5 0 0 1 16 5.2V15a5 5 0 1 1-5-5v2.2a2.8 2.8 0 1 0 2.8 2.8V2h2.5a5 5 0 0 0 3.3 3.4v1.4z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.2 2H21l-6.6 7.5L22 22h-6.2l-4.9-6.4L5.3 22H2.5l7-8L2 2h6.3l4.4 5.8L18.2 2zm-1.1 18h1.7L7 3.9H5.2L17.1 20z"/></svg>',
  ig: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm11 1.5a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM12 7.5A4.5 4.5 0 1 1 12 16.5 4.5 4.5 0 0 1 12 7.5zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>',
  tg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 15.3 9.3 19c.4 0 .6-.2.8-.4l1.9-1.8 3.9 2.9c.7.4 1.2.2 1.4-.7L20.9 5c.3-1.2-.4-1.7-1.2-1.4L3.4 9.4c-1.1.4-1.1 1.1-.2 1.4l4.1 1.3 9.6-6c.4-.3.9-.1.5.2L9.5 15.3z"/></svg>',
  dc: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4.5A16 16 0 0 0 15.6 3l-.3.6a14 14 0 0 1 3.6 1.8 12.5 12.5 0 0 0-12 0A14 14 0 0 1 9.7 3.6 16 16 0 0 0 4 4.5C1.5 8.6.9 12.6 1.2 16.5A16 16 0 0 0 6.2 19l.7-1.1a10.5 10.5 0 0 1-1.7-.8l.4-.3a11.8 11.8 0 0 0 13.8 0l.4.3a10.5 10.5 0 0 1-1.7.8l.7 1.1a16 16 0 0 0 5-2.5c.4-4.4-.7-8.3-2.8-12zM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>',
  gh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7 3.6 3.6 0 0 1 .1-2.6s.8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1a3.6 3.6 0 0 1 .1 2.6 3.9 3.9 0 0 1 1 2.7c0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>'
};

/* Map role text → department section */
const DEPT_RULES = [
  { id: 'leadership', match: /founder|lead|director|owner|ceo|head|руководитель|основатель|лид/i, en: 'Leadership', ru: 'Руководство' },
  { id: 'developers', match: /develop|scripter|programmer|coder|инженер|разработ|скрипт|программ/i, en: 'Developers', ru: 'Разработчики' },
  { id: 'designers', match: /design|artist|ui|ux|builder|3d|модел|художник|дизайн|билдер/i, en: 'Designers', ru: 'Дизайнеры' },
  { id: 'community', match: /community|moderator|manager|marketing|qa|support|модератор|менеджер|маркетинг/i, en: 'Community', ru: 'Комьюнити' }
];

function getDepartment(role) {
  const r = role || '';
  for (const d of DEPT_RULES) {
    if (d.match.test(r)) return d;
  }
  return { id: 'team', match: null, en: 'Team', ru: 'Команда' };
}

function socialIconHtml(s) {
  const svg = SOCIAL_SVG[s.icon] || '';
  return svg;
}


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
    await persist('projects', projects);
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
  document.getElementById('modalSaveStatus').onclick = async () => {
    p.status = document.getElementById('editStatusSelect').value;
    await persist('projects', projects);
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
  document.getElementById('modalSaveBlog').onclick = async () => {
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
      await persist('blog', blogPosts);
    } catch (e) {
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
  document.getElementById('modalSaveNews').onclick = async () => {
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
      await persist('news', newsItems);
    } catch (e) {
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

  // Group by department
  const groups = {};
  const order = [];
  teamMembers.forEach(m => {
    const dept = getDepartment(m.role);
    if (!groups[dept.id]) {
      groups[dept.id] = { dept, members: [] };
      order.push(dept.id);
    }
    groups[dept.id].members.push(m);
  });

  let cardIndex = 0;
  order.forEach(deptId => {
    const { dept, members } = groups[deptId];
    const section = document.createElement('div');
    section.className = 'team-dept';
    const title = currentLang === 'ru' ? dept.ru : dept.en;
    section.innerHTML = `<h3 class="team-dept-title">${escapeHtml(title)}</h3>`;
    const row = document.createElement('div');
    row.className = 'team-grid';

    members.forEach(m => {
      const card = document.createElement('article');
      card.className = 'team-card';
      card.style.animationDelay = (cardIndex++ * 0.05) + 's';
      const initial = (m.name || '?').charAt(0).toUpperCase();
      const av = m.avatar
        ? `<img class="team-avatar" src="${m.avatar}" alt="">`
        : `<div class="team-avatar-placeholder">${escapeHtml(initial)}</div>`;
      const links = SOCIAL_KEYS
        .filter(s => m.links && m.links[s.key])
        .map(s => `<a class="team-social" href="${escapeHtml(m.links[s.key])}" target="_blank" rel="noopener" title="${s.label}">${socialIconHtml(s)}</a>`)
        .join('');
      const bio = m.bio ? `<p class="team-bio">${escapeHtml(m.bio)}</p>` : '';
      card.innerHTML = `
        <div class="team-card-inner">
          ${av}
          <h4 class="team-name">${escapeHtml(m.name)}</h4>
          <p class="team-role">${escapeHtml(m.role || '')}</p>
          ${bio}
          ${links ? `<div class="team-socials">${links}</div>` : ''}
          ${isAdmin ? `
          <div class="blog-actions-row team-admin-actions">
            <button class="btn btn-ghost btn-sm" data-action="edit-team" data-id="${m.id}">${t('btn.edit')}</button>
            <button class="btn btn-danger btn-sm" data-action="delete-team" data-id="${m.id}">${t('btn.delete')}</button>
          </div>` : ''}
        </div>
      `;
      row.appendChild(card);
    });
    section.appendChild(row);
    grid.appendChild(section);
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
    <input type="text" id="teamRole" value="${member ? escapeHtml(member.role || '') : ''}" placeholder="e.g. Founder & Lead Game Designer">
    <label>${t('team.bio')}</label>
    <textarea id="teamBio" placeholder="${t('team.bioHint')}">${member ? escapeHtml(member.bio || '') : ''}</textarea>
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
  document.getElementById('modalSaveTeam').onclick = async () => {
    const name = document.getElementById('teamName').value.trim();
    if (!name) return;
    const role = document.getElementById('teamRole').value.trim();
    const bio = document.getElementById('teamBio').value.trim();
    const newLinks = {};
    SOCIAL_KEYS.forEach(s => {
      const v = document.getElementById('link_' + s.key).value.trim();
      if (v) newLinks[s.key] = v;
    });
    if (member) {
      member.name = name;
      member.role = role;
      member.bio = bio;
      member.avatar = imgState.image || null;
      member.links = newLinks;
    } else {
      teamMembers.push({
        id: uid(),
        name,
        role,
        bio,
        avatar: imgState.image || null,
        links: newLinks
      });
    }
    try {
      await persist('team', teamMembers);
    } catch (e) {
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
      persist('projects', projects);
      renderAll();
      toast(t('toast.deleted'));
    }
  }
  if (action === 'edit-blog') openBlogModal(id);
  if (action === 'delete-blog') {
    if (confirm(currentLang === 'ru' ? 'Удалить пост?' : 'Delete this post?')) {
      blogPosts = blogPosts.filter(p => p.id !== id);
      persist('blog', blogPosts);
      renderAll();
      toast(t('toast.deleted'));
    }
  }
  if (action === 'edit-news') openNewsModal(id);
  if (action === 'delete-news') {
    if (confirm(currentLang === 'ru' ? 'Удалить новость?' : 'Delete this news?')) {
      newsItems = newsItems.filter(n => n.id !== id);
      persist('news', newsItems);
      renderAll();
      toast(t('toast.deleted'));
    }
  }
  if (action === 'edit-team') openTeamModal(id);
  if (action === 'delete-team') {
    if (confirm(currentLang === 'ru' ? 'Удалить участника?' : 'Remove this contributor?')) {
      teamMembers = teamMembers.filter(m => m.id !== id);
      persist('team', teamMembers);
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
    applyMaintenance();
    toast(t('admin.welcome'));
  } else {
    document.getElementById('loginError').style.display = 'block';
    document.getElementById('adminPassword').value = '';
    document.getElementById('adminPassword').focus();
  }
});

/* admin button hidden — use Ctrl+Shift+A or logo clicks */

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



/* ===== MAINTENANCE ===== */
function applyMaintenance() {
  const on = !!(siteSettings && siteSettings.maintenance);
  const overlay = document.getElementById('maintenanceOverlay');
  const msg = document.getElementById('maintenanceMsg');
  const bypass = document.getElementById('maintAdminBypass');
  const loginBtn = document.getElementById('maintLoginBtn');
  if (msg) {
    msg.textContent = (siteSettings && siteSettings.maintenanceMessage)
      ? siteSettings.maintenanceMessage
      : t('maint.desc');
  }
  document.body.classList.toggle('maintenance-on', on && !maintBypass);
  if (!overlay) return;
  if (on && !maintBypass) {
    overlay.style.display = 'flex';
    if (bypass) bypass.style.display = isAdmin ? '' : 'none';
    if (loginBtn) loginBtn.style.display = isAdmin ? 'none' : '';
  } else {
    overlay.style.display = 'none';
  }
}

async function toggleMaintenance() {
  if (!isAdmin) return;
  const turningOn = !siteSettings.maintenance;
  let message = siteSettings.maintenanceMessage || '';
  if (turningOn) {
    const custom = prompt(t('maint.desc'), message || (currentLang === 'ru' ? 'Идут технические работы. Скоро вернёмся.' : "We'll be back soon."));
    if (custom === null) return;
    message = custom;
  }
  siteSettings = {
    maintenance: turningOn,
    maintenanceMessage: message
  };
  try {
    await persist('settings', siteSettings);
  } catch (e) {
    return;
  }
  maintBypass = false;
  applyMaintenance();
  updatePanelMaintLabel();
  toast(turningOn ? t('maint.enabled') : t('maint.disabled'));
}

/* ===== LIVE CHAT ===== */
function renderChat() {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  const list = Array.isArray(chatMessages) ? chatMessages.slice(-100) : [];
  if (list.length === 0) {
    box.innerHTML = `<div class="chat-empty">${t('chat.empty')}</div>`;
    return;
  }
  box.innerHTML = list.map(m => {
    const time = m.ts ? new Date(m.ts).toLocaleTimeString(currentLang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="chat-msg">
      <div class="chat-msg-meta"><span>${escapeHtml(m.name || 'Anon')}</span><span>${time}</span></div>
      <div class="chat-msg-text">${linkify(m.text || '')}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function refreshChat() {
  try {
    const data = await window.FoxurrentDB.dbLoad('chat', []);
    chatMessages = Array.isArray(data) ? data : [];
    renderChat();
  } catch (_) {}
}

function startChatPolling() {
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(refreshChat, 5000);
}

async function sendChatMessage() {
  const nameEl = document.getElementById('chatName');
  const input = document.getElementById('chatInput');
  const name = (nameEl.value || '').trim() || localStorage.getItem('rr_chat_name') || '';
  const text = (input.value || '').trim();
  if (!name) {
    toast(t('chat.needName'), 'error');
    nameEl.focus();
    return;
  }
  if (!text) return;
  localStorage.setItem('rr_chat_name', name);
  nameEl.value = name;

  // reload latest to avoid overwriting
  try {
    const latest = await window.FoxurrentDB.dbLoad('chat', []);
    chatMessages = Array.isArray(latest) ? latest : [];
  } catch (_) {}

  chatMessages.push({
    id: uid(),
    name: name.slice(0, 24),
    text: text.slice(0, 300),
    ts: new Date().toISOString()
  });
  // keep last 150
  if (chatMessages.length > 150) chatMessages = chatMessages.slice(-150);

  try {
    await persist('chat', chatMessages);
  } catch (e) {
    return;
  }
  input.value = '';
  renderChat();
}

function initChatUI() {
  const toggle = document.getElementById('chatToggle');
  const panel = document.getElementById('chatPanel');
  const close = document.getElementById('chatClose');
  const send = document.getElementById('chatSend');
  const input = document.getElementById('chatInput');
  const nameEl = document.getElementById('chatName');
  if (nameEl) nameEl.value = localStorage.getItem('rr_chat_name') || '';
  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        renderChat();
        refreshChat();
      }
    });
  }
  if (close && panel) close.addEventListener('click', () => { panel.hidden = true; });
  if (send) send.addEventListener('click', sendChatMessage);
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });
  const bypass = document.getElementById('maintAdminBypass');
  if (bypass) {
    bypass.addEventListener('click', () => {
      maintBypass = true;
      applyMaintenance();
    });
  }
  const maintLogin = document.getElementById('maintLoginBtn');
  if (maintLogin) {
    maintLogin.addEventListener('click', () => openLoginModal());
  }
}


/* ===== ADMIN PANEL + HIDDEN LOGIN ===== */
function openAdminPanel() {
  if (!isAdmin) return;
  updatePanelMaintLabel();
  const badge = document.getElementById('panelOnlineBadge');
  const src = document.getElementById('onlineBadge');
  if (badge && src) {
    badge.textContent = src.textContent;
    badge.className = src.className;
  }
  const el = document.getElementById('adminPanel');
  if (el) el.classList.add('open');
}

function closeAdminPanel() {
  const el = document.getElementById('adminPanel');
  if (el) el.classList.remove('open');
}

function updatePanelMaintLabel() {
  const btn = document.getElementById('panelMaintBtn');
  if (btn) btn.textContent = siteSettings.maintenance ? t('maint.off') : t('maint.on');
}

function initAdminPanelUI() {
  const panelBtn = document.getElementById('panelBtn');
  if (panelBtn) panelBtn.addEventListener('click', openAdminPanel);
  const close = document.getElementById('adminPanelClose');
  if (close) close.addEventListener('click', closeAdminPanel);
  const overlay = document.getElementById('adminPanel');
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) closeAdminPanel(); });

  const maint = document.getElementById('panelMaintBtn');
  if (maint) maint.addEventListener('click', toggleMaintenance);

  const logout = document.getElementById('panelLogout');
  if (logout) logout.addEventListener('click', () => {
    setAdminSession(false);
    closeAdminPanel();
    toast(t('admin.loggedOut'));
  });

  const clearChat = document.getElementById('panelClearChat');
  if (clearChat) clearChat.addEventListener('click', async () => {
    if (!confirm(currentLang === 'ru' ? 'Очистить чат?' : 'Clear all chat messages?')) return;
    chatMessages = [];
    try {
      await persist('chat', chatMessages);
    } catch (e) { return; }
    renderChat();
    toast(t('toast.updated'));
  });

  // Hidden login: Ctrl+Shift+A
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      if (isAdmin) openAdminPanel();
      else openLoginModal();
    }
  });

  // Hidden login: 5 clicks on logo
  let logoClicks = 0;
  let logoTimer = null;
  const logo = document.getElementById('logoBtn');
  if (logo) {
    logo.addEventListener('click', e => {
      // allow normal nav, but count rapid clicks
      logoClicks++;
      clearTimeout(logoTimer);
      logoTimer = setTimeout(() => { logoClicks = 0; }, 1200);
      if (logoClicks >= 5) {
        logoClicks = 0;
        e.preventDefault();
        if (isAdmin) openAdminPanel();
        else openLoginModal();
      }
    });
  }
}


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
initData();
initChatUI();
initAdminPanelUI();
initCookieBanner();
