// OpenAI (ChatGPT) vision judge — the automatic fallback when no Anthropic key is
// present. Default model gpt-4o, overridable via OPENAI_VISION_MODEL. Same canonical
// Verdict shape as the Anthropic judge, so the rest of the app is provider-blind.
// Client constructed lazily inside judge() so importing needs no key.

import OpenAI from 'openai';
import { buildSystemPrompt, buildUserText, extractJson, normalizeVerdict } from './prompt.js';

const DEFAULT_MODEL = 'gpt-4o';

export function isConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * @param {object} args - imageBase64, mediaType, app, signals, model?
 * @returns {Promise<object>} canonical Verdict (throws on API/parse error)
 */
export async function judge({ imageBase64, mediaType = 'image/jpeg', app, signals, model }) {
  const client = new OpenAI(); // reads OPENAI_API_KEY from the environment
  const dataUrl = `data:${mediaType};base64,${imageBase64}`;
  const resp = await client.chat.completions.create({
    model: model || process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildUserText(app, signals) },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const text = (resp.choices && resp.choices[0] && resp.choices[0].message.content) || '';
  const parsed = extractJson(text);
  if (!parsed) throw new Error('could not parse JSON from OpenAI response');
  return normalizeVerdict(parsed);
}
