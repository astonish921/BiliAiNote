/**
 * BiliAiNote Background Script (Service Worker)
 * 代理 Bilibili API 请求，处理 CORS，管理图标状态
 */

// ── 图标状态管理 ──

function isVideoPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('bilibili.com') &&
      (parsed.pathname.startsWith('/video/') || parsed.pathname.startsWith('/list/'));
  } catch {
    return false;
  }
}

function updateIconForTab(tabId, url) {
  const enabled = isVideoPage(url || '');
  if (enabled) {
    chrome.action.setIcon({
      tabId,
      path: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png'
      }
    }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'BiliAiNote - 点击打开' }).catch(() => {});
  } else {
    chrome.action.setIcon({
      tabId,
      path: {
        16: 'icons/icon-16-disabled.png',
        32: 'icons/icon-32-disabled.png',
        48: 'icons/icon-48-disabled.png',
        128: 'icons/icon-128-disabled.png'
      }
    }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'BiliAiNote - 仅在B站视频页可用' }).catch(() => {});
  }
}

// 监听标签页 URL 变化
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateIconForTab(tabId, tab.url);
  }
});

// 监听标签页切换
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    updateIconForTab(tabId, tab.url);
  } catch {}
});

// 扩展安装/更新时，刷新所有标签页图标
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        updateIconForTab(tab.id, tab.url);
      }
    }
  } catch {}
});

