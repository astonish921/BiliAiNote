// js/llm-doc.js - AI 文档整理模块（LLM 接口直连，任务工厂模式）
// 「文档」页专用：每个提示词（内置 summary/clear + 自定义）对应一个任务，
// 经 background 的 ai-generate 通道调用「设置」中已启用的 LLM，流式回传。
(function () {
  'use strict';
  const BN = window.BiliAiNote;
  if (!BN) return;

  // 任务存储：taskId -> task
  const tasks = {};

  function createTask(taskId) {
    const task = {
      id: taskId,
      state: 'ready', // 'ready' | 'generating' | 'done' | 'error'
      responseText: '',
      activeRequestId: null,
      listeners: { chunk: [], state: [], done: [], error: [] },
    };
    tasks[taskId] = task;
    return task;
  }

  // 自动保存缓存（供导出/历史页使用；思考内容不展示，think 恒为空）
  async function autoSaveCache(task) {
    const cache = window.BiliAiNote.cache;
    if (!cache) return;

    const s = window.BiliAiNote.state;
    const bvid = s.bvid;
    const pageIndex = s.pageIndex || 1;
    const title = document.title || '未知视频';
    const cleanTitle = title.replace(/_哔哩哔哩.*$/, '').trim();

    await cache.saveCache(
      bvid,
      pageIndex,
      cleanTitle,
      task.id,
      '',
      task.responseText.trim()
    );
  }

  function getTask(taskId) {
    if (!tasks[taskId]) createTask(taskId);
    return tasks[taskId];
  }

  function emit(task, event, data) {
    for (const fn of task.listeners[event]) {
      try { fn(data); } catch (e) { console.error('[BN-LlmDoc]', e); }
    }
  }

  function setState(task, newState) {
    if (task.state === newState) return;
    task.state = newState;
    emit(task, 'state', task.state);
  }

  // 发送 markdown 至已启用的 LLM（prompt 为该任务的系统提示词正文）
  // 不传 wantThink：思考内容由 background 剥离，文档页仅接收正文（单一输出窗口）
  function sendMarkdown(taskId, markdown, prompt) {
    const task = getTask(taskId);
    if (task.state === 'generating') return;

    task.responseText = '';
    setState(task, 'generating');

    const sceneId = 'doc_' + taskId;
    try {
      chrome.runtime.sendMessage(
        { type: 'ai-generate', sceneId, content: markdown, prompt },
        (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            const err = (resp && resp.error)
              || (chrome.runtime.lastError && chrome.runtime.lastError.message)
              || '请求失败';
            emit(task, 'error', err);
            setState(task, 'error');
            return;
          }
          task.activeRequestId = resp.requestId;
        }
      );
    } catch (e) {
      emit(task, 'error', '扩展已重新加载，请刷新本页面后重试');
      setState(task, 'error');
    }
  }

  // 处理 chunk：正文原样累积（思考内容已在 background 剥离）
  function processChunk(task, text) {
    if (!text) return;
    task.responseText += text;
    emit(task, 'chunk', { type: 'response', text });
  }

  function getResult(taskId) {
    const task = getTask(taskId);
    return { think: '', response: task.responseText.trim() };
  }

  function clear(taskId) {
    const task = getTask(taskId);
    task.responseText = '';
    setState(task, 'ready');
  }

  function abort(taskId) {
    const task = getTask(taskId);
    try {
      chrome.runtime.sendMessage({ type: 'ai-abort', sceneId: 'doc_' + taskId, requestId: task.activeRequestId });
    } catch {}
    task.activeRequestId = null;
    clear(taskId);
  }

  // 监听 background 推送的 ai-* 消息（仅处理 doc_ 前缀场景）
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || !msg.type || !msg.sceneId || !msg.sceneId.startsWith('doc_')) return;
      const taskId = msg.sceneId.slice(4);
      const task = tasks[taskId];
      if (!task) return;
      // 严格匹配 requestId，避免并行任务互相干扰
      if (task.activeRequestId && msg.requestId && task.activeRequestId !== msg.requestId) return;

      switch (msg.type) {
        case 'ai-chunk':
          processChunk(task, msg.text);
          break;
        case 'ai-done':
          setState(task, 'done');
          emit(task, 'done', getResult(taskId));
          autoSaveCache(task).catch(err => console.warn('[BiliAiNote Cache] Auto-save failed:', err));
          break;
        case 'ai-error':
          emit(task, 'error', msg.error);
          setState(task, 'error');
          break;
        case 'ai-aborted':
          clear(taskId);
          break;
      }
    });
  } catch {}

  // 初始化内置任务
  createTask('clear');
  createTask('summary');

  BN.llmDoc = {
    sendMarkdown,
    getTask,
    getResult,
    clear,
    abort,
    getState: (taskId) => getTask(taskId).state,
    onChunk: (taskId, fn) => getTask(taskId).listeners.chunk.push(fn),
    onStateChange: (taskId, fn) => getTask(taskId).listeners.state.push(fn),
    onDone: (taskId, fn) => getTask(taskId).listeners.done.push(fn),
    onError: (taskId, fn) => getTask(taskId).listeners.error.push(fn),
  };
})();
