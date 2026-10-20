import {createHash} from 'node:crypto';
import {readdir, readFile, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MESSAGE_LENGTH = 5000;
const SHANGHAI_DAY = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function assertDate(value) {
  if (!DAY_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) {
    throw new Error(`日期格式无效：${value}`);
  }
}

export function datesBetween(start, end) {
  assertDate(start);
  assertDate(end);
  const first = new Date(`${start}T00:00:00+08:00`);
  const last = new Date(`${end}T00:00:00+08:00`);
  if (first > last) throw new Error('开始日期不能晚于结束日期');
  const result = [];
  for (let cursor = first; cursor <= last; cursor = new Date(cursor.getTime() + 86400000)) {
    result.push(shanghaiDate(cursor));
  }
  if (result.length > 93) throw new Error('单次采集最多支持 93 天');
  return result;
}

function workBuddyRoot() {
  const root = process.env.WORKBUDDY_HOME || path.join(homedir(), '.workbuddy');
  if (path.basename(path.resolve(root)) === '.workbuddy-ai') {
    throw new Error('本项目只支持国内版 WorkBuddy，不能读取国际版 ~/.workbuddy-ai');
  }
  return root;
}

function shanghaiDate(value) {
  const parts = Object.fromEntries(SHANGHAI_DAY.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timestampValue(value) {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function textFromContent(content, limit = MAX_MESSAGE_LENGTH) {
  if (typeof content === 'string') return limit ? content.slice(0, limit) : content;
  if (!Array.isArray(content)) return '';
  const text = content
    .filter((item) => typeof item?.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
  return limit ? text.slice(0, limit) : text;
}

function isInjectedContext(role, text) {
  if (role !== 'user') return false;
  return text.startsWith('# AGENTS.md instructions')
    || text.startsWith('<environment_context>')
    || text.startsWith('<system-reminder>');
}

function boundedMessages(messages) {
  if (messages.length <= 60) return messages;
  return [...messages.slice(0, 15), ...messages.slice(-45)];
}

async function conversationFiles(root) {
  const projectsRoot = path.join(root, 'projects');
  const result = [];
  for (const directory of await readdir(projectsRoot, {withFileTypes: true})) {
    if (!directory.isDirectory()) continue;
    const directoryPath = path.join(projectsRoot, directory.name);
    for (const file of await readdir(directoryPath, {withFileTypes: true})) {
      if (file.isFile() && file.name.endsWith('.jsonl')) result.push(path.join(directoryPath, file.name));
    }
  }
  return result;
}

function loadSessionIndex(root) {
  const databasePath = path.join(root, 'workbuddy.db');
  const database = new DatabaseSync(databasePath, {readOnly: true});
  try {
    const rows = database.prepare(`
      SELECT id, cwd, title, custom_title, created_at, updated_at
      FROM sessions
      WHERE deleted_at IS NULL AND COALESCE(is_background_automation, 0) = 0
    `).all();
    return new Map(rows.map((row) => [row.id, row]));
  } finally {
    database.close();
  }
}

function sessionBucket(map, id, metadata = {}) {
  if (!map.has(id)) {
    map.set(id, {
      id,
      metadata,
      aiTitle: null,
      cwd: metadata.cwd || null,
      messages: [],
      searchEntries: [],
      toolCallMap: new Map(),
      activityDates: new Set(),
      sourceRefs: [],
      sourceHashes: [],
      seenEvents: new Set(),
      firstTimestamp: null,
      lastTimestamp: null,
    });
  }
  return map.get(id);
}

function finalTitle(bucket) {
  const title = bucket.metadata.custom_title || bucket.metadata.title || bucket.aiTitle;
  if (title?.trim()) return title.trim();
  const firstUser = bucket.messages.find((message) => message.role === 'user')?.text;
  return firstUser?.replace(/\s+/g, ' ').trim().slice(0, 72) || '未命名 WorkBuddy 会话';
}

export async function inspectWorkBuddySource() {
  const root = workBuddyRoot();
  const projects = path.join(root, 'projects');
  const database = path.join(root, 'workbuddy.db');
  const result = {root, projectsReadable: false, databaseReadable: false};
  try { result.projectsReadable = (await stat(projects)).isDirectory(); } catch {}
  try { result.databaseReadable = (await stat(database)).isFile(); } catch {}
  return result;
}

export async function collectWorkBuddyRange(start, end) {
  const root = workBuddyRoot();
  const dates = datesBetween(start, end);
  const includedDates = new Set(dates);
  const metadata = loadSessionIndex(root);
  const buckets = new Map();

  for (const file of await conversationFiles(root)) {
    const text = await readFile(file, 'utf8');
    const sourceHash = createHash('sha256').update(text).digest('hex').slice(0, 16);
    const touched = new Set();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let item;
      try { item = JSON.parse(line); } catch { continue; }
      const id = item.sessionId || path.basename(file, '.jsonl');
      if (!metadata.has(id)) continue;
      const bucket = sessionBucket(buckets, id, metadata.get(id));
      const eventId = item.id || `${item.type}:${item.timestamp}:${item.callId || ''}`;
      if (bucket.seenEvents.has(eventId)) continue;
      bucket.seenEvents.add(eventId);
      touched.add(id);
      if (item.cwd) bucket.cwd = item.cwd;
      if (item.type === 'ai-title' && item.aiTitle) bucket.aiTitle = item.aiTitle;

      const time = timestampValue(item.timestamp);
      if (time === null) continue;
      const date = shanghaiDate(time);
      if (!includedDates.has(date)) continue;
      bucket.activityDates.add(date);
      const timestamp = new Date(time).toISOString();
      bucket.firstTimestamp ||= timestamp;
      bucket.lastTimestamp = timestamp;

      if (item.type === 'message' && ['user', 'assistant'].includes(item.role)) {
        const fullContent = textFromContent(item.content, 0);
        if (fullContent && !isInjectedContext(item.role, fullContent)) {
          bucket.messages.push({role: item.role, text: fullContent.slice(0, MAX_MESSAGE_LENGTH), timestamp});
          bucket.searchEntries.push({role: item.role, text: fullContent});
        }
      }
      if (item.type === 'function_call') {
        const name = item.name || 'unknown';
        const current = bucket.toolCallMap.get(name) || {name, count: 0, firstTimestamp: timestamp, lastTimestamp: null};
        current.count += 1;
        current.lastTimestamp = timestamp;
        bucket.toolCallMap.set(name, current);
      }
    }
    for (const id of touched) {
      const bucket = buckets.get(id);
      bucket.sourceRefs.push(path.relative(root, file));
      bucket.sourceHashes.push(sourceHash);
    }
  }

  const sessions = [...buckets.values()]
    .filter((bucket) => bucket.activityDates.size && (bucket.messages.length || bucket.toolCallMap.size))
    .map((bucket) => {
      const session = {
        id: bucket.id,
        title: finalTitle(bucket),
        cwd: bucket.cwd,
        firstTimestamp: bucket.firstTimestamp,
        lastTimestamp: bucket.lastTimestamp,
        messages: boundedMessages(bucket.messages),
        toolCalls: [...bucket.toolCallMap.values()],
        sourceRef: bucket.sourceRefs.join(', '),
        sourceHash: createHash('sha256').update(bucket.sourceHashes.join(':')).digest('hex').slice(0, 16),
      };
      Object.defineProperty(session, 'searchEntries', {value: bucket.searchEntries, enumerable: false});
      Object.defineProperty(session, 'activityDates', {value: bucket.activityDates, enumerable: false});
      return session;
    });

  const coverage = dates.map((date) => {
    const fileCount = sessions.filter((session) => session.activityDates.has(date)).length;
    return {date, status: fileCount ? '已读取' : '无匹配记录', fileCount};
  });

  return {
    source: 'WorkBuddy 本地会话',
    sourceMode: 'read-only',
    collectedAt: new Date().toISOString(),
    range: {start, end},
    coverage,
    sessions,
    limitations: [
      '按 Asia/Shanghai 的消息发生时间筛选，不把文件修改时间当作工作发生时间。',
      '默认只读取 WorkBuddy 数据库中未删除、非自动化的会话。',
      '助手自称完成和工具调用只构成线索，不自动代表验收完成。',
      '当前采集不等于全部个人工作历史。',
      '单个超长会话保留开头 15 条与末尾 45 条有效消息，中段需回到原始会话复核。',
    ],
  };
}
