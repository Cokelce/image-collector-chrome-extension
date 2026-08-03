// background/service-worker.js
// 后台服务：处理全网图片/动图右键收藏

importScripts('/analyzer/analyzer.js');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_ROOT_FOLDER = '图片收藏夹';
const DRIVE_COMPUTER_FOLDER = '电脑壁纸';
const DRIVE_MOBILE_FOLDER = '手机壁纸';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const LOCAL_SETTINGS_DB = 'ImageCollectorSettingsDB';
const LOCAL_SETTINGS_STORE = 'settings';
const LOCAL_DRIVE_HANDLE_KEY = 'driveFolderHandle';

// 全局错误捕获
self.addEventListener('error', (event) => {
  console.error('[ImageCollector] Global error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[ImageCollector] Unhandled rejection:', event.reason);
});

// 初始化右键菜单
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[ImageCollector] onInstalled fired');
  try {
    await resetContextMenu();
    triggerDriveSync();
    console.log('[ImageCollector] Context menu created');
  } catch (e) {
    console.error('[ImageCollector] Context menu failed:', e);
  }
});

chrome.runtime.onStartup.addListener(() => {
  resetContextMenu().catch((error) => {
    console.error('[ImageCollector] Startup context menu failed:', error);
  });
  triggerDriveSync();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'saveImage' || !info.srcUrl) return;
  saveImageFromUrl(info.srcUrl, tab, {
    pageUrl: info.pageUrl,
    pageTitle: tab?.title || '',
    mediaType: info.mediaType || '',
    source: 'context-menu'
  })
    .then(() => showBadge('OK', '#3a8f5b'))
    .catch((error) => {
      console.error('[ImageCollector] Context menu save failed:', error);
      showBadge('ERR', '#b84a4a');
    });
});

// 监听来自 content script 的消息（包括 ping 用于触发 service worker）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'saveImage') {
    saveImageFromUrl(message.url, sender.tab, message)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (message.action === 'ping') {
    sendResponse({ success: true, pong: true });
    return true;
  }
  if (message.action && message.action.startsWith('drive')) {
    handleDriveMessage(message)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

function showBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

function resetContextMenu() {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      const removeError = chrome.runtime.lastError;
      if (removeError) {
        reject(removeError);
        return;
      }

      chrome.contextMenus.create({
        id: 'saveImage',
        title: '收藏这个图片/动图',
        contexts: ['image', 'video']
      }, () => {
        const createError = chrome.runtime.lastError;
        if (createError) reject(createError);
        else resolve();
      });
    });
  });
}

