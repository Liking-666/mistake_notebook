const STORAGE_KEY = 'kaoyan-mistake-notebook:v1';
const AI_SETTINGS_KEY = 'kaoyan-mistake-notebook:ai-settings:v1';
const CHAT_KEY = 'kaoyan-mistake-notebook:chat:v1';
const titles = {
  dashboard: '今日概览',
  add: '录入错题',
  review: '今日复习',
  library: '错题列表',
  stats: '统计分析',
  chat: 'AI 答疑',
};

const state = {
  mistakes: loadMistakes(),
  currentView: 'dashboard',
  draftPhoto: '',
  activeAIMistakeId: '',
  chatMessages: loadChatMessages(),
  aiSettings: loadAISettings(),
  sending: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const elements = {
  pageTitle: $('#pageTitle'),
  seedButton: $('#seedButton'),
  mistakeForm: $('#mistakeForm'),
  metricGrid: $('#metricGrid'),
  todayPreview: $('#todayPreview'),
  weaknessPreview: $('#weaknessPreview'),
  reviewList: $('#reviewList'),
  reviewCountBadge: $('#reviewCountBadge'),
  mistakeList: $('#mistakeList'),
  subjectFilter: $('#subjectFilter'),
  reasonFilter: $('#reasonFilter'),
  searchInput: $('#searchInput'),
  reasonStats: $('#reasonStats'),
  knowledgeStats: $('#knowledgeStats'),
  photoInput: $('#photoInput'),
  photoPreview: $('#photoPreview'),
  clearPhotoButton: $('#clearPhotoButton'),
  chatForm: $('#chatForm'),
  chatInput: $('#chatInput'),
  chatMessages: $('#chatMessages'),
  aiContextBox: $('#aiContextBox'),
  clearChatButton: $('#clearChatButton'),
  apiBaseInput: $('#apiBaseInput'),
  apiKeyInput: $('#apiKeyInput'),
  modelInput: $('#modelInput'),
  includeMistakesInput: $('#includeMistakesInput'),
  saveAISettingsButton: $('#saveAISettingsButton'),
  testAIButton: $('#testAIButton'),
};

init();

function init() {
  $$('.nav-item').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });
  $$('[data-view-jump]').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.viewJump));
  });

  elements.mistakeForm.addEventListener('submit', handleSubmit);
  elements.seedButton.addEventListener('click', seedExamples);
  elements.photoInput.addEventListener('change', handlePhotoSelect);
  elements.clearPhotoButton.addEventListener('click', clearDraftPhoto);
  elements.chatForm.addEventListener('submit', handleChatSubmit);
  elements.clearChatButton.addEventListener('click', clearChat);
  elements.saveAISettingsButton.addEventListener('click', saveAISettings);
  elements.testAIButton.addEventListener('click', testAIConnection);
  elements.subjectFilter.addEventListener('change', render);
  elements.reasonFilter.addEventListener('change', render);
  elements.searchInput.addEventListener('input', render);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  fillAISettings();
  render();
}

function switchView(view) {
  state.currentView = view;
  elements.pageTitle.textContent = titles[view];
  $$('.view').forEach((section) => section.classList.remove('active'));
  $(`#${view}View`).classList.add('active');
  $$('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const interval = Number($('#intervalInput').value);
  const status = $('#statusInput').value;
  const question = $('#questionInput').value.trim();

  if (!question && !state.draftPhoto) {
    window.alert('请填写题目描述，或上传一张题目照片。');
    return;
  }

  const mistake = {
    id: `mistake_${Date.now()}`,
    subject: $('#subjectInput').value,
    reason: $('#reasonInput').value,
    knowledge: $('#knowledgeInput').value.trim(),
    source: $('#sourceInput').value.trim() || '未填写来源',
    question: question || '已上传题目照片',
    questionImage: state.draftPhoto,
    wrongThinking: $('#wrongInput').value.trim() || '未记录',
    correctThinking: $('#correctInput').value.trim() || '未记录',
    reviewCount: 0,
    mastered: status === 'mastered',
    createdAt: today(),
    nextReviewAt: status === 'mastered' ? addDays(14) : addDays(interval),
  };

  state.mistakes.unshift(mistake);
  persist();
  form.reset();
  clearDraftPhoto();
  $('#subjectInput').value = mistake.subject;
  switchView('library');
  render();
}

function handlePhotoSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    window.alert('请选择图片文件。');
    event.target.value = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    window.alert('图片建议控制在 2MB 以内，方便本地保存和打开。');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.draftPhoto = String(reader.result);
    renderPhotoPreview();
  };
  reader.readAsDataURL(file);
}