// ── 消息监听 ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'fetch-video-meta') {
    fetchVideoMeta(message.bvid)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'fetch-subtitle-list') {
    fetchSubtitleList(message.bvid, message.cid, message.aid)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'fetch-subtitle-body') {
    fetchSubtitleBody(message.url)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // 打开选项页面
  if (message.type === 'open-options') {
    if (message.section) {
      chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?section=${message.section}`) });
    } else {
      chrome.runtime.openOptionsPage();
    }
    return false;
  }

  // ── LLM 配置测试 ──

  if (message.type === 'llm-test') {
    llmTestConnection(message.apiBase, message.apiKey, message.model)
      .then(result => sendResponse(result));
    return true;
  }

  // ── 客户端（本地下载器）──

  if (message.type === 'client-health') {
    clientFetch('/health', { method: 'GET' }, 3000)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'client-reveal') {
    clientFetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: message.path })
    }).then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === 'video-download-start') {
    const senderTabId = sender.tab?.id;
    if (!senderTabId) {
      sendResponse({ ok: false, error: '无 sender tab' });
      return false;
    }
    videoDownloadStart(senderTabId, message.url, !!message.force, message.generateMp3 !== false);
    sendResponse({ ok: true });
    return true;
  }

  // ── AI 文档总结 ──

  if (message.type === 'ai-generate') {
    const senderTabId = sender.tab?.id;
    if (!senderTabId) {
      sendResponse({ ok: false, error: '无 sender tab' });
      return false;
    }
    const requestId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());
    aiHandleGenerate(requestId, message.sceneId, message.content, senderTabId, message.prompt, message.wantThink);
    sendResponse({ ok: true, requestId });
    return true;
  }

  if (message.type === 'ai-abort') {
    aiHandleAbort(message.requestId, message.sceneId);
    return false;
  }

  // ── 语音转写字幕 ──

  if (message.type === 'transcribe-start') {
    const senderTabId = sender.tab?.id;
    if (!senderTabId) {
      sendResponse({ ok: false, error: '无 sender tab' });
      return false;
    }
    const requestId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());
    transcribeHandleStart(requestId, message.videoUrl, message.audioPath || '', senderTabId);
    sendResponse({ ok: true, requestId });
    return true;
  }

  if (message.type === 'transcribe-abort') {
    if (transcribeRequest?.ctrl) {
      try { transcribeRequest.ctrl.abort(); } catch {}
    }
    return false;
  }
});

// 扩展图标点击 → 无操作（面板自动显示）
chrome.action.onClicked.addListener((tab) => {
  // 无操作
});

/**
 * 获取视频元信息
 */
async function fetchVideoMeta(bvid) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const payload = await fetchJson(url);
  if (payload.code !== 0) {
    throw new Error(payload?.message || '无法获取视频信息');
  }
  const data = payload.data || {};
  const pubdate = Number(data.pubdate || 0);
  const uploadDate = pubdate > 0 ? formatDate(pubdate * 1000) : '';
  const pages = Array.isArray(data.pages) ? data.pages : [];
  return {
    aid: data.aid ? String(data.aid) : '',
    title: String(data.title || ''),
    author: String(data.owner?.name || ''),
    description: String(data.desc || ''),
    uploadDate,
    defaultCid: data.cid ? String(data.cid) : '',
    defaultDuration: Number(data.duration || 0) || 0,
    pages: pages.map(item => ({
      cid: String(item.cid || ''),
      page: Number(item.page || 0) || 0,
      part: String(item.part || '').trim(),
      duration: Number(item.duration || 0) || 0
    }))
  };
}

/**
 * 获取字幕列表和章节
 * 完全遵循 Bilibili-Obsidian-Clipper 的双源策略：
 * 1. 主源：player/wbi/v2?aid=xxx&cid=xxx (用 aid 作为主标识)
 * 2. 回退：player/v2?bvid=xxx&cid=xxx
 */
async function fetchSubtitleList(bvid, cid, aid = '') {
  const requests = buildSubtitleInfoRequests({ bvid, cid, aid });

  for (const request of requests) {
    try {
      const payload = await fetchJson(request.url);
      if (payload.code !== 0) {
        console.warn(`[BiliAiNote] ${request.source} failed:`, payload?.message);
        continue;
      }
      const data = payload.data || {};
      const subtitles = normalizeSubtitleTracks(
        (data.subtitle?.subtitles || []).map(item => ({
          id: item?.id === undefined || item?.id === null ? '' : String(item.id),
          lan: item?.lan || '',
          lanDoc: item?.lan_doc || '',
          subtitleUrl: normalizeSubtitleUrl(item?.subtitle_url || ''),
          source: request.source
        })).filter(item => item.subtitleUrl)
      );

      const chapters = normalizeChapters(
        (data.view_points || []).map(item => ({
          title: String(item?.content || item?.title || item?.label || '').trim(),
          from: normalizeChapterTime(item?.from ?? item?.start ?? item?.start_time),
          to: normalizeChapterTime(item?.to ?? item?.end ?? item?.end_time)
        }))
      );

      return { subtitles, chapters };
    } catch (err) {
      console.warn(`[BiliAiNote] ${request.source} error:`, err.message);
      continue;
    }
  }

  // 所有源都失败
  return { subtitles: [], chapters: [] };
}

/**
 * 构建字幕 API 请求列表（双源策略）
 */
function buildSubtitleInfoRequests({ bvid, cid, aid }) {
  const safeBvid = encodeURIComponent(String(bvid || ''));
  const safeCid = encodeURIComponent(String(cid || ''));
  const safeAid = encodeURIComponent(String(aid || ''));
  const requests = [];

  // 主源：player/wbi/v2 用 aid 作为主标识
  if (aid) {
    requests.push({
      source: 'player-wbi-v2',
      url: `https://api.bilibili.com/x/player/wbi/v2?aid=${safeAid}&cid=${safeCid}&bvid=${safeBvid}`
    });
  }

  // 回退：player/v2 用 bvid 作为主标识
  requests.push({
    source: 'player-v2',
    url: `https://api.bilibili.com/x/player/v2?bvid=${safeBvid}&cid=${safeCid}` +
      (aid ? `&aid=${safeAid}` : '')
  });

  return requests;
}

/**
 * 获取字幕正文
 * CDN 域名 (hdslb.com) 响应头为 Access-Control-Allow-Origin: *
 * 不能带 credentials，否则 CORS 报错
 */
