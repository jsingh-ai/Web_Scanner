// Provider-agnostic vision entry point. Selects Claude first, OpenAI as fallback,
// with runtime failover: if the primary provider errors, the other is tried. If no
// provider is configured, or all fail, it returns a `warning` verdict labelled
// "vision unavailable" — never a false `down` (docs/BUILD-RULES.md rules 10-11).

import { isConfigured as anthropicConfigured, judge as anthropicJudge } from './anthropic.js';
import { isConfigured as openaiConfigured, judge as openaiJudge } from './openai.js';

/** Configured providers in preference order (Claude first). */
export function availableProviders() {
  const list = [];
  if (anthropicConfigured()) list.push('anthropic');
  if (openaiConfigured()) list.push('openai');
  return list;
}

function unavailable(reason, error) {
  return {
    status: 'warning',
    method: 'vision',
    provider: null,
    confidence: null,
    summary: `vision unavailable (${reason})`,
    sections: [],
    machines: [],
    error: error || reason,
  };
}

/**
 * Judge a screenshot. Returns a canonical Verdict augmented with { method:'vision',
 * provider }. Always resolves (never throws) — failures degrade to a warning.
 * @param {object} args - screenshotBuffer (Buffer), app, signals
 */
export async function judgeScreenshot({ screenshotBuffer, app, signals }) {
  const providers = availableProviders();
  if (providers.length === 0) {
    return unavailable('no AI provider key configured', 'no_provider');
  }
  if (!screenshotBuffer || !screenshotBuffer.length) {
    return unavailable('no screenshot captured', 'no_screenshot');
  }

  const imageBase64 = screenshotBuffer.toString('base64');
  const errors = [];
  for (const provider of providers) {
    try {
      const judge = provider === 'anthropic' ? anthropicJudge : openaiJudge;
      const verdict = await judge({ imageBase64, mediaType: 'image/jpeg', app, signals });
      return { ...verdict, method: 'vision', provider };
    } catch (e) {
      errors.push(`${provider}: ${(e && e.message) || e}`);
    }
  }
  return unavailable('all providers failed', errors.join('; '));
}