function clearDraftPhoto() {
  state.draftPhoto = '';
  elements.photoInput.value = '';
  renderPhotoPreview();
}

function renderPhotoPreview() {
  elements.photoPreview.classList.toggle('empty', !state.draftPhoto);
  elements.clearPhotoButton.classList.toggle('hidden', !state.draftPhoto);
  elements.photoPreview.innerHTML = state.draftPhoto
    ? `<img src="${state.draftPhoto}" alt="题目照片预览" />`
    : '还没有选择照片';
}

function render() {
  renderMetrics();
  renderDashboardLists();
  renderReviewList();
  renderMistakeList();
  renderStats();
  renderChat();
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const content = elements.chatInput.value.trim();
  if (!content || state.sending) return;

  const settings = readAISettingsFromForm();
  if (!settings.apiKey || !settings.apiBase || !settings.model) {
    window.alert('请先在右侧填写 API Base URL、API Key 和 Model。');
    return;
  }

  state.chatMessages.push({ role: 'user', content });
  elements.chatInput.value = '';
  persistChatMessages();
  renderChat();

  state.sending = true;
  state.chatMessages.push({ role: 'system', content: '正在请求模型...' });
  renderChat();

  try {
    const reply = await requestChatCompletion(settings, buildMessagesForAI(settings.includeMistakes));
    state.chatMessages = state.chatMessages.filter((message) => message.content !== '正在请求模型...');
    state.chatMessages.push({ role: 'assistant', content: reply });
  } catch (error) {
    state.chatMessages = state.chatMessages.filter((message) => message.content !== '正在请求模型...');
    state.chatMessages.push({
      role: 'system',
      content: `调用失败：${error.message}\n如果你正在用 file:// 打开页面，部分模型平台可能会拦截浏览器跨域请求。可以换支持 CORS 的接口，或后续加本地代理服务。`,
    });
  } finally {
    state.sending = false;
    persistChatMessages();
    renderChat();
  }
}

function buildMessagesForAI(includeMistakes) {
  const activeMistake = getActiveAIMistake();
  const system = [
    '你是一个考研学习答疑助手。',
    '回答要面向正在备考的学生，先讲核心概念，再给步骤，最后给易错点。',
    '如果问题涉及数学，请尽量写清公式含义和解题路线。',
  ];

  if (includeMistakes) {
    system.push(`用户错题本摘要：${buildMistakeContext()}`);
  }

  if (activeMistake) {
    system.push(`当前正在查看的错题：${formatMistakeForAI(activeMistake)}`);
  }

  const history = state.chatMessages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-8)
    .map((message) => ({ ...message }));

  if (activeMistake?.questionImage && history.at(-1)?.role === 'user') {
    const latest = history[history.length - 1];
    latest.content = [
      {
        type: 'text',
        text: `${latest.content}\n\n请结合当前错题照片和文字信息进行讲解。`,
      },
      {
        type: 'image_url',
        image_url: { url: activeMistake.questionImage },
      },
    ];
  }

  return [{ role: 'system', content: system.join('\n') }, ...history];
}

