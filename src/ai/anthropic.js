// Anthropic (Claude) vision judge. Default model claude-opus-5, overridable via
// VISION_MODEL. The client is constructed lazily inside judge() so merely importing
// this module never requires a key (keeps the deterministic-only / no-key path clean).

import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, buildUserText, extractJson, normalizeVerdict } from './prompt.js';

const DEFAULT_MODEL = 'claude-opus-5';

export function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * @param {object} args - imageBase64, mediaType, app, signals, model?
 * @returns {Promise<object>} canonical Verdict (throws on API/parse error)
 */
export async function judge({ imageBase64, mediaType = 'image/jpeg', app, signals, model }) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  const resp = await client.messages.create({
    model: model || process.env.VISION_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: buildUserText(app, signals) },
        ],
      },
    ],
  });

  const text = (resp.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const parsed = extractJson(text);
  if (!parsed) throw new Error('could not parse JSON from Anthropic response');
  return normalizeVerdict(parsed);
}
