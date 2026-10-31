// Policy-block helpers of Image to Video Studio. Run through flow-tools/_shared/scripts/check-snapshot.sh.
import assert from 'node:assert/strict';
import { buildImagePrompt, isPolicyBlockError, rewritePromptForPolicy, sanitizeNegative } from '../source/services/safety';

// Flow reports blocks in Vietnamese; quota and network errors must not be mistaken for blocks.
assert.ok(isPolicyBlockError('Lượt tạo này có thể vi phạm các chính sách của chúng tôi về việc tạo nội dung gây hại.'));
assert.ok(isPolicyBlockError('Request blocked by safety filter'));
assert.ok(!isPolicyBlockError('Không đủ tín dụng'));
assert.ok(!isPolicyBlockError('Request timed out (180s)'));
assert.ok(!isPolicyBlockError(''));

// The tail of the real KTT_T04 negative line: listing nudity, gore and celebrity faces is what
// triggered the blocks, so those items go and the harmless ones stay.
const kttNegative = 'no distorted hands, no real public figure or celebrity face, no copyrighted character likeness, no nudity or suggestive exposure, no graphic gore or blood splatter, no cheerful bright palette';
const clean = sanitizeNegative(kttNegative)!;
assert.equal(clean, 'no distorted hands, no copyrighted character likeness, no cheerful bright palette');
assert.equal(sanitizeNegative('no gore; no nudity'), undefined);

// Escalation ladder: level 0 keeps the sanitized Avoid list, level 1+ sends the prompt alone.
assert.equal(buildImagePrompt('A misty temple', kttNegative, 0), `A misty temple\n\nAvoid: ${clean}`);
assert.equal(buildImagePrompt('A misty temple', kttNegative, 1), 'A misty temple');
assert.equal(buildImagePrompt('A misty temple', 'no gore', 0), 'A misty temple');

// AI rewrite: strips fences/quotes, asks round 2 to be more conservative, refuses an empty answer.
const seen: string[] = [];
let reply = '```text\n"A frightened girl in a misty hallway"\n```';
(globalThis as any).__flowStub = {
  generate: { text: async (_prompt: string, options: any) => { seen.push(options.systemInstruction); return { text: reply }; } },
};
assert.equal(await rewritePromptForPolicy('bloody hallway', 1), 'A frightened girl in a misty hallway');
await rewritePromptForPolicy('bloody hallway', 2);
assert.ok(seen[1].length > seen[0].length && /more conservative/.test(seen[1]), 'round 2 is not stricter');
reply = '   ';
await assert.rejects(rewritePromptForPolicy('bloody hallway', 1), /không trả về/);

// Exit explicitly: the 60 s rewrite timeout timer would keep node alive.
process.exit(0);
