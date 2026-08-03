// popup/popup.js
// 弹窗逻辑：图片列表、搜索、筛选、预览

let allImages = [];
let currentFilter = 'all';
let currentCategory = null;
let searchQuery = '';
let currentPreviewId = null;
let currentContextId = null;
let contextMenu = null;
let activeBlobUrls = new Set();
let ambientBlobUrls = [];
let editingCategoryId = null;
let categoryDragState = null;
let driveStatusCache = null;
const advancedFilters = {
  mediaType: 'all',
  orientation: 'all',
  storage: 'all',
  source: 'all',
  color: 'all'
};
const BASE_CATEGORIES = [
  '动漫插画',
  '人像人物',
  '风景自然',
  '城市建筑',
  '动态壁纸',
  '设计素材',
  '科技数码',
  '游戏影视',
  '美食饮品',
  '交通工具',
  '动物萌宠',
  '其他收藏',
  '未分类'
];

// DOM 元素
const gallery = document.getElementById('gallery');
const emptyState = document.getElementById('emptyState');
const imageCount = document.getElementById('imageCount');
const btnDriveStatus = document.getElementById('btnDriveStatus');
const driveLabel = document.getElementById('driveLabel');
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
const categoryList = document.getElementById('categoryList');
const filterBtns = document.querySelectorAll('.filter-btn[data-filter]');
const advancedFilterToggle = document.getElementById('advancedFilterToggle');
const advancedFilterPanel = document.getElementById('advancedFilterPanel');
const advancedFilterClear = document.getElementById('advancedFilterClear');
const previewOverlay = document.getElementById('previewOverlay');
const previewImage = document.getElementById('previewImage');
const previewVideo = document.getElementById('previewVideo');
const previewMeta = document.getElementById('previewMeta');
const previewTags = document.getElementById('previewTags');
const categoryEditorOverlay = document.getElementById('categoryEditorOverlay');
const categoryEditorSelect = document.getElementById('categoryEditorSelect');
const categoryEditorCustom = document.getElementById('categoryEditorCustom');

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  loadImages();
  bindEvents();
  refreshDriveStatus();
});

function bindEvents() {
  // 搜索
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    clearSearch.style.display = searchQuery ? 'block' : 'none';
    if (!searchQuery) {
      currentFilter = 'all';
      currentCategory = null;
      setActiveFilter('all');
      renderCategoryList();
    }
    renderGallery();
  });

  clearSearch.addEventListener('click', () => {
    resetSearchAndFilters();
    renderGallery();
  });

  // 筛选按钮
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      currentCategory = null;
      renderCategoryList();
      renderGallery();
    });
  });

  advancedFilterToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideCardContextMenu();
    advancedFilterPanel.classList.toggle('show');
  });

  advancedFilterPanel.addEventListener('click', (event) => {
    event.stopPropagation();
    const button = event.target.closest('.mini-filter');
    if (!button) return;

    const field = button.dataset.advancedField;
    advancedFilters[field] = button.dataset.advancedValue;
    updateAdvancedFilterButtons();
    renderGallery();
  });

  advancedFilterClear.addEventListener('click', () => {
    resetAdvancedFilters();
    renderGallery();
  });

  // 底部按钮
  document.getElementById('btnRefresh').addEventListener('click', loadImages);
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnClear').addEventListener('click', clearAll);
  btnDriveStatus.addEventListener('click', handleDriveStatusClick);
  categoryList.addEventListener('click', handleCategoryClick);

  // 预览关闭
  document.getElementById('previewClose').addEventListener('click', closePreview);
  previewOverlay.addEventListener('click', (e) => {
    if (e.target === previewOverlay) closePreview();
  });

  // 预览操作
  document.getElementById('btnOpenFile').addEventListener('click', () => openFile(currentPreviewId));
  document.getElementById('btnCopyUrl').addEventListener('click', () => copyUrl(currentPreviewId));
  document.getElementById('btnDelete').addEventListener('click', () => deleteImage(currentPreviewId));

  document.getElementById('categoryEditorClose').addEventListener('click', closeCategoryEditor);
  document.getElementById('categoryEditorCancel').addEventListener('click', closeCategoryEditor);
  document.getElementById('categoryEditorSave').addEventListener('click', saveEditedCategory);
  categoryEditorSelect.addEventListener('change', updateCategoryCustomInput);
  categoryEditorOverlay.addEventListener('click', (event) => {
    if (event.target === categoryEditorOverlay) closeCategoryEditor();
  });

  createCardContextMenu();
  document.addEventListener('click', (event) => {
    hideCardContextMenu();
    if (!advancedFilterPanel.contains(event.target) && event.target !== advancedFilterToggle) {
      hideAdvancedFilterPanel();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideCardContextMenu();
      hideAdvancedFilterPanel();
      closeCategoryEditor();
    }
  });
  gallery.addEventListener('scroll', hideCardContextMenu);
  bindCategoryScroller();
}

