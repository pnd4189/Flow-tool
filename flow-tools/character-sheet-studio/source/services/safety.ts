import { Flow } from 'flow-sdk';

/**
 * Checks whether an error message indicates a safety/policy content block.
 */
export function isPolicyBlockError(msg: string): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  const viKeywords = ['vi phạm', 'chính sách', 'không an toàn'];
  const enKeywords = ['safety', 'policy', 'blocked', 'sensitive', 'prohibited'];

  return (
    viKeywords.some((kw) => lower.includes(kw)) ||
    enKeywords.some((kw) => lower.includes(kw))
  );
}

/**
 * Checks whether an error message indicates a transient error (e.g. timeout, rate limit, busy).
 */
export function isTransientError(msg: string): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  const viKeywords = ['tạm thời không hoạt động'];
  const enKeywords = ['unavailable', 'busy', 'overloaded', 'rate limit', 'timeout'];

  return (
    viKeywords.some((kw) => lower.includes(kw)) ||
    enKeywords.some((kw) => lower.includes(kw))
  );
}

/**
 * Rewrites a prompt for policy compliance using Flow.generate.text with a strict system instruction.
 * Round 1: keep character, outfit, layout, style and mood; soften sensitive elements; turn real people to fictional.
 * Round 2: clearly more conservative.
 * Timeout: 60 seconds. Output: English only, single paragraph, stripped markdown.
 */
export async function rewritePromptForPolicy(prompt: string, round: 1 | 2): Promise<string> {
  const systemInstruction = `You are an expert AI prompt safety adapter for character model sheets.
Rules:
1. Preserve the character identity, outfit design, layout, artistic style, and mood.
2. Soften and eliminate anything remotely graphic, violent, sexually suggestive, or sensitive.
3. Turn any real people or celebrities into completely fictional, original characters.
${round === 2 ? '4. ROUND 2 REQUIREMENT: Be strictly conservative, simplified, and thoroughly safe. Remove any ambiguous adjectives or edgy words.' : ''}
5. Output English only as a single unified paragraph.
6. Do NOT include markdown formatting, code fences, bullet points, or quotation marks.`;

  const userPrompt = `Please rewrite the following character sheet prompt to comply strictly with safety guidelines:

${prompt}`;

  // 60-second timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT: Prompt rewriting exceeded 60 seconds.'));
    }, 60000);
  });

  const generatePromise = (async () => {
    const res = await Flow.generate.text(userPrompt, {
      systemInstruction,
      thinkingLevel: 'low',
    });
    return res.text;
  })();

  const rawText = await Promise.race([generatePromise, timeoutPromise]);

  if (!rawText || !rawText.trim()) {
    throw new Error('Prompt rewrite returned empty response.');
  }

  // Strip code fences, backticks, and outer quotes
  let cleaned = rawText
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();

  // Ensure single paragraph without line breaks
  cleaned = cleaned.replace(/\r?\n+/g, ' ');

  if (!cleaned.trim()) {
    throw new Error('Sanitized prompt is empty after processing.');
  }

  return cleaned;
}
