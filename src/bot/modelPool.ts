export const CURATED_FREE_GEMINI_POOL: readonly string[] = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-4-hydrogen',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it',
  'gemma-3-27b-it',
  'gemma-3-12b-it',
  'gemma-3-4b-it',
];

const PROHIBITED_OR_SPECIALIZED_REGEX =
  /(gemini-1\.|gemini-2\.0|^gemini-pro$|^gemini-pro-vision$|gemini-4-neon|gemini-4-carbon|gemini-4-argon|embedding|imagen|veo|lyria|aqa|tts|transcribe|live|image|robotics|computer|deep-research|decision|omni|nano-banana|audio|vision|learnlm|thinking-exp)/i;

/**
 * Filters Google model IDs to strictly allow current, non-deprecated,
 * free-tier-eligible chat models (Gemini 2.5+, Gemini 3+, Gemini 4 Flash, Gemma 3+).
 */
export function isAllowedFreeTierChatModel(modelId: string): boolean {
  const clean = modelId.replace(/^models\//, '').trim().toLowerCase();
  if (!clean) return false;
  if (!clean.startsWith('gemini-') && !clean.startsWith('gemma-')) return false;
  if (PROHIBITED_OR_SPECIALIZED_REGEX.test(clean)) return false;
  return true;
}

export function isGemmaModel(modelId: string): boolean {
  return modelId.replace(/^models\//, '').trim().toLowerCase().startsWith('gemma-');
}

export interface ErrorClassification {
  kind: 'quota' | 'transient' | 'unavailable' | 'other';
  cooldownMs: number;
  shortReason: string;
}

/**
 * Classifies an upstream Gemini API error to decide how long to cool down a model
 * before trying the next model in the auto-failover pool.
 */
export function classifyGeminiError(err: unknown): ErrorClassification {
  const msg = err instanceof Error ? err.message : String(err);

  // 404 / unsupported / permission denied (e.g. paid-only or retired preview)
  if (
    /(404|NOT_FOUND|not found|is not supported|403|PERMISSION_DENIED|billing)/i.test(msg)
  ) {
    return {
      kind: 'unavailable',
      cooldownMs: 6 * 60 * 60 * 1000, // 6 hours
      shortReason: 'Unavailable on current key',
    };
  }

  // 429 Quota / Rate limit
  if (/(429|RESOURCE_EXHAUSTED|quota|rate[- ]?limit)/i.test(msg)) {
    const isDaily = /(per\s*day|PerDay|daily|retry in \d+h)/i.test(msg);
    let parsedMs = 0;

    const hmsMatch = msg.match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
    if (hmsMatch && (hmsMatch[1] || hmsMatch[2] || hmsMatch[3])) {
      const h = Number(hmsMatch[1] || 0);
      const m = Number(hmsMatch[2] || 0);
      const s = Number(hmsMatch[3] || 0);
      parsedMs = Math.round((h * 3600 + m * 60 + s) * 1000);
    }

    if (isDaily) {
      // Cap recheck to 60 minutes max so recovery happens promptly after daily reset
      const cooldownMs = parsedMs > 0 ? Math.min(parsedMs, 60 * 60 * 1000) : 45 * 60 * 1000;
      return {
        kind: 'quota',
        cooldownMs,
        shortReason: 'Daily limit reached',
      };
    }

    const cooldownMs =
      parsedMs > 0 ? Math.max(15_000, Math.min(parsedMs, 5 * 60 * 1000)) : 65_000;
    return {
      kind: 'quota',
      cooldownMs,
      shortReason: 'Rate limit reached',
    };
  }

  // 503 Overload / Timeout / Network hiccup
  if (/(503|UNAVAILABLE|high demand|overloaded|timed out|timeout|fetch failed|500|INTERNAL)/i.test(msg)) {
    return {
      kind: 'transient',
      cooldownMs: 45_000,
      shortReason: 'Temporarily busy',
    };
  }

  return {
    kind: 'other',
    cooldownMs: 30_000,
    shortReason: 'Error',
  };
}

/**
 * Builds the ordered candidate pool starting with preferredModel (if specified),
 * then curated free-tier models, then any extra discovered models.
 * Models not currently cooling down are prioritized first.
 */
export function buildOrderedFailoverPool(params: {
  preferredModel?: string;
  discoveredModels?: string[];
  cooldowns: Map<string, { untilMs: number; kind: string }>;
  nowMs?: number;
  requireVision?: boolean;
}): string[] {
  const now = params.nowMs ?? Date.now();
  const seen = new Set<string>();
  const all: string[] = [];

  const pushUnique = (id?: string) => {
    if (!id) return;
    const clean = id.replace(/^models\//, '').trim();
    if (!clean || clean === 'auto') return;
    if (!isAllowedFreeTierChatModel(clean)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    all.push(clean);
  };

  pushUnique(params.preferredModel);
  for (const m of CURATED_FREE_GEMINI_POOL) {
    pushUnique(m);
  }
  const extraGemini = (params.discoveredModels ?? []).filter((m) => !isGemmaModel(m));
  const extraGemma = (params.discoveredModels ?? []).filter((m) => isGemmaModel(m));
  for (const m of [...extraGemini, ...extraGemma]) {
    pushUnique(m);
  }

  const visionFiltered = params.requireVision
    ? all.filter((m) => !isGemmaModel(m))
    : all;
  const effective = visionFiltered.length > 0 ? visionFiltered : all;

  const healthy: string[] = [];
  const cooling: string[] = [];

  for (const m of effective) {
    const cd = params.cooldowns.get(m);
    if (!cd || cd.untilMs <= now) {
      healthy.push(m);
    } else if (cd.kind !== 'unavailable') {
      cooling.push(m);
    }
  }

  // Try all healthy models first; only retry quota-cooled models if none remain
  return [...healthy, ...cooling];
}