function resetSearchAndFilters() {
  searchInput.value = '';
  searchQuery = '';
  currentFilter = 'all';
  currentCategory = null;
  clearSearch.style.display = 'none';
  setActiveFilter('all');
  resetAdvancedFilters(false);
  renderCategoryList();
}

function setActiveFilter(filter) {
  filterBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.filter === filter));
}

function resetAdvancedFilters(shouldRender = true) {
  Object.keys(advancedFilters).forEach(key => {
    advancedFilters[key] = 'all';
  });
  updateAdvancedFilterButtons();
  if (shouldRender) renderGallery();
}

function updateAdvancedFilterButtons() {
  const activeCount = Object.values(advancedFilters).filter(value => value !== 'all').length;
  advancedFilterToggle.classList.toggle('active', activeCount > 0);
  advancedFilterToggle.textContent = activeCount > 0 ? `筛选 ${activeCount}` : '筛选';

  advancedFilterPanel.querySelectorAll('.mini-filter').forEach(button => {
    const field = button.dataset.advancedField;
    button.classList.toggle('active', advancedFilters[field] === button.dataset.advancedValue);
  });
}

function hideAdvancedFilterPanel() {
  advancedFilterPanel.classList.remove('show');
}

function bindCategoryScroller() {
  categoryList.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (categoryList.scrollWidth <= categoryList.clientWidth) return;
    event.preventDefault();
    categoryList.scrollLeft += event.deltaY;
  }, { passive: false });

  categoryList.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || categoryList.scrollWidth <= categoryList.clientWidth) return;
    categoryDragState = {
      x: event.clientX,
      scrollLeft: categoryList.scrollLeft,
      moved: false
    };
    categoryList.classList.add('dragging');
    categoryList.setPointerCapture(event.pointerId);
  });

  categoryList.addEventListener('pointermove', (event) => {
    if (!categoryDragState) return;
    const dx = event.clientX - categoryDragState.x;
    if (Math.abs(dx) > 4) categoryDragState.moved = true;
    categoryList.scrollLeft = categoryDragState.scrollLeft - dx;
  });

  categoryList.addEventListener('pointerup', (event) => {
    if (!categoryDragState) return;
    if (categoryDragState.moved) {
      event.preventDefault();
      categoryList.dataset.dragged = 'true';
      setTimeout(() => delete categoryList.dataset.dragged, 0);
    }
    categoryDragState = null;
    categoryList.classList.remove('dragging');
  });

  categoryList.addEventListener('pointercancel', () => {
    categoryDragState = null;
    categoryList.classList.remove('dragging');
  });
}

async function loadImages() {
  // 显示加载
  gallery.innerHTML = '<div class="loading">加载中...</div>';
  
  try {
    const db = await getDB();
    allImages = db.getAllImageSummaries ? await db.getAllImageSummaries() : await db.getAllImages();
    await classifyExistingImages(db);
    allImages.sort((a, b) => b.createdAt - a.createdAt);
    await backfillMissingThumbnails(db);
    await updateAmbientBackground(db);
    updateCount();
    renderCategoryList();
    renderGallery();
  } catch (error) {
    console.error('加载图片失败:', error);
    gallery.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
  }
}

