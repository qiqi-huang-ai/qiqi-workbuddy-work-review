const state = {
  page: 'overview',
  scopeMode: 'all',
  status: null,
  reviews: [],
  activeReview: null,
  conversations: [],
  selectedConversationIds: new Set(),
  conversationRange: null,
  criteria: {query: '', project: null},
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {headers: {'content-type': 'application/json'}, ...options});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '请求失败');
  return payload;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  window.setTimeout(() => element.classList.remove('show'), 2400);
}

function showResult(element, message, error = false) {
  element.textContent = message;
  element.classList.remove('hidden');
  element.classList.toggle('error', error);
}

function setPage(page) {
  state.page = page;
  $$('.page').forEach((element) => element.classList.toggle('active', element.id === `page-${page}`));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function reviewLabel() {
  return '时间段复盘';
}

function renderMarkdown(container, markdown) {
  container.replaceChildren();
  let list = null;
  for (const rawLine of String(markdown || '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) { list = null; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      list = null;
      const element = document.createElement(heading[1].length === 1 ? 'h2' : 'h3');
      element.textContent = heading[2];
      container.append(element);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!list) { list = document.createElement('ul'); container.append(list); }
      const item = document.createElement('li');
      item.textContent = bullet[1];
      list.append(item);
      continue;
    }
    list = null;
    const element = document.createElement(line.startsWith('|') ? 'pre' : 'p');
    element.textContent = line;
    container.append(element);
  }
}

function renderReviews() {
  $('#review-count').textContent = String(state.reviews.length);
  const container = $('#recent-reviews');
  container.replaceChildren();
  if (!state.reviews.length) {
    container.className = 'review-list empty-state';
    container.textContent = '还没有复盘。先从一个真实工作日开始。';
    return;
  }
  container.className = 'review-list';
  state.reviews.slice(0, 6).forEach((review) => {
    const row = document.createElement('article');
    row.className = 'review-row';
    const kind = document.createElement('div');
    kind.className = 'review-kind';
    kind.textContent = reviewLabel(review);
    const center = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = review.projectName || `${review.range.start} 至 ${review.range.end}`;
    const detail = document.createElement('p');
    detail.textContent = `${review.aiVersions?.length || 0} 个 WorkBuddy 版本${review.correction?.content ? ' · 有个人修正' : ''}`;
    center.append(title, detail);
    const time = document.createElement('time');
    time.textContent = review.updatedAt ? new Date(review.updatedAt).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '';
    row.append(kind, center, time);
    row.addEventListener('click', () => openReview(review));
    container.append(row);
  });
}

function activeConversationIds() {
  if (!state.conversationRange) return [];
  return state.scopeMode === 'all'
    ? state.conversations.map((item) => item.id)
    : [...state.selectedConversationIds];
}

function updateScopeSummary() {
  const ids = activeConversationIds();
  const button = $('#generate-review');
  button.disabled = !state.conversationRange || ids.length === 0;
  $$('[data-scope-mode]').forEach((item) => item.classList.toggle('active', item.dataset.scopeMode === state.scopeMode));
  if (!state.conversationRange) {
    $('#selection-note').textContent = '请先查找对话。';
    return;
  }
  const keyword = state.criteria.query ? ` · 关键词“${state.criteria.query}”` : '';
  const scope = state.scopeMode === 'all' ? `全部 ${ids.length} 个匹配对话` : `已勾选的 ${ids.length} 个对话`;
  $('#selection-note').textContent = `${state.conversationRange.start} 至 ${state.conversationRange.end}${keyword} · 将使用${scope}`;
}

function renderConversations() {
  const container = $('#conversation-list');
  const selectedCount = state.selectedConversationIds.size;
  $('#conversation-summary').textContent = state.conversationRange
    ? `找到 ${state.conversations.length} 个对话，已勾选 ${selectedCount} 个`
    : '尚未读取对话';
  container.replaceChildren();
  if (!state.conversations.length) {
    container.className = 'conversation-list empty-state';
    container.textContent = state.conversationRange ? '当前条件没有找到相关对话。' : '确定范围后点击“查找对话”。';
    updateScopeSummary();
    return;
  }
  container.className = 'conversation-list';
  state.conversations.forEach((conversation) => {
    const row = document.createElement('label');
    row.className = 'conversation-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedConversationIds.has(conversation.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedConversationIds.add(conversation.id);
      else state.selectedConversationIds.delete(conversation.id);
      state.scopeMode = 'selected';
      renderConversations();
    });
    const content = document.createElement('div');
    const heading = document.createElement('div');
    heading.className = 'conversation-heading';
    const title = document.createElement('strong');
    title.textContent = conversation.title;
    const meta = document.createElement('span');
    const records = conversation.recordCount > 1 ? ` · ${conversation.recordCount} 个记录分段` : '';
    meta.textContent = `${conversation.project} · ${conversation.messageCount} 条消息 · ${conversation.toolCallCount} 次工具调用${records}`;
    heading.append(title, meta);
    const match = document.createElement('div');
    match.className = 'match-line';
    const badge = document.createElement('span');
    badge.className = 'match-badge';
    badge.textContent = conversation.matchReason;
    const snippet = document.createElement('p');
    snippet.textContent = conversation.matchText;
    match.append(badge, snippet);
    content.append(heading, match);
    row.append(checkbox, content);
    container.append(row);
  });
  updateScopeSummary();
}

