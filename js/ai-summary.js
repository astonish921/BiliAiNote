// js/ai-summary.js - AI 文档总结/学习指导模块（通过 background 中转，支持流式）
(function () {
  'use strict';

  window.BiliAiNote = window.BiliAiNote || {};

  // 场景定义
  const SCENES = {
    M001: { id: 'M001', name: '文档总结' },
    M002: { id: 'M002', name: '学习指导' },
  };

  // 每个场景的运行时状态
  const runs = {
    M001: createRunState('M001'),
    M002: createRunState('M002'),
  };

  function createRunState(sceneId) {
    return {
      sceneId,
      state: 'idle',        // 'idle' | 'loading' | 'streaming' | 'done' | 'error' | 'aborted'
      text: '',
      error: '',
      requestId: null,
      listeners: { chunk: [], state: [], done: [], error: [] },
    };
  }

  function emit(run, event, data) {
    for (const fn of run.listeners[event]) {
      try { fn(data); } catch (e) { console.error('[BiliAiNote AISummary]', e); }
    }
  }

  function setState(run, newState) {
    if (run.state === newState) return;
    run.state = newState;
    emit(run, 'state', run.state);
  }

  function getRun(sceneId) {
    if (!runs[sceneId]) runs[sceneId] = createRunState(sceneId);
    return runs[sceneId];
  }

  // 扩展被重新加载/更新后，旧页面上残留的本脚本会失去与 background 的连接；
  // 此时任何 chrome.runtime 调用都会抛 "Extension context invalidated"。
  function runtimeAlive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  }

  function notifyContextInvalidated(run) {
    run.error = '扩展已重新加载，请刷新本页面后重试';
    emit(run, 'error', run.error);
    setState(run, 'error');
  }

  // 构建发送内容（与文档整理保持一致：使用 exportUtil 生成的 markdown）
  function buildContent() {
    const s = window.BiliAiNote.state;
    if (window.BiliAiNote.exportUtil) {
      return window.BiliAiNote.exportUtil.buildMarkdown(s);
    }
    // 降级：简单拼接字幕
    let md = '';
    if (s.title) md += `# ${s.title}\n\n`;
    const subtitleList = document.getElementById('bn-subtitle-list');
    if (subtitleList) {
      subtitleList.querySelectorAll('.bn-sub-item').forEach(item => {
        const time = item.querySelector('.bn-sub-time')?.textContent || '';
        const text = item.querySelector('.bn-sub-text')?.textContent || '';
        if (text) md += (time ? `[${time}] ` : '') + text + '\n';
      });
    }
    return md || '(无内容)';
  }

  // 发起流式请求（通过 background）
  function generate(sceneId) {
    const run = getRun(sceneId);
    if (run.state === 'loading' || run.state === 'streaming') return;

    run.text = '';
    run.error = '';
    run.requestId = null;
    setState(run, 'loading');

    const content = buildContent();

    if (!runtimeAlive()) {
      notifyContextInvalidated(run);
      return;
    }

    try {
      chrome.runtime.sendMessage(
        { type: 'ai-generate', sceneId, content },
        (resp) => {
          if (chrome.runtime.lastError) {
            run.error = chrome.runtime.lastError.message || '通信失败';
            emit(run, 'error', run.error);
            setState(run, 'error');
            return;
          }
          if (!resp || !resp.ok) {
            run.error = resp?.error || '请求失败';
            emit(run, 'error', run.error);
            setState(run, 'error');
            return;
          }
          run.requestId = resp.requestId;
        }
      );
    } catch (e) {
      // Extension context invalidated
      notifyContextInvalidated(run);
    }
  }

  // 监听 background 推送的消息
  try {
    chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type || !msg.sceneId) return;
    const run = runs[msg.sceneId];
    if (!run) return;
    // 若已有 requestId 则严格匹配，避免并发干扰
    if (run.requestId && msg.requestId && run.requestId !== msg.requestId) return;

    switch (msg.type) {
      case 'ai-chunk':
        if (run.state === 'loading') setState(run, 'streaming');
        run.text += msg.text;
        emit(run, 'chunk', msg.text);
        break;
      case 'ai-done':
        setState(run, 'done');
        emit(run, 'done', run.text);
        break;
      case 'ai-error':
        run.error = msg.error;
        emit(run, 'error', run.error);
        setState(run, 'error');
        break;
      case 'ai-aborted':
        setState(run, 'aborted');
        break;
    }
    });
  } catch {}

  // 中断
  function abort(sceneId) {
    const run = getRun(sceneId);
    try {
      if (runtimeAlive()) chrome.runtime.sendMessage({ type: 'ai-abort', sceneId, requestId: run.requestId });
    } catch {}
    setState(run, 'aborted');
  }

  // 清空
  function clear(sceneId) {
    const run = getRun(sceneId);
    if (run.state === 'loading' || run.state === 'streaming') {
      try {
        if (runtimeAlive()) chrome.runtime.sendMessage({ type: 'ai-abort', sceneId, requestId: run.requestId });
      } catch {}
    }
    run.text = '';
    run.error = '';
    run.requestId = null;
    setState(run, 'idle');
  }

  window.BiliAiNote.aiSummary = {
    SCENES,
    generate,
    abort,
    clear,
    getRun,
    getText: (sceneId) => getRun(sceneId).text,
    getState: (sceneId) => getRun(sceneId).state,
    onChunk: (sceneId, fn) => getRun(sceneId).listeners.chunk.push(fn),
    onStateChange: (sceneId, fn) => getRun(sceneId).listeners.state.push(fn),
    onDone: (sceneId, fn) => getRun(sceneId).listeners.done.push(fn),
    onError: (sceneId, fn) => getRun(sceneId).listeners.error.push(fn),
  };
})();
