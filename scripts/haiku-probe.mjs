// Probe which effort levels the configured model accepts (prints no secrets).
import '../src/config.js';
import { callJSON, DEFAULT_MODEL } from '../src/ai/client.js';
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
for (const effort of ['max', 'xhigh', 'high']) {
  try {
    const r = await callJSON({ system: 'Reply as JSON.', content: [{ type: 'text', text: 'Say ok=true.' }], schema, effort, maxTokens: 2000 });
    console.log(DEFAULT_MODEL, effort, 'OK', r.model, JSON.stringify(r.data));
  } catch (e) { console.log(DEFAULT_MODEL, effort, 'FAIL', e.message.slice(0, 200)); }
}