async function classifyExistingImages(db) {
  const pending = allImages.filter(img => !img.category || img.category === '未分类');
  for (const img of pending) {
    try {
      const fullImage = img.imageData ? img : await db.getImage(img.id);
      const category = await ImageCollectorAnalyzer.analyzeRecord(fullImage || img);
      if (category && category !== img.category) {
        img.category = category;
        await db.updateImage(img.id, { category });
      }
    } catch (error) {
      // 单张图片分类失败不影响弹窗打开。
    }
  }
}

async function backfillMissingThumbnails(db) {
  const missing = allImages
    .filter(img => !isVideoRecord(img) && !img.thumbnailData && img.id)
    .slice(0, 60);

  for (const img of missing) {
    try {
      const fullImage = await db.getImage(img.id);
      if (!fullImage?.imageData) continue;

      const thumbnail = await createPopupThumbnail(fullImage.imageData, fullImage.mimeType);
      if (!thumbnail) continue;

      img.thumbnailData = thumbnail.data;
      img.thumbnailMimeType = thumbnail.mimeType;
      await db.updateImage(img.id, {
        thumbnailData: thumbnail.data,
        thumbnailMimeType: thumbnail.mimeType
      });
    } catch {
      // 旧数据缩略图补齐失败时，继续显示链接占位。
    }
  }
}

async function createPopupThumbnail(imageData, mimeType) {
  try {
    if (typeof createImageBitmap !== 'function') return null;

    const blob = new Blob([imageData], { type: mimeType || 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const maxSide = 280;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const thumbnailBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.78));
    if (!thumbnailBlob) return null;
    return {
      data: await thumbnailBlob.arrayBuffer(),
      mimeType: thumbnailBlob.type || 'image/webp'
    };
  } catch {
    return null;
  }
}

function updateCount() {
  imageCount.textContent = allImages.length;
}

async function refreshDriveStatus() {
  try {
    const status = await sendDriveMessage({ action: 'driveGetStatus' });
    updateDrivePill(status);
  } catch (error) {
    updateDrivePill({
      configured: false,
      enabled: false,
      signedIn: false,
      error: error.message
    });
  }
}

async function handleDriveStatusClick() {
  hideCardContextMenu();
  hideAdvancedFilterPanel();

  try {
    setDrivePillBusy(true);
    const status = driveStatusCache || await sendDriveMessage({ action: 'driveGetStatus' });

    if (!status.configured) {
      showToast('请先配置 Drive 云端同步');
      await openOptionsPageFromPopup();
      return;
    }

    if (!status.signedIn) {
      const nextStatus = await sendDriveMessage({ action: 'driveLogin' });
      updateDrivePill(nextStatus);
      showToast('Drive 已登录，云端同步已开启');
      return;
    }

    if (!status.enabled) {
      const nextStatus = await sendDriveMessage({ action: 'driveSetEnabled', enabled: true });
      updateDrivePill(nextStatus);
      showToast('Drive 云端同步已开启');
      return;
    }

    const nextStatus = await sendDriveMessage({ action: 'driveSyncNow' });
    updateDrivePill(nextStatus);
    const result = nextStatus.syncResult || {};
    showToast(`同步完成：成功 ${result.synced || 0}，失败 ${result.failed || 0}`);
  } catch (error) {
    showToast(error.message || 'Drive 操作失败');
    await refreshDriveStatus();
  } finally {
    setDrivePillBusy(false);
  }
}

function openOptionsPageFromPopup() {
  const optionsUrl = chrome.runtime.getURL('options/options.html');
  return new Promise((resolve) => {
    if (chrome.tabs?.create) {
      chrome.tabs.create({ url: optionsUrl, active: true }, () => {
        if (!chrome.runtime.lastError) {
          resolve();
          return;
        }
        openRuntimeOptionsPage(resolve, optionsUrl);
      });
      return;
    }
    openRuntimeOptionsPage(resolve, optionsUrl);
  });
}

