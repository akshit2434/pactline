// When a key is set but the API is unreachable, every AI function falls back instead of failing.
process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
delete process.env.PACTLINE_AI_OFFLINE;
import { test } from 'node:test';
import assert from 'node:assert/strict';
const ai = await import('../src/ai/index.js');

test('draftContract falls back when the API is unreachable', async () => {
  const r = await ai.draftContract('Logo for $500: $200 when sketches are delivered, $300 when final files are delivered.', { now: '2026-11-12T17:00:00Z', timeoutMs: 3000 });
  assert.equal(r.source, 'fallback');
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === 'AI_FALLBACK'));
});

test('checkProof falls back when the API is unreachable', async () => {
  const r = await ai.checkProof({ milestone: { id: 'm1', criteria: 'Report delivered.' }, text: 'Report attached.' }, { timeoutMs: 3000 });
  assert.equal(r.by, 'heuristic');
  assert.ok(r.fallback_reason);
});

test('explainEvent with useModel falls back to the template', async () => {
  assert.equal(await ai.explainEvent({ type: 'deal.completed' }, { useModel: true, timeoutMs: 3000 }), 'All milestones are paid. The deal is complete.');
});
