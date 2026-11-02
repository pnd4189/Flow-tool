// Error handling of image generation with a scripted Flow (no credits, no network):
// policy-block ladder, transient retries, reference ids, and the safety/file-name helpers.
// Run through flow-tools/_shared/scripts/check-snapshot.sh.
import assert from 'node:assert/strict';
import { generateSheetImage } from '../source/services/generation';
import { isPolicyBlockError, isTransientError, rewritePromptForPolicy } from '../source/services/safety';
import { buildFilename, extForMime } from '../source/services/imageUtils';

// Transient retries wait 8 s and 20 s; shrink those (and only those) so the test runs in milliseconds.
const realSetTimeout = globalThis.setTimeout;
(globalThis as any).setTimeout = (fn: () => void, ms?: number, ...args: unknown[]) =>
  realSetTimeout(fn, ms === 8000 || ms === 20000 ? 1 : ms, ...args);

const POLICY = 'Lượt tạo này có thể vi phạm các chính sách của chúng tôi về việc tạo nội dung gây hại.';
const TRANSIENT = 'Dịch vụ tạo hình ảnh tạm thời không hoạt động.';
const REWRITTEN = 'A calm hero in a clean studio, soft colours.';

function scriptFlow(outcomes: Array<Error | 'ok'>, rewrite: string | Error = REWRITTEN) {
  const calls = { images: [] as any[], texts: [] as any[] };
  (globalThis as any).__flowStub = {
    generate: {
      image: async (options: any) => {
        calls.images.push(options);
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return { base64: 'AAAA', mimeType: 'image/png', mediaId: 'media-1' };
      },
      text: async (prompt: string, options: any) => {
        calls.texts.push({ prompt, options });
        if (rewrite instanceof Error) throw rewrite;
        return { text: rewrite };
      },
    },
  };
  return calls;
}
const run = (extra: Record<string, unknown> = {}) =>
  generateSheetImage({ prompt: 'ORIGINAL PROMPT', model: '🍌 Nano Banana Pro', aspectRatio: '16:9', ...extra } as any);

// One policy block: one AI rewrite, then the retry uses the rewritten prompt.
let calls = scriptFlow([new Error(POLICY), 'ok']);
let result = await run();
assert.equal(calls.images.length, 2);
assert.equal(calls.texts.length, 1);
assert.equal(calls.images[1].prompt, REWRITTEN);
assert.equal(result.rewriteRound, 1);
assert.equal(result.promptUsed, REWRITTEN);

// Two blocks: round 2 asks for a stricter rewrite.
calls = scriptFlow([new Error(POLICY), new Error(POLICY), 'ok']);
result = await run();
assert.equal(calls.images.length, 3);
assert.equal(calls.texts.length, 2);
assert.ok(calls.texts[1].options.systemInstruction.length > calls.texts[0].options.systemInstruction.length, 'round 2 is not stricter');
assert.equal(result.rewriteRound, 2);

// Blocked after both rewrites: stop with a clear message, no fourth call.
calls = scriptFlow([new Error(POLICY), new Error(POLICY), new Error(POLICY)]);
await assert.rejects(run(), /sau 2 lần viết lại/);
assert.equal(calls.images.length, 3);

// A failing rewrite surfaces as an error instead of looping.
calls = scriptFlow([new Error(POLICY)], new Error('rewrite failed'));
await assert.rejects(run(), /rewrite failed/);
assert.equal(calls.images.length, 1);

// Transient errors: two retries then success; three failures surface the original error.
const stages: string[] = [];
calls = scriptFlow([new Error(TRANSIENT), new Error(TRANSIENT), 'ok']);
await run({ onStage: (stage: string) => stages.push(stage) });
assert.equal(calls.images.length, 3);
assert.ok(stages.includes('retrying'));
calls = scriptFlow([new Error(TRANSIENT), new Error(TRANSIENT), new Error(TRANSIENT)]);
await assert.rejects(run(), /tạm thời không hoạt động/);
assert.equal(calls.images.length, 3);

// Any other error (for example out of quota) stops at once and never calls the rewriter.
calls = scriptFlow([new Error('Không đủ tín dụng')]);
await assert.rejects(run(), /Không đủ tín dụng/);
assert.equal(calls.images.length, 1);
assert.equal(calls.texts.length, 0);

// Reference ids: de-duplicated, empty ones dropped, at most 10, omitted when none.
calls = scriptFlow(['ok']);
await run({ referenceMediaIds: [...Array.from({ length: 12 }, (_, i) => `ref-${i}`), 'ref-0', ''] });
assert.deepEqual(calls.images[0].referenceImageMediaIds, Array.from({ length: 10 }, (_, i) => `ref-${i}`));
calls = scriptFlow(['ok']);
await run({ referenceMediaIds: ['', ''] });
assert.ok(!('referenceImageMediaIds' in calls.images[0]));
assert.equal(calls.images[0].modelDisplayName, '🍌 Nano Banana Pro');
assert.equal(calls.images[0].aspectRatio, '16:9');

// Safety helpers.
assert.ok(isPolicyBlockError(POLICY));
assert.ok(isPolicyBlockError('Request blocked by safety filter'));
assert.ok(!isPolicyBlockError('Không đủ tín dụng'));
assert.ok(!isPolicyBlockError(''));
assert.ok(isTransientError(TRANSIENT));
assert.ok(!isTransientError(POLICY));
(globalThis as any).__flowStub = { generate: { text: async () => ({ text: '```text\n"A calm hero"\n```' }) } };
assert.equal(await rewritePromptForPolicy('x', 1), 'A calm hero');
(globalThis as any).__flowStub = { generate: { text: async () => ({ text: '   ' }) } };
await assert.rejects(rewritePromptForPolicy('x', 1), /empty/i);

// File names and extensions.
assert.equal(extForMime('image/png'), 'png');
assert.equal(extForMime('image/jpeg'), 'jpg');
assert.equal(extForMime('image/webp'), 'webp');
assert.equal(buildFilename('main_character', 'layout_a', 'image/png', new Date(2026, 10, 1, 22, 15, 0)), 'main_character_layout_a_20261101-221500.png');

// Exit explicitly: the 150 s / 60 s timeout timers would keep node alive.
process.exit(0);
