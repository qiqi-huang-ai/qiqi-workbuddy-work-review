import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {collectWorkBuddyRange, inspectWorkBuddySource} from './lib/workbuddy-reader.mjs';
import {inspectWorkBuddyCli, runWorkBuddyReview} from './lib/workbuddy-runner.mjs';
import {buildReviewPrompt, DEFAULT_RULES_PATH, inspectRules} from './lib/review.mjs';
import {
  appendLog,
  DATA_ROOT,
  ensureDataLayout,
  listJson,
  PROJECT_ROOT,
  readJson,
  safeId,
  writeJson,
} from './lib/store.mjs';

const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');
const PORT = Number(process.env.PORT || 4319);
const HOST = '127.0.0.1';

function safePreview(text) {
  return String(text || '')
    .replaceAll(homedir(), '~')
    .replace(/\/var\/folders\/[^\s)]+/g, '[临时路径]')
    .slice(0, 180);
}

function matchSnippet(text, query) {
  const source = String(text || '');
  const index = source.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return safePreview(source);
  const start = Math.max(0, index - 70);
  const end = Math.min(source.length, index + query.length + 110);
  return safePreview(`${start ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function json(response, status, value) {
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5_000_000) throw new Error('请求内容超过 5 MB');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function reviewId(type, start, end, projectName = '') {
  return safeId([type, start, end, projectName].filter(Boolean).join('__'));
}

async function statusPayload() {
  const [source, workBuddyCli, rules, reviewFiles, correctionFiles] = await Promise.all([
    inspectWorkBuddySource(),
    inspectWorkBuddyCli(),
    inspectRules(),
    listJson('reviews'),
    listJson('corrections'),
  ]);
  return {
    app: 'WorkBuddy 工作复盘',
    mode: 'WorkBuddy 直连 · 手动触发',
    source: {
      name: 'WorkBuddy 本地会话',
      status: source.projectsReadable && source.databaseReadable ? '已接通' : '不可用',
      indexStatus: source.databaseReadable ? '可读取' : '不可用',
    },
    workBuddyCli,
    rules: {
      name: rules.name,
      path: rules.path,
      modifiedAt: rules.modifiedAt,
      version: rules.sha256.slice(0, 12),
      status: '已读取',
    },
    counts: {reviews: reviewFiles.length, corrections: correctionFiles.length},
    dataRoot: DATA_ROOT,
    connectors: [
      {name: 'WorkBuddy 本地对话', status: source.projectsReadable && source.databaseReadable ? '已接通' : '不可用'},
      {name: 'WorkBuddy 分析', status: workBuddyCli.status},
    ],
  };
}

async function collect(payload) {
  const evidence = await collectWorkBuddyRange(payload.start, payload.end);
  if (Array.isArray(payload.includedSessionIds)) {
    const included = new Set(payload.includedSessionIds.map(String));
    evidence.sessions = evidence.sessions.filter((session) => included.has(session.id));
    evidence.selection = {mode: 'manual', includedSessionIds: [...included]};
  }
  if (payload.manualNotes?.trim()) {
    evidence.manualNotes = {
      status: '已读取',
      text: payload.manualNotes.trim(),
      warning: '用户手动补充；产出是否验收仍需按内容判断。',
    };
  }
  const key = `${payload.start}_${payload.end}`;
  await writeJson(`normalized/${key}.json`, evidence);
  await writeJson(`sources/workbuddy/${key}.json`, {
    collectedAt: evidence.collectedAt,
    range: evidence.range,
    coverage: evidence.coverage,
    sessionCount: evidence.sessions.length,
    sourceMode: evidence.sourceMode,
  });
  await appendLog('workbuddy.collect', {range: evidence.range, sessionCount: evidence.sessions.length});
  return evidence;
}

async function listConversations(start, end, query = '') {
  const evidence = await collectWorkBuddyRange(start, end);
  const grouped = new Map();
  for (const session of evidence.sessions) {
    const existing = grouped.get(session.id);
    if (!existing) {
      grouped.set(session.id, {
        id: session.id,
        title: session.title,
        project: session.cwd ? path.basename(session.cwd) : '未标记项目',
        firstTimestamp: session.firstTimestamp,
        lastTimestamp: session.lastTimestamp,
        messageCount: session.messages.length,
        toolCallCount: session.toolCalls.reduce((sum, item) => sum + item.count, 0),
        preview: safePreview(session.messages.find((message) => message.role === 'user')?.text) || '没有可显示的用户消息',
        recordCount: 1,
        searchEntries: [...session.searchEntries],
      });
      continue;
    }
    existing.messageCount += session.messages.length;
    existing.toolCallCount += session.toolCalls.reduce((sum, item) => sum + item.count, 0);
    existing.recordCount += 1;
    existing.searchEntries.push(...session.searchEntries);
    if (String(session.firstTimestamp) < String(existing.firstTimestamp)) existing.firstTimestamp = session.firstTimestamp;
    if (String(session.lastTimestamp) > String(existing.lastTimestamp)) existing.lastTimestamp = session.lastTimestamp;
  }
  const normalizedQuery = query.trim();
  const conversations = [...grouped.values()]
    .map((item) => {
      let matchReason = '日期范围';
      let matchText = item.preview;
      if (normalizedQuery) {
        if (item.title.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase())) {
          matchReason = '标题命中';
          matchText = matchSnippet(item.title, normalizedQuery);
        } else {
          const entry = item.searchEntries.find((candidate) => candidate.text.toLocaleLowerCase().includes(normalizedQuery.toLocaleLowerCase()));
          if (!entry) return null;
          matchReason = `${entry.role === 'user' ? '用户消息' : 'WorkBuddy 回复'}命中`;
          matchText = matchSnippet(entry.text, normalizedQuery);
        }
      }
      const {searchEntries, ...publicItem} = item;
      return {...publicItem, matchReason, matchText};
    })
    .filter(Boolean);
  return {
    range: evidence.range,
    coverage: evidence.coverage,
    recordCount: evidence.sessions.length,
    criteria: {query: normalizedQuery},
    conversations,
  };
}

async function importReview(payload) {
  if (!payload.content?.trim()) throw new Error('复盘内容不能为空');
  const id = reviewId(payload.type, payload.start, payload.end, payload.projectName);
  const relativePath = `reviews/${id}.json`;
  const existing = await readJson(relativePath, {
    id,
    type: payload.type,
    range: {start: payload.start, end: payload.end},
    projectName: payload.projectName || null,
    acceptanceCriteria: payload.acceptanceCriteria || null,
    aiVersions: [],
  });
  const rules = await inspectRules();
  existing.aiVersions.push({
    version: existing.aiVersions.length + 1,
    importedAt: new Date().toISOString(),
    generatedBy: payload.generatedBy || 'WorkBuddy（导入）',
    rulesVersion: rules.sha256.slice(0, 12),
    content: payload.content.trim(),
  });
  existing.updatedAt = new Date().toISOString();
  await writeJson(relativePath, existing);
  await appendLog('review.imported', {id, version: existing.aiVersions.length});
  return {...existing, correction: await readJson(`corrections/${id}.json`)};
}

async function generateReview(payload) {
  const evidence = await collect(payload);
  const rules = await inspectRules(payload.rulesPath || DEFAULT_RULES_PATH);
  const prompt = buildReviewPrompt({...payload, range: {start: payload.start, end: payload.end}, evidence, rules});
  const key = `${payload.start}_${payload.end}`;
  await writeJson(`rules/${key}.json`, {
    generatedAt: new Date().toISOString(),
    reviewType: payload.type,
    range: {start: payload.start, end: payload.end},
    projectName: payload.projectName || null,
    mode: 'WorkBuddy CLI（直连、手动触发）',
    rules: {name: rules.name, path: rules.path, modifiedAt: rules.modifiedAt, sha256: rules.sha256},
  });
  await appendLog('review.workbuddy-started', {type: payload.type, range: {start: payload.start, end: payload.end}});
  const result = await runWorkBuddyReview(prompt);
  const review = await importReview({...payload, content: result.content, generatedBy: 'WorkBuddy CLI（直连）'});
  await appendLog('review.workbuddy-completed', {id: review.id, durationMs: result.durationMs});
  return {review, durationMs: result.durationMs};
}

async function saveCorrection(payload) {
  if (!payload.id) throw new Error('缺少复盘 ID');
  const correction = {
    id: safeId(payload.id),
    updatedAt: new Date().toISOString(),
    content: String(payload.content || '').trim(),
    source: '用户修正',
  };
  await writeJson(`corrections/${correction.id}.json`, correction);
  await appendLog('review.correction-saved', {id: correction.id});
  return correction;
}

async function listReviews() {
  const files = await listJson('reviews');
  const reviews = [];
  for (const file of files) {
    const review = await readJson(`reviews/${file}`);
    const correction = await readJson(`corrections/${review.id}.json`);
    reviews.push({...review, correction});
  }
  return reviews.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const filePath = path.resolve(PUBLIC_ROOT, relative);
  if (!filePath.startsWith(PUBLIC_ROOT)) return json(response, 403, {error: '禁止访问'});
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {'content-type': MIME[path.extname(filePath)] || 'application/octet-stream'});
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') return json(response, 404, {error: '页面不存在'});
    throw error;
  }
}

async function handler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/status') return json(response, 200, await statusPayload());
    if (request.method === 'GET' && url.pathname === '/api/reviews') return json(response, 200, await listReviews());
    if (request.method === 'GET' && url.pathname === '/api/conversations') return json(response, 200, await listConversations(
      url.searchParams.get('start'),
      url.searchParams.get('end'),
      url.searchParams.get('query') || '',
    ));
    if (request.method === 'POST' && url.pathname === '/api/generate') return json(response, 201, await generateReview(await body(request)));
    if (request.method === 'POST' && url.pathname === '/api/reviews') return json(response, 201, await importReview(await body(request)));
    if (request.method === 'POST' && url.pathname === '/api/corrections') return json(response, 200, await saveCorrection(await body(request)));
    if (url.pathname.startsWith('/api/')) return json(response, 404, {error: '接口不存在'});
    return await serveStatic(request, response, url.pathname);
  } catch (error) {
    console.error(error);
    return json(response, 400, {error: error.message || '请求失败'});
  }
}

await ensureDataLayout();
const server = http.createServer(handler);
server.listen(PORT, HOST, () => {
  console.log(`WorkBuddy 工作复盘已启动：http://${HOST}:${PORT}`);
});

export {handler, reviewId};
