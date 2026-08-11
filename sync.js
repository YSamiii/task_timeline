import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  getDatabase,
  ref,
  get,
  update,
  onValue,
  onChildAdded,
  onChildChanged,
  onChildRemoved
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const bridge = window.TaskAppBridge;
const CLIENT_KEY = 'monthlyTimelineCombinedApp.syncClientId.v2';
const LAST_UID_KEY = 'monthlyTimelineCombinedApp.syncLastUid.v2';
const LAST_SYNC_KEY = 'monthlyTimelineCombinedApp.syncLastAt.v2';
const USER_ROOT = 'users';

let auth = null;
let db = null;
let currentUser = null;
let userPath = '';
let pushTimer = null;
let pushEnabled = false;
let pendingLocalChange = false;
let applyingRemote = false;
let isPushing = false;
let remoteApplyPending = false;
let remoteApplyTimer = null;
let listenerUnsubs = [];
let lastSyncedPayload = emptyPayload();
let remoteStore = makeRemoteStore();
let ownDeletedKeys = new Set();

const clientId = (() => {
  let value = localStorage.getItem(CLIENT_KEY);
  if (!value) {
    value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
    localStorage.setItem(CLIENT_KEY, value);
  }
  return value;
})();

function emptyPayload() {
  return { schemaVersion: 2, tasks: [], dones: [], plans: [], categories: [], categoryColors: {}, activeTimer: null };
}
function makeRemoteStore() {
  return { tasks: new Map(), dones: new Map(), plans: new Map(), settings: {} };
}
function clone(value) { return JSON.parse(JSON.stringify(value ?? null)); }
function same(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

function configured() {
  const vals = [firebaseConfig?.apiKey, firebaseConfig?.authDomain, firebaseConfig?.databaseURL, firebaseConfig?.projectId, firebaseConfig?.appId];
  return vals.every(v => v && !String(v).includes('PASTE_'));
}

function stripSyncMeta(value) {
  if (!value || typeof value !== 'object') return value;
  const out = { ...value };
  delete out.__syncBy;
  delete out.__syncRev;
  return out;
}
function withSyncMeta(value, revision) {
  return { ...clone(value), __syncBy: clientId, __syncRev: revision };
}

function mapFromObject(obj) {
  const map = new Map();
  if (obj && typeof obj === 'object') {
    Object.entries(obj).forEach(([key, value]) => map.set(key, stripSyncMeta(value)));
  }
  return map;
}
function objectItemsToArray(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).map(([key, value]) => {
    const clean = stripSyncMeta(value) || {};
    return { ...clean, id: clean.id || key };
  });
}
function payloadFromRaw(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const settings = stripSyncMeta(raw.settings) || {};
  return {
    schemaVersion: 2,
    tasks: objectItemsToArray(raw.tasks),
    dones: objectItemsToArray(raw.dones),
    plans: objectItemsToArray(raw.plans),
    categories: Array.isArray(settings.categories) ? settings.categories : [],
    categoryColors: settings.categoryColors && typeof settings.categoryColors === 'object' ? settings.categoryColors : {},
    activeTimer: settings.activeTimer || null
  };
}
function loadRemoteStore(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  remoteStore = {
    tasks: mapFromObject(raw.tasks),
    dones: mapFromObject(raw.dones),
    plans: mapFromObject(raw.plans),
    settings: stripSyncMeta(raw.settings) || {}
  };
}
function payloadFromRemoteStore() {
  const settings = remoteStore.settings || {};
  return {
    schemaVersion: 2,
    tasks: Array.from(remoteStore.tasks.values()).map(clone),
    dones: Array.from(remoteStore.dones.values()).map(clone),
    plans: Array.from(remoteStore.plans.values()).map(clone),
    categories: Array.isArray(settings.categories) ? clone(settings.categories) : [],
    categoryColors: settings.categoryColors && typeof settings.categoryColors === 'object' ? clone(settings.categoryColors) : {},
    activeTimer: settings.activeTimer ? clone(settings.activeTimer) : null
  };
}
function payloadHasData(payload) {
  return Boolean((payload?.tasks?.length || 0) + (payload?.dones?.length || 0) + (payload?.plans?.length || 0));
}
function rawHasData(raw) {
  return Boolean(raw && (raw.tasks || raw.dones || raw.plans || raw.settings));
}