function openRuntimeOptionsPage(resolve, optionsUrl) {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage(() => {
      if (chrome.runtime.lastError) window.open(optionsUrl, '_blank');
      resolve();
    });
    return;
  }
  window.open(optionsUrl, '_blank');
  resolve();
}

function updateDrivePill(status) {
  driveStatusCache = status;
  btnDriveStatus.classList.remove('is-ready', 'is-waiting', 'is-offline');

  if (!status.configured) {
    driveLabel.textContent = '配云端';
    btnDriveStatus.title = '点击打开设置页，配置 Drive 云端同步';
    btnDriveStatus.classList.add('is-offline');
    return;
  }

  if (!status.signedIn) {
    driveLabel.textContent = '登录Drive';
    btnDriveStatus.title = '点击登录 Drive 云端';
    btnDriveStatus.classList.add('is-waiting');
    return;
  }

  if (!status.enabled) {
    driveLabel.textContent = '开云端';
    btnDriveStatus.title = '已登录 Drive，点击开启云端自动同步';
    btnDriveStatus.classList.add('is-waiting');
    return;
  }

  const pending = status.pendingCount || 0;
  driveLabel.textContent = pending > 0 ? `同步 ${pending}` : 'Drive 已开';
  btnDriveStatus.title = pending > 0 ? `还有 ${pending} 张待同步到云端，点击立即同步` : 'Drive 云端自动同步已开启，点击立即检查';
  btnDriveStatus.classList.add('is-ready');
}

function setDrivePillBusy(busy) {
  btnDriveStatus.classList.toggle('busy', busy);
  btnDriveStatus.disabled = busy;
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

function renderCategoryList() {
  // 统计分类
  const categoryMap = {};
  allImages.forEach(img => {
    const cat = img.category || '未分类';
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
  });

  categoryList.innerHTML = '';
  Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
      const tag = document.createElement('button');
      tag.className = 'category-tag' + (currentCategory === cat ? ' active' : '');
      tag.dataset.category = cat;
      tag.textContent = `${cat} (${count})`;
      categoryList.appendChild(tag);
    });
}

function handleCategoryClick(event) {
  const tag = event.target.closest('.category-tag');
  if (!tag || !categoryList.contains(tag)) return;
  if (categoryList.dataset.dragged === 'true') return;

  const cat = tag.dataset.category;
  if (!cat) return;

  currentCategory = currentCategory === cat ? null : cat;
  currentFilter = 'all';
  setActiveFilter('all');
  renderCategoryList();
  renderGallery();
}

