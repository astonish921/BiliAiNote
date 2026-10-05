/**
 * BiliAiNote Chapter Module
 * 章节获取、解析、渲染
 */
(function () {
  'use strict';

  window.BiliAiNote = window.BiliAiNote || {};

  let chapterListenerAttached = false;

  // ── AI 智能生成章节（复用 background ai-generate 通道，sceneId = chapters） ──

  const CHAPTER_SCENE = 'chapters';

  const gen = {
    state: 'idle', // idle | generating | error
    text: '',
    error: '',
    requestId: null
  };

  const CHAPTER_PROMPT = `你是视频章节规划助手，请根据提供的带时间戳的字幕文本为视频划分章节。

要求：
1. 仅依据字幕内容划分章节，每章主题明确；数量适中（3~15 个，内容简短则更少）。
2. 每行输出格式：- [MM:SS] 章节标题（视频超过1小时用 HH:MM:SS）。
3. 章节时间必须取自字幕中出现的时间戳，按时间升序排列。
4. 直接输出章节列表，不要输出任何额外说明。

待划分字幕：

{markdown}`;

  // 空态/AI生成态渲染：无法获取章节 + AI智能生成按钮（或生成中）
  function renderGenState(container) {
    if (gen.state === 'generating') {
      container.innerHTML = `
        <div class="bn-transcribe-box">
          <div class="bn-transcribe-head">
            <span class="bn-transcribe-status">AI 正在生成章节…</span>
            <button class="bn-transcribe-stop" data-action="stop-gen-chapters">停止</button>
          </div>
        </div>
      `;
      return;
    }

    const s = window.BiliAiNote.state;
    const hasSubtitle = !!(s.subtitleBody || []).length;
    const hasLlm = !!window.BiliAiNote.settings?.getActiveLlm?.();
    const disabled = (!hasSubtitle || !hasLlm) ? ' disabled' : '';
    const hint = !hasSubtitle
      ? '<div class="bn-transcribe-client-hint">请先生成字幕</div>'
      : (!hasLlm ? '<div class="bn-transcribe-client-hint">请先在「设置」中启用 LLM</div>' : '');

    container.innerHTML = `
      <div class="bn-empty">
        ${gen.state === 'error' && gen.error ? `<div class="bn-transcribe-error">${escapeHtml(gen.error)}</div>` : ''}
        <div class="bn-empty-text">无法自动获取B站的章节</div>
        <button class="bn-transcribe-btn" data-action="gen-chapters"${disabled}>AI智能生成</button>
        ${hint}
      </div>
    `;
  }

  // 构造带时间戳的字幕文本（供 LLM 划分章节）
  function buildSubtitleText() {
    const s = window.BiliAiNote.state;
    const lines = [];
    (s.subtitleBody || []).forEach(it => {
      const text = String(it.content || '').trim();
      if (text) lines.push(`[${formatTime(it.from)}] ${text}`);
    });
    return lines.join('\n');
  }

  function startGenChapters() {
    if (gen.state === 'generating') return;
    const s = window.BiliAiNote.state;
    if (!(s.subtitleBody || []).length) return;

    gen.state = 'generating';
    gen.text = '';
    gen.error = '';
    gen.requestId = null;

    const container = document.getElementById('bn-chapter-list');
    if (container) renderGenState(container);
    window.BiliAiNote.panel.showToast('已发起章节生成请求');

    try {
      chrome.runtime.sendMessage(
        { type: 'ai-generate', sceneId: CHAPTER_SCENE, content: buildSubtitleText(), prompt: CHAPTER_PROMPT },
        (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            gen.error = (resp && resp.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '请求失败';
            gen.state = 'error';
            const c = document.getElementById('bn-chapter-list');
            if (c) renderGenState(c);
            return;
          }
          gen.requestId = resp.requestId;
        }
      );
    } catch (e) {
      // Extension context invalidated
      gen.error = '扩展已重新加载，请刷新本页面后重试';
      gen.state = 'error';
      const c = document.getElementById('bn-chapter-list');
      if (c) renderGenState(c);
    }
  }

  function stopGenChapters() {
    try {
      chrome.runtime.sendMessage({ type: 'ai-abort', sceneId: CHAPTER_SCENE, requestId: gen.requestId });
    } catch {}
    gen.state = 'idle';
    gen.text = '';
    gen.requestId = null;
    const c = document.getElementById('bn-chapter-list');
    if (c) renderGenState(c);
  }

  // 时间文本 → 秒
  function parseTs(str) {
    const parts = String(str).trim().split(':').map(Number);
    if (!parts.length || parts.some(n => Number.isNaN(n))) return -1;
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return sec;
  }

  // 解析 AI 输出为章节：兼容 - [MM:SS] 标题 / 1. [MM:SS] 标题 / ### [MM:SS] 标题 等格式
  function parseChapters(text) {
    const items = [];
    const re = /^\s*(?:[-*+•·]|\d{1,2}[.)]|#{1,6})?\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–—:.、\]]*\s*(.+?)\s*$/gm;
    for (const m of String(text || '').matchAll(re)) {
      const from = parseTs(m[1]);
      const title = String(m[2] || '')
        .replace(/^#{1,6}\s*/, '')
        .replace(/\*\*/g, '')
        .trim();
      if (from < 0 || !title) continue;
      items.push({ from, to: null, title });
    }

    // 按时间升序 + 去掉同一时间戳的重复章节
    items.sort((a, b) => a.from - b.from);
    const dedup = [];
    for (const it of items) {
      if (dedup.length && dedup[dedup.length - 1].from === it.from) continue;
      dedup.push(it);
    }

    // 补齐结束时间：下一章起点，末章取视频时长
    const duration = window.BiliAiNote.state.videoDuration || 0;
    for (let i = 0; i < dedup.length; i++) {
      const next = dedup[i + 1];
      dedup[i].to = next ? next.from : (duration > dedup[i].from ? duration : dedup[i].from + 60);
    }
    return dedup;
  }

  // 生成完成：解析并持久化
  function finishGenChapters() {
    const s = window.BiliAiNote.state;
    const items = parseChapters(gen.text);
    if (!items.length) {
      gen.error = '未能从生成结果中解析出章节';
      gen.state = 'error';
      const c = document.getElementById('bn-chapter-list');
      if (c) renderGenState(c);
      window.BiliAiNote.panel.showToast(gen.error);
      return;
    }
    gen.state = 'idle';
    gen.text = '';
    gen.requestId = null;
    s.chapters = items;
    saveChapters(s.bvid, s.pageIndex || 1, items).catch(() => {});
    render();
    window.BiliAiNote.panel.showToast('章节生成完成');
  }

  // 监听 background 推送的 ai-* 消息（仅处理 chapters 场景）
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || !msg.type || msg.sceneId !== CHAPTER_SCENE) return;
      if (gen.state !== 'generating') return;
      if (gen.requestId && msg.requestId && gen.requestId !== msg.requestId) return;

      switch (msg.type) {
        case 'ai-chunk':
          gen.text += msg.text || '';
          break;
        case 'ai-done':
          finishGenChapters();
          break;
        case 'ai-error':
          gen.error = msg.error || '生成失败';
          gen.state = 'error';
          renderGenState(document.getElementById('bn-chapter-list') || document.createElement('div'));
          window.BiliAiNote.panel.showToast('章节生成失败：' + gen.error);
          break;
        case 'ai-aborted':
          gen.state = 'idle';
          gen.text = '';
          gen.requestId = null;
          renderGenState(document.getElementById('bn-chapter-list') || document.createElement('div'));
          window.BiliAiNote.panel.showToast('已停止生成');
          break;
      }
    });
  } catch {}

  // ── AI 章节持久化（chrome.storage.local，按 bvid+分P 分组） ──

  const CHAPTERS_KEY = 'BiliAiNote_chapters';
  const CHAPTERS_MAX = 30;

  function chaptersKey(bvid, pageIndex) {
    return `${bvid}_p${pageIndex || 1}`;
  }

  function loadSavedChapters(bvid, pageIndex) {
    return new Promise(resolve => {
      chrome.storage.local.get([CHAPTERS_KEY], result => {
        const map = (result && result[CHAPTERS_KEY]) || {};
        const entry = map[chaptersKey(bvid, pageIndex)];
        resolve(entry && Array.isArray(entry.items) && entry.items.length ? entry.items : null);
      });
    });
  }

  function saveChapters(bvid, pageIndex, items) {
    return new Promise(resolve => {
      chrome.storage.local.get([CHAPTERS_KEY], result => {
        const map = (result && result[CHAPTERS_KEY]) || {};
        if (items && items.length) {
          map[chaptersKey(bvid, pageIndex)] = { items, at: Date.now() };
        } else {
          delete map[chaptersKey(bvid, pageIndex)];
        }
        // 超出上限时淘汰最旧视频的记录
        const keys = Object.keys(map);
        if (keys.length > CHAPTERS_MAX) {
          keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
          for (const k of keys.slice(0, keys.length - CHAPTERS_MAX)) delete map[k];
        }
        chrome.storage.local.set({ [CHAPTERS_KEY]: map }, () => resolve());
      });
    });
  }

  function render() {
    const s = window.BiliAiNote.state;
    const container = document.getElementById('bn-chapter-list');
    if (!container) return;

    container.innerHTML = '';

    // 只绑定一次事件委托
    if (!chapterListenerAttached) {
      container.addEventListener('click', onChapterClick);
      chapterListenerAttached = true;
    }

    if (!s.chapters || s.chapters.length === 0) {
      renderGenState(container);
      return;
    }

    s.chapters.forEach((item, index) => {
      // 章节截图用负索引存储
      const snapKey = -index - 1;
      const screenshot = s.screenshots.get(snapKey);
      const el = document.createElement('div');
      el.dataset.index = index;

      if (screenshot) {
        el.className = 'bn-row-img';
        el.innerHTML = `
          <img class="bn-snap-thumb" src="${screenshot.url}" alt="截图" data-index="${index}">
          <div class="bn-text-wrap">
            <div class="bn-time-text">${formatTime(item.from)}</div>
            <div class="bn-sub-text">${escapeHtml(item.title)}</div>
          </div>
          <div class="bn-btns">
            <button data-action="copy">复制</button>
            <button data-action="cancel-snap">取消截图</button>
          </div>
        `;
      } else {
        el.className = 'bn-row';
        el.innerHTML = `
          <span class="bn-row-time">${formatTime(item.from)}</span>
          <span class="bn-row-text">${escapeHtml(item.title)}</span>
          <div class="bn-btns">
            <button data-action="copy">复制</button>
            <button data-action="add-snap">截图</button>
          </div>
        `;
      }

      // 点击跳转
      el.addEventListener('click', (e) => {
        if (e.target.closest('.bn-btns') || e.target.closest('.bn-snap-thumb')) return;
        jumpToChapter(item.from);
      });

      container.appendChild(el);
    });
  }

  function onChapterClick(e) {
    const btn = e.target.closest('button');
    const thumb = e.target.closest('.bn-snap-thumb');
    const s = window.BiliAiNote.state;

    // 点击缩略图 → 预览
    if (thumb) {
      const index = parseInt(thumb.dataset.index);
      window.BiliAiNote.cropViewer.open(-index - 1);
      return;
    }

    if (!btn) return;

    // AI 生成章节按钮（不在章节行内）
    const action0 = btn.dataset.action;
    if (action0 === 'gen-chapters') {
      startGenChapters();
      return;
    }
    if (action0 === 'stop-gen-chapters') {
      stopGenChapters();
      return;
    }

    const row = btn.closest('.bn-row') || btn.closest('.bn-row-img');
    if (!row) return;
    const index = parseInt(row.dataset.index);
    const item = s.chapters[index];
    if (!item) return;

    if (btn.dataset.action === 'copy') {
      const text = item.title;
      navigator.clipboard.writeText(text).then(() => {
        window.BiliAiNote.panel.showToast('已复制');
      });
    } else if (btn.dataset.action === 'add-snap') {
      if (window.BiliAiNote.capture) {
        window.BiliAiNote.capture.addChapterScreenshot(index);
      }
    } else if (btn.dataset.action === 'cancel-snap') {
      if (window.BiliAiNote.capture) {
        const snapKey = -index - 1;
        const old = s.screenshots.get(snapKey);
        if (old?.url) URL.revokeObjectURL(old.url);
        s.screenshots.delete(snapKey);
        window.BiliAiNote.capture?.persistScreenshots();
        render();
        window.BiliAiNote.panel.showToast('已取消截图');
      }
    }
  }

  function showChapterPreview(index) {
    const s = window.BiliAiNote.state;
    const snapKey = -index - 1;
    const screenshot = s.screenshots.get(snapKey);
    if (!screenshot) return;

    const video = window.BiliAiNote.subtitle?.getVideoElement();

    const overlay = document.createElement('div');
    overlay.className = 'bn-preview-overlay';

    let currentUrl = screenshot.url;
    let currentBlob = screenshot.blob;

    overlay.innerHTML = `
      <div class="bn-preview-box">
        <img class="bn-preview-img" src="${currentUrl}" alt="预览">
        <div class="bn-preview-btns">
          <button data-act="prev">上一帧</button>
          <button data-act="next">下一帧</button>
          <button data-act="download">下载截图</button>
          <button data-act="clipboard">复制到剪贴板</button>
          <button data-act="close">关闭</button>
        </div>
      </div>
    `;

    const imgEl = overlay.querySelector('.bn-preview-img');
    let frameActionBusy = false;

    async function doFrameAction(act) {
      if (!video || frameActionBusy) return;
      frameActionBusy = true;
      try {
        const step = s.settings.frameStep || 0.2;
        if (act === 'prev') {
          video.currentTime = Math.max(0, video.currentTime - step);
        } else {
          video.currentTime = Math.min(video.duration, video.currentTime + step);
        }
        await new Promise(r => video.addEventListener('seeked', r, { once: true }));
        const newBlob = await window.BiliAiNote.capture.captureFrame(video);
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = URL.createObjectURL(newBlob);
        currentBlob = newBlob;
        imgEl.src = currentUrl;
        s.screenshots.set(snapKey, { blob: currentBlob, url: currentUrl });
        window.BiliAiNote.capture?.persistScreenshots();
      } finally {
        frameActionBusy = false;
      }
    }

    overlay.addEventListener('click', async (e) => {
      const act = e.target.dataset?.act;
      if (act === 'close' || e.target === overlay) {
        overlay.remove();
        return;
      }
      if (act === 'prev' || act === 'next') {
        await doFrameAction(act);
      } else if (act === 'download') {
        const video = window.BiliAiNote.subtitle?.getVideoElement();
        const ts = video ? video.currentTime : 0;
        window.BiliAiNote.capture.saveToFile(currentBlob, window.BiliAiNote.capture.generateDownloadFilename(ts));
        window.BiliAiNote.panel.showToast('截图已保存');
      } else if (act === 'clipboard') {
        const ok = await window.BiliAiNote.capture.copyToClipboard(currentBlob);
        window.BiliAiNote.panel.showToast(ok ? '已复制到剪贴板' : '复制失败');
      }
    });

    document.body.appendChild(overlay);
  }

  function jumpToChapter(seconds) {
    const video = window.BiliAiNote.subtitle?.getVideoElement();
    if (!video) return;
    const wasPaused = video.paused;
    video.currentTime = seconds;
    if (wasPaused) {
      video.pause();
    }
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  window.BiliAiNote.chapter = {
    render,
    jumpToChapter,
    formatTime,
    loadSavedChapters
  };
})();
