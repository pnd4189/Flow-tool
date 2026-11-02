// Saving and loading a work session, the character pack for video prompts, and the defaults applied
// when the face source switches to a photo. Run through check-snapshot.sh.
import assert from 'node:assert/strict';
import { INITIAL_CONFIG } from '../source/constants';
import { faceSourcePatch } from '../source/services/configRules';
import { buildCharacterPack } from '../source/services/pack';
import { parseSession, serializeSession } from '../source/services/session';

// Switching to a photo hands hair, expression, accessories and notes over to the photo.
assert.deepEqual(faceSourcePatch('upload'), { hairStyle: 'auto', hairColor: '', expression: 'original', accessories: [], distinctiveFeatures: '' });
assert.deepEqual(faceSourcePatch('ai'), {});

const dna = { summary: 'Round face, warm brown eyes', details: { faceShape: 'round', eyes: 'brown', brows: '', nose: '', lips: '', skinTone: 'fair', hair: 'short wavy brown', facialHair: '', ageImpression: '', distinctiveMarks: '' }, genderImpression: 'female', ageGroupGuess: 'middle_aged' } as any;
const item = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `h${n}`, createdAt: 1000 + n, config: { ...INITIAL_CONFIG, tag: `hero_${n}` }, promptUsed: `prompt ${n}`, mediaId: `media-${n}`,
  mimeType: 'image/jpeg', base64: 'FULLIMAGEDATA'.repeat(100), thumb: 'data:image/jpeg;base64,AAAA', rewriteRound: 0, favorite: n % 2 === 0,
  qc: { available: true, score: 80, viewCount: 4, expectedViews: 4, hasText: false, textFound: [], layoutOk: true, faceMatch: null, issues: [], verdict: 'ok' }, ...extra,
}) as any;

// Round trip keeps settings, descriptions and history, but never the full image data.
const config = { ...INITIAL_CONFIG, tag: 'hero_one', styleId: 'watercolor' as const, imageCount: 3 };
const text = serializeSession({ config, faceDna: dna, outfitDna: 'navy blazer', history: [item(1), item(2)] });
assert.ok(!text.includes('FULLIMAGEDATA'), 'full image data must not be saved');
const parsed = parseSession(text);
assert.equal(parsed.ok, true);
if (parsed.ok) {
  assert.equal(parsed.config.tag, 'hero_one');
  assert.equal(parsed.config.styleId, 'watercolor');
  assert.equal(parsed.config.imageCount, 3);
  assert.equal(parsed.faceDna?.summary, 'Round face, warm brown eyes');
  assert.equal(parsed.faceDna?.genderImpression, 'female');
  assert.equal(parsed.outfitDna, 'navy blazer');
  assert.deepEqual(parsed.history.map(h => h.id), ['h1', 'h2']);
  assert.equal(parsed.history[0].mediaId, 'media-1');
  assert.equal(parsed.history[0].base64, null);
  assert.equal(parsed.history[1].favorite, true);
  assert.equal(parsed.history[0].qc?.score, 80);
}

// Bad input is rejected with a message; it never throws.
for (const bad of ['not json', '{}', JSON.stringify({ app: 'something-else', version: 1 }), JSON.stringify({ app: 'character-sheet-studio', version: 999 })]) {
  const result = parseSession(bad);
  assert.equal(result.ok, false, bad);
  assert.ok(typeof (result as { error: string }).error === 'string' && (result as { error: string }).error.length > 0);
}