async function requestChatCompletion(settings, messages) {
  const response = await fetch(settings.apiBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText} ${detail.slice(0, 180)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('接口返回中没有 choices[0].message.content。');
  return content;
}

function buildMistakeContext() {
  if (!state.mistakes.length) return '暂无错题记录。';
  const topReasons = Object.entries(countBy(state.mistakes, 'reason'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name}${count}次`)
    .join('、');
  const topKnowledge = Object.entries(countBy(state.mistakes, 'knowledge'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}${count}次`)
    .join('、');
  return `高频错因：${topReasons || '暂无'}；高频知识点：${topKnowledge || '暂无'}。`;
}

function renderChat() {
  renderAIContext();
  elements.chatMessages.innerHTML = state.chatMessages.length
    ? state.chatMessages.map((message) => renderChatMessage(message)).join('')
    : `<div class="chat-message system">你可以在这里问不懂的知识点。建议先在右侧填 API Key，也可以勾选“附带错题本薄弱点上下文”。</div>`;
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function renderAIContext() {
  const mistake = getActiveAIMistake();
  elements.aiContextBox.classList.toggle('hidden', !mistake);
  if (!mistake) {
    elements.aiContextBox.innerHTML = '';
    return;
  }

  elements.aiContextBox.innerHTML = `
    <strong>正在结合这道错题答疑</strong>
    <span>${mistake.subject} · ${escapeHtml(mistake.knowledge)} · ${mistake.reason}</span>
    <button class="text-button" id="clearAIContextButton" type="button">取消关联</button>
  `;
  $('#clearAIContextButton').addEventListener('click', () => {
    state.activeAIMistakeId = '';
    renderChat();
  });
}

function renderChatMessage(message) {
  const className = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'system';
  return `<div class="chat-message ${className}">${escapeHtml(message.content)}</div>`;
}

function fillAISettings() {
  elements.apiBaseInput.value = state.aiSettings.apiBase;
  elements.apiKeyInput.value = state.aiSettings.apiKey;
  elements.modelInput.value = state.aiSettings.model;
  elements.includeMistakesInput.checked = state.aiSettings.includeMistakes;
}

function readAISettingsFromForm() {
  return {
    apiBase: elements.apiBaseInput.value.trim(),
    apiKey: elements.apiKeyInput.value.trim(),
    model: elements.modelInput.value.trim(),
    includeMistakes: elements.includeMistakesInput.checked,
  };
}

function saveAISettings() {
  state.aiSettings = readAISettingsFromForm();
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(state.aiSettings));
  window.alert('模型设置已保存到本地浏览器。');
}

async function testAIConnection() {
  saveAISettings();
  const settings = readAISettingsFromForm();
  if (!settings.apiKey || !settings.apiBase || !settings.model) {
    window.alert('请先填写 API Base URL、API Key 和 Model。');
    return;
  }

  try {
    const reply = await requestChatCompletion(settings, [
      { role: 'system', content: '你是连接测试助手。' },
      { role: 'user', content: '请用一句话回复：连接测试成功。' },
    ]);
    state.chatMessages.push({ role: 'system', content: `测试返回：${reply}` });
  } catch (error) {
    state.chatMessages.push({ role: 'system', content: `测试失败：${error.message}` });
  }
  persistChatMessages();
  renderChat();
}

function clearChat() {
  state.chatMessages = [];
  persistChatMessages();
  renderChat();
}

function renderMetrics() {
  const due = getDueMistakes();
  const weekCount = state.mistakes.filter((item) => daysBetween(item.createdAt, today()) <= 7).length;
  const weakReason = topEntry(countBy(state.mistakes, 'reason'));
  const weakKnowledge = topEntry(countBy(state.mistakes, 'knowledge'));
  const mastered = state.mistakes.filter((item) => item.mastered).length;

  const metrics = [
    ['今日待复习', due.length],
    ['本周新增', weekCount],
    ['已掌握', mastered],
    ['最高频错因', weakReason ? weakReason[0] : '暂无'],
  ];

  elements.metricGrid.innerHTML = metrics
    .map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join('');

  elements.weaknessPreview.dataset.knowledge = weakKnowledge ? weakKnowledge[0] : '';
}

function renderDashboardLists() {
  const due = getDueMistakes().slice(0, 4);
  elements.todayPreview.innerHTML = due.length
    ? due.map(renderMiniItem).join('')
    : `<div class="empty-state">今天没有到期错题，可以录入新题或复盘近期薄弱点。</div>`;

  const reason = topEntry(countBy(state.mistakes, 'reason'));
  const knowledge = topEntry(countBy(state.mistakes, 'knowledge'));
  const subject = topEntry(countBy(state.mistakes, 'subject'));
  const insights = [
    reason ? `最常见错因：${reason[0]}，共 ${reason[1]} 次。` : '还没有错因数据。',
    knowledge ? `高频知识点：${knowledge[0]}，建议优先复盘。` : '还没有知识点数据。',
    subject ? `错题最多科目：${subject[0]}，需要提高复习权重。` : '还没有科目数据。',
  ];

  elements.weaknessPreview.innerHTML = insights.map((text) => `<div class="mini-item">${text}</div>`).join('');
}

function renderReviewList() {
  const due = getDueMistakes();
  elements.reviewCountBadge.textContent = `${due.length} 题`;
  elements.reviewList.innerHTML = due.length
    ? due.map((mistake) => renderMistakeCard(mistake, true)).join('')
    : `<div class="empty-state">今日复习清单为空。可以去“录入”添加新的错题。</div>`;
  bindCardActions();
}

function renderMistakeList() {
  const keyword = elements.searchInput.value.trim().toLowerCase();
  const subject = elements.subjectFilter.value;
  const reason = elements.reasonFilter.value;
  const list = state.mistakes.filter((item) => {
    const matchSubject = subject === 'all' || item.subject === subject;
    const matchReason = reason === 'all' || item.reason === reason;
    const haystack = `${item.knowledge} ${item.source} ${item.question}`.toLowerCase();
    const matchKeyword = !keyword || haystack.includes(keyword);
    return matchSubject && matchReason && matchKeyword;
  });

  elements.mistakeList.innerHTML = list.length
    ? list.map((mistake) => renderMistakeCard(mistake, false)).join('')
    : `<div class="empty-state">没有匹配的错题。</div>`;
  bindCardActions();
}

function renderStats() {
  elements.reasonStats.innerHTML = renderRankList(countBy(state.mistakes, 'reason'));
  elements.knowledgeStats.innerHTML = renderRankList(countBy(state.mistakes, 'knowledge'));
}

function renderMiniItem(mistake) {
  return `
    <div class="mini-item">
      <strong>${escapeHtml(mistake.knowledge)}</strong>
      <small>${mistake.subject} · ${mistake.reason} · 下次复习 ${mistake.nextReviewAt}</small>
    </div>
  `;
}

function renderMistakeCard(mistake, reviewMode) {
  return `
    <article class="mistake-card" data-id="${mistake.id}">
      <div class="mistake-head">
        <div>
          <strong>${escapeHtml(mistake.knowledge)}</strong>
          <div class="mistake-meta">${mistake.subject} · ${mistake.reason} · ${escapeHtml(mistake.source)}</div>
        </div>
        <span class="badge">${mistake.mastered ? '已掌握' : `复习 ${mistake.reviewCount} 次`}</span>
      </div>
      <div class="mistake-body">
        <p><b>题目：</b>${escapeHtml(mistake.question)}</p>
        ${mistake.questionImage ? `<img class="question-photo" src="${mistake.questionImage}" alt="题目照片" />` : ''}
        <p><b>我的错误：</b>${escapeHtml(mistake.wrongThinking)}</p>
        <p><b>正确思路：</b>${escapeHtml(mistake.correctThinking)}</p>
        <p><b>下次复习：</b>${mistake.nextReviewAt}</p>
      </div>
      <div class="mistake-actions">
        <button class="soft-button" data-action="know">已掌握</button>
        <button class="soft-button" data-action="again">仍然不会</button>
        <button class="soft-button" data-action="ask-ai">问 AI</button>
        ${reviewMode ? '<button class="soft-button" data-action="later">推迟复习</button>' : ''}
        <button class="danger-button" data-action="delete">删除</button>
      </div>
    </article>
  `;
}

function renderRankList(map) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = entries[0]?.[1] || 1;
  if (!entries.length) return `<div class="empty-state">暂无统计数据。</div>`;
  return entries
    .map(
      ([name, count]) => `
        <div class="rank-item">
          <strong>${escapeHtml(name)}</strong>
          <span>${count} 次</span>
          <div class="bar"><i style="width: ${(count / max) * 100}%"></i></div>
        </div>
      `,
    )
    .join('');
}

