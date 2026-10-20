import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_ROOT = process.env.REVIEW_DATA_HOME
  ? path.resolve(process.env.REVIEW_DATA_HOME.replace(/^~(?=\/|$)/, homedir()))
  : path.join(PROJECT_ROOT, 'data');

const DIRECTORIES = [
  'sources/workbuddy',
  'normalized',
  'reviews',
  'corrections',
  'rules',
  'logs',
  'demo',
];

export async function ensureDataLayout() {
  await Promise.all(DIRECTORIES.map((directory) => mkdir(path.join(DATA_ROOT, directory), {recursive: true})));
}

export function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function writeJson(relativePath, value) {
  const target = path.join(DATA_ROOT, relativePath);
  await mkdir(path.dirname(target), {recursive: true});
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return target;
}

export async function readJson(relativePath, fallback = null) {
  try {
    return JSON.parse(await readFile(path.join(DATA_ROOT, relativePath), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function listJson(relativeDirectory) {
  const directory = path.join(DATA_ROOT, relativeDirectory);
  try {
    const names = await readdir(directory);
    return names.filter((name) => name.endsWith('.json')).sort().reverse();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function appendLog(event, detail = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const relativePath = `logs/${date}.json`;
  const entries = await readJson(relativePath, []);
  entries.push({timestamp: new Date().toISOString(), event, ...detail});
  await writeJson(relativePath, entries);
}