// 从 URL 下载并保存图片/动图到 IndexedDB
async function saveImageFromUrl(imageUrl, tab, message = {}) {
  const pageUrl = message.pageUrl || tab?.url || '';
  const pageTitle = message.pageTitle || tab?.title || '';
  const source = message.source || 'page';

  try {
    const response = await fetch(imageUrl, { mode: 'cors', credentials: 'include' });
    if (!response.ok) throw new Error('Fetch failed: ' + response.status);
    const blob = await response.blob();
    const fileSize = blob.size;
    const mediaType = getMediaType(blob.type, imageUrl, message.mediaType);
    const fileName = buildFileName(imageUrl, blob.type, mediaType);
    const thumbnail = mediaType === 'image' ? await createImageThumbnail(blob) : null;

    const urlKeywords = extractUrlKeywords(imageUrl);
    const analysis = await analyzeImageBasic(blob, {
      imageUrl,
      pageUrl,
      pageTitle,
      fileName,
      mimeType: blob.type,
      mediaType
    });
    const arrayBuffer = await blob.arrayBuffer();
    
    const imageData = {
      url: imageUrl,
      fileName: fileName,
      category: analysis.category || '未分类',
      tags: [...new Set([...urlKeywords, ...analysis.tags])],
      color: analysis.color || null,
      width: analysis.width || 0,
      height: analysis.height || 0,
      size: fileSize,
      mediaType,
      pageUrl: pageUrl,
      pageTitle: pageTitle,
      source: source,
      imageData: arrayBuffer,
      mimeType: blob.type || 'image/jpeg',
      thumbnailData: thumbnail?.data || null,
      thumbnailMimeType: thumbnail?.mimeType || ''
    };

    const id = await addImage(imageData);
    syncImageToLocalDriveIfReady(id).catch((syncError) => {
      console.warn('[ImageCollector] Local Drive auto sync skipped:', syncError.message);
    });
    syncImageToDriveIfReady(id).catch((syncError) => {
      console.warn('[ImageCollector] Drive auto sync skipped:', syncError.message);
    });
    return { id, fileName, category: imageData.category, tags: imageData.tags, savedBlob: true };
  } catch (error) {
    console.warn('[ImageCollector] Blob save failed, keeping URL-only record:', error.message);
    const category = ImageCollectorAnalyzer.classifyText({
      imageUrl,
      pageUrl,
      pageTitle,
      fileName: buildFileName(imageUrl, '', message.mediaType),
      tags: extractUrlKeywords(imageUrl)
    }) || (message.mediaType === 'video' ? '动态壁纸' : '链接收藏');

    const id = await addImage({
      url: imageUrl,
      fileName: buildFileName(imageUrl, '', message.mediaType),
      category,
      tags: [...new Set([...extractUrlKeywords(imageUrl), 'url-only'])],
      color: null,
      width: 0,
      height: 0,
      size: 0,
      mediaType: message.mediaType === 'video' ? 'video' : 'image',
      pageUrl,
      pageTitle,
      source,
      imageData: null,
      mimeType: '',
      saveError: error.message
    });
    syncImageToLocalDriveIfReady(id).catch((syncError) => {
      console.warn('[ImageCollector] Local Drive auto sync skipped:', syncError.message);
    });
    syncImageToDriveIfReady(id).catch((syncError) => {
      console.warn('[ImageCollector] Drive auto sync skipped:', syncError.message);
    });
    return { id, fileName: buildFileName(imageUrl, '', message.mediaType), category, tags: ['url-only'], savedBlob: false };
  }
}

function buildFileName(imageUrl, mimeType = '', mediaType = '') {
  const timestamp = Date.now();

  try {
    if (imageUrl.startsWith('data:')) {
      const mime = imageUrl.match(/^data:([^;,]+)/)?.[1] || 'image/jpeg';
      const ext = mime.split('/')[1] || 'jpg';
      return `${timestamp}_image.${normalizeExt(ext)}`;
    }

    const urlPath = new URL(imageUrl).pathname;
    const originalName = decodeURIComponent(urlPath.split('/').pop() || 'image');
    const ext = originalName.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|mp4|webm|mov|m4v)(?:$|\?)/i)?.[1] || extFromMime(mimeType, mediaType);
    const baseName = sanitizeFileName(originalName.replace(/\.[^.]+$/, '') || (mediaType === 'video' ? 'video' : 'image'));
    return `${timestamp}_${baseName}.${normalizeExt(ext)}`;
  } catch {
    return `${timestamp}_${mediaType === 'video' ? 'video' : 'image'}.${extFromMime(mimeType, mediaType)}`;
  }
}

function getMediaType(mimeType, url, hint) {
  if (hint === 'video') return 'video';
  if ((mimeType || '').startsWith('video/')) return 'video';
  if (/\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(url || '')) return 'video';
  return 'image';
}

function extFromMime(mimeType, mediaType) {
  const clean = (mimeType || '').split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v'
  };
  return map[clean] || (mediaType === 'video' ? 'mp4' : 'jpg');
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'image';
}

function normalizeExt(ext) {
  const clean = String(ext).toLowerCase();
  if (clean === 'jpeg') return 'jpg';
  return clean.replace(/[^a-z0-9]/g, '') || 'jpg';
}

async function createImageThumbnail(blob) {
  try {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null;

    const bitmap = await createImageBitmap(blob);
    const maxSide = 280;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const thumbBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.78 });
    return {
      data: await thumbBlob.arrayBuffer(),
      mimeType: thumbBlob.type || 'image/webp'
    };
  } catch {
    return null;
  }
}

// 提取 URL 关键词
function extractUrlKeywords(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/').filter(s => s && s.length > 2);
    const keywords = [];
    for (const segment of segments) {
      const clean = segment.replace(/\.[^.]+$/, '').toLowerCase();
      if (clean.length > 1) keywords.push(clean);
    }
    return [...new Set(keywords)].slice(0, 5);
  } catch {
    return [];
  }
}