async function fetchSubtitleBody(url) {
  const normalizedUrl = normalizeSubtitleUrl(url);
  const isCdn = normalizedUrl.includes('hdslb.com');
  const resp = await fetch(normalizedUrl, {
    credentials: isCdn ? 'omit' : 'include',
    cache: 'no-store'
  });
  if (!resp.ok) {
    throw new Error(`字幕请求失败：${resp.status}`);
  }
  const data = await resp.json();
  return Array.isArray(data.body) ? data.body : [];
}

/**
 * 通用 JSON 请求
 */
async function fetchJson(url) {
  const resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!resp.ok) {
    throw new Error(`请求失败：${resp.status}`);
  }
  return resp.json();
}

/**
 * 标准化字幕 URL
 */
function normalizeSubtitleUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url.replace(/^\/+/, '')}`;
}

/**
 * 字幕语言优先级（数值越小越优先）
 * 中文 > 英文 > 其他
 */
function subtitlePriority(item) {
  const lan = String(item?.lan || '').toLowerCase();
  const label = String(item?.lanDoc || '').toLowerCase();

  if (lan === 'zh-cn' || lan === 'zh-hans') return 0;
  if (lan === 'zh') return 1;
  if (lan.includes('zh')) return 2;
  if (label.includes('中文')) return 3;

  if (lan === 'en' || lan === 'en-us' || lan === 'en-gb') return 10;
  if (lan.includes('en')) return 11;
  if (label.includes('英文') || label.includes('英语') || label.includes('english')) return 12;

  return 50;
}

/**
 * 提取 URL 的稳定部分（去掉 auth_key 等动态参数）
 */
function urlPathKey(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url || '').split('?')[0];
  }
}

/**
 * 按语言优先级排序字幕轨道，保证每次顺序一致
 */
function normalizeSubtitleTracks(subtitles) {
  return [...(subtitles || [])].sort((a, b) => {
    const p = subtitlePriority(a) - subtitlePriority(b);
    if (p !== 0) return p;

    const lanA = String(a.lanDoc || a.lan || '').toLowerCase();
    const lanB = String(b.lanDoc || b.lan || '').toLowerCase();
    if (lanA < lanB) return -1;
    if (lanA > lanB) return 1;

    const idA = Number.parseInt(String(a.id || '0'), 10);
    const idB = Number.parseInt(String(b.id || '0'), 10);
    if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) return idA - idB;

    // 用 URL path 比较，忽略 auth_key 等动态查询参数
    return urlPathKey(a.subtitleUrl).localeCompare(urlPathKey(b.subtitleUrl));
  });
}

/**
 * 标准化章节时间
 */
function normalizeChapterTime(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num > 60 * 60 * 24 ? num / 1000 : num;
}

/**
 * 标准化章节列表
 */
function normalizeChapters(chapters) {
  const normalized = (chapters || [])
    .map(item => ({
      title: String(item?.title || '').trim(),
      from: Number(item?.from || 0) || 0,
      to: Number(item?.to || 0) || 0
    }))
    .filter(item => item.title && item.from >= 0)
    .sort((a, b) => a.from - b.from);

  // 去重
  const unique = [];
  const seen = new Set();
  for (const item of normalized) {
    const key = `${Math.floor(item.from * 10)}|${item.title.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}

/**
 * 格式化日期
 */