function renderGallery() {
  // 清理之前的 blob URLs
  revokeAllBlobUrls();
  
  let filtered = [...allImages];

  // 搜索过滤
  if (searchQuery) {
    filtered = filtered.filter(img => {
      const searchStr = [
        img.category || '',
        ...(img.tags || []),
        img.fileName || '',
        img.pageTitle || '',
        img.url || ''
      ].join(' ').toLowerCase();
      return searchStr.includes(searchQuery);
    });
  }

  // 分类/筛选过滤
  if (currentFilter === 'unclassified') {
    filtered = filtered.filter(img => !img.category || img.category === '未分类');
  }
  if (currentCategory) {
    filtered = filtered.filter(img => img.category === currentCategory);
  }
  filtered = filtered.filter(matchesAdvancedFilters);

  // 渲染
  if (filtered.length === 0) {
    gallery.innerHTML = '';
    gallery.appendChild(emptyState);
    emptyState.style.display = 'flex';
    if (allImages.length > 0) {
      emptyState.querySelector('p').textContent = '没有匹配的图片';
      emptyState.querySelector('.empty-hint').textContent = '尝试其他搜索词或筛选条件';
    } else {
      emptyState.querySelector('p').textContent = '还没有收藏图片';
      emptyState.querySelector('.empty-hint').textContent = '在网页图片或动图上右键，选择“收藏这个图片/动图”';
    }
  } else {
    emptyState.style.display = 'none';
    const grid = document.createElement('div');
    grid.className = 'image-grid';
    
    filtered.forEach(img => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.title = '左键预览，右键更多操作';
      
      const imgEl = document.createElement(isVideoRecord(img) ? 'video' : 'img');
      imgEl.src = getGridMediaUrl(img);
      if (imgEl.tagName === 'VIDEO') {
        imgEl.muted = true;
        imgEl.loop = true;
        imgEl.autoplay = true;
        imgEl.playsInline = true;
        imgEl.preload = 'metadata';
      } else {
        imgEl.alt = img.fileName || '';
        imgEl.loading = 'lazy';
      }

      const missingThumb = document.createElement('div');
      missingThumb.className = 'missing-thumb';
      missingThumb.textContent = '仅保存链接';
      imgEl.addEventListener('error', () => {
        imgEl.style.display = 'none';
        card.classList.add('image-card--missing');
      });
      
      // 标签覆盖层
      const overlay = document.createElement('div');
      overlay.className = 'card-overlay';
      if (img.category && img.category !== '未分类') {
        const catTag = document.createElement('span');
        catTag.className = 'card-tag';
        catTag.textContent = img.category;
        overlay.appendChild(catTag);
      }
      if (img.tags && img.tags.length > 0) {
        img.tags.slice(0, 2).forEach(tag => {
          const tagEl = document.createElement('span');
          tagEl.className = 'card-tag';
          tagEl.textContent = tag;
          overlay.appendChild(tagEl);
        });
      }

      card.appendChild(imgEl);
      card.appendChild(missingThumb);
      card.appendChild(overlay);
      
      card.addEventListener('click', () => openPreview(img.id));
      card.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showCardContextMenu(img.id, event.clientX, event.clientY);
      });
      
      grid.appendChild(card);
    });
    
    // 保留 emptyState 元素但隐藏
    gallery.innerHTML = '';
    gallery.appendChild(emptyState);
    emptyState.style.display = 'none';
    gallery.appendChild(grid);
  }
}

function matchesAdvancedFilters(img) {
  if (advancedFilters.mediaType !== 'all') {
    const type = isVideoRecord(img) ? 'video' : 'image';
    if (type !== advancedFilters.mediaType) return false;
  }

  if (advancedFilters.orientation !== 'all' && getImageOrientation(img) !== advancedFilters.orientation) {
    return false;
  }

  if (advancedFilters.storage !== 'all') {
    const hasLocalFile = !!img.imageData || !!img.hasLocalFile || (img.size || 0) > 0;
    if (advancedFilters.storage === 'local' && !hasLocalFile) return false;
    if (advancedFilters.storage === 'link' && hasLocalFile) return false;
  }

  if (advancedFilters.source !== 'all') {
    const text = `${img.url || ''} ${img.pageUrl || ''}`.toLowerCase();
    const isHaowallpaper = text.includes('haowallpaper.com');
    if (advancedFilters.source === 'haowallpaper' && !isHaowallpaper) return false;
    if (advancedFilters.source === 'other' && isHaowallpaper) return false;
  }

  if (advancedFilters.color !== 'all') {
    const tags = img.tags || [];
    if (!tags.includes(advancedFilters.color)) return false;
  }

  return true;
}

function getImageOrientation(img) {
  if (img.width && img.height) {
    const ratio = img.width / img.height;
    if (ratio > 1.35) return 'landscape';
    if (ratio < 0.78) return 'portrait';
    return 'square';
  }

  const tags = img.tags || [];
  if (tags.includes('横图')) return 'landscape';
  if (tags.includes('竖图')) return 'portrait';
  if (tags.includes('方图')) return 'square';
  return 'unknown';
}