function formatSyncTime(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'America/Toronto', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date(value));
  } catch (_) { return ''; }
}
function setStatus(kind, text, meta = '') {
  const dot = $('syncStatusDot');
  if (dot) dot.className = `sync-dot${kind ? ` ${kind}` : ''}`;
  if ($('syncStatusText')) $('syncStatusText').textContent = text;
  if ($('syncStatusMeta')) $('syncStatusMeta').textContent = meta || '';
}
function setAuthUi(user) {
  const loggedIn = Boolean(user);
  if ($('syncUserLabel')) $('syncUserLabel').textContent = loggedIn ? `已登录：${user.email || user.uid}` : '尚未登录';
  if ($('syncLogoutBtn')) $('syncLogoutBtn').disabled = !loggedIn;
  if ($('syncNowBtn')) $('syncNowBtn').disabled = !loggedIn || !pushEnabled;
  if ($('syncLoginBtn')) $('syncLoginBtn').disabled = loggedIn;
  if ($('syncRegisterBtn')) $('syncRegisterBtn').disabled = loggedIn;
}
function friendlyError(err) {
  const code = String(err?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return '邮箱或密码不正确。';
  if (code.includes('email-already-in-use')) return '这个邮箱已经注册，请直接登录。';
  if (code.includes('weak-password')) return '密码强度不足，请使用至少 6 位密码。';
  if (code.includes('invalid-email')) return '邮箱格式不正确。';
  if (code.includes('network-request-failed') || code.includes('network-error')) return '网络连接失败，请联网后重试。';
  if (code.includes('operation-not-allowed')) return 'Firebase 尚未启用 Email/Password 登录。';
  if (code.includes('permission-denied')) return 'Realtime Database 权限规则未正确配置。';
  return err?.message || '同步发生错误。';
}

function listToMap(items) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach(item => {
    if (item && item.id) map.set(String(item.id), item);
  });
  return map;
}
function buildUpdates(current, baseline, revision) {
  const updates = {};
  ownDeletedKeys = new Set();

  for (const type of ['tasks', 'dones', 'plans']) {
    const cur = listToMap(current[type]);
    const base = listToMap(baseline[type]);
    for (const [id, item] of cur) {
      if (!base.has(id) || !same(item, base.get(id))) {
        updates[`${userPath}/${type}/${id}`] = withSyncMeta(item, revision);
      }
    }
    for (const id of base.keys()) {
      if (!cur.has(id)) {
        const key = `${type}/${id}`;
        ownDeletedKeys.add(key);
        updates[`${userPath}/${type}/${id}`] = null;
      }
    }
  }

  const currentSettings = {
    schemaVersion: 2,
    categories: Array.isArray(current.categories) ? current.categories : [],
    categoryColors: current.categoryColors && typeof current.categoryColors === 'object' ? current.categoryColors : {},
    activeTimer: current.activeTimer || null
  };
  const baseSettings = {
    schemaVersion: 2,
    categories: Array.isArray(baseline.categories) ? baseline.categories : [],
    categoryColors: baseline.categoryColors && typeof baseline.categoryColors === 'object' ? baseline.categoryColors : {},
    activeTimer: baseline.activeTimer || null
  };
  if (!same(currentSettings, baseSettings)) {
    updates[`${userPath}/settings`] = withSyncMeta(currentSettings, revision);
  }
  return updates;
}

async function writeCloud(reason = '自动同步') {
  if (!pushEnabled || !currentUser || !db || !bridge || applyingRemote || isPushing) {
    pendingLocalChange = true;
    return;
  }
  clearTimeout(pushTimer);
  const current = bridge.getCloudPayload();
  const revision = `${Date.now()}-${clientId}`;
  const updates = buildUpdates(current, lastSyncedPayload, revision);
  if (!Object.keys(updates).length) {
    pendingLocalChange = false;
    const last = Number(localStorage.getItem(LAST_SYNC_KEY) || Date.now());
    setStatus('ok', '已同步', `最近同步：${formatSyncTime(last)}`);
    return;
  }

  isPushing = true;
  pendingLocalChange = false;
  setStatus('busy', '正在同步…', reason);
  try {
    await update(ref(db), updates);
    lastSyncedPayload = clone(current);
    const now = Date.now();
    localStorage.setItem(LAST_SYNC_KEY, String(now));
    setStatus('ok', '已同步', `最近同步：${formatSyncTime(now)}`);
  } catch (err) {
    pendingLocalChange = true;
    setStatus('error', '同步失败', friendlyError(err));
  } finally {
    isPushing = false;
    setTimeout(() => ownDeletedKeys.clear(), 500);
  }

  if (pendingLocalChange) {
    setTimeout(() => writeCloud('继续同步待处理修改'), 120);
  } else if (remoteApplyPending) {
    scheduleApplyRemote(true);
  }
}