// 基础分析
async function analyzeImageBasic(blob, meta) {
  if (meta.mediaType === 'video' || (blob.type || '').startsWith('video/')) {
    const ext = extFromMime(blob.type, 'video');
    return {
      category: ImageCollectorAnalyzer.classifyText(meta) || '动态壁纸',
      tags: ['video', '动图', ext],
      color: null,
      width: 0,
      height: 0
    };
  }

  return ImageCollectorAnalyzer.analyzeBlob(blob, meta);
}

// ========== Google Drive 可选同步 ==========
function triggerDriveSync() {
  triggerLocalDriveSync();
  syncAllToDrive().catch((error) => {
    console.warn('[ImageCollector] Drive background sync skipped:', error.message);
  });
}

async function handleDriveMessage(message) {
  if (message.action === 'driveGetStatus') return getDriveStatus();
  if (message.action === 'driveLocalSetEnabled') return setLocalDriveSyncEnabled(!!message.enabled);
  if (message.action === 'driveSaveClientId') return saveDriveClientId(message.clientId || '');
  if (message.action === 'driveLogin') return driveLogin();
  if (message.action === 'driveLogout') return driveLogout();
  if (message.action === 'driveSetEnabled') return setDriveSyncEnabled(!!message.enabled);
  if (message.action === 'driveSyncNow') {
    const result = await syncAllToDrive({ force: true, interactive: true });
    return { ...(await getDriveStatus()), syncResult: result };
  }
  if (message.action === 'driveLocalSyncNow') {
    const result = await syncAllToLocalDrive({ force: true });
    return { ...(await getDriveStatus()), syncResult: result };
  }
  throw new Error('未知 Drive 操作');
}

async function getDriveStatus() {
  const settings = await chrome.storage.local.get(['driveSyncEnabled', 'driveFolderIds', 'driveClientId']);
  const configured = await isDriveOAuthConfigured();
  const token = configured ? await getDriveToken(false) : null;
  const localStatus = await getLocalDriveStatus();
  let pendingCount = 0;

  try {
    const images = await getAllImages();
    pendingCount = images.filter(image => image.driveSyncStatus !== 'synced').length;
  } catch {
    pendingCount = 0;
  }

  return {
    configured,
    enabled: !!settings.driveSyncEnabled,
    signedIn: !!token,
    local: localStatus,
    clientId: settings.driveClientId || '',
    redirectUri: getDriveRedirectUri(),
    extensionId: chrome.runtime.id,
    pendingCount,
    rootFolderName: DRIVE_ROOT_FOLDER,
    computerFolderName: DRIVE_COMPUTER_FOLDER,
    mobileFolderName: DRIVE_MOBILE_FOLDER,
    folderIds: settings.driveFolderIds || {}
  };
}

function triggerLocalDriveSync() {
  syncAllToLocalDrive().catch((error) => {
    console.warn('[ImageCollector] Local Drive background sync skipped:', error.message);
  });
}

async function getLocalDriveStatus() {
  const settings = await chrome.storage.local.get(['driveLocalEnabled']);
  const handle = await getStoredLocalDriveHandle();
  let permission = 'missing';
  if (handle) {
    try {
      permission = await handle.queryPermission({ mode: 'readwrite' });
    } catch {
      permission = 'unknown';
    }
  }

  let pendingCount = 0;
  try {
    const images = await getAllImages();
    pendingCount = images.filter(image => image.localDriveSyncStatus !== 'synced').length;
  } catch {
    pendingCount = 0;
  }

  return {
    configured: !!handle,
    enabled: !!settings.driveLocalEnabled,
    folderName: handle?.name || '',
    permission,
    pendingCount,
    rootFolderName: DRIVE_ROOT_FOLDER,
    computerFolderName: DRIVE_COMPUTER_FOLDER,
    mobileFolderName: DRIVE_MOBILE_FOLDER
  };
}

async function setLocalDriveSyncEnabled(enabled) {
  if (!enabled) {
    await chrome.storage.local.set({ driveLocalEnabled: false });
    return getDriveStatus();
  }

  const handle = await getStoredLocalDriveHandle();
  if (!handle) throw new Error('请先选择 Google Drive 本地文件夹');
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('Drive 文件夹需要重新授权，请重新选择文件夹');

  await chrome.storage.local.set({ driveLocalEnabled: true });
  triggerLocalDriveSync();
  return getDriveStatus();
}

