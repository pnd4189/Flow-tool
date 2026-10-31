// Prompt-count regressions of the Effect-Image parser. Run through flow-tools/_shared/scripts/check-snapshot.sh.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parsePromptTextAsync } from '../source/services/promptParser';

const dataDir = join(process.env.TOOL_DIR ?? '', 'test-data');
const read = (name: string) => readFileSync(join(dataDir, name), 'utf8');

async function count(text: string) {
  return (await parsePromptTextAsync(text, '16:9')).items;
}

// "--- SCENE 001 ---" header lines followed by blank-line separated label paragraphs: one prompt per
// header, not one per paragraph (the original bug turned 120 scenes into 1200 prompts).
const ktt = await count(read('ktt-scene-blocks-10.txt'));
assert.equal(ktt.length, 10, `ktt-scene-blocks-10: ${ktt.length} prompts`);
assert.match(ktt[0].prompt, /Camera/i, 'first scene lost its first paragraph');

assert.equal((await count(read('test_prompts.txt'))).length, 4, 'test_prompts.txt');
assert.equal((await count(read('prompts300.txt'))).length, 300, 'prompts300.txt');
assert.equal((await count(read('md-blocks.txt'))).length, 2, 'markdown headings with extra paragraphs');
assert.equal((await count(read('scene-colon.txt'))).length, 2, 'SCENE n: headers');
assert.equal((await count(read('top-title.txt'))).length, 2, 'a lone title line must not swallow the prompts');

// The full 120-scene episode lives on the user's Drive; check it when the mount is present.
const fullEpisode = join(homedir(), 'cloud/gdrive/1. YOUTUBE AUDIO/3. Kẻ Trừ Tà/2. BẢN NGẮN/Tập 04 - Bóng Quỷ (ch084-110)/8. DỰNG VIDEO/KTT_T04_ban-ngan_vi_image_prompts.txt');
if (existsSync(fullEpisode)) {
  const items = await count(readFileSync(fullEpisode, 'utf8'));
  assert.equal(items.length, 120, `KTT_T04 full episode: ${items.length} prompts`);
} else {
  console.log('  (skipped KTT_T04 full episode: Drive not mounted)');
}

// Exit explicitly: open MessageChannel ports (used to yield during parsing) keep node alive.
process.exit(0);