function formatDate(timestamp) {
  const d = new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── 客户端访问地址（本地下载器 Tauri 服务）──

const CLIENT_DEFAULT_BASE = 'http://127.0.0.1:17563';

// 从设置读取客户端访问地址并归一化为 base（剥离旧版完整路径/尾部斜杠）
async function getClientBase() {
  return new Promise(resolve => {
    chrome.storage.local.get(['BiliAiNote_settings'], result => {
      const s = (result && result.BiliAiNote_settings) || {};
      let base = String(s.transcribeApiUrl || CLIENT_DEFAULT_BASE).trim().replace(/\/+$/, '');
      base = base.replace(/\/api\/zizai\/transcribe$/i, '').replace(/\/+$/, '');
      resolve(base || CLIENT_DEFAULT_BASE);
    });
  });
}

// 请求客户端接口：path 相对 base（如 /health、/api/download/start）
async function clientFetch(path, options = {}, timeoutMs = 8000) {
  const base = await getClientBase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(base + path, { ...options, signal: ctrl.signal });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!resp.ok) {
      const msg = (data && data.message) || `HTTP ${resp.status} ${resp.statusText}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ── 视频下载（委托客户端，轮询进度并推送）──

// tabId -> { stopped }：每个标签页同时只跟踪一个下载任务
let videoDownloadJobs = {};

async function videoDownloadStart(tabId, url, force, generateMp3) {
  const send = (msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

  // 同一标签页已有轮询任务时先停止旧轮询（客户端侧任务不受影响）
  if (videoDownloadJobs[tabId]) videoDownloadJobs[tabId].stopped = true;
  const job = { stopped: false };
  videoDownloadJobs[tabId] = job;

  try {
    const data = await clientFetch('/api/download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, generateMp3: generateMp3 !== false, force })
    }, 15000);

    if (job.stopped) return;
    const task = data?.task || {};
    if (task.status === 'completed') {
      send({ type: 'video-download-done', files: task.files || [], dir: task.dir || '' });
      return;
    }
    await pollVideoDownload(tabId, job, task.taskId);
  } catch (err) {
    if (!job.stopped) send({ type: 'video-download-error', error: err.message || String(err) });
  }
}

async function pollVideoDownload(tabId, job, taskId) {
  const send = (msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  const deadline = Date.now() + 30 * 60 * 1000;

  while (!job.stopped && Date.now() < deadline) {
    try {
      const data = await clientFetch(`/api/download/status/${encodeURIComponent(taskId)}`, { method: 'GET' }, 8000);
      if (job.stopped) return;
      const task = data?.task || {};
      switch (task.status) {
        case 'completed':
          send({ type: 'video-download-done', files: task.files || [], dir: task.dir || '' });
          return;
        case 'failed':
          send({ type: 'video-download-error', error: task.error || '下载失败' });
          return;
        case 'cancelled':
          send({ type: 'video-download-error', error: '下载已取消' });
          return;
        default:
          send({ type: 'video-download-progress', progress: task.progress || 0, status: task.status });
      }
    } catch (err) {
      if (job.stopped) return;
      send({ type: 'video-download-error', error: err.message || String(err) });
      return;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!job.stopped) send({ type: 'video-download-error', error: '下载超时' });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (videoDownloadJobs[tabId]) {
    videoDownloadJobs[tabId].stopped = true;
    delete videoDownloadJobs[tabId];
  }
});

// ── AI 文档总结（OpenAI 兼容接口） ──

// 读取「设置」中当前启用的 LLM 配置（多配置，同一时间仅启用一个）
// 返回 { apiBase, apiKey, model, name }；未启用时 apiBase 为空
async function aiGetConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(['BiliAiNote_settings'], result => {
      const s = (result && result.BiliAiNote_settings) || {};
      const configs = Array.isArray(s.llmConfigs) ? s.llmConfigs : [];
      const active = configs.find(c => c.id === s.llmActiveId);
      if (active) {
        resolve({
          apiBase: String(active.apiBase || '').replace(/\/+$/, ''),
          apiKey: active.apiKey || '',
          model: active.model || '',
          name: active.name || ''
        });
      } else {
        resolve({ apiBase: '', apiKey: '', model: '', name: '' });
      }
    });
  });
}

// 测试 LLM 连接：先 GET /models，失败（404/405 等不支持列表接口）再发最小 chat 请求
async function llmTestConnection(apiBase, apiKey, model) {
  const base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, error: 'API 地址为空' };
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
  };

  // 1) GET /models
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(`${base}/models`, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.ok) {
      let modelOk = !model;
      try {
        const data = await resp.json();
        const ids = (data.data || data.models || []).map(m => m.id || m.name || '');
        if (model && ids.length) modelOk = ids.includes(model);
      } catch {}
      return { ok: true, method: 'models', modelOk };
    }
    // 404/405：该服务未实现模型列表，降级 chat
    if (resp.status !== 404 && resp.status !== 405) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 200); } catch {}
      return { ok: false, error: `HTTP ${resp.status} ${resp.statusText}${detail ? ' - ' + detail : ''}` };
    }
  } catch (err) {
    // 网络层失败（含超时）：继续尝试 chat，仍失败则报网络错误
  }

  // 2) 最小 chat 请求
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false
      }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (resp.ok) return { ok: true, method: 'chat' };
    let detail = '';
    try { detail = (await resp.text()).slice(0, 200); } catch {}
    return { ok: false, error: `HTTP ${resp.status} ${resp.statusText}${detail ? ' - ' + detail : ''}` };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? '连接超时' : (err.message || String(err)) };
  }
}

// sceneId -> 系统提示词
const AI_SCENE_PROMPTS = {
  M001: `你是一个文档总结助手，请根据提供的视频字幕文档生成结构化的文档总结。

要求：
1. 仅依据字幕内容进行总结，不得添加、猜测或推断原文未提及的信息。
2. 提炼视频的核心主题、主要观点与关键内容，忽略寒暄、口头禅、广告、重复内容等无关信息。
3. 使用 Markdown 输出，包含「一句话概述」和「核心要点」（要点用列表呈现）两部分。
4. 表达自然流畅、客观中立，使用中文。

直接输出总结，不要输出任何额外说明。`,
  M002: `你是一个学习指导助手，请根据提供的视频字幕文档生成学习指导。

要求：
1. 仅依据字幕内容生成学习指导，不得补充原文之外的知识。
2. 使用 Markdown 输出，包含以下部分：
   - 「学习目标」：学完本视频应掌握的内容（列表）
   - 「知识脉络」：按视频内容顺序梳理知识结构（分级列表）
   - 「重点与难点」：需要重点关注或容易混淆的内容（列表）
   - 「学习建议」：如何巩固所学内容（列表）
3. 表达自然流畅、客观中立，使用中文。

直接输出学习指导，不要输出任何额外说明。`,
};

// requestId -> { ctrl, sceneId, senderTabId }
let aiRequests = {};

// <think>...</think> 剥离器（跨 chunk 边界安全）：
// 调用方（如「总结」页）不需要思考内容时，剥离标签与其中内容后仅下发正文
function aiCreateThinkStripper() {
  let inThink = false;
  let pending = '';

  // s 的最长后缀长度：该后缀同时是 tag 的前缀（用于保留被截断的标签等待下一块）
  function partialTagLen(s, tag) {
    const max = Math.min(s.length, tag.length - 1);
    for (let i = max; i > 0; i--) {
      if (s.slice(s.length - i) === tag.slice(0, i)) return i;
    }
    return 0;
  }

  let flush = () => {
    const rest = pending;
    pending = '';
    // 思考中残留的只可能是截断闭标签前缀，直接丢弃；正文模式则回吐（可能是普通文本）
    return inThink ? '' : rest;
  };

  const push = function (text) {
    pending += text;
    let out = '';
    for (;;) {
      if (inThink) {
        const close = pending.indexOf('</think>');
        if (close !== -1) {
          pending = pending.slice(close + 8);
          inThink = false;
          continue;
        }
        // 无完整闭标签：丢弃思考内容，仅保留可能是截断闭标签的尾巴
        const keep = partialTagLen(pending, '</think>');
        pending = pending.slice(pending.length - keep);
        return out;
      }
      const open = pending.indexOf('<think>');
      if (open !== -1) {
        out += pending.slice(0, open);
        pending = pending.slice(open + 7);
        inThink = true;
        continue;
      }
      const keep = partialTagLen(pending, '<think>');
      out += pending.slice(0, pending.length - keep);
      pending = pending.slice(pending.length - keep);
      return out;
    }
  };

  return { push, flush };
}

async function aiHandleGenerate(requestId, sceneId, content, senderTabId, promptOverride, wantThink) {
  const abortCtrl = new AbortController();
  aiRequests[requestId] = { ctrl: abortCtrl, sceneId, senderTabId };

  const send = (msg) => {
    chrome.tabs.sendMessage(senderTabId, { ...msg, requestId, sceneId }).catch(() => {});
  };

  // 不需要思考内容的调用方：剥离 <think>...</think> 后再下发
  const strip = wantThink ? null : aiCreateThinkStripper();
  const emitText = (text) => {
    const out = strip ? strip.push(text) : text;
    if (out) send({ type: 'ai-chunk', text: out });
  };
  // 流结束：回吐因疑似截断标签而暂存的正文尾巴
  const flushText = () => {
    if (strip) {
      const rest = strip.flush();
      if (rest) send({ type: 'ai-chunk', text: rest });
    }
  };

  try {
    const { apiBase, apiKey, model } = await aiGetConfig();
    if (!apiBase) {
      throw new Error('未启用 LLM 配置，请在「设置」中添加并启用');
    }

    const systemPrompt = (typeof promptOverride === 'string' && promptOverride.trim())
      ? promptOverride
      : (AI_SCENE_PROMPTS[sceneId] || AI_SCENE_PROMPTS.M001);

    const resp = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        stream: true,
      }),
      signal: abortCtrl.signal,
    });

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 200); } catch {}
      throw new Error(`HTTP ${resp.status} ${resp.statusText}${detail ? ' - ' + detail : ''}`);
    }

    if (!resp.body) {
      const text = await resp.text();
      if (text) emitText(text);
      flushText();
      send({ type: 'ai-done' });
      delete aiRequests[requestId];
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const parsed = aiParseStreamChunk(chunk, sseBuf);
      sseBuf = parsed.remainder;

      if (parsed.text) emitText(parsed.text);
    }

    if (sseBuf.trim()) {
      const tail = aiParseStreamChunk('\n', sseBuf);
      if (tail.text) emitText(tail.text);
    }

    flushText();
    send({ type: 'ai-done' });
  } catch (err) {
    if (err.name === 'AbortError') {
      send({ type: 'ai-aborted' });
    } else {
      send({ type: 'ai-error', error: err.message || String(err) });
    }
  } finally {
    delete aiRequests[requestId];
  }
}

function aiHandleAbort(requestId, sceneId) {
  // 优先按 requestId 终止；否则按 sceneId 终止当前 tab 的请求
  if (requestId && aiRequests[requestId]) {
    try { aiRequests[requestId].ctrl.abort(); } catch {}
    return;
  }
  for (const rid in aiRequests) {
    const entry = aiRequests[rid];
    if (entry.sceneId === sceneId) {
      try { entry.ctrl.abort(); } catch {}
    }
  }
}

// 解析流式 chunk：兼容 SSE（data: 行）与纯文本
function aiParseStreamChunk(chunk, prevBuf) {
  let buf = prevBuf + chunk;
  let text = '';
  let remainder = '';

  const hasSSE = /^data:\s/m.test(buf) || prevBuf.startsWith('data:');

  if (hasSSE) {
    const lines = buf.split('\n');
    remainder = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const obj = JSON.parse(payload);
        let piece =
          obj.content || obj.text || obj.delta || obj.message ||
          obj.choices?.[0]?.delta?.content ||
          obj.choices?.[0]?.message?.content ||
          '';
        // 推理模型：reasoning_content 包上 <think> 标签，由文档页拆分展示
        const reasoning =
          obj.choices?.[0]?.delta?.reasoning_content ||
          obj.choices?.[0]?.message?.reasoning_content ||
          '';
        if (reasoning) piece = `<think>${reasoning}</think>` + piece;
        if (piece) text += piece;
      } catch {
        text += payload;
      }
    }
  } else {
    text = buf;
    remainder = '';
  }

  return { text, remainder };
}

// ── 语音转写字幕（流式） ──

// 单例：同一时间只允许一个转写任务
let transcribeRequest = null;

async function transcribeHandleStart(requestId, videoUrl, audioPath, senderTabId) {
  const abortCtrl = new AbortController();
  transcribeRequest = { ctrl: abortCtrl, requestId, senderTabId };

  const send = (msg) => {
    chrome.tabs.sendMessage(senderTabId, { ...msg, requestId }).catch(() => {});
  };

  try {
    // 转写地址 = 客户端访问地址 + 固定路径
    const apiUrl = `${await getClientBase()}/api/zizai/transcribe`;

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl, ...(audioPath ? { audioPath } : {}) }),
      signal: abortCtrl.signal,
    });

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 200); } catch {}
      throw new Error(`HTTP ${resp.status} ${resp.statusText}${detail ? ' - ' + detail : ''}`);
    }

    if (!resp.body) {
      const text = await resp.text();
      if (text) send({ type: 'transcribe-chunk', text });
      send({ type: 'transcribe-done' });
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const parsed = transcribeParseStreamChunk(chunk, sseBuf);
      sseBuf = parsed.remainder;

      if (parsed.status) {
        send({
          type: 'transcribe-status',
          stage: parsed.status.stage || '',
          text: parsed.status.text || '',
          percent: Number.isFinite(parsed.status.percent) ? parsed.status.percent : null
        });
      }
      if (parsed.result) {
        send({
          type: 'transcribe-result',
          transcript: parsed.result.transcript,
          title: parsed.result.title,
          files: Array.isArray(parsed.result.files) ? parsed.result.files : []
        });
      }
    }

    if (sseBuf.trim()) {
      const tail = transcribeParseStreamChunk('\n', sseBuf);
      if (tail.status) {
        send({
          type: 'transcribe-status',
          stage: tail.status.stage || '',
          text: tail.status.text || '',
          percent: Number.isFinite(tail.status.percent) ? tail.status.percent : null
        });
      }
      if (tail.result) {
        send({
          type: 'transcribe-result',
          transcript: tail.result.transcript,
          title: tail.result.title,
          files: Array.isArray(tail.result.files) ? tail.result.files : []
        });
      }
    }

    send({ type: 'transcribe-done' });
  } catch (err) {
    if (err.name === 'AbortError') {
      send({ type: 'transcribe-aborted' });
    } else {
      send({ type: 'transcribe-error', error: err.message || String(err) });
    }
  } finally {
    if (transcribeRequest?.requestId === requestId) transcribeRequest = null;
  }
}

// 解析转写服务的 SSE 流：
// - {"type":"status","stage":"...","text":"...","percent":N} → UI 当前阶段
// - {"message":"...","type":"log"}     → 详细日志（仅诊断，不在 UI 展示）
// - {...,"transcript":[...],"type":"result"} → 结构化字幕（一次性下发）
// - ":"/{"type":"done"}                → 心跳/结束，忽略
// 非 SSE 纯文本响应则原样透传
function transcribeParseStreamChunk(chunk, prevBuf) {
  const buf = prevBuf + chunk;
  let logs = '';
  let status = null;
  let result = null;
  let remainder = '';

  const isSSE = /(^|\n)\s*(data:|:)/.test(buf);

  if (isSSE) {
    const lines = buf.split('\n');
    remainder = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // SSE 心跳/注释行
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const obj = JSON.parse(payload);
        if (obj.type === 'result' && Array.isArray(obj.transcript)) {
          result = obj;
        } else if (obj.type === 'status' && typeof obj.text === 'string') {
          status = obj;
        } else if (typeof obj.message === 'string' && obj.message) {
          // 详细日志仅保留解析兼容性，不再转发到字幕 UI
          logs += obj.message + '\n';
        }
      } catch {
        logs += payload + '\n';
      }
    }
  } else {
    logs = buf;
  }

  return { logs, status, result, remainder };
}