async function syncImageToLocalDriveIfReady(id) {
  const settings = await chrome.storage.local.get(['driveLocalEnabled']);
  if (!settings.driveLocalEnabled) return;

  const handle = await getStoredLocalDriveHandle();
  if (!handle) {
    await updateImage(id, {
      localDriveSyncStatus: 'needs_folder',
      localDriveError: '未选择 Drive 文件夹',
      localDriveLastTriedAt: Date.now()
    });
    return;
  }

  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    await updateImage(id, {
      localDriveSyncStatus: 'needs_permission',
      localDriveError: 'Drive 文件夹需要重新授权',
      localDriveLastTriedAt: Date.now()
    });
    return;
  }

  const record = await getImage(id);
  if (record) await syncSingleImageToLocalDrive(record, handle);
}

async function syncAllToLocalDrive(options = {}) {
  const settings = await chrome.storage.local.get(['driveLocalEnabled']);
  if (!options.force && !settings.driveLocalEnabled) return { synced: 0, failed: 0, skipped: 0 };

  const handle = await getStoredLocalDriveHandle();
  if (!handle) throw new Error('请先选择 Google Drive 本地文件夹');
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('Drive 文件夹需要重新授权');

  const images = await getAllImages();
  const pending = images.filter(image => image.localDriveSyncStatus !== 'synced');
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const image of pending) {
    try {
      const result = await syncSingleImageToLocalDrive(image, handle);
      if (result?.skipped) skipped += 1;
      else synced += 1;
    } catch (error) {
      failed += 1;
      console.warn('[ImageCollector] Local Drive sync failed:', error.message);
    }
  }

  return { synced, failed, skipped };
}

async function syncSingleImageToLocalDrive(record, handle) {
  if (!record?.id || (!record.imageData && !record.url)) return { skipped: true };

  const folderName = getDriveTargetFolderName(record);
  await updateImage(record.id, {
    localDriveSyncStatus: 'syncing',
    localDriveFolderName: folderName,
    localDriveError: '',
    localDriveLastTriedAt: Date.now()
  });

  try {
    const result = await writeRecordToLocalDrive(record, handle, folderName);
    await updateImage(record.id, {
      localDriveSyncStatus: 'synced',
      localDriveFileName: result.fileName,
      localDriveFolderName: folderName,
      localDriveSyncedAt: Date.now(),
      localDriveError: ''
    });
    return result;
  } catch (error) {
    await updateImage(record.id, {
      localDriveSyncStatus: 'error',
      localDriveError: error.message,
      localDriveLastTriedAt: Date.now()
    });
    throw error;
  }
}

async function writeRecordToLocalDrive(record, driveHandle, folderName) {
  const root = await driveHandle.getDirectoryHandle(DRIVE_ROOT_FOLDER, { create: true });
  const target = await root.getDirectoryHandle(folderName, { create: true });
  const hasLocalFile = !!record.imageData;
  const mimeType = record.mimeType || (record.mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
  const blob = hasLocalFile
    ? new Blob([record.imageData], { type: mimeType })
    : new Blob([JSON.stringify(buildDriveLinkRecord(record), null, 2)], { type: 'application/json' });
  const fileName = hasLocalFile ? buildDriveFileName(record) : buildDriveLinkFileName(record);
  const fileHandle = await target.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { synced: true, fileName, folderName };
}

async function getStoredLocalDriveHandle() {
  try {
    const db = await getLocalSettingsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LOCAL_SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(LOCAL_SETTINGS_STORE);
      const req = store.get(LOCAL_DRIVE_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result?.value || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

function getLocalSettingsDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_SETTINGS_DB, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(LOCAL_SETTINGS_STORE)) {
        db.createObjectStore(LOCAL_SETTINGS_STORE, { keyPath: 'key' });
      }
    };
  });
}

