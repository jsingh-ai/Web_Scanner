// CI smoke test for the AI judgment layer. Tests pure logic (JSON extraction,
// verdict normalization, prompt building) and the provider-selection + graceful
// degradation paths. Does NOT call any real API — no keys, no network, no cost.

import {
  buildSystemPrompt,
  buildUserText,
  extractJson,
  normalizeVerdict,
} from '../src/ai/prompt.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

// Ensure a clean env for provider-selection tests.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

// --- extractJson ---
assert(extractJson('{"status":"good"}').status === 'good', 'plain json');
assert(extractJson('```json\n{"status":"down"}\n```').status === 'down', 'fenced json');
assert(extractJson('Here you go: {"status":"warning"} thanks').status === 'warning', 'json in prose');
assert(extractJson('no json here') === null, 'no json -> null');
assert(extractJson('{bad json') === null, 'invalid json -> null');

// --- normalizeVerdict ---
const full = normalizeVerdict({
  status: 'good',
  confidence: 0.9,
  summary: 'ok',
  sections: [{ name: 'Pinch', status: 'good', notes: 'fine' }],
  machines: [{ section: 'Lam', machine: 'L6', state: 'offline', note: 'no data' }],
});
assert(full.status === 'good' && full.confidence === 0.9, 'valid verdict kept');
assert(full.sections.length === 1 && full.sections[0].name === 'Pinch', 'section mapped');
assert(full.machines[0].id === 'L6', 'machine.machine mapped to id');

assert(normalizeVerdict({ status: 'bogus' }).status === 'warning', 'bad status -> warning');
assert(normalizeVerdict({}).status === 'warning', 'missing status -> warning');
assert(normalizeVerdict({ confidence: 5 }).confidence === null, 'out-of-range confidence -> null');
assert(Array.isArray(normalizeVerdict({}).sections), 'sections always array');

// --- prompt building ---
assert(buildSystemPrompt().toLowerCase().includes('standby'), 'system prompt states standby rule');
assert(buildSystemPrompt().toLowerCase().includes('json'), 'system prompt asks for json');
const userText = buildUserText(
  { name: 'OPC', url: 'http://opc', is_rich_dashboard: true, sections: ['Pinch', 'Lamination'] },
  { httpStatus: 200, loadMs: 1200, textLength: 5000 },
);
assert(userText.includes('OPC') && userText.includes('Pinch'), 'user text has app + sections');
assert(userText.includes('HTTP 200'), 'user text has signals');

// --- provider selection (env-driven) ---
const { availableProviders, judgeScreenshot } = await import('../src/ai/provider.js');
assert(availableProviders().length === 0, 'no keys -> no providers');

process.env.OPENAI_API_KEY = 'sk-test-openai';
assert(availableProviders().join() === 'openai', 'only openai key -> openai');

process.env.ANTHROPIC_API_KEY = 'sk-test-anthropic';
assert(availableProviders().join() === 'anthropic,openai', 'both keys -> claude first');

// --- graceful degradation (no network) ---
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
const noProvider = await judgeScreenshot({ screenshotBuffer: Buffer.from('x'), app: {}, signals: {} });
assert(noProvider.status === 'warning' && noProvider.error === 'no_provider', 'no provider -> warning');

process.env.ANTHROPIC_API_KEY = 'sk-test-anthropic';
const noShot = await judgeScreenshot({ screenshotBuffer: null, app: {}, signals: {} });
assert(noShot.status === 'warning' && noShot.error === 'no_screenshot', 'no screenshot -> warning');
delete process.env.ANTHROPIC_API_KEY;

console.log('AI SMOKE PASSED');
