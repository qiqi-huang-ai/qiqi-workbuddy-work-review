import test from 'node:test';
import assert from 'node:assert/strict';
import {datesBetween} from '../lib/workbuddy-reader.mjs';
import {buildReviewPrompt} from '../lib/review.mjs';
import {safeId} from '../lib/store.mjs';

test('datesBetween includes both boundaries', () => {
  assert.deepEqual(datesBetween('2026-10-19', '2026-10-20'), ['2026-10-19', '2026-10-20']);
});

test('datesBetween rejects reversed ranges', () => {
  assert.throws(() => datesBetween('2026-10-20', '2026-10-19'), /开始日期/);
});

test('review prompt carries evidence boundaries and rules version', () => {
  const prompt = buildReviewPrompt({
    type: 'custom',
    range: {start: '2026-10-20', end: '2026-10-20'},
    manualNotes: '',
    evidence: {sessions: [], coverage: [{date: '2026-10-20', status: '无匹配记录'}]},
    rules: {
      path: '/rules/review-rules.md',
      sha256: '1234567890abcdef',
      modifiedAt: '2026-10-20T00:00:00.000Z',
      rulesText: '没有记录不等于没有工作。区分讨论、计划和可验证完成。',
    },
  });
  assert.match(prompt, /没有记录不等于没有工作/);
  assert.match(prompt, /自定义时间段复盘/);
  assert.match(prompt, /1234567890ab/);
  assert.match(prompt, /无匹配记录/);
});

test('safeId removes path separators', () => {
  assert.equal(safeId('day/../../secret'), 'day_.._.._secret');
});
