// analyzer/analyzer.js
// 轻量本地分类器：关键词优先，图片像素特征兜底。

(function (global) {
  'use strict';

  const FALLBACK_CATEGORY = '其他收藏';

  const TEXT_RULES = [
    ['人像人物', ['portrait', 'people', 'person', 'girl', 'boy', 'woman', 'man', 'face', 'beauty', 'model', 'cosplay', 'avatar', '人像', '人物', '美女', '女生', '女孩', '男生', '写真', '头像', '明星', '长发', '短发', '高颜值', '甜酷', '卧姿', '裙', '模特']],
    ['动漫插画', ['anime', 'manga', 'comic', 'cartoon', 'illustration', 'illust', 'drawing', 'artwork', '二次元', '动漫', '插画', '漫画', '卡通', '原画', '手绘']],
    ['风景自然', ['landscape', 'nature', 'mountain', 'forest', 'sky', 'cloud', 'sea', 'ocean', 'beach', 'flower', 'scenery', 'sunset', '风景', '自然', '山', '森林', '天空', '云', '海', '花', '日落']],
    ['城市建筑', ['city', 'urban', 'street', 'building', 'architecture', 'road', 'neon', '城市', '街道', '建筑', '楼', '夜景', '霓虹', '公路']],
    ['动物萌宠', ['animal', 'cat', 'dog', 'pet', 'bird', 'horse', '动物', '猫', '狗', '宠物', '鸟']],
    ['美食饮品', ['food', 'drink', 'coffee', 'cake', 'dessert', '美食', '食物', '咖啡', '甜品', '饮品']],
    ['交通工具', ['car', 'vehicle', 'train', 'plane', 'ship', 'bike', 'motor', '汽车', '车辆', '火车', '飞机', '船', '摩托']],
    ['游戏影视', ['game', 'movie', 'film', 'cinema', 'character', '游戏', '电影', '影视', '角色']],
    ['科技数码', ['tech', 'digital', 'phone', 'smartphone', 'camera', 'laptop', 'keyboard', 'robot', 'chip', 'processor', 'hardware', 'ai', '科技', '数码', '手机', '相机', '镜头', '笔记本电脑', '键盘', '机器人', '芯片', '处理器', '硬件']]
  ];

  function classifyText(meta = {}) {
    const text = normalizeClassifierText([
      meta.imageUrl,
      meta.pageUrl,
      meta.pageTitle,
      meta.fileName,
      ...(meta.tags || [])
    ].filter(Boolean).join(' '));

    for (const [category, terms] of TEXT_RULES) {
      if (terms.some(term => text.includes(term.toLowerCase()))) return category;
    }
    return '';
  }

  function normalizeClassifierText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/电脑壁纸|手机壁纸|桌面壁纸|动态壁纸|wallpapers?|haowallpaper|哲风壁纸/g, ' ');
  }

  async function analyzeBlob(blob, meta = {}) {
    const contentType = blob?.type || meta.mimeType || '';
    if (isMotionRecord(meta, contentType)) {
      const ext = motionExtension(meta, contentType);
      return {
        category: '动态壁纸',
        tags: [...new Set(['动图', ext].filter(Boolean))],
        color: null,
        width: 0,
        height: 0
      };
    }

    const result = {
      category: classifyText(meta),
      tags: [],
      color: null,
      width: 0,
      height: 0
    };

    if (contentType.includes('image')) result.tags.push(contentType.split('/')[1]);

    try {
      if (blob && typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        result.width = bitmap.width;
        result.height = bitmap.height;

        const stats = readBitmapStats(bitmap);
        if (stats) {
          result.color = stats.hex;
          result.tags.push(...colorTags(stats));
          if (!result.category) result.category = classifyStats(stats, result.width, result.height);
        }

        bitmap.close();
      }
    } catch (error) {
      // 图片解码失败时继续用文本和尺寸兜底。
    }

    if (result.width > 0 && result.height > 0) {
      const ratio = result.width / result.height;
      if (ratio > 1.5) result.tags.push('横图');
      else if (ratio < 0.67) result.tags.push('竖图');
      else result.tags.push('方图');
      if (!result.category) result.category = classifyShape(ratio);
    }

    if (!result.category) result.category = FALLBACK_CATEGORY;
    result.tags = [...new Set(result.tags.filter(Boolean))];
    return result;
  }

  async function analyzeRecord(record) {
    if (isMotionRecord(record)) return '动态壁纸';

    const category = classifyText(record);
    if (category) return category;

    if (record?.imageData) {
      const blob = new Blob([record.imageData], { type: record.mimeType || 'image/jpeg' });
      const analysis = await analyzeBlob(blob, record);
      return analysis.category || FALLBACK_CATEGORY;
    }

    if (record?.width && record?.height) return classifyShape(record.width / record.height);
    return FALLBACK_CATEGORY;
  }

  function isMotionRecord(meta = {}, contentType = '') {
    const mime = String(contentType || meta.mimeType || '').toLowerCase();
    const mediaType = String(meta.mediaType || '').toLowerCase();
    const fileOrUrl = [
      meta.fileName,
      meta.imageUrl,
      meta.url
    ].filter(Boolean).join(' ').toLowerCase();

    return mediaType === 'video' ||
      mime.startsWith('video/') ||
      mime === 'image/gif' ||
      /\.(mp4|webm|mov|m4v|gif)(?:$|\?)/i.test(fileOrUrl);
  }

  function motionExtension(meta = {}, contentType = '') {
    const mime = String(contentType || meta.mimeType || '').split(';')[0].trim().toLowerCase();
    const byMime = {
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'video/x-m4v': 'm4v'
    };
    if (byMime[mime]) return byMime[mime];

    const fileOrUrl = [meta.fileName, meta.imageUrl, meta.url].filter(Boolean).join(' ');
    return fileOrUrl.match(/\.(mp4|webm|mov|m4v|gif)(?:$|\?)/i)?.[1]?.toLowerCase() || '';
  }

  function readBitmapStats(bitmap) {
    const sampleW = 42;
    const sampleH = Math.max(1, Math.round(sampleW * bitmap.height / bitmap.width));
    const canvas = createCanvas(sampleW, sampleH);
    if (!canvas) return null;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0, sampleW, sampleH);
    const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let satSum = 0;
    let lightSum = 0;
    let green = 0;
    let blue = 0;
    let warm = 0;
    let skin = 0;
    let gray = 0;
    let diff = 0;
    let diffCount = 0;
    const pixels = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const hsl = rgbToHsl(r, g, b);
      rSum += r;
      gSum += g;
      bSum += b;
      satSum += hsl.s;
      lightSum += hsl.l;

      if (hsl.s < 0.16) gray++;
      if (hsl.h >= 70 && hsl.h <= 170 && hsl.s > 0.18) green++;
      if (hsl.h >= 175 && hsl.h <= 255 && hsl.s > 0.18) blue++;
      if ((hsl.h <= 48 || hsl.h >= 330) && hsl.s > 0.2) warm++;
      if (hsl.h >= 8 && hsl.h <= 45 && hsl.s >= 0.18 && hsl.s <= 0.72 && hsl.l >= 0.28 && hsl.l <= 0.86) skin++;

      const pixel = i / 4;
      const x = pixel % sampleW;
      const y = Math.floor(pixel / sampleW);
      if (x > 0) {
        const j = i - 4;
        diff += colorDistance(data, i, j);
        diffCount++;
      }
      if (y > 0) {
        const j = i - sampleW * 4;
        diff += colorDistance(data, i, j);
        diffCount++;
      }
    }

    const r = Math.round(rSum / pixels);
    const g = Math.round(gSum / pixels);
    const b = Math.round(bSum / pixels);

    return {
      hex: rgbToHex(r, g, b),
      saturation: satSum / pixels,
      lightness: lightSum / pixels,
      greenRatio: green / pixels,
      blueRatio: blue / pixels,
      warmRatio: warm / pixels,
      skinRatio: skin / pixels,
      grayRatio: gray / pixels,
      edgeScore: diffCount ? diff / diffCount : 0
    };
  }

  function createCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    return null;
  }

  function classifyStats(stats, width, height) {
    const ratio = width / height;
    if (stats.skinRatio > 0.22 && stats.greenRatio < 0.22 && stats.blueRatio < 0.34) return '人像人物';
    if (stats.skinRatio > 0.12 && stats.greenRatio < 0.18 && stats.blueRatio < 0.28 && ratio < 2.2) return '人像人物';
    if (stats.saturation > 0.36 && stats.edgeScore < 0.13) return '动漫插画';
    if (stats.greenRatio > 0.24 || (stats.blueRatio > 0.32 && stats.greenRatio > 0.08)) return '风景自然';
    if (stats.grayRatio > 0.32 && stats.edgeScore > 0.13) return '城市建筑';
    if (stats.warmRatio > 0.34 && stats.edgeScore > 0.16) return '城市建筑';
    if (stats.saturation > 0.48 && ratio >= 0.85 && ratio <= 1.25) return '动漫插画';
    return classifyShape(ratio);
  }

  function classifyShape(ratio) {
    if (ratio > 1.35) return '风景自然';
    if (ratio < 0.78) return '人像人物';
    return '设计素材';
  }

  function colorTags(stats) {
    const tags = [];
    if (stats.greenRatio > 0.24) tags.push('绿色');
    if (stats.blueRatio > 0.28) tags.push('蓝色');
    if (stats.warmRatio > 0.28) tags.push('暖色');
    if (stats.grayRatio > 0.42) tags.push('低饱和');
    return tags;
  }

  function colorDistance(data, i, j) {
    return (Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2])) / 765;
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }

    return { h, s, l };
  }

  global.ImageCollectorAnalyzer = {
    analyzeBlob,
    analyzeRecord,
    classifyText,
    fallbackCategory: FALLBACK_CATEGORY
  };
})(typeof self !== 'undefined' ? self : window);