// An old session without the setting, or a nonsense value, means one candidate (the feature is off).
{
  const base = JSON.parse(text);
  delete base.config.qcCandidates;
  const none = parseSession(JSON.stringify(base));
  assert.equal(none.ok, true);
  if (none.ok) assert.ok((none.config.qcCandidates ?? 1) === 1);
  base.config.qcCandidates = -3;
  const low = parseSession(JSON.stringify(base));
  if (low.ok) assert.equal(low.config.qcCandidates, 1);
}
// Config values are validated against the catalogue and clamped.
const messy = JSON.parse(text);
messy.config = { ...messy.config, styleId: 'nonsense', tag: 'Hero Name!', imageCount: 99, qcMaxRetries: 9, qcCandidates: 99, layoutId: 'layout_z', aspectRatio: '7:5' };
const fixed = parseSession(JSON.stringify(messy));
assert.equal(fixed.ok, true);
if (fixed.ok) {
  assert.equal(fixed.config.styleId, INITIAL_CONFIG.styleId);
  assert.equal(fixed.config.tag, 'heroname');
  assert.equal(fixed.config.imageCount, 4);
  assert.equal(fixed.config.qcMaxRetries, 2);
  assert.equal(fixed.config.qcCandidates, 4, 'candidates are clamped to 1-4');
  assert.equal(fixed.config.layoutId, INITIAL_CONFIG.layoutId);
  assert.equal(fixed.config.aspectRatio, INITIAL_CONFIG.aspectRatio);
}

// History: at most 40 items, items without id or mediaId dropped, thumbnails must be image data URLs.
const many = Array.from({ length: 50 }, (_, n) => item(n));
const capped = parseSession(serializeSession({ config, faceDna: null, outfitDna: '', history: many }));
assert.equal(capped.ok && capped.history.length, 40);
const broken = JSON.parse(text);
broken.history = [{ ...broken.history[0], id: '' }, { ...broken.history[1], thumb: 'javascript:alert(1)' }, { ...broken.history[0], id: 'ok', mediaId: 'm' }];
const cleaned = parseSession(JSON.stringify(broken));
assert.equal(cleaned.ok, true);
if (cleaned.ok) {
  assert.ok(!cleaned.history.some(h => h.id === ''), 'an item without an id is dropped');
  assert.ok(cleaned.history.every(h => h.thumb === '' || h.thumb.startsWith('data:image/')), 'no non-image thumbnail survives');
}
const big = serializeSession({ config, faceDna: dna, outfitDna: '', history: Array.from({ length: 40 }, (_, n) => item(n, { thumb: 'data:image/jpeg;base64,' + 'A'.repeat(60000) })) });
assert.ok(big.length < 3_000_000, `session file has ${big.length} characters`);

// The character pack: a description to paste into video prompts, in English, with headings in the UI language.
const pack = buildCharacterPack({ ...INITIAL_CONFIG, tag: 'mai_linh', displayName: 'Mai Linh', styleId: 'modern_anime' }, { faceDna: 'Round face, warm brown eyes', outfitDna: 'navy blazer over a white shirt' }, 'vi');
assert.match(pack, /mai_linh/);
assert.match(pack, /Round face, warm brown eyes/);
assert.match(pack, /navy blazer/);
assert.match(pack, /Strictly 2D/i);
assert.match(pack, /NHÂN VẬT/);
assert.doesNotMatch(pack, /Director/i);
assert.doesNotMatch(pack, /#[0-9a-f]{6}/i, 'hair and colours are described in words');
// The one-paragraph CHARACTER block says each thing once and is clean prose.
const block = pack.split('\n').find(line => line.startsWith('CHARACTER:')) ?? '';
assert.ok(block.length > 100, 'the CHARACTER block is missing');
assert.ok((block.match(/hair/gi) ?? []).length <= 2, 'hair is described more than once');
assert.ok((block.match(/expression/gi) ?? []).length <= 1, 'expression is described more than once');
assert.ok(!/\.\./.test(block), 'double full stop in the CHARACTER block');
assert.doesNotMatch(block, /Heritage:|Accessories:|Distinctive marks:/, 'the CHARACTER block must be prose, not the section labels');

const enPack = buildCharacterPack({ ...INITIAL_CONFIG, styleId: 'photorealistic' }, { faceDna: '', outfitDna: '' }, 'en');
assert.match(enPack, /CHARACTER/);
assert.doesNotMatch(enPack, /NHÂN VẬT/);
assert.doesNotMatch(enPack, /Strictly 2D/i, 'a photoreal character is not described as 2D');
assert.match(enPack, /reference/i, 'the pack tells how to use the sheet as a reference');
assert.ok(pack.endsWith('\n'));

process.exit(0);