async function openPreview(id) {
  hideCardContextMenu();
  const img = await getImageRecord(id);
  if (!img) return;
  
  currentPreviewId = id;
  
  // 清理之前的预览 blob URL
  if (previewImage.src && previewImage.src.startsWith('blob:')) {
    URL.revokeObjectURL(previewImage.src);
  }
  if (previewVideo.src && previewVideo.src.startsWith('blob:')) {
    URL.revokeObjectURL(previewVideo.src);
  }
  
  const previewUrl = img.imageData ? createBlobUrl(img.imageData, img.mimeType) : img.url;
  if (isVideoRecord(img)) {
    previewImage.style.display = 'none';
    previewImage.removeAttribute('src');
    previewVideo.style.display = 'block';
    previewVideo.src = previewUrl;
  } else {
    previewVideo.pause();
    previewVideo.style.display = 'none';
    previewVideo.removeAttribute('src');
    previewImage.style.display = 'block';
    previewImage.src = previewUrl;
  }
  
  previewMeta.innerHTML = `
    <strong>文件：</strong>${img.fileName || '未知'}<br>
    <strong>分类：</strong>${img.category || '未分类'}<br>
    <strong>尺寸：</strong>${img.width || '?'} × ${img.height || '?'}<br>
    <strong>大小：</strong>${formatSize(img.size || 0)}<br>
    <strong>类型：</strong>${isVideoRecord(img) ? '动图/视频' : '图片'}<br>
    <strong>状态：</strong>${img.imageData ? '已保存到本机' : '仅保存原链接'}<br>
    <strong>来源：</strong>${img.pageTitle || img.pageUrl || '未知'}<br>
    <strong>时间：</strong>${new Date(img.createdAt).toLocaleString()}
  `;
  
  previewTags.innerHTML = '';
  if (img.tags && img.tags.length > 0) {
    img.tags.forEach(tag => {
      const span = document.createElement('span');
      span.className = 'preview-tag';
      span.textContent = tag;
      previewTags.appendChild(span);
    });
  }
  
  previewOverlay.classList.add('show');
}

function closePreview() {
  // 清理预览图片的 blob URL
  if (previewImage.src && previewImage.src.startsWith('blob:')) {
    URL.revokeObjectURL(previewImage.src);
    previewImage.src = '';
  }
  if (previewVideo.src && previewVideo.src.startsWith('blob:')) {
    URL.revokeObjectURL(previewVideo.src);
  }
  previewVideo.pause();
  previewVideo.removeAttribute('src');
  previewOverlay.classList.remove('show');
  currentPreviewId = null;
}

// 清理所有资源
window.addEventListener('beforeunload', () => {
  revokeAllBlobUrls();
  if (previewImage.src && previewImage.src.startsWith('blob:')) {
    URL.revokeObjectURL(previewImage.src);
  }
  if (previewVideo.src && previewVideo.src.startsWith('blob:')) {
    URL.revokeObjectURL(previewVideo.src);
  }
  revokeAmbientBlobUrls();
});

async function openFile(id, notice = '已开始下载') {
  const img = await getImageRecord(id);
  if (!img) return;

  if (img.imageData) {
    const blob = new Blob([img.imageData], { type: img.mimeType || (isVideoRecord(img) ? 'video/mp4' : 'image/jpeg') });
    const blobUrl = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: blobUrl,
      filename: getDownloadFileName(img),
      saveAs: false,
      conflictAction: 'uniquify'
    }, () => {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      showToast(chrome.runtime.lastError ? '下载失败' : notice);
    });
    return;
  }

  chrome.downloads.download({
    url: img.url,
    filename: getDownloadFileName(img),
    saveAs: false,
    conflictAction: 'uniquify'
  }, () => showToast(chrome.runtime.lastError ? '下载失败' : notice));
}

async function copyUrl(id) {
  const img = allImages.find(i => i.id === id);
  if (!img) return;
  try {
    await navigator.clipboard.writeText(img.url);
    showToast('链接已复制');
  } catch (e) {
    showToast('复制失败');
  }
}

async function deleteImage(id) {
  if (!confirm('确定删除这张图片吗？')) return;
  
  try {
    const db = await getDB();
    await db.deleteImage(id);
    allImages = allImages.filter(i => i.id !== id);
    if (currentCategory && !allImages.some(img => img.category === currentCategory)) {
      currentCategory = null;
    }
    await updateAmbientBackground();
    closePreview();
    updateCount();
    renderCategoryList();
    renderGallery();
    showToast('已删除');
  } catch (error) {
    showToast('删除失败');
  }
}

