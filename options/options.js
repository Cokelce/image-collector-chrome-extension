// options/options.js
// 设置页面逻辑

let latestDriveStatus = null;
const LOCAL_SETTINGS_DB = 'ImageCollectorSettingsDB';
const LOCAL_SETTINGS_STORE = 'settings';
const LOCAL_DRIVE_HANDLE_KEY = 'driveFolderHandle';

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  bindEvents();
});

function bindEvents() {
  // 选择文件夹
  document.getElementById('btnChooseFolder').addEventListener('click', async () => {
    // 在 MV3 中，我们通过设置默认下载路径来间接控制
    // 实际文件夹选择由 Chrome  Downloads API 处理
    showToast('请在首次下载时选择保存位置');
  });

  // 开关切换
  document.getElementById('toggleAutoAnalyze').addEventListener('click', (e) => {
    e.target.classList.toggle('active');
    const enabled = e.target.classList.contains('active');
    chrome.storage.local.set({ autoAnalyze: enabled });
  });

  document.getElementById('toggleAI').addEventListener('click', (e) => {
    e.target.classList.toggle('active');
    const enabled = e.target.classList.contains('active');
    chrome.storage.local.set({ aiEnabled: enabled });
  });

  // 加载模型
  document.getElementById('btnLoadModel').addEventListener('click', async () => {
    showToast('模型将在收藏图片时自动加载');
    chrome.storage.local.set({ loadModelOnDemand: true });
  });

  document.getElementById('btnSaveDriveClientId').addEventListener('click', saveDriveClientId);
  document.getElementById('driveClientIdInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveDriveClientId();
  });
  document.getElementById('btnCopyDriveRedirect').addEventListener('click', async () => {
    const text = document.getElementById('driveRedirectUri').textContent.trim();
    if (!text || text === '读取中...') return;
    await navigator.clipboard.writeText(text);
    showToast('回调地址已复制');
  });

  document.getElementById('toggleDriveSync').addEventListener('click', async () => {
    const toggle = document.getElementById('toggleDriveSync');
    const enabled = !toggle.classList.contains('active');
    try {
      setDriveBusy(true);
      const status = await sendDriveMessage({ action: 'driveSetEnabled', enabled });
      updateDriveUI(status);
      showToast(enabled ? '已开启 Drive 云端同步' : '已关闭 Drive 云端同步');
    } catch (error) {
      showToast(error.message || 'Drive 设置失败');
      focusDriveClientInput();
      await refreshDriveStatus();
    } finally {
      setDriveBusy(false);
    }
  });

  document.getElementById('btnDriveLogin').addEventListener('click', async () => {
    try {
      setDriveBusy(true);
      const status = await sendDriveMessage({ action: 'driveLogin' });
      updateDriveUI(status);
      showToast('Drive 已登录，云端同步已开启');
    } catch (error) {
      showToast(error.message || 'Drive 登录失败');
      focusDriveClientInput();
      await refreshDriveStatus();
    } finally {
      setDriveBusy(false);
    }
  });

  document.getElementById('btnDriveLogout').addEventListener('click', async () => {
    try {
      setDriveBusy(true);
      const status = await sendDriveMessage({ action: 'driveLogout' });
      updateDriveUI(status);
      showToast('已退出 Drive，云端同步已关闭');
    } catch (error) {
      showToast(error.message || 'Drive 退出失败');
      await refreshDriveStatus();
    } finally {
      setDriveBusy(false);
    }
  });

  document.getElementById('btnDriveSyncNow').addEventListener('click', async () => {
    try {
      setDriveBusy(true);
      const status = await sendDriveMessage({ action: 'driveSyncNow' });
      updateDriveUI(status);
      const result = status.syncResult || {};
      showToast(`同步完成：成功 ${result.synced || 0}，失败 ${result.failed || 0}`);
    } catch (error) {
      showToast(error.message || 'Drive 同步失败');
      focusDriveClientInput();
      await refreshDriveStatus();
    } finally {
      setDriveBusy(false);
    }
  });

  document.getElementById('toggleLocalDriveSync').addEventListener('click', async () => {
    const toggle = document.getElementById('toggleLocalDriveSync');
    const enabled = !toggle.classList.contains('active');
    try {
      setDriveBusy(true);
      if (enabled && !latestDriveStatus?.local?.configured) {
        await chooseDriveLocalFolder(false);
      }
      const status = await sendDriveMessage({ action: 'driveLocalSetEnabled', enabled });
      updateDriveUI(status);
      showToast(enabled ? '已开启备用文件夹同步' : '已关闭备用文件夹同步');
    } catch (error) {
      showToast(error.message || '备用同步设置失败');
      await refreshDriveStatus();
    } finally {
      setDriveBusy(false);
    }
  });

  document.getElementById('btnLocalDriveChoose').addEventListener('click', async () => {
    try {
      setDriveBusy(true);
      await chooseDriveLocalFolder(true);
    } catch (error) {
      showToast(error.message || '选择备用文件夹失败');
      await refreshDriveStatus();
    } finally {
      setDriveBusy(false);
    }
  });

  document.getElementById('btnLocalDriveSyncNow').addEventListener('click', async () => {
    try {
      setDriveBusy(true);
      if (!latestDriveStatus?.local?.configured) {
        await chooseDriveLocalFolder(false);
      }
      const status = await sendDriveMessage({ action: 'driveLocalSyncNow' });
      updateDriveUI(status);
      const result = status.syncResult || {};
      showToast(`备用同步完成：成功 ${result.synced || 0}，失败 ${result.failed || 0}`);
    } catch (error) {
      showToast(error.message || '备用同步失败');
      await refreshDriveStatus();
    } finally {
      setDriveBusy(false);
    }
  });

  document.getElementById('btnLocalDriveClose').addEventListener('click', async () => {
    try {
      setDriveBusy(true);
      const status = await sendDriveMessage({ action: 'driveLocalSetEnabled', enabled: false });
      updateDriveUI(status);
      showToast('已关闭备用文件夹同步');
    } catch (error) {
      showToast(error.message || '关闭备用同步失败');
      await refreshDriveStatus();
    } finally {
      setDriveBusy(false);
    }
  });

  // 导出
  document.getElementById('btnExport').addEventListener('click', async () => {
    const db = await getDB();
    const images = await db.getAllImages();
    const exportImages = images.map((image) => ({ ...image, imageData: undefined }));
    const blob = new Blob([JSON.stringify(exportImages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: url,
      filename: `image-collector-export-${Date.now()}.json`
    });
    showToast('导出成功');
  });

  document.getElementById('btnImport').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });

  document.getElementById('importFileInput').addEventListener('change', importData);

  // 清空
  document.getElementById('btnClearData').addEventListener('click', async () => {
    if (!confirm('确定清空所有收藏图片吗？此操作不可恢复。')) return;
    if (!confirm('再次确认：真的要删除所有数据吗？')) return;
    
    const db = await getDB();
    await db.deleteAllImages();
    showToast('已清空');
  });
}