function queuePush() {
  if (applyingRemote) return;
  pendingLocalChange = true;
  if (!pushEnabled || !currentUser || isPushing) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => writeCloud('自动保存'), 650);
}
window.TaskCloudSync = { queuePush };

function scheduleApplyRemote(force = false) {
  remoteApplyPending = true;
  if (!force && (applyingRemote || isPushing || pendingLocalChange)) return;
  clearTimeout(remoteApplyTimer);
  remoteApplyTimer = setTimeout(() => {
    if (isPushing || pendingLocalChange) return;
    const payload = payloadFromRemoteStore();
    remoteApplyPending = false;
    lastSyncedPayload = clone(payload);
    applyingRemote = true;
    try { bridge?.applyCloudPayload?.(payload); }
    finally { applyingRemote = false; }
    const now = Date.now();
    localStorage.setItem(LAST_SYNC_KEY, String(now));
    setStatus('ok', '已同步其他设备的修改', `最近同步：${formatSyncTime(now)}`);
  }, 120);
}

function handleChild(type, action, snap) {
  const id = snap.key;
  if (!id) return;
  const map = remoteStore[type];
  const old = map.get(id);

  if (action === 'remove') {
    map.delete(id);
    if (ownDeletedKeys.has(`${type}/${id}`)) return;
    scheduleApplyRemote();
    return;
  }

  const raw = snap.val() || {};
  const clean = stripSyncMeta(raw);
  map.set(id, clean);
  if (same(old, clean)) return;
  if (raw.__syncBy === clientId) return;
  scheduleApplyRemote();
}

function attachRemoteListeners() {
  listenerUnsubs.forEach(fn => { try { fn(); } catch (_) {} });
  listenerUnsubs = [];

  for (const type of ['tasks', 'dones', 'plans']) {
    const r = ref(db, `${userPath}/${type}`);
    listenerUnsubs.push(onChildAdded(r, snap => handleChild(type, 'add', snap)));
    listenerUnsubs.push(onChildChanged(r, snap => handleChild(type, 'change', snap)));
    listenerUnsubs.push(onChildRemoved(r, snap => handleChild(type, 'remove', snap)));
  }

  const settingsRef = ref(db, `${userPath}/settings`);
  listenerUnsubs.push(onValue(settingsRef, snap => {
    const raw = snap.val() || {};
    const clean = stripSyncMeta(raw) || {};
    const old = remoteStore.settings;
    remoteStore.settings = clean;
    if (same(old, clean)) return;
    if (raw.__syncBy === clientId) return;
    scheduleApplyRemote();
  }));
}

