// Script-import regressions of Long-Form AI Studio. Run through flow-tools/_shared/scripts/check-snapshot.sh.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseImportedScriptFile } from '../source/services/scriptImport';

const dataDir = join(process.env.TOOL_DIR ?? '', 'test-data');
const vault = [{ id: 'c1', name: 'Lan' }] as any;
const parse = (name: string) => parseImportedScriptFile(readFileSync(join(dataDir, name), 'utf8'), name, vault);

// "--- SCENE ---" blocks with label lines: one shot per block, labels are not dialogue.
const blocks = await parse('scene-blocks.txt');
assert.equal(blocks.totalShots, 2, `scene-blocks: ${blocks.totalShots} shots`);
assert.equal(blocks.totalDialogues, 0, 'scene-blocks: label lines were read as dialogue');

// A file with a single "--- SCENE 001 ---" block is still the structured format.
const single = await parse('single-scene-block.txt');
assert.equal(single.totalShots, 1, `single-scene-block: ${single.totalShots} shots`);
assert.match(single.shots[0].action, /brass crank/, 'single block lost its Action label');

// A plain-script scene made only of label lines must still produce a shot.
const labelsOnly = await parse('labels-only-plain.txt');
assert.equal(labelsOnly.totalShots, 1, `labels-only-plain: ${labelsOnly.totalShots} shots`);
assert.match(labelsOnly.shots[0].action, /Con cáo quay tay quay/);
assert.match(labelsOnly.shots[0].action, /Camera: wide shot/);

// A scene that opens with a line of dialogue: the line is dialogue, never visual action text.
// "Năm 1876:" is a label-like line with a digit, so it stays an action beat.
const labels = await parse('labels-not-dialogue.txt');
assert.equal(labels.totalShots, 3, `labels-not-dialogue: ${labels.totalShots} shots`);
assert.equal(labels.totalDialogues, 1, `labels-not-dialogue: ${labels.totalDialogues} dialogues`);
assert.ok(labels.shots.every(s => !/^LAN:/.test(s.action)), 'dialogue line became action text');

// Two speakers in a row must not overwrite each other; a "Camera:" note joins the current shot.
const mixed = await parse('mixed-dialogue.txt');
assert.equal(mixed.totalShots, 2, `mixed-dialogue: ${mixed.totalShots} shots`);
assert.equal(mixed.totalDialogues, 2, `mixed-dialogue: ${mixed.totalDialogues} dialogues`);
assert.deepEqual(mixed.shots.map(s => s.audioDialogue.replace(/["“”]/g, '')), ['Chào anh', 'Em đến rồi']);
assert.match(mixed.shots[0].action, /Camera: slow push in/, 'camera note was not attached to the shot');

// The full 120-scene episode lives on the user's Drive; check it when the mount is present.
const fullEpisode = join(homedir(), 'cloud/gdrive/1. YOUTUBE AUDIO/3. Kẻ Trừ Tà/2. BẢN NGẮN/Tập 04 - Bóng Quỷ (ch084-110)/8. DỰNG VIDEO/KTT_T04_ban-ngan_vi_image_prompts.txt');
if (existsSync(fullEpisode)) {
  const episode = await parseImportedScriptFile(readFileSync(fullEpisode, 'utf8'), 'ktt.txt', vault);
  assert.equal(episode.totalShots, 120, `KTT_T04 full episode: ${episode.totalShots} shots`);
} else {
  console.log('  (skipped KTT_T04 full episode: Drive not mounted)');
}

// Exit explicitly: open MessageChannel ports (used to yield during parsing) keep node alive.
process.exit(0);