async function saveDriveClientId(clientId) {
  const cleanClientId = String(clientId).trim();
  if (!cleanClientId || !/\.apps\.googleusercontent\.com$/.test(cleanClientId)) {
    throw new Error('请输入正确的 Google OAuth Client ID');
  }

  const old = await getStoredDriveClientId();
  if (old && old !== cleanClientId) {
    await chrome.storage.local.remove(['driveAccessToken', 'driveTokenExpiresAt', 'driveFolderIds']);
  }

  await chrome.storage.local.set({ driveClientId: cleanClientId });
  return getDriveStatus();
}

async function driveLogin() {
  await ensureDriveOAuthConfigured();
  const token = await getDriveToken(true);
  await ensureDriveFolders(token);
  await chrome.storage.local.set({ driveSyncEnabled: true });
  triggerDriveSync();
  return getDriveStatus();
}

async function driveLogout() {
  const token = await isDriveOAuthConfigured() ? await getDriveToken(false) : null;
  if (token) await removeCachedDriveToken(token);
  await chrome.storage.local.remove(['driveAccessToken', 'driveTokenExpiresAt']);
  await chrome.storage.local.set({ driveSyncEnabled: false });
  return getDriveStatus();
}

async function setDriveSyncEnabled(enabled) {
  if (!enabled) {
    await chrome.storage.local.set({ driveSyncEnabled: false });
    return getDriveStatus();
  }

  await ensureDriveOAuthConfigured();
  const token = await getDriveToken(false);
  if (!token) throw new Error('请先登录 Drive，再开启自动同步');

  await ensureDriveFolders(token);
  await chrome.storage.local.set({ driveSyncEnabled: true });
  triggerDriveSync();
  return getDriveStatus();
}

async function syncImageToDriveIfReady(id) {
  const settings = await chrome.storage.local.get(['driveSyncEnabled']);
  if (!settings.driveSyncEnabled || !await isDriveOAuthConfigured()) return;

  const token = await getDriveToken(false);
  if (!token) {
    await updateImage(id, {
      driveSyncStatus: 'needs_login',
      driveError: '未登录 Drive',
      driveLastTriedAt: Date.now()
    });
    return;
  }

  const record = await getImage(id);
  if (record) await syncSingleImageToDrive(record, token);
}

async function syncAllToDrive(options = {}) {
  const settings = await chrome.storage.local.get(['driveSyncEnabled']);
  if (!options.force && !settings.driveSyncEnabled) {
    return { synced: 0, failed: 0, skipped: 0 };
  }
  await ensureDriveOAuthConfigured();

  const token = await getDriveToken(!!options.interactive);
  if (!token) throw new Error('请先登录 Drive');

  await ensureDriveFolders(token);
  const images = await getAllImages();
  const pending = images.filter(image => image.driveSyncStatus !== 'synced' || !image.driveFileId);
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const image of pending) {
    try {
      const result = await syncSingleImageToDrive(image, token);
      if (result?.skipped) skipped += 1;
      else synced += 1;
    } catch (error) {
      failed += 1;
      console.warn('[ImageCollector] Drive sync failed:', error.message);
    }
  }

  return { synced, failed, skipped };
}

async function syncSingleImageToDrive(record, token) {
  if (!record?.id || (!record.imageData && !record.url)) return { skipped: true };

  const folderIds = await ensureDriveFolders(token);
  const folderName = getDriveTargetFolderName(record);
  const parentId = folderName === DRIVE_MOBILE_FOLDER ? folderIds.mobile : folderIds.computer;

  await updateImage(record.id, {
    driveSyncStatus: 'syncing',
    driveFolderName: folderName,
    driveError: '',
    driveLastTriedAt: Date.now()
  });

  try {
    const driveFile = await uploadRecordToDrive(record, token, parentId);
    await updateImage(record.id, {
      driveSyncStatus: 'synced',
      driveFileId: driveFile.id,
      driveFileName: driveFile.name,
      driveFolderName: folderName,
      driveSyncedAt: Date.now(),
      driveError: ''
    });
    return { synced: true, fileId: driveFile.id };
  } catch (error) {
    await updateImage(record.id, {
      driveSyncStatus: 'error',
      driveError: error.message,
      driveLastTriedAt: Date.now()
    });
    throw error;
  }
}

async function isDriveOAuthConfigured() {
  return !!await getDriveClientId();
}

async function ensureDriveOAuthConfigured() {
  if (!await isDriveOAuthConfigured()) {
    throw new Error('Drive 可选同步还没配置 Google OAuth Client ID，本地收藏不受影响');
  }
}