async function importData(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  let records = [];
  try {
    const parsed = JSON.parse(await file.text());
    records = normalizeImportRecords(parsed);
  } catch {
    showToast('导入失败：JSON 文件格式不正确');
    return;
  }

  if (!records.length) {
    showToast('导入失败：没有找到可恢复的图片链接');
    return;
  }

  const db = await getDB();
  const images = await db.getAllImages();
  const existingUrls = new Set(images.map((image) => image.url).filter(Boolean));
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  setImportBusy(true);
  showToast(`开始导入 ${records.length} 条收藏...`);
  for (const record of records) {
    if (existingUrls.has(record.url)) {
      skipped += 1;
      continue;
    }

    try {
      const result = await sendSaveImageMessage(record);
      if (!result?.success) throw new Error(result?.error || '保存失败');
      existingUrls.add(record.url);
      imported += 1;
    } catch {
      failed += 1;
    }
  }
  setImportBusy(false);
  await refreshDriveStatus();
  showToast(`导入完成：新增 ${imported}，跳过 ${skipped}，失败 ${failed}`);
}

function normalizeImportRecords(parsed) {
  const list = Array.isArray(parsed) ? parsed : (parsed?.images || parsed?.records || []);
  const records = [];
  for (const item of list) {
    const url = String(item?.url || item?.src || item?.imageUrl || item?.mediaUrl || '').trim();
    if (!/^https?:\/\//i.test(url) && !url.startsWith('data:')) continue;
    records.push({
      action: 'saveImage',
      url,
      pageUrl: item.pageUrl || item.sourcePage || '',
      pageTitle: item.pageTitle || item.title || item.historyTitle || '',
      mediaType: item.mediaType || '',
      category: item.category || '',
      tags: item.tags || item.keywords || [],
      width: Number(item.width || 0),
      height: Number(item.height || 0),
      source: 'import'
    });
  }
  return records;
}

function sendSaveImageMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(['autoAnalyze', 'aiEnabled']);
  
  if (settings.autoAnalyze !== false) {
    document.getElementById('toggleAutoAnalyze').classList.add('active');
  }
  if (settings.aiEnabled) {
    document.getElementById('toggleAI').classList.add('active');
  }

  await refreshDriveStatus();
}

async function chooseDriveLocalFolder(showDoneToast) {
  if (typeof showDirectoryPicker !== 'function') {
    throw new Error('当前浏览器不支持选择本地 Drive 文件夹');
  }

  const handle = await showDirectoryPicker({
    id: 'image-collector-drive',
    mode: 'readwrite',
    startIn: 'documents'
  });
  const permission = await handle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('需要允许写入 Drive 文件夹');

  await saveLocalSetting(LOCAL_DRIVE_HANDLE_KEY, handle);
  const status = await sendDriveMessage({ action: 'driveLocalSetEnabled', enabled: true });
  updateDriveUI(status);
  if (showDoneToast) showToast('已选择 Drive 文件夹，并开启自动同步');
  return status;
}

