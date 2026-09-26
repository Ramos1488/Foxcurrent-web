/* Shared online store (Supabase) with localStorage fallback */
const LOCAL_MAP = {
  projects: 'rr_projects',
  blog: 'rr_blog',
  news: 'rr_news',
  team: 'rr_team',
  chat: 'rr_chat',
  settings: 'rr_settings'
};

function dbConfigured() {
  const c = window.FOXURRENT_CONFIG || {};
  return !!(c.supabaseUrl && c.supabaseAnonKey && window.supabase);
}

function getClient() {
  const c = window.FOXURRENT_CONFIG;
  return window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
}

function localLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(LOCAL_MAP[key]);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function localSave(key, data) {
  localStorage.setItem(LOCAL_MAP[key], JSON.stringify(data));
}

async function dbLoad(key, fallback) {
  const fb = fallback !== undefined ? fallback : [];
  if (!dbConfigured()) return localLoad(key, fb);
  try {
    const client = getClient();
    const { data, error } = await client
      .from('foxurrent_store')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.value === undefined || data.value === null) return fb;
    return data.value;
  } catch (err) {
    console.warn('DB load failed', key, err);
    return localLoad(key, fb);
  }
}

async function dbSave(key, value) {
  if (!dbConfigured()) {
    localSave(key, value);
    return { online: false };
  }
  try {
    const client = getClient();
    const { error } = await client
      .from('foxurrent_store')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    try { localSave(key, value); } catch (_) {}
    return { online: true };
  } catch (err) {
    console.error('DB save failed', err);
    localSave(key, value);
    throw err;
  }
}

async function dbLoadAll() {
  const empty = {
    projects: [],
    blog: [],
    news: [],
    team: [],
    chat: [],
    settings: { maintenance: false, maintenanceMessage: '' },
    online: false
  };
  if (!dbConfigured()) {
    return {
      projects: localLoad('projects', []),
      blog: localLoad('blog', []),
      news: localLoad('news', []),
      team: localLoad('team', []),
      chat: localLoad('chat', []),
      settings: localLoad('settings', empty.settings),
      online: false
    };
  }
  try {
    const client = getClient();
    const { data, error } = await client.from('foxurrent_store').select('key, value');
    if (error) throw error;
    const map = { ...empty, online: true };
    (data || []).forEach(row => {
      if (row.key === 'settings') {
        map.settings = row.value && typeof row.value === 'object' ? row.value : empty.settings;
      } else if (['projects', 'blog', 'news', 'team', 'chat'].includes(row.key)) {
        map[row.key] = Array.isArray(row.value) ? row.value : [];
      }
    });
    return map;
  } catch (err) {
    console.warn('DB loadAll failed', err);
    return {
      projects: localLoad('projects', []),
      blog: localLoad('blog', []),
      news: localLoad('news', []),
      team: localLoad('team', []),
      chat: localLoad('chat', []),
      settings: localLoad('settings', empty.settings),
      online: false
    };
  }
}

window.FoxurrentDB = { dbLoad, dbSave, dbLoadAll, dbConfigured };
