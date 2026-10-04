// js/video-download.js - 视频页下载区模块
// 内容最上方显示下载入口：委托本地客户端（Tauri 下载器）下载视频+音频，
// 完成后展示文件链接（点击打开所在文件夹并定位），并与「字幕」页转写共用下载记录。
(function () {
  'use strict';

  window.BiliAiNote = window.BiliAiNote || {};

  const STORAGE_KEY = 'BiliAiNote_videoDownloads';
  const MAX_RECORDS = 100;
  const HELP_URL = 'https://www.yuque.com/yuxian-tgyyu/megc4v/dspf9gpytg3oqyxn';

  // 客户端在线状态：null = 未检测，true/false = 检测结果
  let clientOnline = null;
  // 当前视频下载中（含进度）
  let downloading = false;
  let downloadProgress = 0;
  let downloadError = '';
  let listenerAttached = false;

  // 与 subtitle.js buildVideoUrl 一致：去追踪参数，保留 ?p=
  function currentUrl() {
    try {
      const u = new URL(location.href);
      const p = u.searchParams.get('p');
      const clean = u.origin + u.pathname;
      return p && p !== '1' ? `${clean}?p=${encodeURIComponent(p)}` : clean;
    } catch {
      return location.href;
    }
  }

  function readMap() {
    return new Promise(resolve => {
      chrome.storage.local.get([STORAGE_KEY], result => {
        resolve((result && result[STORAGE_KEY]) || {});
      });
    });
  }

  function writeMap(map) {
    // 数量超限时按时间淘汰最旧记录
    const keys = Object.keys(map);
    if (keys.length > MAX_RECORDS) {
      keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
      for (const k of keys.slice(0, keys.length - MAX_RECORDS)) delete map[k];
    }
    return new Promise(resolve => {
      chrome.storage.local.set({ [STORAGE_KEY]: map }, resolve);
    });
  }

  async function getRecord(url) {
    const map = await readMap();
    return map[url] || null;
  }

  async function removeRecord(url) {
    const map = await readMap();
    delete map[url];
    await writeMap(map);
  }

  // 记录下载产物（视频/音频文件绝对路径）
  // 新 files 中缺少某类文件时沿用旧记录（如转写复用音频回写时只带 mp3，不应覆盖 videoFile）
  async function saveRecord(url, files, dir) {
    if (!Array.isArray(files) || !files.length) return;
    const map = await readMap();
    const prev = map[url] || {};
    map[url] = {
      files,
      dir: dir || prev.dir || '',
      videoFile: files.find(f => !/\.mp3$/i.test(f)) || prev.videoFile || files[0] || '',
      mp3File: files.find(f => /\.mp3$/i.test(f)) || prev.mp3File || '',
      at: Date.now()
    };
    await writeMap(map);
  }

  // 供字幕页转写去重：当前视频已下载的音频路径（无则空串）
  async function getAudioPath(url) {
    url = url || currentUrl();
    const record = await getRecord(url);
    return (record && record.mp3File) || '';
  }

  function checkClient() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'client-health' }, (resp) => {
          if (chrome.runtime.lastError) {
            clientOnline = false;
            resolve(false);
            return;
          }
          clientOnline = !!(resp && resp.ok);
          resolve(clientOnline);
        });
      } catch {
        clientOnline = false;
        resolve(false);
      }
    });
  }

  function revealFile(path) {
    chrome.runtime.sendMessage({ type: 'client-reveal', path }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (!resp || !resp.ok) {
        window.BiliAiNote.panel.showToast('打开文件夹失败：' + ((resp && resp.error) || '未知错误'));
      }
    });
  }

  // 是否需要同时生成 MP3：B 站无字幕（后续大概率要走语音转写）才生成，
  // 有字幕则只下载视频，避免多余的音频文件
  function needMp3() {
    const s = window.BiliAiNote.state;
    return !s.subtitles || s.subtitles.length === 0;
  }

  async function startDownload(force) {
    if (downloading) return;
    const url = currentUrl();
    downloading = true;
    downloadProgress = 0;
    downloadError = '';
    // 重新下载时先清除扩展中的旧文件记录，避免已删除文件仍显示为“已下载”
    if (force) await removeRecord(url);
    render();
    try {
      chrome.runtime.sendMessage(
        { type: 'video-download-start', url, force, generateMp3: needMp3() },
        (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            downloading = false;
            downloadError = resp?.error || chrome.runtime.lastError?.message || '无法启动下载';
            render();
          }
        }
      );
    } catch (e) {
      downloading = false;
      downloadError = '扩展已重新加载，请刷新本页面后重试';
      render();
    }
  }

  // ── 渲染 ──

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  async function render() {
    const container = document.getElementById('bn-video-download');
    if (!container) return;

    const record = await getRecord(currentUrl());
    const online = clientOnline === true;
    const checking = clientOnline === null;

    let html = '<div class="bn-video-download">';

    if (downloading) {
      const pct = Math.round((downloadProgress || 0) * 100);
      html += `
        <div class="bn-vd-row">
          <span class="bn-vd-status bn-vd-status-running"><span class="bn-dot bn-spinner"></span>下载中${pct > 0 ? `：${pct}%` : '…'}</span>
        </div>`;
    } else if (record) {
      const reDisabled = online ? '' : ' disabled';
      html += `
        <div class="bn-vd-row">
          <span class="bn-vd-status bn-vd-status-done"><span class="bn-dot bn-dot-green"></span>视频已下载到本地</span>
        </div>
        <div class="bn-vd-file" data-action="reveal" data-path="${escapeHtml(record.videoFile)}" title="${escapeHtml(record.videoFile)}">文件：${escapeHtml(record.videoFile)}</div>
        <div class="bn-vd-row bn-vd-row-redownload">
          <button class="bn-vd-btn" data-action="redownload"${reDisabled}>重新下载</button>
        </div>`;
    } else {
      const disabled = online ? '' : ' disabled';
      html += `
        <div class="bn-vd-row bn-vd-row-download">
          <button class="bn-vd-btn bn-vd-btn-primary" data-action="download"${disabled}>下载视频</button>
        </div>`;
    }

    if (downloadError) {
      html += `<div class="bn-vd-error">${escapeHtml(downloadError)}</div>`;
    }
    if (checking) {
      html += `<div class="bn-transcribe-client-hint">正在检测客户端…</div>`;
    } else if (!online) {
      html += `
        <div class="bn-transcribe-client-hint bn-client-unavailable">
          <span>请先启动BilibiliDownloader.exe客户端，如需下载</span>
          <a class="bn-transcribe-client-link" href="${HELP_URL}" target="_blank" rel="noopener noreferrer">点击下载客户端</a>
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;

    // 绑定点击事件（每次渲染重新绑定）
    container.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', () => {
        const action = el.dataset.action;
        if (action === 'download') startDownload(false);
        else if (action === 'redownload') startDownload(true);
        else if (action === 'reveal' && el.dataset.path) revealFile(el.dataset.path);
      });
    });
  }

  // 监听 background 推送的下载事件
  function attachListener() {
    if (listenerAttached) return;
    listenerAttached = true;
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        switch (msg.type) {
          case 'video-download-progress':
            downloadProgress = msg.progress || 0;
            render();
            break;
          case 'video-download-done':
            downloading = false;
            downloadError = '';
            saveRecord(currentUrl(), msg.files || [], msg.dir || '').then(() => {
              render();
              window.BiliAiNote.panel.showToast('视频已下载到本地');
            });
            break;
          case 'video-download-error':
            downloading = false;
            downloadError = msg.error || '下载失败';
            render();
            window.BiliAiNote.panel.showToast('下载失败：' + downloadError);
            break;
        }
      });
    } catch {}
  }

  // 刷新：检测客户端 + 重新渲染
  function refresh() {
    attachListener();
    if (clientOnline === null) {
      render(); // 先渲染一次（检测中状态，按钮禁用）
    }
    checkClient().then(() => render());
  }

  window.BiliAiNote.videoDownload = {
    refresh,
    render,
    getRecord,
    saveRecord,
    getAudioPath,
    checkClient
  };
})();