async function connectUser(user) {
  listenerUnsubs.forEach(fn => { try { fn(); } catch (_) {} });
  listenerUnsubs = [];
  pushEnabled = false;
  pendingLocalChange = false;
  setAuthUi(user);
  setStatus('busy', '正在连接云端…', '读取同步数据');
  userPath = `${USER_ROOT}/${user.uid}`;

  try {
    const snap = await get(ref(db, userPath));
    const raw = snap.exists() ? snap.val() : null;
    const localPayload = bridge?.getCloudPayload?.() || emptyPayload();
    const lastUid = localStorage.getItem(LAST_UID_KEY) || '';

    if (!rawHasData(raw)) {
      remoteStore = makeRemoteStore();
      lastSyncedPayload = emptyPayload();
      pushEnabled = true;
      await writeCloud(payloadHasData(localPayload) ? '首次上传本机数据' : '建立云端同步空间');
      loadRemoteStore({
        tasks: Object.fromEntries((localPayload.tasks || []).map(x => [x.id, x])),
        dones: Object.fromEntries((localPayload.dones || []).map(x => [x.id, x])),
        plans: Object.fromEntries((localPayload.plans || []).map(x => [x.id, x])),
        settings: { categories: localPayload.categories || [], categoryColors: localPayload.categoryColors || {}, activeTimer: localPayload.activeTimer || null }
      });
    } else {
      const remotePayload = payloadFromRaw(raw);
      const localHasData = payloadHasData(localPayload);
      const remoteHasItems = payloadHasData(remotePayload);
      let useLocal = false;

      if (localHasData && remoteHasItems && lastUid !== user.uid) {
        useLocal = !confirm('云端已有任务数据，本机也有任务数据。\n\n确定：使用云端数据覆盖本机\n取消：保留本机数据，并把本机版本上传到云端');
      }

      if (useLocal) {
        loadRemoteStore(raw);
        lastSyncedPayload = remotePayload;
        pushEnabled = true;
        pendingLocalChange = true;
        await writeCloud('首次连接：上传本机版本');
      } else {
        loadRemoteStore(raw);
        lastSyncedPayload = clone(remotePayload);
        applyingRemote = true;
        try { bridge?.applyCloudPayload?.(remotePayload); }
        finally { applyingRemote = false; }
        const now = Date.now();
        localStorage.setItem(LAST_SYNC_KEY, String(now));
        setStatus('ok', '已同步', `已载入云端数据 · ${formatSyncTime(now)}`);
        pushEnabled = true;
      }
    }

    localStorage.setItem(LAST_UID_KEY, user.uid);
    attachRemoteListeners();
    setAuthUi(user);
    if (pendingLocalChange) await writeCloud('同步待处理修改');
  } catch (err) {
    pushEnabled = false;
    setAuthUi(user);
    setStatus('error', '云端连接失败', friendlyError(err));
  }
}

async function login() {
  const email = String($('syncEmail')?.value || '').trim();
  const password = String($('syncPassword')?.value || '');
  if (!email || !password) return alert('请输入邮箱和密码。');
  setStatus('busy', '正在登录…', '');
  try { await signInWithEmailAndPassword(auth, email, password); }
  catch (err) { setStatus('error', '登录失败', friendlyError(err)); }
}
async function register() {
  const email = String($('syncEmail')?.value || '').trim();
  const password = String($('syncPassword')?.value || '');
  if (!email || !password) return alert('请输入邮箱和密码。');
  if (password.length < 6) return alert('密码至少需要 6 位。');
  setStatus('busy', '正在注册…', '');
  try { await createUserWithEmailAndPassword(auth, email, password); }
  catch (err) { setStatus('error', '注册失败', friendlyError(err)); }
}
async function logout() {
  try { await signOut(auth); }
  catch (err) { setStatus('error', '退出失败', friendlyError(err)); }
}

async function init() {
  if (!bridge) {
    setStatus('error', '同步模块无法连接 App', '请重新上传完整 ZIP 内的所有文件。');
    return;
  }

  $('syncLoginBtn')?.addEventListener('click', login);
  $('syncRegisterBtn')?.addEventListener('click', register);
  $('syncLogoutBtn')?.addEventListener('click', logout);
  $('syncNowBtn')?.addEventListener('click', () => { pendingLocalChange = true; writeCloud('手动同步'); });
  $('syncPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  window.addEventListener('online', () => {
    if (currentUser && pendingLocalChange) writeCloud('网络恢复后自动同步');
  });

  if (!configured()) {
    $('syncConfigWarning')?.classList.add('show');
    setStatus('error', '云同步尚未配置', '先完成 FIREBASE_SETUP.md 中的一次性设置。');
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);
    await setPersistence(auth, browserLocalPersistence);
    $('syncConfigWarning')?.classList.remove('show');

    onAuthStateChanged(auth, async user => {
      currentUser = user || null;
      if (!user) {
        pushEnabled = false;
        userPath = '';
        listenerUnsubs.forEach(fn => { try { fn(); } catch (_) {} });
        listenerUnsubs = [];
        setAuthUi(null);
        setStatus('', '本地模式', '登录后开启跨设备自动同步。');
        return;
      }
      await connectUser(user);
    });
  } catch (err) {
    setStatus('error', 'Firebase 初始化失败', friendlyError(err));
  }
}

init();