function bindCardActions() {
  $$('.mistake-card button').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.mistake-card');
      if (button.dataset.action === 'ask-ai') {
        openAIForMistake(card.dataset.id);
        return;
      }
      updateMistake(card.dataset.id, button.dataset.action);
    });
  });
}

function openAIForMistake(id) {
  const mistake = state.mistakes.find((item) => item.id === id);
  if (!mistake) return;
  state.activeAIMistakeId = id;
  elements.chatInput.value = `请帮我讲解这道错题：为什么我会错？正确思路是什么？下次遇到同类题应该怎么做？`;
  switchView('chat');
  renderChat();
  elements.chatInput.focus();
}

function getActiveAIMistake() {
  return state.mistakes.find((item) => item.id === state.activeAIMistakeId);
}

function formatMistakeForAI(mistake) {
  return [
    `科目：${mistake.subject}`,
    `知识点：${mistake.knowledge}`,
    `错因：${mistake.reason}`,
    `来源：${mistake.source}`,
    `题目描述：${mistake.question}`,
    `我的错误：${mistake.wrongThinking}`,
    `正确思路：${mistake.correctThinking}`,
    `是否有题目照片：${mistake.questionImage ? '有，已随本次提问附带图片。' : '无'}`,
  ].join('；');
}

function updateMistake(id, action) {
  const mistake = state.mistakes.find((item) => item.id === id);
  if (!mistake) return;

  if (action === 'delete') {
    state.mistakes = state.mistakes.filter((item) => item.id !== id);
  }

  if (action === 'know') {
    mistake.mastered = true;
    mistake.reviewCount += 1;
    mistake.nextReviewAt = addDays(14);
  }

  if (action === 'again') {
    mistake.mastered = false;
    mistake.reviewCount += 1;
    mistake.nextReviewAt = addDays(1);
  }

  if (action === 'later') {
    mistake.nextReviewAt = addDays(2);
  }

  persist();
  render();
}