function createCardContextMenu() {
  if (contextMenu) return;

  contextMenu = document.createElement('div');
  contextMenu.className = 'card-context-menu';
  contextMenu.innerHTML = `
    <button type="button" data-action="edit-category"><span>✎</span>修改分类</button>
    <button type="button" data-action="download"><span>↓</span>下载</button>
    <button type="button" data-action="wallpaper"><span>▣</span>设为桌面壁纸</button>
    <button type="button" data-action="screensaver"><span>◫</span>设为屏保</button>
    <button type="button" data-action="delete" class="danger"><span>×</span>删除</button>
  `;

  contextMenu.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const id = currentContextId;
    const action = button.dataset.action;
    hideCardContextMenu();
    if (!id) return;

    if (action === 'edit-category') openCategoryEditor(id);
    if (action === 'download') await openFile(id);
    if (action === 'delete') await deleteImage(id);
    if (action === 'wallpaper') await downloadForSystemSetting(id, '桌面壁纸');
    if (action === 'screensaver') await downloadForSystemSetting(id, '屏保');
  });

  document.body.appendChild(contextMenu);
}

function showCardContextMenu(id, x, y) {
  if (!contextMenu) createCardContextMenu();
  currentContextId = id;
  contextMenu.classList.add('show');

  const margin = 10;
  const rect = contextMenu.getBoundingClientRect();
  const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
}

function hideCardContextMenu() {
  if (!contextMenu) return;
  contextMenu.classList.remove('show');
  currentContextId = null;
}

function openCategoryEditor(id) {
  const img = allImages.find(item => item.id === id);
  if (!img) return;

  editingCategoryId = id;
  const currentCategoryName = img.category || '未分类';
  const options = getCategoryOptions(currentCategoryName);
  categoryEditorSelect.innerHTML = '';

  options.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categoryEditorSelect.appendChild(option);
  });

  const customOption = document.createElement('option');
  customOption.value = '__custom__';
  customOption.textContent = '自定义...';
  categoryEditorSelect.appendChild(customOption);
  categoryEditorSelect.value = options.includes(currentCategoryName) ? currentCategoryName : '__custom__';
  categoryEditorCustom.value = options.includes(currentCategoryName) ? '' : currentCategoryName;
  updateCategoryCustomInput();
  categoryEditorOverlay.classList.add('show');
  if (categoryEditorSelect.value === '__custom__') categoryEditorCustom.focus();
}

function closeCategoryEditor() {
  categoryEditorOverlay.classList.remove('show');
  editingCategoryId = null;
}

function updateCategoryCustomInput() {
  const isCustom = categoryEditorSelect.value === '__custom__';
  categoryEditorCustom.style.display = isCustom ? 'block' : 'none';
}

async function saveEditedCategory() {
  if (!editingCategoryId) return;

  const selected = categoryEditorSelect.value;
  const category = selected === '__custom__'
    ? categoryEditorCustom.value.trim()
    : selected;
  if (!category) {
    showToast('请输入分类名称');
    categoryEditorCustom.focus();
    return;
  }

  try {
    const db = await getDB();
    await db.updateImage(editingCategoryId, { category });
    const image = allImages.find(item => item.id === editingCategoryId);
    if (image) categoryEditorCustom.value = '';
    if (image) image.category = category;
    closeCategoryEditor();
    currentFilter = 'all';
    currentCategory = category;
    setActiveFilter('all');
    updateCount();
    renderCategoryList();
    renderGallery();
    showToast('分类已更新');
  } catch {
    showToast('保存失败');
  }
}

function getCategoryOptions(currentCategoryName) {
  const existing = allImages
    .map(img => img.category || '未分类')
    .filter(Boolean);
  return [...new Set([...BASE_CATEGORIES, ...existing, currentCategoryName])];
}

async function downloadForSystemSetting(id, purpose) {
  await openFile(id, `已下载，请在 Windows 设置中设为${purpose}`);
}

function isVideoRecord(img) {
  return img?.mediaType === 'video' ||
    (img?.mimeType || '').startsWith('video/') ||
    /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(img?.fileName || img?.url || '');
}

