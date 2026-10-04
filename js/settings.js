/**
 * BiliAiNote Settings Module
 * 读写 chrome.storage.local，管理设置项
 */
(function () {
  'use strict';

  window.BiliAiNote = window.BiliAiNote || {};

  const DEFAULTS = {
    frameStep: 0.2,
    autoScroll: true,
    pauseOnPreview: true,
    subtitleLang: '',
    downloadDir: '',
    lastOpenMode: 'panel',
    deepseekPrompt: '',
    deepseekPromptName: '',
    deepseekSummary: '',
    deepseekSummaryName: '',
    customPrompts: [],
    showFloatToolbar: true,
    defaultExpand: true,
    // 多 LLM 接口配置：[{id, name, apiBase, apiKey, model}]，同一时间仅启用一个（llmActiveId）
    llmConfigs: [],
    llmActiveId: '',
    // 客户端访问地址（base，如 http://127.0.0.1:17563），转写/下载路径由使用方拼接
    transcribeApiUrl: 'http://127.0.0.1:17563'
  };

  const DEFAULT_CHECKED = {
    title: true,
    author: true,
    date: true,
    duration: true,
    url: true,
    description: true,
    chapterTimestamp: false,
    subtitleTimestamp: false
  };

  // 客户端访问地址归一化：剥离旧版完整转写路径后缀与尾部斜杠
  function normalizeClientBase(url) {
    let base = String(url || '').trim().replace(/\/+$/, '');
    base = base.replace(/\/api\/zizai\/transcribe$/i, '');
    return base.replace(/\/+$/, '');
  }

  // 一次性迁移：旧版单 LLM 配置（aiApiBase/aiApiKey/aiModel）→ llmConfigs 首条配置
  function migrate(s, saved) {
    if ((!s.llmConfigs || !s.llmConfigs.length) && saved && saved.aiApiBase) {
      const config = {
        id: 'llm_' + Date.now().toString(36),
        name: '默认 LLM',
        apiBase: saved.aiApiBase,
        apiKey: saved.aiApiKey || '',
        model: saved.aiModel || ''
      };
      s.llmConfigs = [config];
      s.llmActiveId = config.id;
    }
    if (s.llmActiveId && !(s.llmConfigs || []).some(c => c.id === s.llmActiveId)) {
      s.llmActiveId = '';
    }
    s.transcribeApiUrl = normalizeClientBase(s.transcribeApiUrl);
  }

  // 获取当前启用的 LLM 配置；未启用返回 null
  function getActiveLlm() {
    const s = window.BiliAiNote.state.settings;
    const configs = s.llmConfigs || [];
    if (!s.llmActiveId) return null;
    return configs.find(c => c.id === s.llmActiveId) || null;
  }

  async function load() {
    return new Promise(resolve => {
      chrome.storage.local.get(['BiliAiNote_settings', 'BiliAiNote_videoInfoChecked'], result => {
        if (chrome.runtime.lastError) {
          console.warn('[BiliAiNote] Storage load error:', chrome.runtime.lastError);
          resolve({ ...DEFAULTS });
          return;
        }
        const saved = result.BiliAiNote_settings || {};
        Object.assign(window.BiliAiNote.state.settings, { ...DEFAULTS, ...saved });

        const savedChecked = result.BiliAiNote_videoInfoChecked || {};
        Object.assign(window.BiliAiNote.state.videoInfoChecked, { ...DEFAULT_CHECKED, ...savedChecked });

        // 迁移与归一化（迁移结果需要持久化，避免下次重复迁移）
        const before = JSON.stringify(window.BiliAiNote.state.settings);
        migrate(window.BiliAiNote.state.settings, saved);
        if (JSON.stringify(window.BiliAiNote.state.settings) !== before) {
          save();
        }

        resolve(window.BiliAiNote.state.settings);
      });
    });
  }

  async function save() {
    return new Promise(resolve => {
      const settings = window.BiliAiNote.state.settings;
      const checked = window.BiliAiNote.state.videoInfoChecked;
      chrome.storage.local.set({
        BiliAiNote_settings: { ...settings },
        BiliAiNote_videoInfoChecked: { ...checked }
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[BiliAiNote] Storage save error:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  function resetDefaults() {
    const s = window.BiliAiNote.state.settings;
    const preserved = {
      deepseekPrompt: s.deepseekPrompt,
      deepseekPromptName: s.deepseekPromptName,
      deepseekSummary: s.deepseekSummary,
      deepseekSummaryName: s.deepseekSummaryName,
      customPrompts: s.customPrompts,
      llmConfigs: s.llmConfigs,
      llmActiveId: s.llmActiveId,
      transcribeApiUrl: s.transcribeApiUrl,
    };
    Object.assign(s, { ...DEFAULTS }, preserved);
    Object.assign(window.BiliAiNote.state.videoInfoChecked, { ...DEFAULT_CHECKED });
    save();
  }

  window.BiliAiNote.settings = {
    load,
    save,
    resetDefaults,
    getActiveLlm,
    normalizeClientBase,
    DEFAULTS: { ...DEFAULTS }
  };
})();