function getDueMistakes() {
  const current = today();
  return state.mistakes
    .filter((item) => !item.mastered || item.nextReviewAt <= current)
    .filter((item) => item.nextReviewAt <= current)
    .sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt));
}

function countBy(list, key) {
  return list.reduce((acc, item) => {
    const value = item[key] || '未填写';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function topEntry(map) {
  return Object.entries(map).sort((a, b) => b[1] - a[1])[0];
}

function seedExamples() {
  if (state.mistakes.length && !window.confirm('会添加 4 条示例错题，是否继续？')) return;
  state.mistakes = [...sampleMistakes(), ...state.mistakes];
  persist();
  render();
}

function sampleMistakes() {
  return [
    {
      id: `mistake_${Date.now()}_1`,
      subject: '线性代数',
      reason: '计算失误',
      knowledge: '线代-特征值',
      source: '660题 第3章',
      question: '求矩阵的特征值时把行列式展开符号写反。',
      questionImage: '',
      wrongThinking: '看到二阶子式后直接心算，忽略了负号。',
      correctThinking: '先写特征多项式，再逐步展开并检查符号。',
      reviewCount: 1,
      mastered: false,
      createdAt: addDays(-2),
      nextReviewAt: today(),
    },
    {
      id: `mistake_${Date.now()}_2`,
      subject: '英语',
      reason: '审题错误',
      knowledge: '阅读-主旨题',
      source: '2019 英语一 Text 2',
      question: '主旨题选了局部细节项。',
      questionImage: '',
      wrongThinking: '只盯着第二段关键词，没有看全文转折。',
      correctThinking: '主旨题先看首尾段和每段主题句，再排除局部细节。',
      reviewCount: 0,
      mastered: false,
      createdAt: addDays(-1),
      nextReviewAt: today(),
    },
    {
      id: `mistake_${Date.now()}_3`,
      subject: '政治',
      reason: '记忆遗漏',
      knowledge: '马原-矛盾分析法',
      source: '肖1000题',
      question: '混淆主要矛盾和矛盾主要方面。',
      questionImage: '',
      wrongThinking: '概念背得不牢，看到关键词就选。',
      correctThinking: '主要矛盾解决事物发展动力，矛盾主要方面决定事物性质。',
      reviewCount: 2,
      mastered: true,
      createdAt: addDays(-6),
      nextReviewAt: addDays(7),
    },
    {
      id: `mistake_${Date.now()}_4`,
      subject: '专业课',
      reason: '概念不清',
      knowledge: '数据结构-堆排序',
      source: '专业课真题',
      question: '不会判断建堆过程的比较次数。',
      questionImage: '',
      wrongThinking: '只记住结论，没有理解向下调整过程。',
      correctThinking: '按完全二叉树层级模拟，每次调整记录比较次数。',
      reviewCount: 0,
      mastered: false,
      createdAt: addDays(-3),
      nextReviewAt: addDays(1),
    },
  ];
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.mistakes));
}

function loadMistakes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function loadAISettings() {
  try {
    return {
      apiBase: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      model: 'gpt-4o-mini',
      includeMistakes: true,
      ...(JSON.parse(localStorage.getItem(AI_SETTINGS_KEY)) || {}),
    };
  } catch {
    return {
      apiBase: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      model: 'gpt-4o-mini',
      includeMistakes: true,
    };
  }
}

function loadChatMessages() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_KEY)) || [];
  } catch {
    return [];
  }
}

function persistChatMessages() {
  localStorage.setItem(CHAT_KEY, JSON.stringify(state.chatMessages));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  return Math.abs((new Date(end) - new Date(start)) / 86400000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