async function saveDriveClientId() {
  const input = document.getElementById('driveClientIdInput');
  try {
    setDriveBusy(true);
    const status = await sendDriveMessage({
      action: 'driveSaveClientId',
      clientId: input.value
    });
    updateDriveUI(status);
    showToast('Drive Client ID 已保存');
  } catch (error) {
    showToast(error.message || '保存失败');
    input.focus();
  } finally {
    setDriveBusy(false);
  }
}

async function refreshDriveStatus() {
  try {
    const status = await sendDriveMessage({ action: 'driveGetStatus' });
    updateDriveUI(status);
  } catch (error) {
    const driveStatus = document.getElementById('driveStatus');
    driveStatus.textContent = error.message || 'Drive 状态读取失败，本地收藏不受影响';
  }
}

function updateDriveUI(status) {
  latestDriveStatus = status;
  const toggle = document.getElementById('toggleDriveSync');
  const statusEl = document.getElementById('driveStatus');
  const btnLogin = document.getElementById('btnDriveLogin');
  const btnLogout = document.getElementById('btnDriveLogout');
  const btnSyncNow = document.getElementById('btnDriveSyncNow');
  const btnSaveClientId = document.getElementById('btnSaveDriveClientId');
  const input = document.getElementById('driveClientIdInput');
  const redirectUri = document.getElementById('driveRedirectUri');

  toggle.classList.toggle('active', !!status.enabled);
  if (!input.value && status.clientId) input.value = status.clientId;
  redirectUri.textContent = status.redirectUri || '当前浏览器不支持';
  btnLogin.disabled = false;
  btnLogout.disabled = !status.signedIn;
  btnSyncNow.disabled = false;
  btnSaveClientId.disabled = false;

  if (!status.configured) {
    statusEl.textContent = '请先保存 OAuth Client ID；现在只保存到本机';
    updateLocalDriveUI(status);
    return;
  }

  if (!status.signedIn) {
    statusEl.textContent = '已保存 Client ID，尚未登录 Drive；现在只保存到本机';
    updateLocalDriveUI(status);
    return;
  }

  const folderText = `${status.rootFolderName}/${status.computerFolderName}、${status.rootFolderName}/${status.mobileFolderName}`;
  if (status.enabled) {
    statusEl.textContent = `已开启：新收藏会直接上传到云端 ${folderText}；待同步 ${status.pendingCount || 0} 张`;
  } else {
    statusEl.textContent = `已登录但未开启自动同步；立即同步会上传到云端 ${folderText}`;
  }
  updateLocalDriveUI(status);
}

function updateLocalDriveUI(status) {
  const local = status.local || {};
  const toggle = document.getElementById('toggleLocalDriveSync');
  const statusEl = document.getElementById('localDriveStatus');
  const btnSyncNow = document.getElementById('btnLocalDriveSyncNow');
  const btnClose = document.getElementById('btnLocalDriveClose');
  if (!toggle || !statusEl) return;

  toggle.classList.toggle('active', !!local.enabled);
  btnSyncNow.disabled = !local.configured;
  btnClose.disabled = !local.enabled;

  if (!local.configured) {
    statusEl.textContent = '未选择备用文件夹';
    return;
  }

  if (local.permission !== 'granted') {
    statusEl.textContent = `已选择“${local.folderName}”，但需要重新授权写入`;
    return;
  }

  const folderText = `${local.rootFolderName}/${local.computerFolderName}、${local.rootFolderName}/${local.mobileFolderName}`;
  if (local.enabled) {
    statusEl.textContent = `备用已开启：写入“${local.folderName}”里的 ${folderText}；待同步 ${local.pendingCount || 0} 张`;
  } else {
    statusEl.textContent = `备用已选择“${local.folderName}”，但未开启`;
  }
}

function setDriveBusy(busy) {
  if (!busy) {
    if (latestDriveStatus) updateDriveUI(latestDriveStatus);
    return;
  }
  [
    'btnDriveLogin',
    'btnDriveLogout',
    'btnDriveSyncNow',
    'btnSaveDriveClientId',
    'btnLocalDriveChoose',
    'btnLocalDriveSyncNow',
    'btnLocalDriveClose'
  ].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.disabled = busy;
  });
}

function setImportBusy(busy) {
  const button = document.getElementById('btnImport');
  const input = document.getElementById('importFileInput');
  if (button) button.disabled = busy;
  if (input) input.disabled = busy;
}

function focusDriveClientInput() {
  const input = document.getElementById('driveClientIdInput');
  if (!input.value.trim()) input.focus();
}

async function saveLocalSetting(key, value) {
  const db = await getLocalSettingsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(LOCAL_SETTINGS_STORE);
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
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

function sendDriveMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || 'Drive 操作失败'));
        return;
      }
      resolve(response);
    });
  });
}

function showToast(msg) {
  let toast = document.querySelector('.ic-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'ic-toast';
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      background: rgba(30, 30, 50, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      color: white;
      font-size: 14px;
      z-index: 999999;
      opacity: 0;
      transform: translateY(-10px);
      transition: opacity 0.3s, transform 0.3s;
      pointer-events: none;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
  }, 2000);
}