async function getImageRecord(id) {
  const summary = allImages.find(i => i.id === id);
  if (!summary) return null;
  if (summary.imageData) return summary;

  try {
    const db = await getDB();
    return await db.getImage(id) || summary;
  } catch {
    return summary;
  }
}

function getGridMediaUrl(img) {
  if (img.thumbnailData) {
    return createBlobUrl(img.thumbnailData, img.thumbnailMimeType || 'image/webp');
  }
  if (img.imageData) {
    return createBlobUrl(img.imageData, img.mimeType || (isVideoRecord(img) ? 'video/mp4' : 'image/jpeg'));
  }
  return img.url || '';
}

function getDownloadFileName(img) {
  if (img.fileName) return img.fileName;
  const ext = isVideoRecord(img) ? 'mp4' : 'jpg';
  return `${isVideoRecord(img) ? 'video' : 'image'}_${img.id || Date.now()}.${ext}`;
}

async function updateAmbientBackground(existingDb) {
  revokeAmbientBlobUrls();
  for (let i = 1; i <= 4; i++) {
    document.documentElement.style.setProperty(`--ambient-image-${i}`, 'none');
  }

  const sources = [];
  const db = existingDb || await getDB();
  for (const img of allImages) {
    if (isVideoRecord(img)) continue;

    let source = img;
    if (!source.thumbnailData && !source.imageData && source.id) {
      try {
        source = await db.getImage(source.id) || img;
      } catch {
        source = img;
      }
    }

    if (source.thumbnailData || source.imageData) sources.push(source);
    if (sources.length >= 4) break;
  }

  if (sources.length === 0) {
    document.body.classList.remove('has-ambient');
    return;
  }

  sources.forEach((source, index) => {
    const data = source.thumbnailData || source.imageData;
    const mimeType = source.thumbnailMimeType || source.mimeType || 'image/jpeg';
    const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
    ambientBlobUrls.push(url);
    document.documentElement.style.setProperty(`--ambient-image-${index + 1}`, `url("${url}")`);
  });
  document.body.classList.add('has-ambient');
}

function revokeAmbientBlobUrls() {
  ambientBlobUrls.forEach(url => URL.revokeObjectURL(url));
  ambientBlobUrls = [];
}

async function exportData() {
  try {
    const db = await getDB();
    const images = await db.getAllImages();
    // ArrayBuffer 不能直接 JSON.stringify，转换为 base64
    const exportImages = images.map(img => {
      const exported = { ...img };
      if (exported.imageData && exported.imageData instanceof ArrayBuffer) {
        exported.imageData = arrayBufferToBase64(exported.imageData);
      }
      delete exported.imageData; // 导出时移除二进制数据
      return exported;
    });
    const blob = new Blob([JSON.stringify(exportImages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: url,
      filename: `image-collector-export-${Date.now()}.json`,
      saveAs: false
    });
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('导出成功');
  } catch (error) {
    console.error('导出失败:', error);
    showToast('导出失败');
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function clearAll() {
  if (!confirm('确定清空所有收藏图片吗？此操作不可恢复。')) return;
  if (!confirm('再次确认：真的要删除所有数据吗？')) return;
  
  try {
    const db = await getDB();
    await db.deleteAllImages();
    allImages = [];
    await updateAmbientBackground();
    updateCount();
    renderCategoryList();
    renderGallery();
    showToast('已清空');
  } catch (error) {
    showToast('清空失败');
  }
}

function formatSize(bytes) {
  if (!bytes) return '未知';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 创建 Blob URL 并跟踪以便后续清理
function createBlobUrl(imageData, mimeType) {
  const blob = new Blob([imageData], { type: mimeType || 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  activeBlobUrls.add(url);
  return url;
}

// 清理所有 Blob URL
function revokeAllBlobUrls() {
  activeBlobUrls.forEach(url => URL.revokeObjectURL(url));
  activeBlobUrls.clear();
}

function showToast(msg) {
  let toast = document.querySelector('.ic-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'ic-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}
