/**
 * BiliAiNote Subtitle Module
 * 字幕获取、解析、渲染、高亮同步
 */
(function () {
  'use strict';

  window.BiliAiNote = window.BiliAiNote || {};

  let syncTimer = null;

  // ── API 通信 ──

  async function fetchFromBg(type, params) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...params }, resp => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp?.ok) {
          reject(new Error(resp?.error || '请求失败'));
          return;
        }
        resolve(resp.data);
      });
    });
  }

  // ── 获取视频元信息 ──

  async function fetchVideoMeta(bvid) {
    return fetchFromBg('fetch-video-meta', { bvid });
  }

  // ── 获取字幕列表 ──

  async function fetchSubtitleList(bvid, cid, aid) {
    return fetchFromBg('fetch-subtitle-list', { bvid, cid, aid });
  }

  // ── 获取字幕正文 ──

  async function fetchSubtitleBody(url) {
    return fetchFromBg('fetch-subtitle-body', { url });
  }

  // ── 提取 BVID ──

  function extractBvid(url) {
    const match = url.match(/\/video\/(BV[\w]+)/);
    return match ? match[1] : '';
  }

  // ── 获取视频元素 ──

  function getVideoElement() {
    const selectors = [
      '.bpx-player-video-wrap video',
      '#bilibili-player video',
      'video'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ── 提取分P索引 ──

  function extractPageIndex(url) {
    try {
      const page = Number(new URL(url).searchParams.get('p') || '1');
      return Number.isFinite(page) && page > 0 ? page : 1;
    } catch {
      return 1;
    }
  }

  // ── 从 pages 数组中按索引选页 ──

  function pickPageFromPages(pages, pageIndex) {
    const safePages = Array.isArray(pages) ? pages : [];
    // 按数组下标
    const byIndex = safePages[pageIndex - 1];
    if (byIndex?.cid) return byIndex;
    // 按 page 字段
    const byNo = safePages.find(item => Number(item.page) === pageIndex);
    if (byNo?.cid) return byNo;
    return null;
  }

  // ── 刷新（主流程） ──

  async function refresh() {
    const s = window.BiliAiNote.state;
    const panel = window.BiliAiNote.panel;
    // 每次刷新字幕时重新探测客户端，允许客户端启动后立即恢复转写按钮
    transcribeClientOnline = null;
    transcribeClientChecking = false;

    const newBvid = extractBvid(location.href);
    if (!newBvid) {
      panel.showToast('当前页面不是 B 站视频页');
      return;
    }

    // BVID 变化时重置旧状态，防止残留数据
    if (newBvid !== s.bvid) {
      s.reset();
    }
    s.bvid = newBvid;
    // 换视频/手动刷新后清空搜索状态
    clearSearchState();

    // 每次刷新递增 runId，取消过期请求
    const runId = ++s.fetchRunId;

    panel.showToast('正在获取字幕...');

    try {
      // 获取视频元信息
      const meta = await fetchVideoMeta(s.bvid);
      if (runId !== s.fetchRunId) return; // 请求已过期

      s.aid = meta.aid || '';
      s.title = meta.title || '';
      s.author = meta.author || '';
      s.uploadDate = meta.uploadDate || '';
      s.description = meta.description || '';
      s.videoDuration = meta.defaultDuration || 0;

      // 标题获取后立即更新提示词
      panel.renderDoc();

      // 用 URL 中的 ?p= 参数选择正确的分P，获取对应 CID
      const pageIndex = extractPageIndex(location.href);
      s.pageIndex = pageIndex;
      const currentPage = pickPageFromPages(meta.pages, pageIndex);
      s.cid = currentPage?.cid || meta.defaultCid || meta.pages?.[0]?.cid || '';

      if (!s.cid) {
        panel.showToast('无法获取视频 CID');
        return;
      }

      // 加载该视频分P的行备注
      s.notes = await loadNotes(s.bvid, s.pageIndex || 1);
      if (runId !== s.fetchRunId) return; // 请求已过期

      // 恢复该视频分P的截图（含章节截图，负索引），先释放旧的 ObjectURL
      if (window.BiliAiNote.capture?.loadScreenshots) {
        for (const [, v] of s.screenshots) {
          if (v?.url) URL.revokeObjectURL(v.url);
        }
        s.screenshots = await window.BiliAiNote.capture.loadScreenshots(s.bvid, s.pageIndex || 1);
        if (runId !== s.fetchRunId) return; // 请求已过期
      }

      // 获取字幕列表和章节
      const bundle = await fetchSubtitleList(s.bvid, s.cid, s.aid);
      if (runId !== s.fetchRunId) return; // 请求已过期

      s.subtitles = bundle.subtitles || [];
      s.chapters = bundle.chapters || [];

      // 渲染视频信息
      if (window.BiliAiNote.videoInfo) {
        window.BiliAiNote.videoInfo.render();
      }

      // 刷新视频页下载区状态
      if (window.BiliAiNote.videoDownload) {
        window.BiliAiNote.videoDownload.refresh();
      }

      // 渲染章节
      if (window.BiliAiNote.chapter) {
        window.BiliAiNote.chapter.render();
      }

      // 更新字幕语言下拉（仅显示可用语言列表，不传 selectedUrl）
      panel.updateSubtitleSelect(s.subtitles, null);

      if (s.subtitles.length === 0) {
        // 无 B 站字幕：尝试恢复历史语音转写生成的字幕
        const saved = await loadTranscript(s.bvid, s.pageIndex || 1);
        if (runId !== s.fetchRunId) return; // 请求已过期
        if (saved && saved.length) {
          s.subtitleBody = saved;
          s.selectedSubtitleUrl = '';
          s.selectedSubtitleLang = 'transcribe';
          renderSubtitleList();
          startSync();
          markTranscribeSource();
          panel.showToast('已恢复语音转写字幕');
          return;
        }
        s.subtitleBody = [];
        renderSubtitleList();
        panel.showToast('无法自动获取Bz字幕');
        return;
      }

      // 优先选择上次使用的字幕语言，否则选第一个
      let preferred = s.subtitles[0];
      if (s.selectedSubtitleLang) {
        const found = s.subtitles.find(t => t.lan === s.selectedSubtitleLang);
        if (found) preferred = found;
      }
      await loadSubtitle(preferred.subtitleUrl, preferred.lan);

      if (runId !== s.fetchRunId) return; // 请求已过期
      panel.showToast('字幕获取成功');
    } catch (err) {
      if (runId !== s.fetchRunId) return; // 请求已过期
      console.error('[BiliAiNote] refresh error:', err);
      panel.showToast('获取失败：' + err.message);
    }
  }

  // ── 加载字幕正文 ──

  async function loadSubtitle(url, lang) {
    const s = window.BiliAiNote.state;
    const panel = window.BiliAiNote.panel;
    const runId = s.fetchRunId;

    try {
      const body = await fetchSubtitleBody(url);
      if (runId !== s.fetchRunId) return; // 请求已过期
      s.subtitleBody = body;
      s.selectedSubtitleUrl = url;
      s.selectedSubtitleLang = lang || '';
      renderSubtitleList();
      startSync();
      // 更新语言选择按钮显示
      panel.updateSubtitleSelect(s.subtitles, s.selectedSubtitleUrl);
    } catch (err) {
      if (runId !== s.fetchRunId) return;
      console.error('[BiliAiNote] loadSubtitle error:', err);
      panel.showToast('字幕加载失败：' + err.message);
    }
  }

  // ── 切换字幕语言 ──

  async function switchSubtitle(url, lang) {
    stopSync();
    // 切换语言后字幕内容变化，清空搜索状态
    clearSearchState();
    await loadSubtitle(url, lang);
  }

  // ── 语音转写字幕持久化（刷新页面后可恢复）──

  const TRANSCRIPT_KEY = 'BiliAiNote_transcripts';
  const TRANSCRIPT_MAX = 30;

  function transcriptKey(bvid, pageIndex) {
    return `${bvid}_p${pageIndex || 1}`;
  }

  function loadTranscript(bvid, pageIndex) {
    return new Promise(resolve => {
      chrome.storage.local.get([TRANSCRIPT_KEY], result => {
        const map = (result && result[TRANSCRIPT_KEY]) || {};
        const entry = map[transcriptKey(bvid, pageIndex)];
        resolve(entry && Array.isArray(entry.items) && entry.items.length ? entry.items : null);
      });
    });
  }

  function saveTranscript(bvid, pageIndex, items) {
    return new Promise(resolve => {
      chrome.storage.local.get([TRANSCRIPT_KEY], result => {
        const map = (result && result[TRANSCRIPT_KEY]) || {};
        map[transcriptKey(bvid, pageIndex)] = { items, at: Date.now() };
        // 超出上限时淘汰最旧记录
        const keys = Object.keys(map);
        if (keys.length > TRANSCRIPT_MAX) {
          keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
          for (const k of keys.slice(0, keys.length - TRANSCRIPT_MAX)) delete map[k];
        }
        chrome.storage.local.set({ [TRANSCRIPT_KEY]: map }, () => resolve());
      });
    });
  }

  function removeTranscript(bvid, pageIndex) {
    return new Promise(resolve => {
      chrome.storage.local.get([TRANSCRIPT_KEY], result => {
        const map = (result && result[TRANSCRIPT_KEY]) || {};
        delete map[transcriptKey(bvid, pageIndex)];
        chrome.storage.local.set({ [TRANSCRIPT_KEY]: map }, () => resolve());
      });
    });
  }

  function isTranscribedSubtitle() {
    return window.BiliAiNote.state.selectedSubtitleLang === 'transcribe';
  }

  async function clearTranscribedSubtitle() {
    const s = window.BiliAiNote.state;
    if (!isTranscribedSubtitle()) return false;
    await removeTranscript(s.bvid, s.pageIndex || 1);
    stopSync();
    s.subtitleBody = [];
    s.selectedSubtitleUrl = '';
    s.selectedSubtitleLang = '';
    transcribe.state = 'idle';
    transcribe.text = '';
    transcribe.error = '';
    transcribe.transcript = null;
    renderSubtitleList();
    window.BiliAiNote.panel.updateSubtitleSelect(s.subtitles || [], null);
    window.BiliAiNote.panel.showToast('已清空语音转写字幕');
    return true;
  }

  // 显示“语音转写”来源标记（底部语言下拉标签）
  function markTranscribeSource() {
    const langLabel = document.getElementById('bn-lang-label');
    if (langLabel) langLabel.textContent = '语音转写';
  }

  // ── 语音转写字幕 ──

  const TRANSCRIBE_HELP_URL = 'https://www.yuque.com/yuxian-tgyyu/megc4v/dspf9gpytg3oqyxn';
  let transcribeClientOnline = null;
  let transcribeClientChecking = false;

  const transcribe = {
    state: 'idle', // idle | running | error
    text: '',
    error: '',
    requestId: null,
    transcript: null, // 服务端返回的结构化字幕 [{start, end, text}]（毫秒）
  };

  function checkTranscribeClient() {
    if (transcribeClientChecking) return;
    transcribeClientChecking = true;
    const checker = window.BiliAiNote.videoDownload?.checkClient;
    const done = (online) => {
      transcribeClientOnline = !!online;
      transcribeClientChecking = false;
      const s = window.BiliAiNote.state;
      const container = document.getElementById('bn-subtitle-list');
      if (container && (!s.subtitleBody || s.subtitleBody.length === 0) && transcribe.state !== 'running') {
        renderTranscribeState(container);
      }
    };
    if (checker) {
      checker().then(done).catch(() => done(false));
    } else {
      done(false);
    }
  }

  // 空态/转写态渲染：无法获取字幕 + 语音转写按钮（或流式内容）
  function renderTranscribeState(container) {
    if (transcribe.state === 'running') {
      const preview = escapeHtml(transcribe.text).slice(-3000);
      container.innerHTML = `
        <div class="bn-transcribe-box">
          <div class="bn-transcribe-head">
            <span class="bn-transcribe-status">正在语音转写…</span>
            <button class="bn-transcribe-stop" data-action="stop-transcribe">停止</button>
          </div>
          <pre class="bn-transcribe-stream">${preview}</pre>
        </div>
      `;
      const streamEl = container.querySelector('.bn-transcribe-stream');
      if (streamEl) streamEl.scrollTop = streamEl.scrollHeight;
      return;
    }

    const checking = transcribeClientOnline === null || transcribeClientChecking;
    const unavailable = transcribeClientOnline === false;
    const disabled = (checking || unavailable) ? ' disabled' : '';
    const clientHint = checking
      ? '<div class="bn-transcribe-client-hint">正在检测客户端…</div>'
      : unavailable
        ? `<div class="bn-transcribe-client-hint bn-client-unavailable"><span>请先启动BilibiliDownloader.exe客户端，如需下载</span><a class="bn-transcribe-client-link" href="${TRANSCRIBE_HELP_URL}" target="_blank" rel="noopener noreferrer">点击下载客户端</a></div>`
        : '';

    if (transcribe.state === 'error' && transcribe.error) {
      container.innerHTML = `
        <div class="bn-empty">
          <div class="bn-transcribe-error">${escapeHtml(transcribe.error)}</div>
          <div class="bn-empty-text">无法自动获取B站的字幕</div>
          <button class="bn-transcribe-btn" data-action="transcribe"${disabled}>语音转写来生成</button>
          ${clientHint}
        </div>
      `;
      if (transcribeClientOnline === null && !transcribeClientChecking) checkTranscribeClient();
      return;
    }

    container.innerHTML = `
      <div class="bn-empty">
        <div class="bn-empty-text">无法自动获取B站的字幕</div>
        <button class="bn-transcribe-btn" data-action="transcribe"${disabled}>语音转写来生成</button>
        ${clientHint}
      </div>
    `;
    if (transcribeClientOnline === null && !transcribeClientChecking) checkTranscribeClient();
  }

  // 构造传给转写服务的视频 URL：去掉追踪参数，保留分P参数
  function buildVideoUrl() {
    try {
      const u = new URL(location.href);
      const p = u.searchParams.get('p');
      const clean = u.origin + u.pathname;
      return p && p !== '1' ? `${clean}?p=${encodeURIComponent(p)}` : clean;
    } catch {
      return location.href;
    }
  }

  // 启动语音转写（通过 background 中转，流式回传）
  // 若本地客户端已为当前视频生成过音频（视频页下载过），携带 audioPath 跳过重复下载
  async function startTranscribe() {
    if (transcribe.state === 'running') return;
    if (transcribeClientOnline !== true) {
      window.BiliAiNote.panel.showToast('客户端工具未启用');
      checkTranscribeClient();
      return;
    }

    transcribe.state = 'running';
    transcribe.text = '';
    transcribe.error = '';
    transcribe.requestId = null;
    transcribe.transcript = null;

    const container = document.getElementById('bn-subtitle-list');
    if (container) renderTranscribeState(container);
    window.BiliAiNote.panel.showToast('已发起语音转写请求');

    // 复用已下载的音频（视频页已下载过则客户端跳过下载）
    let audioPath = '';
    try {
      if (window.BiliAiNote.videoDownload) {
        audioPath = await window.BiliAiNote.videoDownload.getAudioPath(buildVideoUrl());
      }
    } catch {}

    try {
      chrome.runtime.sendMessage(
        { type: 'transcribe-start', videoUrl: buildVideoUrl(), audioPath },
        (resp) => {
          if (chrome.runtime.lastError) {
            transcribe.error = chrome.runtime.lastError.message || '通信失败';
            transcribe.state = 'error';
            renderTranscribeState(document.getElementById('bn-subtitle-list') || container);
            return;
          }
          if (!resp || !resp.ok) {
            transcribe.error = resp?.error || '请求失败';
            transcribe.state = 'error';
            renderTranscribeState(document.getElementById('bn-subtitle-list') || container);
            return;
          }
          transcribe.requestId = resp.requestId;
        }
      );
    } catch (e) {
      // Extension context invalidated
      transcribe.error = '扩展已重新加载，请刷新本页面后重试';
      transcribe.state = 'error';
      const c = document.getElementById('bn-subtitle-list');
      if (c) renderTranscribeState(c);
    }
  }

  // 停止转写
  function stopTranscribe() {
    try {
      chrome.runtime.sendMessage({ type: 'transcribe-abort' });
    } catch {}
    transcribe.state = 'idle';
    transcribe.text = '';
    transcribe.transcript = null;
    const container = document.getElementById('bn-subtitle-list');
    if (container) renderTranscribeState(container);
  }

  // 解析转写结果中的原文字幕为 B 站字幕格式 [{from, to, content}]
  // 兼容格式：SRT/VTT 时间轴（00:01:02,300 --> 00:01:05,000）、
  // [MM:SS]/[HH:MM:SS] 前缀行、MM:SS 开头行
  function parseTranscript(raw) {
    const ts = (str) => {
      const parts = String(str).trim().replace(',', '.').split(':').map(Number);
      if (!parts.length || parts.some(n => Number.isNaN(n))) return null;
      let sec = 0;
      for (const p of parts) sec = sec * 60 + p;
      return sec;
    };

    const TS = '\\d{1,2}:\\d{2}(?::\\d{2})?(?:[.,]\\d{1,3})?';
    const arrowRe = new RegExp(`^(${TS})\\s*-->\\s*(${TS})`);
    const lineRe = new RegExp(`^\\[?(${TS})\\]?\\s*[-–—]?\\s*(.*)$`);

    const items = [];
    let pending = null; // 待配文本的 SRT 时间轴

    for (const rawLine of String(raw || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const arrow = line.match(arrowRe);
      if (arrow) {
        if (pending) items.push({ from: pending.from, to: pending.to, content: '' });
        pending = { from: ts(arrow[1]), to: ts(arrow[2]) };
        continue;
      }

      const m = line.match(lineRe);
      if (m) {
        const from = ts(m[1]);
        const content = m[2].trim();
        if (from !== null && content) {
          items.push({ from, to: null, content });
          continue;
        }
      }

      if (pending) {
        // SRT：时间轴行的下一行是字幕文本
        items.push({ from: pending.from, to: pending.to, content: line });
        pending = null;
        continue;
      }

      // 无时间戳的普通行：追加到上一条字幕
      if (items.length && items[items.length - 1].content) {
        items[items.length - 1].content += ' ' + line;
      }
    }

    // 补齐缺失的结束时间
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.from === null || it.from === undefined) continue;
      if (it.to === null || it.to === undefined || it.to <= it.from) {
        const next = items[i + 1];
        it.to = next ? next.from : it.from + 3;
      }
    }

    return items.filter(it => it.from !== null && it.from !== undefined && it.content);
  }

  // 转写完成：解析字幕并覆盖流式内容
  function finishTranscribe() {
    const s = window.BiliAiNote.state;
    const container = document.getElementById('bn-subtitle-list');

    // 优先使用服务端返回的结构化 transcript（start/end 为毫秒）
    let items = [];
    if (Array.isArray(transcribe.transcript)) {
      items = transcribe.transcript
        .map(seg => ({
          from: Number(seg.start) / 1000,
          to: Number(seg.end) / 1000,
          content: String(seg.text || '').trim()
        }))
        .filter(it => Number.isFinite(it.from) && Number.isFinite(it.to) && it.content);
    }

    // 回退：从流式文本中解析带时间戳的行
    if (!items.length) {
      items = parseTranscript(transcribe.text);
    }

    if (!items.length) {
      transcribe.error = '未能从转写结果中解析出带时间戳的字幕';
      transcribe.state = 'error';
      if (container) renderTranscribeState(container);
      window.BiliAiNote.panel.showToast(transcribe.error);
      return;
    }

    transcribe.state = 'idle';
    transcribe.text = '';
    transcribe.transcript = null;
    s.subtitleBody = items;
    // 持久化：刷新页面/下次进入时可直接恢复，无需重新转写
    saveTranscript(s.bvid, s.pageIndex || 1, items).catch(() => {});
    s.selectedSubtitleUrl = '';
    s.selectedSubtitleLang = 'transcribe';
    renderSubtitleList();
    startSync();
    markTranscribeSource();
    window.BiliAiNote.panel.showToast('语音转写完成，已生成字幕');
  }

  // 监听 background 推送的转写消息
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || !msg.type || !msg.type.startsWith('transcribe-')) return;
      if (transcribe.state !== 'running') return;
      if (transcribe.requestId && msg.requestId && transcribe.requestId !== msg.requestId) return;

      switch (msg.type) {
        case 'transcribe-chunk':
          transcribe.text += msg.text || '';
          renderTranscribeState(document.getElementById('bn-subtitle-list'));
          break;
        case 'transcribe-result':
          if (Array.isArray(msg.transcript)) {
            transcribe.transcript = msg.transcript;
          }
          // 回写下载记录：转写过程中客户端生成的视频/音频文件，
          // 供视频页显示“视频已下载到本地”
          if (Array.isArray(msg.files) && msg.files.length && window.BiliAiNote.videoDownload) {
            window.BiliAiNote.videoDownload.saveRecord(buildVideoUrl(), msg.files).catch(() => {});
          }
          break;
        case 'transcribe-done':
          finishTranscribe();
          break;
        case 'transcribe-aborted':
          transcribe.state = 'idle';
          transcribe.text = '';
          transcribe.transcript = null;
          renderTranscribeState(document.getElementById('bn-subtitle-list'));
          window.BiliAiNote.panel.showToast('已停止转写');
          break;
        case 'transcribe-error':
          transcribe.error = msg.error || '转写失败';
          transcribe.state = 'error';
          renderTranscribeState(document.getElementById('bn-subtitle-list'));
          window.BiliAiNote.panel.showToast('转写失败：' + transcribe.error);
          break;
      }
    });
  } catch {}

  // ── 字幕搜索与过滤 ──

  const search = {
    keyword: '',
    noteKeyword: '', // 备注关键词
    onlySnap: false, // 只看截图
    onlyNote: false, // 只看备注
    hits: [],        // 命中的行索引（升序，关键词 ∧ 备注关键词 ∧ 过滤条件）
    pos: -1          // 当前命中在 hits 中的下标
  };

  let lastSearchCurrentEl = null;

  // 备注弹窗打开期间暂停自动滚动
  let scrollPaused = false;

  function isSearchActive() {
    return !!(search.keyword || search.noteKeyword || search.onlySnap || search.onlyNote);
  }

  // 过滤条件：只看截图、只看备注同时勾选时取并集（满足任一即可）；
  // 备注关键词与上述条件取交集
  function rowMatchFilters(index, s) {
    if (search.onlySnap || search.onlyNote) {
      const snapOk = search.onlySnap && s.screenshots.has(index);
      const noteOk = search.onlyNote && !!s.notes.get(index);
      if (!snapOk && !noteOk) return false;
    }
    if (search.noteKeyword) {
      const note = String(s.notes.get(index) || '').toLowerCase();
      if (!note || !note.includes(search.noteKeyword)) return false;
    }
    return true;
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 在已转义的文本中给关键词包裹 <mark>；关键词同样先做 HTML 转义，防止注入
  function markKeyword(safeText, keyword) {
    if (!keyword) return safeText;
    const re = new RegExp(`(${escapeRegExp(escapeHtml(keyword))})`, 'gi');
    return safeText.replace(re, '<mark class="bn-search-mark">$1</mark>');
  }

  function highlightText(text) {
    return markKeyword(escapeHtml(text), search.keyword);
  }

  function highlightNoteText(note) {
    return markKeyword(escapeHtml(note), search.noteKeyword);
  }

  // 重算命中并重渲染（keepPos: 数据变化时尽量保持当前命中位置）
  function runSearch(options = {}) {
    const s = window.BiliAiNote.state;
    const prevIndex = options.keepPos && search.pos >= 0 ? search.hits[search.pos] : -1;

    search.hits = [];
    search.pos = -1;

    if (isSearchActive() && s.subtitleBody?.length) {
      const lower = search.keyword.toLowerCase();
      s.subtitleBody.forEach((item, index) => {
        if (search.keyword && !String(item.content || '').toLowerCase().includes(lower)) return;
        if (!rowMatchFilters(index, s)) return;
        search.hits.push(index);
      });
    }

    if (prevIndex >= 0) {
      const p = search.hits.indexOf(prevIndex);
      if (p >= 0) search.pos = p;
    }

    renderSubtitleList();
    updateSearchCountUI();
  }

  // 应用搜索关键词：重算命中并重渲染列表
  function applySearch(keyword) {
    search.keyword = String(keyword || '').trim();
    runSearch();
    if (search.hits.length && search.pos < 0) stepSearch(1);
  }

  // 应用过滤条件（与关键词叠加）
  function setSearchFilters(onlySnap, onlyNote) {
    search.onlySnap = !!onlySnap;
    search.onlyNote = !!onlyNote;
    runSearch();
    if (search.hits.length && search.pos < 0) stepSearch(1);
  }

  // 应用备注关键词搜索（与字幕关键词、过滤条件叠加）
  function applyNoteSearch(keyword) {
    search.noteKeyword = String(keyword || '').trim().toLowerCase();
    runSearch();
    if (search.hits.length && search.pos < 0) stepSearch(1);
  }

  // 在命中之间循环导航（dir: 1 下一个 / -1 上一个）
  function stepSearch(dir) {
    if (!search.hits.length) return;
    search.pos = (search.pos + dir + search.hits.length) % search.hits.length;
    const index = search.hits[search.pos];
    updateSearchCountUI();
    markSearchCurrent(index);
    scrollToItem(index);
  }

  // 标记当前命中行
  function markSearchCurrent(index) {
    if (lastSearchCurrentEl) lastSearchCurrentEl.classList.remove('bn-search-current');
    lastSearchCurrentEl = null;
    const el = document.getElementById('bn-subtitle-list')?.querySelector(`[data-index="${index}"]`);
    if (el) {
      el.classList.add('bn-search-current');
      lastSearchCurrentEl = el;
    }
  }

  // 更新计数显示（当前第几个 / 总命中数）
  function updateSearchCountUI() {
    const countEl = document.getElementById('bn-search-count');
    if (!countEl) return;
    countEl.textContent = isSearchActive()
      ? (search.hits.length ? `${search.pos + 1}/${search.hits.length}` : '0 结果')
      : '';
  }

  // 数据变化（刷新/切换语言/换视频）时清空搜索与过滤状态
  function clearSearchState() {
    search.keyword = '';
    search.noteKeyword = '';
    search.onlySnap = false;
    search.onlyNote = false;
    search.hits = [];
    search.pos = -1;
    lastSearchCurrentEl = null;
    const input = document.getElementById('bn-search-input');
    if (input && input.value) input.value = '';
    const noteInput = document.getElementById('bn-note-search-input');
    if (noteInput && noteInput.value) noteInput.value = '';
    ['bn-filter-snap', 'bn-filter-note'].forEach(id => {
      const box = document.getElementById(id);
      if (box) box.checked = false;
    });
    updateSearchCountUI();
    // 重渲染以移除高亮/变淡状态
    renderSubtitleList();
  }

  // ── 行备注持久化（按 bvid+分P 分组存储） ──

  const NOTES_KEY = 'BiliAiNote_notes';
  const NOTES_MAX = 100;

  function notesKey(bvid, pageIndex) {
    return `${bvid}_p${pageIndex || 1}`;
  }

  function loadNotes(bvid, pageIndex) {
    return new Promise(resolve => {
      chrome.storage.local.get([NOTES_KEY], result => {
        const map = (result && result[NOTES_KEY]) || {};
        const entry = map[notesKey(bvid, pageIndex)] || {};
        const notes = new Map();
        Object.keys(entry.notes || {}).forEach(k => {
          const text = String(entry.notes[k] || '').trim();
          if (text) notes.set(Number(k), text);
        });
        resolve(notes);
      });
    });
  }

  function saveNotes(bvid, pageIndex, notes) {
    return new Promise(resolve => {
      chrome.storage.local.get([NOTES_KEY], result => {
        const map = (result && result[NOTES_KEY]) || {};
        const entry = {};
        notes.forEach((text, index) => { entry[index] = text; });
        if (Object.keys(entry).length) {
          map[notesKey(bvid, pageIndex)] = { notes: entry, at: Date.now() };
        } else {
          delete map[notesKey(bvid, pageIndex)];
        }
        // 超出上限时淘汰最旧记录
        const keys = Object.keys(map);
        if (keys.length > NOTES_MAX) {
          keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
          for (const k of keys.slice(0, keys.length - NOTES_MAX)) delete map[k];
        }
        chrome.storage.local.set({ [NOTES_KEY]: map }, () => resolve());
      });
    });
  }

  // ── 行备注弹窗 ──

  function openNoteModal(index) {
    const s = window.BiliAiNote.state;
    const item = s.subtitleBody[index];
    if (!item) return;

    scrollPaused = true;

    const overlay = document.createElement('div');
    overlay.className = 'bn-note-overlay';
    overlay.innerHTML = `
      <div class="bn-note-box">
        <div class="bn-note-title">备注 · ${formatTime(item.from)}</div>
        <textarea class="bn-note-textarea" placeholder="填写备注内容…" rows="4"></textarea>
        <div class="bn-note-btns">
          <button data-act="save">保存</button>
          <button data-act="cancel">取消</button>
        </div>
      </div>
    `;

    const textarea = overlay.querySelector('.bn-note-textarea');
    textarea.value = s.notes.get(index) || '';

    const close = () => {
      overlay.remove();
      scrollPaused = false;
      // 关闭后恢复自动滚动并滚回当前播放行
      if (window.BiliAiNote.state.settings.autoScroll && lastActiveIndex >= 0) {
        scrollToItem(lastActiveIndex);
      }
    };

    overlay.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'save') {
        const text = textarea.value.trim();
        if (text) s.notes.set(index, text);
        else s.notes.delete(index);
        saveNotes(s.bvid, s.pageIndex || 1, s.notes).catch(() => {});
        runSearch({ keepPos: true });
        window.BiliAiNote.panel.showToast(text ? '备注已保存' : '备注已清空');
        close();
      } else if (act === 'cancel' || e.target === overlay) {
        close();
      }
    });

    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        overlay.querySelector('[data-act="save"]').click();
      }
    });

    document.body.appendChild(overlay);
    textarea.focus();
  }

  function deleteNote(index) {
    const s = window.BiliAiNote.state;
    s.notes.delete(index);
    saveNotes(s.bvid, s.pageIndex || 1, s.notes).catch(() => {});
    runSearch({ keepPos: true });
    window.BiliAiNote.panel.showToast('已删除备注');
  }

  // ── 渲染字幕列表 ──

  let subtitleListenerAttached = false;

  function renderSubtitleList() {
    const s = window.BiliAiNote.state;
    const container = document.getElementById('bn-subtitle-list');
    if (!container) return;

    // 清除 DOM 缓存
    invalidateRowCache();

    container.innerHTML = '';

    // 只绑定一次事件委托
    if (!subtitleListenerAttached) {
      container.addEventListener('click', onSubtitleClick);
      subtitleListenerAttached = true;
    }

    if (!s.subtitleBody || s.subtitleBody.length === 0) {
      renderTranscribeState(container);
      return;
    }

    // 搜索命中集合（用于行级 bn-search-hit / bn-search-dim）
    const filtering = isSearchActive();
    const hitSet = new Set(search.hits);

    s.subtitleBody.forEach((item, index) => {
      const text = String(item.content || '').trim();
      if (!text) return;

      const screenshot = s.screenshots.get(index);
      const note = s.notes.get(index);
      const el = document.createElement('div');

      const searchCls = filtering
        ? (hitSet.has(index) ? ' bn-search-hit' : ' bn-search-dim')
        : '';
      const rowText = highlightText(text);
      const noteHtml = note
        ? `<span class="bn-row-note">备注：${highlightNoteText(note)}</span>`
        : '';

      if (screenshot) {
        el.className = 'bn-row-img' + searchCls;
        el.dataset.index = index;
        el.innerHTML = `
          <img class="bn-snap-thumb" src="${screenshot.url}" alt="截图" data-index="${index}">
          <div class="bn-text-wrap">
            <div class="bn-time-text">${formatTime(item.from)}</div>
            <div class="bn-sub-text">${rowText}</div>
            ${noteHtml}
          </div>
          <div class="bn-btns">
            <button data-action="copy">复制</button>
            <button data-action="note">备注</button>
            ${note ? '<button data-action="delete-note">删除备注</button>' : ''}
            <button data-action="cancel-snap">取消截图</button>
          </div>
        `;
      } else {
        el.className = 'bn-row' + searchCls;
        el.dataset.index = index;
        el.innerHTML = `
          <span class="bn-row-time">${formatTime(item.from)}</span>
          <span class="bn-row-text">${rowText}${noteHtml}</span>
          <div class="bn-btns">
            <button data-action="copy">复制</button>
            <button data-action="note">备注</button>
            ${note ? '<button data-action="delete-note">删除备注</button>' : ''}
            <button data-action="add-snap">截图</button>
          </div>
        `;
      }

      // 点击行跳转
      el.addEventListener('click', (e) => {
        if (e.target.closest('.bn-btns') || e.target.closest('.bn-snap-thumb')) return;
        jumpToTime(item.from);
      });

      container.appendChild(el);
    });

    // 重新渲染后恢复高亮状态
    if (lastActiveIndex >= 0) {
      updateHighlight(lastActiveIndex);
    }

    // 重新渲染后恢复搜索当前命中标记
    if (search.keyword && search.hits.length && search.pos >= 0) {
      markSearchCurrent(search.hits[search.pos]);
    }
  }

  // ── 字幕列表点击事件 ──

  function onSubtitleClick(e) {
    const btn = e.target.closest('button');
    const thumb = e.target.closest('.bn-snap-thumb');
    const s = window.BiliAiNote.state;

    if (thumb) {
      const index = parseInt(thumb.dataset.index);
      window.BiliAiNote.cropViewer.open(index);
      return;
    }

    if (!btn) return;

    // 语音转写相关按钮（不在字幕行内）
    const action0 = btn.dataset.action;
    if (action0 === 'transcribe') {
      startTranscribe();
      return;
    }
    if (action0 === 'stop-transcribe') {
      stopTranscribe();
      return;
    }

    const row = btn.closest('.bn-row') || btn.closest('.bn-row-img');
    if (!row) return;
    const index = parseInt(row.dataset.index);
    const action = btn.dataset.action;

    if (action === 'copy') {
      copySingleText(index);
    } else if (action === 'note') {
      openNoteModal(index);
    } else if (action === 'delete-note') {
      deleteNote(index);
    } else if (action === 'add-snap') {
      if (window.BiliAiNote.capture) {
        window.BiliAiNote.capture.addScreenshot(index);
      }
    } else if (action === 'cancel-snap') {
      if (window.BiliAiNote.capture) {
        window.BiliAiNote.capture.removeScreenshot(index);
      }
    }
  }

  // ── 跳转到时间点 ──

  function jumpToTime(seconds) {
    const video = getVideoElement();
    if (!video) return;
    const wasPaused = video.paused;
    video.currentTime = seconds;
    if (wasPaused) {
      video.pause();
    }
  }

  // ── 字幕高亮同步 ──

  let lastActiveIndex = -1;
  let manualScrollPauseUntil = 0;
  let scrollHandlers = null;

  // 性能优化：缓存 DOM 元素引用
  let cachedSubtitleList = null;
  let cachedRows = null;

  function getCachedRows() {
    if (!cachedSubtitleList || !cachedSubtitleList.parentNode) {
      cachedSubtitleList = document.getElementById('bn-subtitle-list');
      cachedRows = null;
    }
    if (!cachedRows && cachedSubtitleList) {
      cachedRows = cachedSubtitleList.querySelectorAll('.bn-row, .bn-row-img');
    }
    return cachedRows || [];
  }

  function invalidateRowCache() {
    cachedSubtitleList = null;
    cachedRows = null;
    cachedActiveRow = null;
    lastSearchCurrentEl = null;
  }

  // 性能优化：使用 requestAnimationFrame 节流 timeupdate
  let rafId = null;
  let lastProcessedTime = -1;

  function processTimeUpdate(video) {
    if (rafId) return; // 已有待处理的帧

    rafId = requestAnimationFrame(() => {
      rafId = null;
      const s = window.BiliAiNote.state;
      if (s.activeTab !== 'subtitle') return;

      const currentTime = video.currentTime;

      // 跳过重复处理同一时间点
      if (Math.abs(currentTime - lastProcessedTime) < 0.1) return;
      lastProcessedTime = currentTime;

      const activeIndex = findActiveIndex(currentTime);

      // 高亮始终生效（不受 autoScroll 影响）
      if (activeIndex !== lastActiveIndex) {
        updateHighlight(activeIndex);
        lastActiveIndex = activeIndex;
      }

      // 自动滚动：仅在开启、非搜索/过滤态、无弹窗且用户未手动滚动时生效
      if (s.settings.autoScroll && !isSearchActive() && !scrollPaused && activeIndex >= 0) {
        if (Date.now() > manualScrollPauseUntil) {
          scrollToItem(activeIndex);
        }
      }
    });
  }

  function startSync() {
    stopSync();
    const video = getVideoElement();
    if (!video) return;

    // 清除缓存，获取最新 DOM
    invalidateRowCache();

    const onTimeUpdate = () => processTimeUpdate(video);

    // seek 完成后立即更新高亮（解决暂停状态跳转后高亮不更新的问题）
    const onSeeked = () => {
      const s = window.BiliAiNote.state;
      if (s.activeTab !== 'subtitle') return;

      const currentTime = video.currentTime;
      const activeIndex = findActiveIndex(currentTime);

      if (activeIndex !== lastActiveIndex) {
        updateHighlight(activeIndex);
        lastActiveIndex = activeIndex;
      }

      // seek 后也触发自动滚动（搜索/过滤态、弹窗打开时除外）
      if (s.settings.autoScroll && !isSearchActive() && !scrollPaused && activeIndex >= 0) {
        scrollToItem(activeIndex);
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onSeeked);
    syncTimer = { video, handler: onTimeUpdate, seekedHandler: onSeeked };

    // 监听用户手动滚动，暂停自动滚动
    setupManualScrollDetection();
  }

  function stopSync() {
    if (syncTimer) {
      syncTimer.video.removeEventListener('timeupdate', syncTimer.handler);
      if (syncTimer.seekedHandler) {
        syncTimer.video.removeEventListener('seeked', syncTimer.seekedHandler);
      }
      syncTimer = null;
    }
    // 清理滚动监听
    if (scrollHandlers) {
      scrollHandlers.el.removeEventListener('wheel', scrollHandlers.wheel);
      scrollHandlers.el.removeEventListener('touchmove', scrollHandlers.touch);
      scrollHandlers = null;
    }

    // 清理 RAF
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (scrollRafId) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }

    // 清除缓存
    invalidateRowCache();
    cachedScrollWrap = null;

    lastActiveIndex = -1;
    lastProcessedTime = -1;
  }

  function setupManualScrollDetection() {
    const scrollWrap = window.BiliAiNote.panel.getScrollWrap();
    if (!scrollWrap) return;

    const handler = () => {
      manualScrollPauseUntil = Date.now() + 3000;
    };
    scrollWrap.addEventListener('wheel', handler, { passive: true });
    scrollWrap.addEventListener('touchmove', handler, { passive: true });
    scrollHandlers = { el: scrollWrap, wheel: handler, touch: handler };
  }

  // 性能优化：使用缓存的二分查找
  function findActiveIndex(currentTime) {
    const body = window.BiliAiNote.state.subtitleBody;
    if (!body || body.length === 0) return -1;

    // 先检查上一个位置（常见情况：连续播放）
    if (lastActiveIndex >= 0 && lastActiveIndex < body.length) {
      const item = body[lastActiveIndex];
      const to = item.to || item.from + 2;
      if (currentTime >= item.from && currentTime < to) {
        return lastActiveIndex;
      }
    }

    // 二分查找
    let left = 0;
    let right = body.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const item = body[mid];
      const to = item.to || item.from + 2;

      if (currentTime >= item.from && currentTime < to) {
        return mid;
      } else if (currentTime < item.from) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return -1;
  }

  // 性能优化：直接引用当前高亮行，避免遍历所有行
  let cachedActiveRow = null;

  function updateHighlight(activeIndex) {
    const rows = getCachedRows();
    if (rows.length === 0) return;

    // 移除旧高亮（O(1)）
    if (cachedActiveRow) {
      cachedActiveRow.classList.remove('bn-active');
      cachedActiveRow = null;
    }

    // 添加新高亮（O(1)）
    if (activeIndex >= 0 && activeIndex < rows.length) {
      cachedActiveRow = rows[activeIndex];
      cachedActiveRow.classList.add('bn-active');
    }
  }

  // 节流滚动 + 缓存 scrollWrap
  let scrollRafId = null;
  let cachedScrollWrap = null;

  function getScrollWrap() {
    if (!cachedScrollWrap || !cachedScrollWrap.parentNode) {
      cachedScrollWrap = window.BiliAiNote.panel.getScrollWrap();
    }
    return cachedScrollWrap;
  }

  function scrollToItem(index) {
    if (scrollRafId) return; // 已有待处理的滚动

    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;

      const scrollWrap = getScrollWrap();
      const rows = getCachedRows();
      if (!scrollWrap || rows.length === 0) return;

      const target = rows[index];
      if (!target) return;

      // 目标位置：距滚动容器顶部留约 5 行高度，但不超过视口高度的 30%，
      // 避免截图行/多行文本行过高时留白过大把当前行滚出可视区域
      const rowHeight = target.offsetHeight || 40;
      const offset = Math.min(rowHeight * 5.0, scrollWrap.clientHeight * 0.3);
      const targetTop = target.offsetTop - offset;

      scrollWrap.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth'
      });
    });
  }

  // ── 复制单条字幕 ──

  function copySingleText(index) {
    const s = window.BiliAiNote.state;
    const item = s.subtitleBody[index];
    if (!item) return;
    navigator.clipboard.writeText(item.content).then(() => {
      window.BiliAiNote.panel.showToast('已复制');
    });
  }

  // ── 复制全部字幕文本 ──

  function copyText() {
    const s = window.BiliAiNote.state;
    if (!s.subtitleBody || s.subtitleBody.length === 0) {
      window.BiliAiNote.panel.showToast('没有可复制的字幕');
      return;
    }
    const text = s.subtitleBody
      .map(item => item.content)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      window.BiliAiNote.panel.showToast('已复制全部字幕');
    });
  }

  // ── 预览弹窗 ──

  function showPreview(index) {
    const s = window.BiliAiNote.state;
    const screenshot = s.screenshots.get(index);
    if (!screenshot) return;

    const video = getVideoElement();

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
        s.screenshots.set(index, { blob: currentBlob, url: currentUrl });
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
        const video = getVideoElement();
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

  // ── 工具函数 ──

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  // ── 公开接口 ──

  window.BiliAiNote.subtitle = {
    refresh,
    switchSubtitle,
    copyText,
    renderSubtitleList,
    getVideoElement,
    jumpToTime,
    startSync,
    stopSync,
    formatTime,
    fetchVideoMeta,
    extractBvid,
    extractPageIndex,
    findActiveIndex,
    startTranscribe,
    stopTranscribe,
    parseTranscript,
    isTranscribedSubtitle,
    clearTranscribedSubtitle,
    applySearch,
    applyNoteSearch,
    setSearchFilters,
    stepSearch,
    clearSearchState
  };
})();