async function loadConversations() {
  const start = $('#start-date').value;
  const end = $('#end-date').value;
  const query = $('#conversation-search').value.trim();
  const params = new URLSearchParams({start, end});
  if (query) params.set('query', query);
  const button = $('#load-conversations');
  button.disabled = true;
  button.textContent = '查找中…';
  try {
    const result = await api(`/api/conversations?${params}`);
    state.conversations = result.conversations;
    state.selectedConversationIds = new Set(result.conversations.map((item) => item.id));
    state.conversationRange = result.range;
    state.criteria = result.criteria;
    state.scopeMode = 'all';
    renderConversations();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = '查找对话';
  }
}

function openReview(review) {
  state.activeReview = review;
  $('#drawer-title').textContent = review.projectName || `${reviewLabel(review)} · ${review.range.start}`;
  renderMarkdown($('#drawer-content'), review.aiVersions?.at(-1)?.content || '没有可显示的复盘内容。');
  $('#correction-content').value = review.correction?.content || '';
  $('#review-drawer').classList.add('open');
  $('#drawer-backdrop').classList.add('open');
  $('#review-drawer').setAttribute('aria-hidden', 'false');
}

function closeReview() {
  $('#review-drawer').classList.remove('open');
  $('#drawer-backdrop').classList.remove('open');
  $('#review-drawer').setAttribute('aria-hidden', 'true');
}

async function refresh() {
  const [status, reviews] = await Promise.all([api('/api/status'), api('/api/reviews')]);
  state.status = status;
  state.reviews = reviews;
  $('#mode-status').textContent = status.source.status === '已接通' && status.workBuddyCli.status === '已接通'
    ? 'WorkBuddy 已接通'
    : 'WorkBuddy 需配置';
  $('#source-metric').textContent = status.source.status;
  $('#source-detail').textContent = status.source.status === '已接通' ? '本地会话只读访问' : '请检查 WorkBuddy 数据目录';
  $('#rules-version').textContent = status.rules.version;
  $('#rules-version-detail').textContent = `${status.rules.version} · ${new Date(status.rules.modifiedAt).toLocaleString('zh-CN')}`;
  $('#rules-path').textContent = status.rules.path;
  $('#rules-status').textContent = status.rules.status;
  $('#data-root').textContent = status.dataRoot;
  const list = $('#connector-list');
  list.replaceChildren();
  status.connectors.forEach((connector) => {
    const item = document.createElement('div');
    item.className = 'connector-item';
    const name = document.createElement('strong');
    name.textContent = connector.name;
    const value = document.createElement('span');
    value.className = `connector-status ${connector.status === '已接通' ? 'connected' : ''}`;
    value.textContent = connector.status;
    item.append(name, value);
    list.append(item);
  });
  renderReviews();
}

function reviewPayload() {
  return {
    type: 'custom',
    start: $('#start-date').value,
    end: $('#end-date').value,
    manualNotes: $('#manual-notes').value,
    includedSessionIds: activeConversationIds(),
  };
}

async function generateReview(payload, button, result) {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'WorkBuddy 正在复盘…';
  showResult(result, '正在读取所选记录并调用 WorkBuddy。页面可以保持打开，完成后会自动展示结果。');
  try {
    const response = await api('/api/generate', {method: 'POST', body: JSON.stringify(payload)});
    await refresh();
    showResult(result, `复盘已生成并保存，用时 ${Math.max(1, Math.round(response.durationMs / 1000))} 秒。`);
    openReview(response.review);
  } catch (error) {
    showResult(result, error.message, true);
  } finally {
    button.disabled = activeConversationIds().length === 0;
    button.textContent = originalLabel;
  }
}

function setDefaults() {
  const today = localDate(new Date());
  $('#start-date').value = today;
  $('#end-date').value = today;
  $('#today-label').textContent = `${new Date().toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'})} · 工作证据，而不是努力分`;
}

$$('.nav-item').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
$$('[data-go]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.go)));
$$('[data-scope-mode]').forEach((button) => button.addEventListener('click', () => { state.scopeMode = button.dataset.scopeMode; updateScopeSummary(); }));
$('#load-conversations').addEventListener('click', loadConversations);
$('#conversation-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadConversations(); });
$('#select-all-conversations').addEventListener('click', () => { state.selectedConversationIds = new Set(state.conversations.map((item) => item.id)); state.scopeMode = 'selected'; renderConversations(); });
$('#clear-conversations').addEventListener('click', () => { state.selectedConversationIds.clear(); state.scopeMode = 'selected'; renderConversations(); });
$('#start-date').addEventListener('change', () => { state.conversationRange = null; state.conversations = []; state.selectedConversationIds.clear(); renderConversations(); });
$('#end-date').addEventListener('change', () => { state.conversationRange = null; state.conversations = []; state.selectedConversationIds.clear(); renderConversations(); });
$('#generate-review').addEventListener('click', () => generateReview(reviewPayload(), $('#generate-review'), $('#generation-result')));
$('#close-drawer').addEventListener('click', closeReview);
$('#drawer-backdrop').addEventListener('click', closeReview);
$('#save-correction').addEventListener('click', async () => {
  if (!state.activeReview) return;
  try {
    const correction = await api('/api/corrections', {method: 'POST', body: JSON.stringify({id: state.activeReview.id, content: $('#correction-content').value})});
    state.activeReview.correction = correction;
    await refresh();
    toast('个人修正已单独保存');
  } catch (error) { toast(error.message); }
});

setDefaults();
renderConversations();
refresh().catch((error) => toast(error.message));
