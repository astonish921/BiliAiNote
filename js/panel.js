/**
 * BiliAiNote Panel Module
 * 构建 UI 面板 DOM，管理标签页切换、折叠/展开、拖动
 */
(function () {
  'use strict';

  window.BiliAiNote = window.BiliAiNote || {};

  let panelEl = null;
  let mainWrapEl = null;
  let arrowEl = null;
  let maximizeEl = null;
  let headerEl = null;
  let footerEl = null;
  let collapseContainerEl = null;
  let tabs = [];
  let views = {};
  let panelMountMode = 'danmuku';
  let refreshDocUI = null; // 文档整理页刷新函数

  const TAB_DEFS = [
    { id: 'subtitle', label: '字幕' },
    { id: 'chapter', label: '章节' },
    { id: 'video', label: '视频' },
    { id: 'doc', label: '总结' },
    { id: 'setting', label: '设置' }
  ];

  // ── 创建面板 ──

  function createPanel() {
    const s = window.BiliAiNote.state;

    panelEl = document.createElement('div');
    panelEl.className = 'bn-panel bn-hidden';

    // Header
    headerEl = document.createElement('div');
    headerEl.className = 'bn-header';

    const tabGroup = document.createElement('div');
    tabGroup.className = 'bn-tab-group';
    tabs = TAB_DEFS.map(def => {
      const btn = document.createElement('button');
      btn.className = 'bn-tab' + (def.id === 'subtitle' ? ' bn-active' : '');
      btn.textContent = def.label;
      btn.dataset.tab = def.id;
      btn.addEventListener('click', () => switchTab(def.id));
      tabGroup.appendChild(btn);
      return { id: def.id, btn, def };
    });
    headerEl.appendChild(tabGroup);

    maximizeEl = document.createElement('button');
    maximizeEl.className = 'bn-maximize';
    maximizeEl.title = '放大';
    maximizeEl.setAttribute('aria-label', '放大');
    // 放大图标：四角向外箭头
    maximizeEl.innerHTML = `
      <svg class="bn-maximize-icon-expand" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      <svg class="bn-maximize-icon-restore" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
    `;
    maximizeEl.addEventListener('click', toggleMaximize);
    headerEl.appendChild(maximizeEl);

    arrowEl = document.createElement('button');
    arrowEl.className = 'bn-arrow';
    arrowEl.title = '收起';
    arrowEl.setAttribute('aria-label', '收起');
    // 展开状态箭头向上表示收起，收起后上下翻转表示展开
    arrowEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m8.001 6.812 3.359 3.359a.75.75 0 1 0 1.061-1.061L8.532 5.221a.75.75 0 0 0-1.061 0L3.582 9.11a.75.75 0 1 0 1.061 1.061l3.358-3.359z"/></svg>';
    arrowEl.addEventListener('click', toggleCollapse);
    headerEl.appendChild(arrowEl);

    panelEl.appendChild(headerEl);

    // Main
    mainWrapEl = document.createElement('div');
    mainWrapEl.className = 'bn-main';

    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'bn-scroll';

    TAB_DEFS.forEach(def => {
      const view = document.createElement('div');
      view.className = 'bn-view' + (def.id === 'subtitle' ? ' bn-show' : '');
      view.id = `bn-view-${def.id}`;
      if (def.id === 'subtitle') {
        view.innerHTML = `
          <div class="bn-search-bar" id="bn-search-bar">
            <svg class="bn-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="bn-search-input" placeholder="搜索字幕，点击结果跳转播放位置" autocomplete="off" spellcheck="false">
            <span class="bn-search-count" id="bn-search-count"></span>
            <button class="bn-search-nav" id="bn-search-prev" title="上一个 (Shift+Enter)" aria-label="上一个">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button class="bn-search-nav" id="bn-search-next" title="下一个 (Enter)" aria-label="下一个">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button class="bn-search-nav" id="bn-search-clear" title="清空 (Esc)" aria-label="清空">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div id="bn-subtitle-list"></div>
        `;
      } else if (def.id === 'chapter') {
        view.innerHTML = '<div id="bn-chapter-list"></div>';
      } else if (def.id === 'video') {
        view.innerHTML = '<div id="bn-video-download"></div><div id="bn-video-info"></div>';
      } else if (def.id === 'setting') {
        view.innerHTML = buildSettingHTML();
      } else if (def.id === 'doc') {
        view.innerHTML = buildDocHTML();
      }
      scrollWrap.appendChild(view);
      views[def.id] = view;
    });

    mainWrapEl.appendChild(scrollWrap);

    // 字幕页底部工具栏（在滚动容器外面，不随字幕滚动）
    footerEl = document.createElement('div');
    footerEl.className = 'bn-sub-footer';
    footerEl.innerHTML = `
      <div class="bn-lang-box">
        <button class="bn-lang-btn" id="bn-lang-trigger">
          <span id="bn-lang-label">暂无字幕</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div class="bn-lang-menu" id="bn-lang-menu"></div>
      </div>
      <button data-action="refresh">刷新</button>
      <button data-action="copy">复制</button>
      <div class="bn-more-box">
        <button class="bn-more-btn" id="bn-more-trigger" data-action="more" aria-expanded="false">
          <span>更多</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="bn-more-menu" id="bn-more-menu">
          <button data-action="export-srt">导出 SRT</button>
          <button data-action="download-md">下载 MD</button>
          <button data-action="clear-subtitle" id="bn-clear-subtitle">清空</button>
        </div>
      </div>
    `;
    mainWrapEl.appendChild(footerEl);

    panelEl.appendChild(mainWrapEl);

    mountPanelToDanmuku();

    // 监测面板是否被 Vue 重渲染移除，自动重新插入
    startPanelSurvival();

    // 阻止滚轮事件穿透到背景网页
    panelEl.addEventListener('wheel', (e) => {
      const el = e.target;
      // 找到最近的可滚动祖先
      const scrollable = el.closest('.bn-scroll, .bn-result-area, .bn-prompt-textarea, .bn-prompt-pre, .bn-sub-list, textarea, [style*="overflow"]');
      if (scrollable) {
        const { scrollTop, scrollHeight, clientHeight } = scrollable;
        const atTop = scrollTop <= 0 && e.deltaY < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
        // 可滚动元素在中间时，不阻止（让它自己滚动）
        if (!atTop && !atBottom) return;
      }
      // 不可滚动或已到边界，阻止默认行为防止背景滚动
      e.preventDefault();
    }, { passive: false });

    // 折叠浮动组件（icon + 快捷菜单）
    collapseContainerEl = document.createElement('div');
    collapseContainerEl.className = 'bn-collapse-container bn-hidden';

    const iconUrl = chrome.runtime.getURL('icons/icon-32.png');
    collapseContainerEl.innerHTML = `
      <div class="bn-collapse-icon" title="展开">
        <img src="${iconUrl}" alt="BiliAiNote">
      </div>
      <div class="bn-collapse-menu">
        <div class="bn-collapse-menu-item" data-action="add-snap" title="添加截图到字幕">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </div>
        <div class="bn-collapse-menu-divider"></div>
        <div class="bn-collapse-menu-item" data-action="download-snap" title="下载截图">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </div>
        <div class="bn-collapse-menu-divider"></div>
        <div class="bn-collapse-menu-item" data-action="copy-snap" title="复制截图到剪贴板">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </div>
      </div>
    `;

    // icon 点击 → 无操作（不再展开面板）
    collapseContainerEl.querySelector('.bn-collapse-icon').addEventListener('click', (e) => {
      e.stopPropagation();
      // 无操作
    });

    // 菜单项点击
    collapseContainerEl.querySelector('.bn-collapse-menu').addEventListener('click', onCollapseMenuClick);

    setupCollapseDrag(collapseContainerEl);
    document.body.appendChild(collapseContainerEl);

    // 绑定字幕页底部工具栏按钮
    const subFooter = panelEl.querySelector('.bn-sub-footer');
    if (subFooter) {
      subFooter.addEventListener('click', onFooterClick);
    }

    // 字幕搜索栏事件（输入防抖 + Enter/Esc 快捷键 + 上/下一个导航）
    bindSearchBar();

    // 点击面板其他区域时关闭“更多”菜单
    panelEl.addEventListener('click', (e) => {
      if (!e.target.closest('.bn-more-box')) closeMoreMenu();
    });

    // 语言切换下拉菜单
    const langTrigger = panelEl.querySelector('#bn-lang-trigger');
    const langMenu = panelEl.querySelector('#bn-lang-menu');
    if (langTrigger && langMenu) {
      langTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        langMenu.classList.toggle('show');
      });
      // 点击外部关闭菜单
      document.addEventListener('click', () => {
        langMenu.classList.remove('show');
      });
    }

    // 设置页事件绑定
    bindSettingEvents();

    // 填充版本号
    const versionEl = document.getElementById('bn-version');
    if (versionEl) versionEl.textContent = 'v' + chrome.runtime.getManifest().version;

    updateMaximizeUI();

    // 初始化显示状态（字幕页）
    switchTab('subtitle');
  }

  // ── 提示词模板 ──

  // ── 文档整理页 HTML ──

  // 内置提示词与「总结」页 AI_SCENE_PROMPTS（M001/M002）保持一致；
  // settings.deepseekSummary / deepseekPrompt 可覆盖正文，名称默认「文档总结」「学习指导」
  const DEFAULT_DEEPSEEK_PROMPT = `你是一个学习指导助手，请根据提供的视频字幕文档生成学习指导。

要求：
1. 仅依据字幕内容生成学习指导，不得补充原文之外的知识。
2. 使用 Markdown 输出，包含以下部分：
   - 「学习目标」：学完本视频应掌握的内容（列表）
   - 「知识脉络」：按视频内容顺序梳理知识结构（分级列表）
   - 「重点与难点」：需要重点关注或容易混淆的内容（列表）
   - 「学习建议」：如何巩固所学内容（列表）
3. 表达自然流畅、客观中立，使用中文。

待整理文档：

{markdown}

直接输出学习指导，不要输出任何额外说明。`;

  const DEFAULT_DEEPSEEK_SUMMARY = `你是一个文档总结助手，请根据提供的视频字幕文档生成结构化的文档总结。

要求：
1. 仅依据字幕内容进行总结，不得添加、猜测或推断原文未提及的信息。
2. 提炼视频的核心主题、主要观点与关键内容，忽略寒暄、口头禅、广告、重复内容等无关信息。
3. 使用 Markdown 输出，包含「一句话概述」和「核心要点」（要点用列表呈现）两部分。
4. 表达自然流畅、客观中立，使用中文。

待总结文档：

{markdown}

直接输出总结，不要输出任何额外说明。`;

  function buildDocHTML() {
    return buildDocAutoHTML();
  }

  function buildDocAutoHTML() {
    return `
      <div class="bn-doc-auto">
        <div class="bn-doc-header">
          <div class="bn-doc-title">AI 文档总结</div>
          <span id="bn-ds-status" class="bn-status bn-status-off"><span class="bn-dot bn-dot-red"></span>未启用</span>
        </div>
        <div class="bn-prompt-switcher" id="bn-prompt-switcher"></div>
        <div class="bn-doc-body">
          <pre id="bn-ds-prompt" class="bn-prompt-pre"></pre>
          <div id="bn-ds-result" class="bn-result-area" style="display:none"></div>
        </div>
        <div class="bn-doc-actions">
          <button id="bn-ds-action" class="bn-btn-primary">开始整理</button>
          <button id="bn-ds-download" class="bn-btn-primary" style="display:none">下载 Markdown</button>
          <button id="bn-ds-copy" style="display:none">复制</button>
          <button id="bn-ds-clear" style="display:none">清除</button>
        </div>
      </div>
    `;
  }

  // ── 设置页 HTML ──

  function buildSettingHTML() {
    return `
      <div id="bn-settings-main">
        <section class="bn-setting-section bn-setting-section-basic">
          <div class="bn-setting-group-title">基础信息</div>
          <div class="bn-setting-label">帧步长 <span class="bn-tooltip-icon" data-tooltip="帧步长控制逐帧浏览时每次移动的时间间隔。1/5 表示每帧 0.2 秒（适用于 5fps 视频），1/30 表示每帧约 0.033 秒（适用于 30fps 视频）。数值越小，帧精度越高。">?</span></div>
          <div class="bn-chip-group" data-setting="frameStep">
            <input type="radio" name="bn-frameStep" id="bn-fs1" value="1" checked><label for="bn-fs1">1/1</label>
            <input type="radio" name="bn-frameStep" id="bn-fs5" value="0.2"><label for="bn-fs5">1/5</label>
            <input type="radio" name="bn-frameStep" id="bn-fs15" value="0.066667"><label for="bn-fs15">1/15</label>
            <input type="radio" name="bn-frameStep" id="bn-fs30" value="0.033333"><label for="bn-fs30">1/30</label>
          </div>
          <div class="bn-switch">
            <span>字幕自动滚动</span>
            <input type="checkbox" id="bn-auto-scroll" checked>
            <label class="bn-switch-track" for="bn-auto-scroll"></label>
          </div>
          <div class="bn-switch">
            <span>预览截图暂停视频</span>
            <input type="checkbox" id="bn-pause-preview" checked>
            <label class="bn-switch-track" for="bn-pause-preview"></label>
          </div>
          <div class="bn-switch">
            <span>显示悬浮功能条</span>
            <input type="checkbox" id="bn-show-float-toolbar" checked>
            <label class="bn-switch-track" for="bn-show-float-toolbar"></label>
          </div>
          <div class="bn-switch">
            <span>默认展开面板</span>
            <input type="checkbox" id="bn-default-expand" checked>
            <label class="bn-switch-track" for="bn-default-expand"></label>
          </div>
        </section>
        <section class="bn-setting-section bn-setting-section-llm">
          <div class="bn-setting-group-header">
            <div class="bn-setting-group-title">LLM 接口 <span class="bn-tooltip-icon" data-tooltip="用于视频字幕总结分析。">?</span></div>
            <button class="bn-llm-add-btn" id="bn-llm-add-btn">＋ 添加 LLM</button>
          </div>
          <div id="bn-llm-list" class="bn-llm-list"></div>
          <div id="bn-llm-form" class="bn-llm-form" style="display:none">
            <input type="text" id="bn-llm-form-name" class="bn-ai-input" placeholder="配置名称，如 我的 DeepSeek" autocomplete="off" spellcheck="false">
            <input type="text" id="bn-llm-form-base" class="bn-ai-input" placeholder="API 地址，如 http://127.0.0.1:8071/v1" autocomplete="off" spellcheck="false">
            <input type="text" id="bn-llm-form-key" class="bn-ai-input" placeholder="API Key" autocomplete="off" spellcheck="false">
            <input type="text" id="bn-llm-form-model" class="bn-ai-input" placeholder="模型ID，如 deepseek-chat" autocomplete="off" spellcheck="false">
            <div class="bn-llm-form-actions">
              <button class="bn-setting-btn" id="bn-llm-form-test">测试连接</button>
              <button class="bn-setting-btn bn-btn-primary" id="bn-llm-form-save">保存</button>
              <button class="bn-setting-btn" id="bn-llm-form-cancel">取消</button>
            </div>
          </div>
        </section>
        <section class="bn-setting-section bn-setting-section-client">
          <div class="bn-setting-group-title">B站视频下载客户端地址 <span class="bn-tooltip-icon" data-tooltip="用于下载B站视频或提取音频后转写成字幕。">?</span></div>
          <div class="bn-ai-config">
            <input type="text" id="bn-transcribe-url" class="bn-ai-input" placeholder="如 http://127.0.0.1:17563" autocomplete="off" spellcheck="false">
          </div>
        </section>
        <div class="bn-setting-actions">
          <button class="bn-setting-btn" id="bn-reset-btn">恢复默认设置</button>
          <button class="bn-setting-btn" id="bn-open-options-btn">更多设置</button>
        </div>
        <div class="bn-about">
          <div class="bn-about-version">BiliAiNote <span id="bn-version"></span></div>
        </div>
      </div>
    `;
  }

  // ── 设置页事件 ──

  function bindSettingEvents() {
    // 帧步长
    panelEl.querySelectorAll('input[name="bn-frameStep"]').forEach(r => {
      r.addEventListener('change', () => {
        window.BiliAiNote.state.settings.frameStep = parseFloat(r.value);
        window.BiliAiNote.settings.save();
      });
    });

    // 自动滚动
    const autoScrollEl = panelEl.querySelector('#bn-auto-scroll');
    if (autoScrollEl) {
      autoScrollEl.addEventListener('change', () => {
        window.BiliAiNote.state.settings.autoScroll = autoScrollEl.checked;
        window.BiliAiNote.settings.save();
      });
    }

    // 预览暂停
    const pausePreviewEl = panelEl.querySelector('#bn-pause-preview');
    if (pausePreviewEl) {
      pausePreviewEl.addEventListener('change', () => {
        window.BiliAiNote.state.settings.pauseOnPreview = pausePreviewEl.checked;
        window.BiliAiNote.settings.save();
      });
    }

    // 显示悬浮功能条
    const showFloatToolbarEl = panelEl.querySelector('#bn-show-float-toolbar');
    if (showFloatToolbarEl) {
      showFloatToolbarEl.addEventListener('change', () => {
        window.BiliAiNote.state.settings.showFloatToolbar = showFloatToolbarEl.checked;
        window.BiliAiNote.settings.save();

        // 实时更新悬浮功能条显示状态
        if (showFloatToolbarEl.checked) {
          showCollapse();
        } else {
          hideCollapse();
        }
      });
    }

    // 默认展开面板
    const defaultExpandEl = panelEl.querySelector('#bn-default-expand');
    if (defaultExpandEl) {
      defaultExpandEl.addEventListener('change', () => {
        window.BiliAiNote.state.settings.defaultExpand = defaultExpandEl.checked;
        window.BiliAiNote.settings.save();
      });
    }

    // 客户端访问地址（失焦或回车时保存并归一化）
    const clientUrlEl = panelEl.querySelector('#bn-transcribe-url');
    if (clientUrlEl) {
      const persistClientUrl = () => {
        const val = window.BiliAiNote.settings.normalizeClientBase(clientUrlEl.value);
        clientUrlEl.value = val;
        if (window.BiliAiNote.state.settings.transcribeApiUrl === val) return;
        window.BiliAiNote.state.settings.transcribeApiUrl = val;
        window.BiliAiNote.settings.save();
        showToast('客户端访问地址已保存');
      };
      clientUrlEl.addEventListener('blur', persistClientUrl);
      clientUrlEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); clientUrlEl.blur(); }
      });
    }

    // LLM 多配置管理
    bindLlmConfigEvents();

    // 打开选项页面
    const openOptionsBtn = document.getElementById('bn-open-options-btn');
    if (openOptionsBtn) {
      openOptionsBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'open-options' });
      });
    }

    // 恢复默认
    const resetBtn = panelEl.querySelector('#bn-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        window.BiliAiNote.settings.resetDefaults();
        loadSettingsToUI();
        // 恢复悬浮功能条显示状态
        showCollapse();
        // 恢复面板展开状态（默认展开）
        window.BiliAiNote.state.collapsed = false;
        panelEl.classList.remove('bn-collapsed');
        if (arrowEl) arrowEl.classList.remove('bn-collapsed');
        // 重新渲染视频信息页（恢复默认勾选）
        if (window.BiliAiNote.videoInfo) {
          window.BiliAiNote.videoInfo.render();
        }
        // 重新渲染文档整理页面
        const docView = views['doc'];
        if (docView) {
          docView.innerHTML = buildDocHTML();
          bindDocEvents();
        }
        showToast('已恢复默认设置');
      });
    }

    // 文档整理页事件
    bindDocEvents();

    // AI 文档总结页事件
    bindAiSummaryEvents();
  }

  // ── LLM 多配置管理（设置页）──

  // 当前正在编辑的配置 id（null = 新增）
  let llmEditingId = null;

  function renderLlmConfigs() {
    const listEl = panelEl?.querySelector('#bn-llm-list');
    if (!listEl) return;
    const s = window.BiliAiNote.state.settings;
    const configs = s.llmConfigs || [];

    if (!configs.length) {
      listEl.innerHTML = '<div class="bn-llm-empty">暂无 LLM 配置，点击右上角「添加 LLM」</div>';
      return;
    }

    listEl.innerHTML = configs.map(c => {
      const active = c.id === s.llmActiveId;
      return `
        <div class="bn-llm-item${active ? ' active' : ''}" data-id="${escapeHtml(c.id)}">
          <div class="bn-llm-item-info">
            <span class="bn-llm-item-name">${escapeHtml(c.name || '未命名')}</span>
            <span class="bn-llm-item-model">${escapeHtml(c.model || '')}</span>
            ${active ? '<span class="bn-llm-item-badge">已启用</span>' : ''}
          </div>
          <div class="bn-llm-item-actions">
            <button data-action="toggle" title="${active ? '禁用' : '启用'}">${active ? '禁用' : '启用'}</button>
            <button data-action="test" title="测试连接">测试</button>
            <button data-action="edit" title="编辑">编辑</button>
            <button data-action="delete" title="删除">删除</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function llmOpenForm(config) {
    const formEl = panelEl?.querySelector('#bn-llm-form');
    if (!formEl) return;
    llmEditingId = config ? config.id : null;
    panelEl.querySelector('#bn-llm-form-name').value = config?.name || '';
    panelEl.querySelector('#bn-llm-form-base').value = config?.apiBase || '';
    panelEl.querySelector('#bn-llm-form-key').value = config?.apiKey || '';
    panelEl.querySelector('#bn-llm-form-model').value = config?.model || '';
    formEl.style.display = '';
    panelEl.querySelector('#bn-llm-form-name').focus();
  }

  function llmCloseForm() {
    const formEl = panelEl?.querySelector('#bn-llm-form');
    if (formEl) formEl.style.display = 'none';
    llmEditingId = null;
  }

  function bindLlmConfigEvents() {
    const listEl = panelEl.querySelector('#bn-llm-list');
    const addBtn = panelEl.querySelector('#bn-llm-add-btn');
    const formEl = panelEl.querySelector('#bn-llm-form');
    if (!listEl || !addBtn || !formEl) return;

    const saveBtn = panelEl.querySelector('#bn-llm-form-save');
    const cancelBtn = panelEl.querySelector('#bn-llm-form-cancel');
    const testBtn = panelEl.querySelector('#bn-llm-form-test');

    // 列表操作（事件委托）
    listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const item = btn.closest('.bn-llm-item');
      if (!item) return;
      const id = item.dataset.id;
      const s = window.BiliAiNote.state.settings;
      const configs = s.llmConfigs || [];
      const config = configs.find(c => c.id === id);
      if (!config) return;

      const action = btn.dataset.action;
      if (action === 'toggle') {
        // 单选语义：启用该配置 / 再次点击禁用
        s.llmActiveId = (s.llmActiveId === id) ? '' : id;
        window.BiliAiNote.settings.save();
        renderLlmConfigs();
        showToast(s.llmActiveId ? `已启用：${config.name || config.model}` : '已禁用 LLM');
      } else if (action === 'test') {
        btn.disabled = true;
        btn.textContent = '测试中…';
        chrome.runtime.sendMessage(
          { type: 'llm-test', apiBase: config.apiBase, apiKey: config.apiKey, model: config.model },
          (resp) => {
            btn.disabled = false;
            btn.textContent = '测试';
            if (resp && resp.ok) {
              showToast('连接成功');
            } else {
              showToast('连接失败：' + ((resp && resp.error) || '未知错误'));
            }
          }
        );
      } else if (action === 'edit') {
        llmOpenForm(config);
      } else if (action === 'delete') {
        s.llmConfigs = configs.filter(c => c.id !== id);
        if (s.llmActiveId === id) s.llmActiveId = '';
        window.BiliAiNote.settings.save();
        renderLlmConfigs();
        showToast('已删除');
      }
    });

    addBtn.addEventListener('click', () => llmOpenForm(null));

    cancelBtn.addEventListener('click', llmCloseForm);

    saveBtn.addEventListener('click', () => {
      const name = panelEl.querySelector('#bn-llm-form-name').value.trim();
      const apiBase = panelEl.querySelector('#bn-llm-form-base').value.trim().replace(/\/+$/, '');
      const apiKey = panelEl.querySelector('#bn-llm-form-key').value.trim();
      const model = panelEl.querySelector('#bn-llm-form-model').value.trim();
      if (!apiBase) { showToast('请填写 API 地址'); return; }
      if (!model) { showToast('请填写模型ID'); return; }

      const s = window.BiliAiNote.state.settings;
      const configs = s.llmConfigs || [];
      if (llmEditingId) {
        const config = configs.find(c => c.id === llmEditingId);
        if (config) Object.assign(config, { name: name || model, apiBase, apiKey, model });
      } else {
        const config = {
          id: 'llm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: name || model, apiBase, apiKey, model
        };
        configs.push(config);
        // 首个配置保存后自动启用，减少一次手动操作
        if (configs.length === 1) s.llmActiveId = config.id;
      }
      s.llmConfigs = configs;
      window.BiliAiNote.settings.save();
      renderLlmConfigs();
      llmCloseForm();
      showToast('已保存');
    });

    testBtn.addEventListener('click', () => {
      const apiBase = panelEl.querySelector('#bn-llm-form-base').value.trim().replace(/\/+$/, '');
      const apiKey = panelEl.querySelector('#bn-llm-form-key').value.trim();
      const model = panelEl.querySelector('#bn-llm-form-model').value.trim();
      if (!apiBase) { showToast('请填写 API 地址'); return; }
      testBtn.disabled = true;
      testBtn.textContent = '测试中…';
      chrome.runtime.sendMessage(
        { type: 'llm-test', apiBase, apiKey, model },
        (resp) => {
          testBtn.disabled = false;
          testBtn.textContent = '测试连接';
          if (resp && resp.ok) {
            showToast('连接成功');
          } else {
            showToast('连接失败：' + ((resp && resp.error) || '未知错误'));
          }
        }
      );
    });

    // 初始化渲染
    renderLlmConfigs();
  }

  // ── 文档整理页事件 ──

  function bindDocEvents() {
    bindDocAutoEvents();
  }

  function bindDocAutoEvents() {
    const ds = window.BiliAiNote.llmDoc;
    if (!ds) return;

    const statusEl = panelEl.querySelector('#bn-ds-status');
    const actionBtn = panelEl.querySelector('#bn-ds-action');
    const promptEl = panelEl.querySelector('#bn-ds-prompt');
    const resultEl = panelEl.querySelector('#bn-ds-result');
    const downloadBtn = panelEl.querySelector('#bn-ds-download');
    const copyBtn = panelEl.querySelector('#bn-ds-copy');
    const clearBtn = panelEl.querySelector('#bn-ds-clear');
    let savedScreenshots = {};
    let currentPromptType = 'summary';
    let autoScroll = true;

    // 当前启用的 LLM 配置（null = 未启用）
    function activeLlm() {
      return window.BiliAiNote.settings.getActiveLlm();
    }

    function truncateModelName(name, maxLength = 15) {
      const chars = Array.from(String(name || ''));
      return chars.length > maxLength ? chars.slice(0, maxLength).join('') + '...' : chars.join('');
    }

    // 渲染提示词切换按钮
    function renderPromptSwitcher() {
      const switcherEl = panelEl.querySelector('#bn-prompt-switcher');
      if (!switcherEl) return;
      const settings = window.BiliAiNote.state.settings;
      const customPrompts = settings.customPrompts || [];
      const summaryName = settings.deepseekSummaryName || '文档总结';
      const clearName = settings.deepseekPromptName || '学习指导';
      let html = `
        <button class="bn-prompt-btn${currentPromptType === 'summary' ? ' active' : ''}" data-prompt="summary">${escapeHtml(summaryName)}</button>
        <button class="bn-prompt-btn${currentPromptType === 'clear' ? ' active' : ''}" data-prompt="clear">${escapeHtml(clearName)}</button>
      `;
      customPrompts.forEach(p => {
        html += `<button class="bn-prompt-btn${currentPromptType === p.id ? ' active' : ''}" data-prompt="${p.id}">${escapeHtml(p.name)}</button>`;
        bindTaskEvents(p.id);
      });
      html += `<button class="bn-prompt-add-btn" id="bn-prompt-add-btn" title="新增提示词"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
      switcherEl.innerHTML = html;

      // 绑定按钮点击事件
      const promptBtns = switcherEl.querySelectorAll('.bn-prompt-btn');
      promptBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          promptBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentPromptType = btn.dataset.prompt;
          updatePromptPreview();
          refreshCurrentTaskUI();
        });
      });

      // 绑定"+"按钮点击事件 - 打开提示词管理
      const addBtn = switcherEl.querySelector('#bn-prompt-add-btn');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'open-options', section: 'prompts' });
        });
      }
    }

    // 提示词预览
    function updatePromptPreview() {
      if (!promptEl) return;
      if (currentPromptType === 'clear') {
        promptEl.textContent = window.BiliAiNote.state.settings.deepseekPrompt || DEFAULT_DEEPSEEK_PROMPT;
      } else if (currentPromptType === 'summary') {
        promptEl.textContent = window.BiliAiNote.state.settings.deepseekSummary || DEFAULT_DEEPSEEK_SUMMARY;
      } else {
        // 自定义提示词
        const customPrompts = window.BiliAiNote.state.settings.customPrompts || [];
        const custom = customPrompts.find(p => p.id === currentPromptType);
        promptEl.textContent = custom ? custom.prompt : '';
      }
    }

    // 刷新当前任务的UI
    function refreshCurrentTaskUI() {
      const task = ds.getTask(currentPromptType);
      updateUI(task.state);
      // 恢复结果内容（完成后按 Markdown 渲染，与「总结」页一致）
      if (resultEl) {
        setAiResultContent(resultEl, task.responseText, task.state === 'done');
      }
    }

    // 暴露给 switchTab 使用
    refreshDocUI = refreshCurrentTaskUI;

    // 已绑定事件的任务 ID 集合（防止重复绑定）
    const boundTaskIds = new Set();

    // 为任务绑定状态和 chunk 监听（包括自定义提示词）
    function bindTaskEvents(taskId) {
      if (boundTaskIds.has(taskId)) return;
      boundTaskIds.add(taskId);

      ds.onStateChange(taskId, (newState) => {
        if (taskId === currentPromptType) {
          updateUI(newState);
        }
      });

      // 流式输出：单一结果窗口，纯文本增量
      ds.onChunk(taskId, (chunk) => {
        if (taskId !== currentPromptType || chunk.type !== 'response' || !resultEl) return;
        if (resultEl.style.display === 'none') resultEl.style.display = '';
        setAiResultContent(resultEl, ds.getResult(taskId).response, false);
        if (autoScroll) resultEl.scrollTop = resultEl.scrollHeight;
      });

      // 完成：切换为 Markdown 渲染（HTML 效果，与「总结」页一致）
      ds.onDone(taskId, (result) => {
        if (taskId !== currentPromptType || !resultEl) return;
        resultEl.style.display = '';
        setAiResultContent(resultEl, result.response, true);
        if (autoScroll) resultEl.scrollTop = resultEl.scrollHeight;
      });
    }

    // 绑定内置任务
    ['clear', 'summary'].forEach(bindTaskEvents);

    // 绑定自定义提示词任务
    const initCustomPrompts = window.BiliAiNote.state.settings.customPrompts || [];
    initCustomPrompts.forEach(p => bindTaskEvents(p.id));

    // 渲染提示词切换按钮
    renderPromptSwitcher();
    updatePromptPreview();

    function updateUI(docState) {
      if (!statusEl) return;
      const llm = activeLlm();
      const fullDisplayName = llm ? String(llm.name || llm.model || '') : '';
      const shortDisplayName = truncateModelName(fullDisplayName);
      const stateMap = {
        'no_llm':    { cls: 'bn-status-off',  dot: 'bn-dot-red',   text: '未启用',            action: '设置' },
        'ready':     { cls: llm ? 'bn-status-ok' : 'bn-status-off', dot: llm ? 'bn-dot-green' : 'bn-dot-red', text: llm ? `已启用：${shortDisplayName}` : '未启用', action: llm ? '开始整理' : '设置' },
        'generating': { cls: 'bn-status-warn', dot: 'bn-spinner',   text: '整理中',            action: '停止整理' },
        'done':      { cls: 'bn-status-ok',   dot: 'bn-dot-green', text: '已完成',            action: null },
        'error':     { cls: 'bn-status-off',  dot: 'bn-dot-red',   text: '错误',              action: llm ? '重试' : '设置' },
      };
      // 未启用 LLM 时任何状态都以 no_llm 呈现（生成不可能进行）
      let state = docState;
      if (!llm && state !== 'generating') state = 'no_llm';
      const info = stateMap[state] || stateMap.no_llm;
      statusEl.className = `bn-status ${info.cls}`;
      statusEl.innerHTML = `<span class="${info.dot}"></span>${escapeHtml(info.text)}`;
      // 仅启用状态展示完整配置名称；其他状态不保留旧 tooltip
      statusEl.title = (state === 'ready' && fullDisplayName) ? `已启用：${fullDisplayName}` : '';

      if (actionBtn) {
        if (info.action) {
          actionBtn.textContent = info.action;
          actionBtn.style.display = '';
          actionBtn.disabled = false;
        } else {
          actionBtn.style.display = 'none';
        }
      }

      if (state === 'generating' || state === 'done') {
        if (promptEl) promptEl.style.display = 'none';
        if (resultEl && resultEl.style.display === 'none') resultEl.style.display = '';
      } else {
        if (promptEl) promptEl.style.display = '';
        if (resultEl) resultEl.style.display = 'none';
      }

      if (state === 'done') {
        if (downloadBtn) downloadBtn.style.display = '';
        if (copyBtn) copyBtn.style.display = '';
        if (clearBtn) clearBtn.style.display = '';
      } else {
        if (downloadBtn) downloadBtn.style.display = 'none';
        if (copyBtn) copyBtn.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
      }
    }

    // 初始化UI
    const initialTask = ds.getTask(currentPromptType);
    updateUI(initialTask.state);

    // 自动滚动：离开底部暂停，回到底部恢复
    const isAtBottom = (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 5;
    if (resultEl) {
      resultEl.addEventListener('scroll', () => { autoScroll = isAtBottom(resultEl); }, { passive: true });
    }

    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        const task = ds.getTask(currentPromptType);
        const currentState = task.state;
        const llm = activeLlm();

        if (!llm && currentState !== 'generating') {
          // 未启用 LLM：跳转设置页
          switchTab('setting');
          return;
        }
        if (currentState === 'generating') {
          ds.abort(currentPromptType);
          if (resultEl) setAiResultContent(resultEl, '', false);
        } else {
          // ready / error / done：开始或重试
          autoScroll = true;
          const s = window.BiliAiNote.state;
          savedScreenshots[currentPromptType] = s.screenshots ? new Map(s.screenshots) : null;
          const md = window.BiliAiNote.exportUtil
            ? window.BiliAiNote.exportUtil.buildMarkdown(s)
            : buildExportMarkdown();

          // 获取提示词
          let prompt;
          if (currentPromptType === 'clear') {
            prompt = s.settings.deepseekPrompt || DEFAULT_DEEPSEEK_PROMPT;
          } else if (currentPromptType === 'summary') {
            prompt = s.settings.deepseekSummary || DEFAULT_DEEPSEEK_SUMMARY;
          } else {
            // 自定义提示词
            const customPrompts = s.settings.customPrompts || [];
            const custom = customPrompts.find(p => p.id === currentPromptType);
            prompt = custom ? custom.prompt : '';
          }
          ds.sendMarkdown(currentPromptType, md, prompt);
        }
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        downloadResult(ds, savedScreenshots[currentPromptType], currentPromptType);
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const result = ds.getResult(currentPromptType);
        if (result.response) navigator.clipboard.writeText(result.response).then(() => showToast('已复制'));
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        ds.clear(currentPromptType);
        savedScreenshots[currentPromptType] = null;

        // 同步清除缓存（仅移除当前 promptType，不影响其他类型）
        const cache = window.BiliAiNote.cache;
        if (cache) {
          const s = window.BiliAiNote.state;
          await cache.removePromptType(s.bvid, s.pageIndex || 1, currentPromptType);
        }

        if (resultEl) setAiResultContent(resultEl, '', false);
      });
    }

    // 监听存储变化，实时更新提示词切换按钮与 LLM 启用状态
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.BiliAiNote_settings) {
        const newSettings = changes.BiliAiNote_settings.newValue || {};
        // 更新内存中的设置
        Object.assign(window.BiliAiNote.state.settings, newSettings);
        // 重新渲染提示词切换按钮与状态徽章（启用模型可能变化）
        renderPromptSwitcher();
        updatePromptPreview();
        refreshCurrentTaskUI();
      }
    });
  }

  function sanitize(str) {
    return String(str || 'untitled')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  // 根据 taskId 获取提示词名称
  function getPromptName(taskId) {
    const settings = window.BiliAiNote.state.settings;
    if (taskId === 'clear') return settings.deepseekPromptName || '学习指导';
    if (taskId === 'summary') return settings.deepseekSummaryName || '文档总结';
    const customPrompts = settings.customPrompts || [];
    const custom = customPrompts.find(p => p.id === taskId);
    return custom ? custom.name : '整理结果';
  }

  // 获取提示词的打包图片设置
  function getPromptPackImages(taskId) {
    const settings = window.BiliAiNote.state.settings;
    if (taskId === 'clear' || taskId === 'summary') {
      const packImagesMap = settings.promptPackImages || {};
      return packImagesMap[taskId] ?? (taskId === 'clear');
    }
    const customPrompts = settings.customPrompts || [];
    const custom = customPrompts.find(p => p.id === taskId);
    return custom ? (custom.packImages ?? false) : false;
  }

  // 生成下载文件名：视频标题_提示词名
  function buildDownloadFilename(taskId) {
    const s = window.BiliAiNote.state;
    const videoTitle = s.title || 'note';
    const promptName = getPromptName(taskId);
    return sanitize(`${videoTitle}_${promptName}`);
  }

  async function downloadResult(ds, savedScreenshots, taskId = 'clear') {
    const result = ds.getResult(taskId);
    if (!result.response) return;
    const shots = savedScreenshots;
    const filename = buildDownloadFilename(taskId);
    const packImages = getPromptPackImages(taskId);
    const hasScreenshots = packImages && shots && shots.size > 0;
    if (hasScreenshots && typeof JSZip !== 'undefined') {
      const zip = new JSZip();
      zip.file('note.md', result.response);
      for (const [index, { blob, timeCode }] of shots) {
        const tc = timeCode || '0000';
        zip.file(`assets/${tc}.png`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([result.response], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function buildExportMarkdown() {
    // 构建导出的 markdown 内容
    const s = window.BiliAiNote.state;
    let md = '';
    if (s.title) md += `# ${s.title}\n\n`;
    // 从字幕列表获取内容
    const subtitleList = document.getElementById('bn-subtitle-list');
    if (subtitleList) {
      const items = subtitleList.querySelectorAll('.bn-sub-item');
      items.forEach(item => {
        const time = item.querySelector('.bn-sub-time')?.textContent || '';
        const text = item.querySelector('.bn-sub-text')?.textContent || '';
        if (text) md += (time ? `[${time}] ` : '') + text + '\n';
      });
    }
    return md || '(无内容)';
  }

  function resetDocAuto() {
    const ds = window.BiliAiNote.llmDoc;
    if (ds) {
      ds.abort('clear');
      ds.abort('summary');
    }
    const resultEl = panelEl?.querySelector('#bn-ds-result');
    if (resultEl) setAiResultContent(resultEl, '', false);
  }

  function renderDoc() {
    // No-op: manual mode removed, auto mode handles its own rendering
  }

  // ── AI 文档总结页 HTML ──

  function buildAiSummaryHTML() {
    return `
      <div class="bn-aisummary">
        <div class="bn-doc-header">
          <div class="bn-doc-title">AI 文档总结</div>
          <span id="bn-ai-status" class="bn-status bn-status-off"><span class="bn-dot bn-dot-red"></span>空闲</span>
        </div>
        <div class="bn-prompt-switcher" id="bn-ai-scene-switcher">
          <button class="bn-prompt-btn active" data-scene="M001">文档总结</button>
          <button class="bn-prompt-btn" data-scene="M002">学习指导</button>
        </div>
        <div class="bn-doc-body">
          <div id="bn-ai-result" class="bn-result-area" style="display:none"></div>
        </div>
        <div class="bn-doc-actions">
          <button id="bn-ai-action" class="bn-btn-primary">开始生成</button>
          <button id="bn-ai-download" class="bn-btn-primary" style="display:none">下载 Markdown</button>
          <button id="bn-ai-copy" style="display:none">复制</button>
          <button id="bn-ai-clear" style="display:none">清除</button>
        </div>
      </div>
    `;
  }

  // ── AI 文档总结页事件 ──

  function bindAiSummaryEvents() {
    const ai = window.BiliAiNote.aiSummary;
    if (!ai) return;

    const statusEl = panelEl.querySelector('#bn-ai-status');
    const resultEl = panelEl.querySelector('#bn-ai-result');
    const actionBtn = panelEl.querySelector('#bn-ai-action');
    const downloadBtn = panelEl.querySelector('#bn-ai-download');
    const copyBtn = panelEl.querySelector('#bn-ai-copy');
    const clearBtn = panelEl.querySelector('#bn-ai-clear');
    const switcherEl = panelEl.querySelector('#bn-ai-scene-switcher');

    // 当前展示的场景（默认文档总结）
    let currentSceneId = 'M001';
    let autoScroll = true;

    const STATUS_MAP = {
      idle:      { cls: 'bn-status-off',  dot: 'bn-dot-red',   text: '空闲',   action: '开始生成' },
      loading:   { cls: 'bn-status-warn', dot: 'bn-spinner',   text: '请求中', action: '停止生成' },
      streaming: { cls: 'bn-status-warn', dot: 'bn-spinner',   text: '生成中', action: '停止生成' },
      done:      { cls: 'bn-status-ok',   dot: 'bn-dot-green', text: '已完成', action: null },
      error:     { cls: 'bn-status-off',  dot: 'bn-dot-red',   text: '错误',   action: '重试' },
      aborted:   { cls: 'bn-status-off',  dot: 'bn-dot-red',   text: '已停止', action: '开始生成' },
    };

    // 刷新当前场景的 UI（状态徽章 + 按钮显隐 + 结果区恢复）
    function refreshCurrentSceneUI() {
      const state = ai.getState(currentSceneId);
      const info = STATUS_MAP[state] || STATUS_MAP.idle;

      if (statusEl) {
        statusEl.className = `bn-status ${info.cls}`;
        statusEl.innerHTML = `<span class="${info.dot}"></span>${info.text}`;
      }

      // 主操作按钮
      if (actionBtn) {
        if (info.action) {
          actionBtn.textContent = info.action;
          actionBtn.style.display = '';
          actionBtn.disabled = false;
        } else {
          actionBtn.style.display = 'none';
        }
      }

      // 完成后展示下载/复制/清除
      const hasResult = !!(resultEl && resultEl.textContent);
      if (downloadBtn) downloadBtn.style.display = (state === 'done') ? '' : 'none';
      if (copyBtn) copyBtn.style.display = (state === 'done') ? '' : 'none';
      if (clearBtn) clearBtn.style.display = (state === 'done' || state === 'error' || hasResult) ? '' : 'none';

      // 结果区域显隐 + 内容恢复
      if (resultEl) {
        const showStates = ['loading', 'streaming', 'done', 'error', 'aborted'];
        if (showStates.includes(state) || ai.getText(currentSceneId)) {
          resultEl.style.display = '';
        } else {
          resultEl.style.display = 'none';
        }
        // 恢复当前场景已累积的文本；完成后按 Markdown 渲染
        setAiResultContent(resultEl, ai.getText(currentSceneId), state === 'done');
      }
    }

    // 为两个场景绑定监听（各场景独立累积文本，切换 tab 时恢复）
    Object.keys(ai.SCENES).forEach(sceneId => {
      ai.onStateChange(sceneId, (newState) => {
        if (sceneId === currentSceneId) {
          refreshCurrentSceneUI();
          if (newState === 'done' && resultEl) {
            setAiResultContent(resultEl, ai.getText(sceneId), true);
          }
        }
      });
      ai.onChunk(sceneId, (text) => {
        if (sceneId !== currentSceneId) return;
        if (resultEl) {
          if (resultEl.style.display === 'none') resultEl.style.display = '';
          setAiResultContent(resultEl, ai.getText(sceneId), false);
          if (autoScroll) resultEl.scrollTop = resultEl.scrollHeight;
        }
      });
      ai.onError(sceneId, (err) => {
        if (sceneId !== currentSceneId) return;
        if (resultEl) {
          resultEl.style.display = '';
          setAiResultContent(resultEl, '❌ 请求失败：' + err, false);
        }
      });
    });

    // 场景切换（tab 切换，不清空内容）
    if (switcherEl) {
      switcherEl.querySelectorAll('.bn-prompt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          switcherEl.querySelectorAll('.bn-prompt-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentSceneId = btn.dataset.scene;
          autoScroll = true;
          refreshCurrentSceneUI();
        });
      });
    }

    // 自动滚动：离开底部暂停，回到底部恢复（与文档整理一致）
    if (resultEl) {
      const isAtBottom = (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 5;
      resultEl.addEventListener('scroll', () => { autoScroll = isAtBottom(resultEl); }, { passive: true });
    }

    // 主操作按钮：开始 / 停止 / 重试
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        const state = ai.getState(currentSceneId);
        if (state === 'loading' || state === 'streaming') {
          // 停止
          ai.abort(currentSceneId);
        } else {
          // 开始 / 重试
          autoScroll = true;
          if (resultEl) setAiResultContent(resultEl, '', false);
          ai.generate(currentSceneId);
        }
      });
    }

    // 下载
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        const text = ai.getText(currentSceneId);
        if (!text) return;
        const sceneName = ai.SCENES[currentSceneId]?.name || 'AI';
        const s = window.BiliAiNote.state;
        const videoTitle = (s.title || 'note').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${videoTitle}_${sceneName}.md`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // 复制
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const text = ai.getText(currentSceneId);
        if (text) navigator.clipboard.writeText(text).then(() => showToast('已复制'));
      });
    }

    // 清除（仅清除当前场景）
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        ai.clear(currentSceneId);
        if (resultEl) { setAiResultContent(resultEl, '', false); resultEl.style.display = 'none'; }
        refreshCurrentSceneUI();
      });
    }

    // 初始化
    refreshCurrentSceneUI();
  }

  // ── 加载设置到 UI ──

  function loadSettingsToUI() {
    const s = window.BiliAiNote.state.settings;
    const setRadio = (name, value) => {
      const r = panelEl.querySelector(`input[name="${name}"][value="${value}"]`);
      if (r) r.checked = true;
    };
    setRadio('bn-frameStep', String(s.frameStep));

    const autoScrollEl = panelEl.querySelector('#bn-auto-scroll');
    if (autoScrollEl) autoScrollEl.checked = s.autoScroll;

    const pausePreviewEl = panelEl.querySelector('#bn-pause-preview');
    if (pausePreviewEl) pausePreviewEl.checked = s.pauseOnPreview;

    const showFloatToolbarEl = panelEl.querySelector('#bn-show-float-toolbar');
    if (showFloatToolbarEl) showFloatToolbarEl.checked = s.showFloatToolbar !== false;

    const defaultExpandEl = panelEl.querySelector('#bn-default-expand');
    if (defaultExpandEl) defaultExpandEl.checked = s.defaultExpand !== false;

    // LLM 多配置列表 + 客户端访问地址
    renderLlmConfigs();
    const transcribeEl = panelEl.querySelector('#bn-transcribe-url');
    if (transcribeEl) transcribeEl.value = s.transcribeApiUrl || '';
  }

  // ── 标签页切换 ──

  function switchTab(tabId) {
    const s = window.BiliAiNote.state;
    s.activeTab = tabId;

    tabs.forEach(t => {
      t.btn.classList.toggle('bn-active', t.id === tabId);
    });

    Object.keys(views).forEach(id => {
      views[id].classList.toggle('bn-show', id === tabId);
    });

    // 底部工具栏只在字幕页显示
    if (footerEl) {
      footerEl.classList.toggle('bn-show', tabId === 'subtitle');
    }

    // 点击文档整理标签时加载缓存并恢复任务状态 UI
    if (tabId === 'doc') {
      const ds = window.BiliAiNote.llmDoc;
      const cache = window.BiliAiNote.cache;

      if (ds && cache) {
        // bvid/pageIndex 兜底从 URL 提取（字幕刷新尚未完成时也能命中缓存）
        const subtitleMod = window.BiliAiNote.subtitle;
        const bvid = s.bvid || (subtitleMod && subtitleMod.extractBvid ? subtitleMod.extractBvid(location.href) : '');
        const pageIndex = s.pageIndex || (subtitleMod && subtitleMod.extractPageIndex ? subtitleMod.extractPageIndex(location.href) : 1);

        if (bvid) {
          cache.getCache(bvid, pageIndex).then(cached => {
            if (cached) {
              Object.keys(cached).forEach(promptType => {
                const task = ds.getTask(promptType);
                const data = cached[promptType];
                // 正在生成中的任务不覆盖
                if (task.state === 'generating') return;
                task.responseText = data.response;
                // Direct assignment is intentional here: we're hydrating from cache before
                // any listeners are active, and refreshDocUI() is called immediately after.
                task.state = 'done';
              });
            }
            if (refreshDocUI) refreshDocUI();
          });
        } else if (refreshDocUI) {
          refreshDocUI();
        }
      } else if (ds) {
        if (refreshDocUI) refreshDocUI();
      }
    }

    // 切到视频页时刷新下载区状态
    if (tabId === 'video' && window.BiliAiNote.videoDownload) {
      window.BiliAiNote.videoDownload.refresh();
    }
  }

  // ── 折叠/展开 ──

  let isDraggingCollapse = false;
  const BTN_SIZE = 36;
  const EDGE_MARGIN = 20; // 距右边界的距离，避免覆盖滚动条

  function clamp(val, min, max) {
    return Math.max(min, Math.min(val, max));
  }

  // 保存/恢复 icon 位置
  let savedIconLeft = null;
  let savedIconTop = null;

  function toggleCollapse() {
    if (!panelEl) createPanel();
    const s = window.BiliAiNote.state;
    s.collapsed = !s.collapsed;

    if (s.collapsed) {
      // 收起：隐藏主内容区域，显示扁平标签导航条
      panelEl.classList.add('bn-collapsed');
      if (arrowEl) arrowEl.classList.add('bn-collapsed');
      // 记住用户选择的模式
      window.BiliAiNote.state.settings.lastOpenMode = 'collapsed';
      window.BiliAiNote.settings.save();
    } else {
      // 展开：显示主内容区域
      panelEl.classList.remove('bn-collapsed');
      if (arrowEl) arrowEl.classList.remove('bn-collapsed');
      // 记住用户选择的模式
      window.BiliAiNote.state.settings.lastOpenMode = 'panel';
      window.BiliAiNote.settings.save();
      loadSettingsToUI();
      // 自动加载字幕
      const currentBvid = window.BiliAiNote.subtitle?.extractBvid(location.href) || '';
      if (window.BiliAiNote.subtitle && (!s.bvid || s.bvid !== currentBvid)) {
        window.BiliAiNote.subtitle.refresh();
      }
    }
  }

  // ── 折叠菜单点击 ──

  async function onCollapseMenuClick(e) {
    const item = e.target.closest('.bn-collapse-menu-item');
    if (!item) return;
    e.stopPropagation();

    const action = item.dataset.action;
    const capture = window.BiliAiNote.capture;
    const subtitle = window.BiliAiNote.subtitle;
    const video = subtitle?.getVideoElement();

    if (!video) {
      showToast('未找到视频元素');
      return;
    }

    if (action === 'add-snap') {
      // 如果字幕未加载，先刷新
      if (!window.BiliAiNote.state.subtitleBody.length) {
        showToast('正在获取字幕...');
        await subtitle.refresh();
      }
      // 找到当前时间对应的字幕
      const activeIndex = subtitle.findActiveIndex(video.currentTime);
      if (activeIndex >= 0) {
        await capture.addScreenshot(activeIndex);
      } else {
        showToast('当前时间无对应字幕');
      }
    } else if (action === 'download-snap') {
      try {
        const blob = await capture.captureFrame(video);
        capture.saveToFile(blob, capture.generateDownloadFilename(video.currentTime));
        showToast('截图已保存');
      } catch (err) {
        showToast('截图失败：' + err.message);
      }
    } else if (action === 'copy-snap') {
      try {
        const blob = await capture.captureFrame(video);
        const ok = await capture.copyToClipboard(blob);
        showToast(ok ? '已复制到剪贴板' : '复制失败');
      } catch (err) {
        showToast('复制失败：' + err.message);
      }
    }
  }

  // ── 折叠按钮拖动 ──

  function setupCollapseDrag(el) {
    let isDragging = false;
    let hasMoved = false;
    let offsetX = 0, offsetY = 0;
    let startX = 0, startY = 0;

    el.addEventListener('mousedown', (e) => {
      // 只有点击 icon 区域才触发拖动
      if (!e.target.closest('.bn-collapse-icon')) return;
      isDragging = true;
      hasMoved = false;
      isDraggingCollapse = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      // 5px 距离阈值，避免微小移动误判为拖动
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) <= 5) return;
      hasMoved = true;
      isDraggingCollapse = true;
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      let x = e.clientX - offsetX;
      let y = e.clientY - offsetY;
      x = clamp(x, EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
      y = clamp(y, EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      savedIconLeft = x;
      savedIconTop = y;
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      hasMoved = false;
    });
  }

  // ── 面板拖动 ──

  function setupDrag(handle) {
    let isDragging = false;
    let offsetX = 0, offsetY = 0;

    handle.addEventListener('mousedown', (e) => {
      if (panelEl.classList.contains('bn-maximized')) return;
      if (e.target.classList.contains('bn-tab') || e.target.classList.contains('bn-arrow') || e.target.classList.contains('bn-maximize')) return;
      isDragging = true;
      const rect = panelEl.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      let x = e.clientX - offsetX;
      let y = e.clientY - offsetY;
      const rect = panelEl.getBoundingClientRect();
      x = Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - rect.width - EDGE_MARGIN));
      y = Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - rect.height - EDGE_MARGIN));
      panelEl.style.left = x + 'px';
      panelEl.style.top = y + 'px';
      panelEl.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // ── Footer 按钮 ──

  function closeMoreMenu() {
    const menu = panelEl?.querySelector('#bn-more-menu');
    const trigger = panelEl?.querySelector('#bn-more-trigger');
    if (menu) menu.classList.remove('show');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function updateMoreMenuState() {
    const clearBtn = panelEl?.querySelector('#bn-clear-subtitle');
    const subtitle = window.BiliAiNote.subtitle;
    if (clearBtn) {
      const canClear = !!(subtitle && subtitle.isTranscribedSubtitle && subtitle.isTranscribedSubtitle());
      clearBtn.disabled = !canClear;
      clearBtn.title = canClear ? '删除当前语音转写字幕及其存储记录' : 'B站字幕不能清空';
    }
  }

  // ── 字幕搜索栏 ──

  function bindSearchBar() {
    const input = panelEl?.querySelector('#bn-search-input');
    const prevBtn = panelEl?.querySelector('#bn-search-prev');
    const nextBtn = panelEl?.querySelector('#bn-search-next');
    const clearBtn = panelEl?.querySelector('#bn-search-clear');
    if (!input) return;

    let debounceTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        window.BiliAiNote.subtitle?.applySearch(input.value);
      }, 300);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.BiliAiNote.subtitle?.stepSearch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = '';
        window.BiliAiNote.subtitle?.applySearch('');
      }
    });

    prevBtn?.addEventListener('click', () => window.BiliAiNote.subtitle?.stepSearch(-1));
    nextBtn?.addEventListener('click', () => window.BiliAiNote.subtitle?.stepSearch(1));
    clearBtn?.addEventListener('click', () => {
      input.value = '';
      window.BiliAiNote.subtitle?.applySearch('');
      input.focus();
    });
  }

  async function onFooterClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'more') {
      e.stopPropagation();
      const menu = panelEl?.querySelector('#bn-more-menu');
      const show = menu && !menu.classList.contains('show');
      closeMoreMenu();
      if (show && menu) {
        updateMoreMenuState();
        menu.classList.add('show');
        btn.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    closeMoreMenu();
    if (action === 'refresh') {
      if (window.BiliAiNote.subtitle) window.BiliAiNote.subtitle.refresh();
    } else if (action === 'copy') {
      if (window.BiliAiNote.subtitle) window.BiliAiNote.subtitle.copyText();
    } else if (action === 'export-srt') {
      if (window.BiliAiNote.exportUtil) window.BiliAiNote.exportUtil.downloadSrt();
    } else if (action === 'download-md') {
      if (window.BiliAiNote.exportUtil) window.BiliAiNote.exportUtil.downloadMarkdown();
    } else if (action === 'clear-subtitle') {
      const subtitle = window.BiliAiNote.subtitle;
      if (subtitle && subtitle.clearTranscribedSubtitle) {
        await subtitle.clearTranscribedSubtitle();
      }
    }
  }

  // ── 面板存活保护 ──
  // B站视频脚本会多次替换整个 #app，用 setInterval 持续守护面板

  let panelSurvivalTimer = null;

  function mountPanelToDanmuku() {
    if (!panelEl) return;
    const danmukuBox = document.getElementById('danmukuBox');
    if (danmukuBox) {
      danmukuBox.insertBefore(panelEl, danmukuBox.firstChild);
      panelMountMode = 'danmuku';
    } else {
      document.body.appendChild(panelEl);
      panelMountMode = 'body';
    }
  }

  function mountPanelToBody() {
    if (!panelEl) return;
    document.body.appendChild(panelEl);
    panelMountMode = 'body';
  }

  function startPanelSurvival() {
    stopPanelSurvival();
    if (!panelEl) return;

    panelSurvivalTimer = setInterval(() => {
      if (!panelEl) return;
      if (panelEl.isConnected) return; // 面板正常在 DOM 中

      console.warn('[BiliAiNote] Panel detached, re-inserting...');
      if (panelMountMode === 'body') {
        mountPanelToBody();
      } else {
        reinsertWhenReady();
      }
    }, 200);
  }

  function stopPanelSurvival() {
    if (panelSurvivalTimer) {
      clearInterval(panelSurvivalTimer);
      panelSurvivalTimer = null;
    }
  }

  // 等待新 #app 渲染完成后重新插入面板
  function reinsertWhenReady(attempts) {
    attempts = attempts || 0;
    requestAnimationFrame(() => {
      if (panelEl.isConnected) return; // 已被其他逻辑插入
      const box = document.getElementById('danmukuBox');
      if (box) {
        mountPanelToDanmuku();
        console.log('[BiliAiNote] Panel re-inserted into new #danmukuBox');
        // 延迟检查导航栏（等 Vue 渲染完成）
        setTimeout(checkNavRecovery, 500);
      } else if (attempts < 60) {
        reinsertWhenReady(attempts + 1);
      } else {
        mountPanelToBody();
        console.warn('[BiliAiNote] Panel re-inserted into body (fallback)');
        setTimeout(checkNavRecovery, 500);
      }
    });
  }

  // 检测导航栏丢失并尝试恢复
  // B站视频脚本替换 #app 后，新的 MainHeaderV3 组件可能未正确渲染
  // 此时从 Vue 组件树中找到旧的（已分离但内容完整）的 MainHeaderV3，复制其 HTML
  function checkNavRecovery() {
    const nav = document.getElementById('biliMainHeader');
    if (nav && nav.childElementCount > 0) return; // 导航栏有内容，正常

    const app = document.getElementById('app');
    const vue = app?.__vue__;

    // 尝试从 Vue 组件树恢复导航栏内容
    if (vue && vue.$children) {
      // 找到所有 MainHeaderV3 组件
      const headerComponents = vue.$children.filter(c => {
        const tag = c.$options?.tag || c.$options?._componentTag || c.$options?.name;
        return tag === 'MainHeaderV3';
      });

      // 找到有内容但已分离的旧组件（elConnected: false, innerHTML 有内容）
      const oldHeader = headerComponents.find(c => !c.$el.isConnected && c.$el.innerHTML.length > 0);

      if (oldHeader) {
        console.log('[BiliAiNote] Nav bar empty, recovering from old MainHeaderV3 component...');
        nav.innerHTML = oldHeader.$el.innerHTML;
        return;
      }

      // 备用：强制重渲染
      console.warn('[BiliAiNote] Nav bar empty, attempting forceUpdate...');
      try {
        vue.$forceUpdate();
      } catch(e) { console.warn(e); }
    }

    // 以上方法都无效，尝试触发 popstate
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  // ── 显示/隐藏面板 ──

  function show() {
    if (!panelEl) createPanel();
    panelEl.classList.remove('bn-hidden');
    window.BiliAiNote.state.panelVisible = true;

    // 根据设置决定是否展开
    const s = window.BiliAiNote.state;
    const defaultExpand = s.settings.defaultExpand !== false;
    if (defaultExpand) {
      // 展开面板
      s.collapsed = false;
      panelEl.classList.remove('bn-collapsed');
      if (arrowEl) arrowEl.classList.remove('bn-collapsed');
      s.settings.lastOpenMode = 'panel';
    } else {
      // 折叠面板
      s.collapsed = true;
      panelEl.classList.add('bn-collapsed');
      if (arrowEl) arrowEl.classList.add('bn-collapsed');
      s.settings.lastOpenMode = 'collapsed';
    }
    window.BiliAiNote.settings.save();
    loadSettingsToUI();
    // 自动加载字幕：无数据或 URL 变化时刷新
    const currentBvid = window.BiliAiNote.subtitle?.extractBvid(location.href) || '';
    const currentBvidChanged = currentBvid && s.bvid !== currentBvid;
    const currentPage = window.BiliAiNote.subtitle?.extractPageIndex(location.href) || 1;
    const currentPageChanged = s.cid && currentPage !== (s.pageIndex || 1);
    if (window.BiliAiNote.subtitle && (!s.bvid || currentBvidChanged || currentPageChanged)) {
      window.BiliAiNote.subtitle.refresh();
    }
  }

  function hide() {
    if (panelEl) {
      panelEl.classList.add('bn-hidden');
      window.BiliAiNote.state.panelVisible = false;
      window.BiliAiNote.state.collapsed = false;
    }
  }

  function showCollapse() {
    if (collapseContainerEl) {
      // 设置默认位置（右上角）
      if (!collapseContainerEl.style.left) {
        collapseContainerEl.style.left = (window.innerWidth - BTN_SIZE - EDGE_MARGIN) + 'px';
        collapseContainerEl.style.top = '100px';
      }
      collapseContainerEl.classList.remove('bn-hidden');
    }
  }

  function hideCollapse() {
    if (collapseContainerEl) {
      collapseContainerEl.classList.add('bn-hidden');
    }
  }

  function toggle() {
    if (window.BiliAiNote.state.panelVisible) {
      hide();
    } else {
      show();
    }
  }

  // ── 更新字幕语言下拉 ──

  function updateSubtitleSelect(subtitles, selectedUrl) {
    const langLabel = panelEl?.querySelector('#bn-lang-label');
    const langMenu = panelEl?.querySelector('#bn-lang-menu');
    if (!langLabel || !langMenu) return;

    if (!subtitles || subtitles.length === 0) {
      langLabel.textContent = '暂无字幕';
      langMenu.innerHTML = '';
      return;
    }

    // 更新按钮文本
    const selected = subtitles.find(s => s.subtitleUrl === selectedUrl);
    const aiTag = selected?.lan?.startsWith('ai-') ? ' [AI]' : '';
    langLabel.textContent = selected ? `${selected.lanDoc || selected.lan}${aiTag}` : '选择语言';

    // 更新菜单项
    langMenu.innerHTML = subtitles.map(item => {
      const aiTag = item.lan?.startsWith('ai-') ? ' [AI]' : '';
      const label = `${item.lanDoc || item.lan}${aiTag}`;
      const activeClass = item.subtitleUrl === selectedUrl ? ' active' : '';
      return `<div class="bn-lang-item${activeClass}" data-url="${escapeHtml(item.subtitleUrl)}" data-lang="${escapeHtml(item.lan)}">${escapeHtml(label)}</div>`;
    }).join('');

    // 绑定菜单项点击事件
    langMenu.querySelectorAll('.bn-lang-item').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.dataset.url;
        const lang = item.dataset.lang;
        if (url && window.BiliAiNote.subtitle) {
          window.BiliAiNote.subtitle.switchSubtitle(url, lang);
        }
        langMenu.classList.remove('show');
      });
    });
  }

  // ── Toast ──

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'bn-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // ── 工具函数 ──

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /**
   * 使用 markdown-it 将 Markdown 文本渲染为 HTML。
   * 浏览器 UMD 构建会挂载到 window.markdownit（注意：没有连字符）。
   * 渲染失败时退化为转义纯文本，保证可用性。
   */
  let _mdInstance = null;
  function getMarkdownRenderer() {
    if (_mdInstance) return _mdInstance;
    const factory = (typeof markdownit !== 'undefined') ? markdownit
                  : (typeof window !== 'undefined' && window.markdownit) ? window.markdownit
                  : null;
    if (factory) {
      _mdInstance = factory({
        html: false,        // 禁止原始 HTML，保证 XSS 安全
        breaks: true,       // 单换行渲染为 <br>
        linkify: true,      // 自动识别 URL
        typographer: false  // 关闭美化引号
      });
      // 外部链接默认在新标签打开
      const defaultLinkOpen = _mdInstance.renderer.rules.link_open || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
      };
      _mdInstance.renderer.rules.link_open = function(tokens, idx, options, env, self) {
        const aIndex = tokens[idx].attrIndex('target');
        if (aIndex < 0) {
          tokens[idx].attrPush(['target', '_blank']);
        } else {
          tokens[idx].attrs[aIndex][1] = '_blank';
        }
        const relIndex = tokens[idx].attrIndex('rel');
        if (relIndex < 0) {
          tokens[idx].attrPush(['rel', 'noopener noreferrer']);
        }
        return defaultLinkOpen(tokens, idx, options, env, self);
      };
    }
    return _mdInstance;
  }

  function renderMarkdownWithGFM(md) {
    const text = String(md || '');
    try {
      const renderer = getMarkdownRenderer();
      if (renderer) {
        return renderer.render(text);
      }
    } catch (e) {
      console.warn('[BiliAiNote] markdown-it render failed, fallback to text:', e);
    }
    const escaped = text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    return `<pre style="white-space:pre-wrap;margin:0;">${escaped}</pre>`;
  }

  function setAiResultContent(el, text, renderMarkdown = false) {
    if (!el) return;
    if (renderMarkdown) {
      // Markdown 渲染后换行由 <p>/<br> 控制，需要 normal 避免多余空白
      el.style.whiteSpace = 'normal';
      el.innerHTML = renderMarkdownWithGFM(text);
    } else {
      // 流式纯文本：保留 \n 换行，避免内容挤到一起
      el.style.whiteSpace = 'pre-wrap';
      el.textContent = text;
    }
  }

  function updateMaximizeUI() {
    if (!panelEl || !maximizeEl) return;
    const maximized = !!window.BiliAiNote.state.panelMaximized;
    panelEl.classList.toggle('bn-maximized', maximized);
    maximizeEl.classList.toggle('bn-active', maximized);
    maximizeEl.title = maximized ? '恢复尺寸' : '放大';
    maximizeEl.setAttribute('aria-label', maximizeEl.title);
    // 图标切换：默认显示“放大”，激活后显示“还原”
    const expandIcon = maximizeEl.querySelector('.bn-maximize-icon-expand');
    const restoreIcon = maximizeEl.querySelector('.bn-maximize-icon-restore');
    if (expandIcon) expandIcon.style.display = maximized ? 'none' : '';
    if (restoreIcon) restoreIcon.style.display = maximized ? '' : 'none';
  }

  function toggleMaximize() {
    const s = window.BiliAiNote.state;
    s.panelMaximized = !s.panelMaximized;
    if (s.panelMaximized) {
      mountPanelToBody();
    } else {
      mountPanelToDanmuku();
    }
    updateMaximizeUI();
  }

  // ── 公开接口 ──

  window.BiliAiNote.panel = {
    create: createPanel,
    show,
    hide,
    hideCollapse,
    showCollapse,
    toggle,
    toggleCollapse,
    switchTab,
    updateSubtitleSelect,
    showToast,
    renderDoc,
    resetDocAuto,
    getPanelEl: () => panelEl,
    getScrollWrap: () => panelEl?.querySelector('.bn-scroll'),
    loadSettingsToUI
  };
})();
