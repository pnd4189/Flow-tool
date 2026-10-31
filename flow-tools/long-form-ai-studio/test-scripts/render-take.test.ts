// Error handling of renderShotTake with a scripted Flow (no credits): policy block -> one AI
// rewrite -> retry, a second block -> clear error, quota -> QUOTA_ERROR. Run through check-snapshot.sh.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseImportedScriptFile } from '../source/services/scriptImport';
import { renderShotTake } from '../source/services/renderService';

const dataDir = join(process.env.TOOL_DIR ?? '', 'test-data');
const imported = await parseImportedScriptFile(readFileSync(join(dataDir, 'single-scene-block.txt'), 'utf8'), 'single-scene-block.txt', []);
const shot = imported.shots[0];
const scene = imported.scenes[0];
const config = {
  mode: 'long', targetShots: 1, videoModel: 'Omni 1.1 Flash', imageModel: '🍌 Nano Banana 2.1',
  resolution: '360p', durationSeconds: 4, aspectRatio: '16:9', lookId: 'anime_cel', customStyle: '',
} as any;
const keyframes = { firstFrameMediaId: 'kf-start', lastFrameMediaId: 'kf-end' } as any;
const POLICY = 'Lượt tạo này có thể vi phạm các chính sách của chúng tôi về việc tạo nội dung gây hại.';

function scriptFlow(videoOutcomes: Array<Error | 'ok'>) {
  const calls = { video: [] as string[], text: 0 };
  (globalThis as any).__flowStub = {
    generate: {
      video: async (req: any) => {
        calls.video.push(req.prompt);
        const outcome = videoOutcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return { base64: Buffer.from('fake mp4').toString('base64'), mimeType: 'video/mp4', mediaId: 'video-1' };
      },
      text: async () => {
        calls.text++;
        return { text: 'A gentle 2D cartoon fox turns a crank, soft colours.' };
      },
    },
  };
  return calls;
}
const render = () => renderShotTake({ shot, scene, characters: [], config, currentKeyframes: keyframes, enableQC: false });

// One policy block: the AI rewrites the prompt once and the retry succeeds with the new prompt.
let calls = scriptFlow([new Error(POLICY), 'ok']);
const { take, lock } = await render();
assert.equal(calls.video.length, 2, 'expected exactly one retry');
assert.equal(calls.text, 1, 'expected exactly one AI rewrite');
assert.notEqual(calls.video[1], calls.video[0], 'retry reused the blocked prompt');
assert.equal(take.promptUsed, calls.video[1]);
assert.equal(lock.prompt, calls.video[1], 'lock must keep the prompt that actually rendered');
assert.equal(take.firstFrameMediaId, 'kf-start');
assert.equal(take.creditCost, 4);

// Blocked again after the rewrite: stop with an actionable message, no third call.
calls = scriptFlow([new Error(POLICY), new Error(POLICY)]);
await assert.rejects(render(), /Bị chặn vì chính sách sau khi AI chỉnh prompt/);
assert.equal(calls.video.length, 2, 'must not retry a second time');

// Out of credits: no retry, error tagged for the queue to stop.
calls = scriptFlow([new Error('Không đủ tín dụng để tạo video')]);
await assert.rejects(render(), /^Error: QUOTA_ERROR:/);
assert.equal(calls.video.length, 1);
assert.equal(calls.text, 0);

// Exit explicitly: the 900 s render timeout timer would keep node alive.
process.exit(0);