async function getDriveClientId() {
  const stored = await getStoredDriveClientId();
  if (stored) return stored;

  const manifestClientId = chrome.runtime.getManifest()?.oauth2?.client_id || '';
  if (manifestClientId && !manifestClientId.startsWith('REPLACE_WITH_') && !manifestClientId.startsWith('YOUR_')) {
    return manifestClientId;
  }
  return '';
}

async function getStoredDriveClientId() {
  const settings = await chrome.storage.local.get(['driveClientId']);
  return String(settings.driveClientId || '').trim();
}

async function getDriveToken(interactive) {
  const storedClientId = await getStoredDriveClientId();
  if (storedClientId) return getDriveTokenWithWebAuth(storedClientId, interactive);
  return getDriveTokenWithManifest(interactive);
}

function getDriveTokenWithManifest(interactive) {
  return new Promise((resolve, reject) => {
    if (!chrome.identity?.getAuthToken) {
      if (interactive) reject(new Error('当前浏览器不支持 Drive 登录'));
      else resolve(null);
      return;
    }

    chrome.identity.getAuthToken({ interactive, scopes: [DRIVE_SCOPE] }, (token) => {
      const error = chrome.runtime.lastError;
      if (error || !token) {
        if (interactive) reject(new Error(error?.message || 'Drive 登录失败'));
        else resolve(null);
        return;
      }
      resolve(token);
    });
  });
}

async function getDriveTokenWithWebAuth(clientId, interactive) {
  const cached = await chrome.storage.local.get(['driveAccessToken', 'driveTokenExpiresAt']);
  if (cached.driveAccessToken && Number(cached.driveTokenExpiresAt || 0) > Date.now() + 60000) {
    return cached.driveAccessToken;
  }
  if (!interactive) return null;
  if (!chrome.identity?.launchWebAuthFlow) throw new Error('当前浏览器不支持 Drive 登录');

  const redirectUri = getDriveRedirectUri();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', DRIVE_SCOPE);
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('prompt', 'select_account');

  const responseUrl = await launchDriveAuthFlow(authUrl.toString());
  const hash = new URL(responseUrl).hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') || 3600);
  const error = params.get('error');
  if (error || !token) throw new Error(error || 'Drive 登录失败');

  await chrome.storage.local.set({
    driveAccessToken: token,
    driveTokenExpiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000
  });
  return token;
}

function launchDriveAuthFlow(url) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (responseUrl) => {
      const error = chrome.runtime.lastError;
      if (error || !responseUrl) {
        reject(new Error(error?.message || 'Drive 登录窗口已关闭'));
        return;
      }
      resolve(responseUrl);
    });
  });
}

function getDriveRedirectUri() {
  return chrome.identity?.getRedirectURL ? chrome.identity.getRedirectURL('drive') : '';
}

