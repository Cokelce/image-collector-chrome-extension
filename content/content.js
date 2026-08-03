// content/content.js
// 页面注入脚本：检测图片、添加收藏按钮
// 支持直接保存到 IndexedDB（无需 service worker）

(function () {
  'use strict';

  if (window.__imageCollectorInjected) return;
  window.__imageCollectorInjected = true;

  // 注入样式
  const style = document.createElement('style');
  style.textContent = `
    .ic-save-btn {
      position: absolute !important;
      top: 8px !important;
      right: 8px !important;
      width: 36px !important;
      height: 36px !important;
      background: rgba(0,0,0,0.55) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      border: 1.5px solid rgba(255,255,255,0.25) !important;
      border-radius: 50% !important;
      color: #fff !important;
      font-size: 18px !important;
      line-height: 36px !important;
      text-align: center !important;
      cursor: pointer !important;
      opacity: 0.85 !important;
      transition: opacity .25s, background .2s, transform .2s !important;
      z-index: 999999 !important;
      user-select: none !important;
      pointer-events: auto !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.35) !important;
    }
    .ic-img-wrap:hover .ic-save-btn { opacity: 1 !important; transform: scale(1.1); }
    .ic-card-wrap:hover .ic-save-btn { opacity: 1 !important; transform: scale(1.1); }
    .ic-img-wrap { position: relative !important; display: inline-block !important; }
    .ic-card-wrap { position: relative !important; display: block !important; }
    .ic-toast {
      position: fixed !important; top: 16px !important; right: 16px !important;
      padding: 10px 18px !important; background: rgba(20,20,40,0.85) !important;
      backdrop-filter: blur(16px) !important; -webkit-backdrop-filter: blur(16px) !important;
      border: 1px solid rgba(255,255,255,0.15) !important; border-radius: 12px !important;
      color: #fff !important; font-size: 13px !important; z-index: 9999999 !important;
      opacity: 0 !important; transform: translateY(-8px) !important;
      transition: opacity .3s, transform .3s !important; pointer-events: none !important;
    }
    .ic-toast.show { opacity: 1 !important; transform: translateY(0) !important; }
  `;
  document.head.appendChild(style);

  // 创建 toast
  const toast = document.createElement('div');
  toast.className = 'ic-toast';
  document.body.appendChild(toast);

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // ========== IndexedDB 直接保存（无需 service worker） ==========
  function openDB() {
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

  async function addImageDirect(imageData) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      const record = { ...imageData, createdAt: Date.now(), updatedAt: Date.now() };
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveImageDirect(imageUrl, pageTitle) {
    try {
      // 获取文件名
      const urlPath = new URL(imageUrl).pathname;
      const originalName = urlPath.split('/').pop() || 'image';
      const ext = originalName.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)/i)?.[1] || 'jpg';
      const baseName = originalName.replace(/\.[^.]+$/, '') || 'image';
      const timestamp = Date.now();
      const fileName = `${timestamp}_${baseName}.${ext}`;

      // 通过 Fetch 获取图片 Blob
      const response = await fetch(imageUrl, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) throw new Error('Fetch failed: ' + response.status);
      const blob = await response.blob();
      const fileSize = blob.size;
      const arrayBuffer = await blob.arrayBuffer();

      // 提取 URL 关键词
      const urlKeywords = extractUrlKeywordsDirect(imageUrl);

      // 分析图片
      const analysis = await analyzeImageBasicDirect(imageUrl);

      // 保存到 IndexedDB
      const imageData = {
        url: imageUrl,
        fileName: fileName,
        category: analysis.category || '未分类',
        tags: [...new Set([...urlKeywords, ...analysis.tags])],
        width: analysis.width || 0,
        height: analysis.height || 0,
        size: fileSize,
        pageUrl: location.href,
        pageTitle: pageTitle || document.title,
        source: 'page',
        imageData: arrayBuffer,
        mimeType: blob.type || 'image/jpeg'
      };

      const id = await addImageDirect(imageData);
      return { success: true, id, fileName, category: imageData.category, tags: imageData.tags };
    } catch (error) {
      console.error('直接保存图片失败:', error);
      return { success: false, error: error.message };
    }
  }

  function extractUrlKeywordsDirect(url) {
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

  async function analyzeImageBasicDirect(imageUrl) {
    const result = {
      category: '未分类',
      tags: [],
      width: 0,
      height: 0
    };

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
      });
      
      result.width = img.naturalWidth;
      result.height = img.naturalHeight;
      
      if (result.width > 0 && result.height > 0) {
        const ratio = result.width / result.height;
        if (ratio > 1.5) result.tags.push('横图');
        else if (ratio < 0.67) result.tags.push('竖图');
        else result.tags.push('方图');
      }
    } catch (e) {
      // 跨域或网络问题，跳过
    }

    return result;
  }

  // ========== haowallpaper.com 适配 ==========
  function isHaowallpaper() {
    return location.hostname.includes('haowallpaper');
  }

  function getHaowallpaperMedia(card) {
    // 优先查找 .resource-container（列表页结构）
    const container = card.querySelector('.resource-container');
    if (container) {
      const video = container.querySelector('video');
      const img = container.querySelector('img');
      if (video) {
        const videoSrc = video.src || '';
        const mediaId = videoSrc.split('/').pop();
        if (mediaId) {
          return {
            url: `https://haowallpaper.com/link/common/file/getCroppingImg/${mediaId}`,
            type: 'video'
          };
        }
      }
      if (img) {
        return { url: img.src, type: 'image' };
      }
    }

    // 兼容详情页：直接在 card 中查找 img 或 video
    const cardImg = card.querySelector('img');
    const cardVideo = card.querySelector('video');
    if (cardImg && cardImg.src && !cardImg.src.includes('favicon')) {
      return { url: cardImg.src, type: 'image' };
    }
    if (cardVideo) {
      const videoSrc = cardVideo.src || '';
      const mediaId = videoSrc.split('/').pop();
      if (mediaId) {
        return {
          url: `https://haowallpaper.com/link/common/file/getCroppingImg/${mediaId}`,
          type: 'video'
        };
      }
    }

    return null;
  }

  function attachHaowallpaperButton(card) {
    if (card.dataset.icBound === '1') return;
    
    const media = getHaowallpaperMedia(card);
    if (!media) return;

    const cardContent = card.querySelector('.card-content');
    const title = cardContent ? cardContent.textContent.trim().substring(0, 80) : '';

    const wrap = document.createElement('div');
    wrap.className = 'ic-card-wrap';
    card.style.position = 'relative';
    card.appendChild(wrap);

    const btn = document.createElement('div');
    btn.className = 'ic-save-btn';
    btn.textContent = '☆';
    btn.title = '收藏图片';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      btn.textContent = '...';
      btn.style.pointerEvents = 'none';

      // 尝试通过 chrome.runtime 发送消息（需要 service worker）
      let saved = false;
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ 
              action: 'saveImage', 
              url: media.url,
              pageTitle: title,
              source: 'haowallpaper'
            }, (res) => resolve(res));
          });
          
          if (response && response.success) {
            saved = true;
            btn.textContent = '✓';
            btn.style.background = 'rgba(80,180,80,0.75)';
            showToast('图片已收藏！');
          }
        } catch (e) {
          // service worker 未运行，忽略
        }
      }

      // 如果 service worker 不可用，直接保存到 IndexedDB
      if (!saved) {
        const result = await saveImageDirect(media.url, title);
        if (result.success) {
          btn.textContent = '✓';
          btn.style.background = 'rgba(80,180,80,0.75)';
          showToast('图片已收藏！');
        } else {
          btn.textContent = '✗';
          btn.style.background = 'rgba(200,80,80,0.75)';
          showToast('收藏失败: ' + result.error);
        }
      }

      setTimeout(() => {
        btn.textContent = '☆';
        btn.style.background = '';
        btn.style.pointerEvents = '';
      }, 2000);
    });

    wrap.appendChild(btn);
    card.dataset.icBound = '1';
  }

  // ========== 通用图片检测 ==========
  function getImageUrl(img) {
    return (
      img.src ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      ''
    );
  }

  function attachButton(img) {
    if (img.width < 60 || img.height < 60) return;
    if (img.dataset.icBound === '1') return;

    const src = getImageUrl(img);
    if (src.includes('favicon') || src.includes('avatar') || src.includes('icon')) return;

    let parent = img.parentElement;
    while (parent && parent !== document.body) {
      const display = window.getComputedStyle(parent).display;
      if (display === 'inline' || display === 'inline-block' || display === 'block') break;
      parent = parent.parentElement;
    }
    if (!parent || parent === document.body) parent = img.parentElement;

    const wrap = document.createElement('span');
    wrap.className = 'ic-img-wrap';
    wrap.style.display = parent.style.display || 'inline-block';
    wrap.style.position = parent.style.position || 'relative';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    const btn = document.createElement('div');
    btn.className = 'ic-save-btn';
    btn.textContent = '☆';
    btn.title = '收藏图片';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = getImageUrl(img);
      if (!url) return;

      btn.textContent = '...';
      btn.style.pointerEvents = 'none';

      // 尝试通过 chrome.runtime 发送消息
      let saved = false;
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'saveImage', url }, (res) => resolve(res));
          });
          
          if (response && response.success) {
            saved = true;
            btn.textContent = '✓';
            btn.style.background = 'rgba(80,180,80,0.75)';
            showToast('图片已收藏！');
          }
        } catch (e) {
          // service worker 未运行，忽略
        }
      }

      // 如果 service worker 不可用，直接保存到 IndexedDB
      if (!saved) {
        const result = await saveImageDirect(url, document.title);
        if (result.success) {
          btn.textContent = '✓';
          btn.style.background = 'rgba(80,180,80,0.75)';
          showToast('图片已收藏！');
        } else {
          btn.textContent = '✗';
          btn.style.background = 'rgba(200,80,80,0.75)';
          showToast('收藏失败: ' + result.error);
        }
      }

      setTimeout(() => {
        btn.textContent = '☆';
        btn.style.background = '';
        btn.style.pointerEvents = '';
      }, 2000);
    });

    wrap.appendChild(btn);
    img.dataset.icBound = '1';
  }

  // ========== 初始化 ==========
  function init() {
    if (isHaowallpaper()) {
      document.querySelectorAll('.card').forEach(card => {
        try { attachHaowallpaperButton(card); } catch (e) { /* ignore */ }
      });
    } else {
      document.querySelectorAll('img').forEach(img => {
        try { attachButton(img); } catch (e) { /* ignore */ }
      });
    }
  }

  // 扫描现有元素
  init();

  // 监听新增元素
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          if (isHaowallpaper()) {
            if (node.classList && node.classList.contains('card')) {
              try { attachHaowallpaperButton(node); } catch (e) { /* ignore */ }
            }
            if (node.querySelectorAll) {
              node.querySelectorAll('.card').forEach(card => {
                try { attachHaowallpaperButton(card); } catch (e) { /* ignore */ }
              });
            }
          } else {
            if (node.nodeName === 'IMG' && !node.dataset.icBound) {
              try { attachButton(node); } catch (e) { /* ignore */ }
            }
            if (node.querySelectorAll) {
              node.querySelectorAll('img').forEach(img => {
                if (!img.dataset.icBound) {
                  try { attachButton(img); } catch (e) { /* ignore */ }
                }
              });
            }
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // 调试标记
  const debugEl = document.createElement('div');
  debugEl.textContent = '🔍 图片收藏夹已加载';
  debugEl.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999999;background:rgba(100,150,255,0.9);color:#fff;padding:6px 14px;border-radius:20px;font-size:12px;font-family:sans-serif;box-shadow:0 2px 10px rgba(0,0,0,0.3);pointer-events:none;';
  document.body.appendChild(debugEl);
  setTimeout(() => debugEl.remove(), 5000);

  console.log('[ImageCollector] Content script loaded on', location.hostname);
})();
