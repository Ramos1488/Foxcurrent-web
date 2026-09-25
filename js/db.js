/* Shared online store (Supabase) with localStorage fallback */
const DB_KEYS = {
  projects: 'projects',
  blog: 'blog',
  news: 'news',
  team: 'team'
};

const LOCAL_MAP = {
  projects: 'rr_projects',
  blog: 'rr_blog',
  news: 'rr_news',
  team: 'rr_team'
};

function dbConfigured() {
  const c = window.FOXURRENT_CONFIG || {};
  return !!(c.supabaseUrl && c.supabaseAnonKey && window.supabase);
}

function getClient() {
  const c = window.FOXURRENT_CONFIG;
  return window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
}

function localLoad(key) {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_MAP[key])) || [];
  } catch {
    return [];
  }
}

function localSave(key, data) {
  localStorage.setItem(LOCAL_MAP[key], JSON.stringify(data));
}

async function dbLoad(key) {
  if (!dbConfigured()) return localLoad(key);
  try {
    const client = getClient();
    const { data, error } = await client
      .from('foxurrent_store')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return [];
    return Array.isArray(data.value) ? data.value : [];
  } catch (err) {
    console.warn('DB load failed, using local', err);
    return localLoad(key);
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
    // also mirror locally for faster reloads
    try { localSave(key, value); } catch (_) {}
    return { online: true };
  } catch (err) {
    console.error('DB save failed', err);
    localSave(key, value);
    throw err;
  }
}

async function dbLoadAll() {
  if (!dbConfigured()) {
    return {
      projects: localLoad('projects'),
      blog: localLoad('blog'),
      news: localLoad('news'),
      team: localLoad('team'),
      online: false
    };
  }
  try {
    const client = getClient();
    const { data, error } = await client.from('foxurrent_store').select('key, value');
    if (error) throw error;
    const map = { projects: [], blog: [], news: [], team: [] };
    (data || []).forEach(row => {
      if (map.hasOwnProperty(row.key)) {
        map[row.key] = Array.isArray(row.value) ? row.value : [];
      }
    });
    return { ...map, online: true };
  } catch (err) {
    console.warn('DB loadAll failed', err);
    return {
      projects: localLoad('projects'),
      blog: localLoad('blog'),
      news: localLoad('news'),
      team: localLoad('team'),
      online: false
    };
  }
}

window.FoxurrentDB = { dbLoad, dbSave, dbLoadAll, dbConfigured, DB_KEYS };
