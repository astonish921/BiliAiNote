/**
 * BiliAiNote Capture Module
 * OffscreenCanvas 截图、保存文件、复制剪贴板
 */
(function () {
  'use strict';

  window.BiliAiNote = window.BiliAiNote || {};

  /**
   * 截取当前视频帧
   */
  async function captureFrame(video) {
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('视频未加载，无法截取');
    }
    const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    return canvas.convertToBlob({ type: 'image/png' });
  }

  /**
   * 格式化时间码（用于文件名，无冒号）
   * 不足1小时：MMSS，超过1小时：HHMMSS
   */
  function formatTimeCode(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}${pad(m)}${pad(s)}` : `${pad(m)}${pad(s)}`;
  }

  /**
   * 格式化时间显示（带冒号）
   * 不足1小时：MM:SS，超过1小时：HH:MM:SS
   */
  function formatTimeDisplay(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  /**
   * 生成下载文件名：biliainote-{bvid}-{时间码}.png
   */
  function generateDownloadFilename(timeSeconds) {
    const s = window.BiliAiNote.state;
    const bvid = s.bvid || 'unknown';
    const tc = formatTimeCode(timeSeconds);
    return `biliainote-${bvid}-${tc}.png`;
  }

  /**
   * 生成 assets 文件名：{时间码}.png
   */
  function generateAssetFilename(timeSeconds) {
    return `${formatTimeCode(timeSeconds)}.png`;
  }

  /**
   * 给字幕行添加截图
   */
  async function addScreenshot(subtitleIndex) {
    const s = window.BiliAiNote.state;
    const panel = window.BiliAiNote.panel;
    const video = window.BiliAiNote.subtitle?.getVideoElement();

    if (!video) {
      panel.showToast('未找到视频元素');
      return;
    }

    const item = s.subtitleBody[subtitleIndex];
    if (!item) return;

    try {
      const wasPaused = video.paused;
      const isActive = window.BiliAiNote.subtitle.findActiveIndex(video.currentTime) === subtitleIndex;
      const captureCurrentFrame = !wasPaused && isActive;

      let blob, url, timeCode, timeSeconds;

      if (captureCurrentFrame) {
        // 视频播放中 + 当前活跃字幕 → 截取当前帧
        blob = await captureFrame(video);
        url = URL.createObjectURL(blob);
        timeCode = formatTimeCode(video.currentTime);
        timeSeconds = video.currentTime;
      } else {
        // 暂停状态 或 非活跃字幕 → 跳转到 item.from 再截取
        video.currentTime = item.from;
        await new Promise(r => video.addEventListener('seeked', r, { once: true }));
        blob = await captureFrame(video);
        url = URL.createObjectURL(blob);
        timeCode = formatTimeCode(item.from);
        timeSeconds = item.from;
        if (!wasPaused) video.play().catch(() => {});
      }

      // 如果已有截图，释放旧的
      const old = s.screenshots.get(subtitleIndex);
      if (old?.url) URL.revokeObjectURL(old.url);

      s.screenshots.set(subtitleIndex, { blob, url, timeCode, timeSeconds });
      persistScreenshots();

      // 重新渲染字幕列表
      window.BiliAiNote.subtitle.renderSubtitleList();
      panel.renderDoc();
      panel.showToast('已添加截图');
    } catch (err) {
      console.error('[BiliAiNote] addScreenshot error:', err);
      panel.showToast('截图失败：' + err.message);
    }
  }

  /**
   * 给章节添加截图
   */
  async function addChapterScreenshot(chapterIndex) {
    const s = window.BiliAiNote.state;
    const panel = window.BiliAiNote.panel;
    const video = window.BiliAiNote.subtitle?.getVideoElement();

    if (!video) {
      panel.showToast('未找到视频元素');
      return;
    }

    const item = s.chapters[chapterIndex];
    if (!item) return;

    try {
      const wasPaused = video.paused;
      video.currentTime = item.from;
      await new Promise(r => video.addEventListener('seeked', r, { once: true }));

      const blob = await captureFrame(video);
      const url = URL.createObjectURL(blob);

      // 章节截图用负索引存储，避免与字幕索引冲突
      const key = -chapterIndex - 1;
      const old = s.screenshots.get(key);
      if (old?.url) URL.revokeObjectURL(old.url);
      s.screenshots.set(key, { blob, url, timeCode: formatTimeCode(item.from), timeSeconds: item.from });
      persistScreenshots();

      if (!wasPaused) video.play().catch(() => {});
      window.BiliAiNote.chapter.render();
      panel.renderDoc();
      panel.showToast('已添加截图');
    } catch (err) {
      console.error('[BiliAiNote] addChapterScreenshot error:', err);
      panel.showToast('截图失败：' + err.message);
    }
  }

  /**
   * 取消字幕截图
   */
  function removeScreenshot(subtitleIndex) {
    const s = window.BiliAiNote.state;
    const old = s.screenshots.get(subtitleIndex);
    if (old?.url) URL.revokeObjectURL(old.url);
    s.screenshots.delete(subtitleIndex);
    persistScreenshots();
    window.BiliAiNote.subtitle.renderSubtitleList();
    window.BiliAiNote.panel.renderDoc();
    window.BiliAiNote.panel.showToast('已取消截图');
  }

  /**
   * 保存截图到文件
   */
  async function saveToFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'biliainote-screenshot.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 延迟释放，确保下载完成
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /**
   * 复制截图到剪贴板
   */
  async function copyToClipboard(blob) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      return true;
    } catch (err) {
      console.error('[BiliAiNote] clipboard write failed:', err);
      return false;
    }
  }

  /**
   * 截图持久化（chrome.storage.local，base64 存储，按 bvid+分P 分组）
   * 与行备注同一存储模式：刷新页面/重进视频自动恢复
   */
  const SNAPS_KEY = 'BiliAiNote_snapshots';
  const SNAPS_MAX_VIDEOS = 30;

  function snapsKey(bvid, pageIndex) {
    return `${bvid}_p${pageIndex || 1}`;
  }

  function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(items) {
    return new Promise(resolve => chrome.storage.local.set(items, resolve));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('读取截图失败'));
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToBlob(dataUrl) {
    const resp = await fetch(dataUrl);
    return resp.blob();
  }

  // 恢复某视频分P的截图（含章节截图，负索引），生成新的 ObjectURL
  async function loadScreenshots(bvid, pageIndex) {
    const map = new Map();
    try {
      const result = await storageGet([SNAPS_KEY]);
      const store = (result && result[SNAPS_KEY]) || {};
      const shots = (store[snapsKey(bvid, pageIndex)] || {}).shots || {};
      await Promise.all(Object.keys(shots).map(async k => {
        const shot = shots[k];
        if (!shot?.dataUrl) return;
        const blob = await dataUrlToBlob(shot.dataUrl);
        map.set(Number(k), {
          blob,
          url: URL.createObjectURL(blob),
          timeCode: shot.timeCode || '',
          timeSeconds: Number(shot.timeSeconds || 0)
        });
      }));
    } catch (err) {
      console.warn('[BiliAiNote] loadScreenshots failed:', err);
    }
    return map;
  }

  // 将当前内存中的截图写入存储（截图增删改后调用）
  async function persistScreenshots() {
    const s = window.BiliAiNote.state;
    if (!s.bvid) return;
    try {
      const key = snapsKey(s.bvid, s.pageIndex || 1);
      const result = await storageGet([SNAPS_KEY]);
      const map = (result && result[SNAPS_KEY]) || {};

      if (s.screenshots.size === 0) {
        delete map[key];
      } else {
        const shots = {};
        for (const [k, v] of s.screenshots) {
          shots[k] = {
            dataUrl: await blobToDataUrl(v.blob),
            timeCode: v.timeCode || '',
            timeSeconds: v.timeSeconds || 0
          };
        }
        map[key] = { shots, at: Date.now() };
      }

      // 超出上限时淘汰最旧视频的记录
      const keys = Object.keys(map);
      if (keys.length > SNAPS_MAX_VIDEOS) {
        keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
        for (const k of keys.slice(0, keys.length - SNAPS_MAX_VIDEOS)) delete map[k];
      }
      await storageSet({ [SNAPS_KEY]: map });
    } catch (err) {
      console.warn('[BiliAiNote] persistScreenshots failed:', err);
    }
  }

  window.BiliAiNote.capture = {
    captureFrame,
    addScreenshot,
    addChapterScreenshot,
    removeScreenshot,
    saveToFile,
    copyToClipboard,
    loadScreenshots,
    persistScreenshots,
    formatTimeCode,
    formatTimeDisplay,
    generateDownloadFilename,
    generateAssetFilename
  };
})();