function removeCachedDriveToken(token) {
  return new Promise((resolve) => {
    if (!chrome.identity?.removeCachedAuthToken) {
      resolve();
      return;
    }
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function ensureDriveFolders(token) {
  const settings = await chrome.storage.local.get(['driveFolderIds']);
  const cached = settings.driveFolderIds || {};
  const root = cached.root || await findOrCreateDriveFolder(token, DRIVE_ROOT_FOLDER);
  const computer = cached.computer || await findOrCreateDriveFolder(token, DRIVE_COMPUTER_FOLDER, root);
  const mobile = cached.mobile || await findOrCreateDriveFolder(token, DRIVE_MOBILE_FOLDER, root);
  const folderIds = { root, computer, mobile };
  await chrome.storage.local.set({ driveFolderIds: folderIds });
  return folderIds;
}

async function findOrCreateDriveFolder(token, name, parentId = '') {
  const query = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${escapeDriveQueryValue(name)}'`,
    'trashed=false'
  ];
  if (parentId) query.push(`'${escapeDriveQueryValue(parentId)}' in parents`);

  const params = new URLSearchParams({
    q: query.join(' and '),
    spaces: 'drive',
    fields: 'files(id,name)',
    pageSize: '1'
  });
  const found = await driveFetch(token, `${DRIVE_API}/files?${params}`);
  if (found.files?.[0]?.id) return found.files[0].id;

  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentId) metadata.parents = [parentId];

  const created = await driveFetch(token, `${DRIVE_API}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(metadata)
  });
  return created.id;
}

async function uploadRecordToDrive(record, token, parentId) {
  const hasLocalFile = !!record.imageData;
  const mediaType = record.mimeType || (record.mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
  const uploadBlob = hasLocalFile
    ? new Blob([record.imageData], { type: mediaType })
    : new Blob([JSON.stringify(buildDriveLinkRecord(record), null, 2)], { type: 'application/json' });
  const uploadMimeType = uploadBlob.type || 'application/octet-stream';
  const uploadName = hasLocalFile ? buildDriveFileName(record) : buildDriveLinkFileName(record);

  const metadata = {
    name: uploadName,
    parents: [parentId],
    mimeType: uploadMimeType,
    description: buildDriveDescription(record),
    appProperties: buildDriveAppProperties(record)
  };

  return driveMultipartUpload(token, metadata, uploadBlob, uploadMimeType);
}

async function driveMultipartUpload(token, metadata, blob, mimeType) {
  const boundary = `imagecollector_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`
  ], { type: `multipart/related; boundary=${boundary}` });

  const params = new URLSearchParams({
    uploadType: 'multipart',
    fields: 'id,name,webViewLink'
  });
  return driveFetch(token, `${DRIVE_UPLOAD_API}/files?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': body.type },
    body
  });
}

async function driveFetch(token, url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  if (!response.ok) {
    let message = text || response.statusText;
    try {
      message = JSON.parse(text).error?.message || message;
    } catch {
      // 保留原始错误文本。
    }
    throw new Error(`Drive 请求失败：${message}`);
  }
  return text ? JSON.parse(text) : {};
}

function getDriveTargetFolderName(record) {
  const width = Number(record.width || 0);
  const height = Number(record.height || 0);
  if (width > 0 && height > width) return DRIVE_MOBILE_FOLDER;
  return DRIVE_COMPUTER_FOLDER;
}

function buildDriveFileName(record) {
  if (record.fileName) return sanitizeFileName(record.fileName);
  const ext = record.mediaType === 'video' ? 'mp4' : 'jpg';
  return `${Date.now()}_${record.mediaType === 'video' ? 'video' : 'image'}_${record.id}.${ext}`;
}

function buildDriveLinkFileName(record) {
  const baseName = stripFileExtension(record.fileName || `link_${record.id || Date.now()}`);
  return `${sanitizeFileName(baseName)}.link.json`;
}

function buildDriveDescription(record) {
  return [
    '图片收藏夹自动同步',
    `分类：${record.category || '未分类'}`,
    `尺寸：${record.width || '?'} x ${record.height || '?'}`,
    `来源：${record.url || ''}`,
    record.pageUrl ? `页面：${record.pageUrl}` : ''
  ].filter(Boolean).join('\n').slice(0, 3000);
}

function buildDriveAppProperties(record) {
  return {
    app: 'ImageCollector',
    localId: String(record.id || ''),
    category: String(record.category || '未分类').slice(0, 120),
    width: String(record.width || 0),
    height: String(record.height || 0),
    mediaType: String(record.mediaType || 'image'),
    sourceHost: getUrlHost(record.url || record.pageUrl || '').slice(0, 120)
  };
}

function buildDriveLinkRecord(record) {
  const exported = { ...record };
  delete exported.imageData;
  delete exported.thumbnailData;
  return exported;
}

function getUrlHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function stripFileExtension(name) {
  return String(name).replace(/\.[a-z0-9]{2,6}$/i, '') || 'link';
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ========== IndexedDB 操作 ==========
function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ImageCollectorDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('images')) {
        const store = db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
        store.createIndex('url', 'url', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

async function addImage(imageData) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    const record = { ...imageData, createdAt: Date.now(), updatedAt: Date.now() };
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllImages() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readonly');
    const store = tx.objectStore('images');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getImage(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readonly');
    const store = tx.objectStore('images');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function updateImage(id, updates) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return reject(new Error('Not found'));
      const updated = { ...record, ...updates, updatedAt: Date.now() };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve(updated);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

async function deleteImage(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function deleteAllImages() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

console.log('[ImageCollector] Service worker loaded');
