// Reference images (face and outfit): validation, sizing, id selection, Face DNA parsing and the
// reference wording of the prompt, with a scripted Flow. Run through check-snapshot.sh.
import assert from 'node:assert/strict';
import { MAX_FACE_REFS, MAX_OUTFIT_REFS, fitWithin, validateFile } from '../source/services/refImages';
import { applyFaceDnaToConfig, describeFace, describeOutfit, faceDnaToConfigPatch, formatFaceDna } from '../source/services/faceDna';
import { buildReferenceIds } from '../source/services/referenceIds';
import { buildSheetPrompt } from '../source/services/promptBuilder';
import { INITIAL_CONFIG } from '../source/constants';

assert.equal(MAX_FACE_REFS, 3);
assert.equal(MAX_OUTFIT_REFS, 4);

// Sizing keeps the aspect ratio and never upscales.
assert.deepEqual(fitWithin(4000, 3000, 1536), { width: 1536, height: 1152 });
assert.deepEqual(fitWithin(3000, 4000, 1536), { width: 1152, height: 1536 });
assert.deepEqual(fitWithin(800, 600, 1536), { width: 800, height: 600 });

// File validation: png/jpeg/webp up to 12 MB, with a Vietnamese reason otherwise.
assert.deepEqual(validateFile({ name: 'a.png', type: 'image/png', size: 1000 }), { ok: true });
assert.deepEqual(validateFile({ name: 'a.webp', type: 'image/webp', size: 1000 }), { ok: true });
for (const bad of [{ name: 'a.gif', type: 'image/gif', size: 10 }, { name: 'a', type: '', size: 10 }, { name: 'a.pdf', type: 'application/pdf', size: 10 }]) {
  const result = validateFile(bad);
  assert.equal(result.ok, false, bad.name);
}
const tooBig = validateFile({ name: 'big.jpg', type: 'image/jpeg', size: 13 * 1024 * 1024 });
assert.equal(tooBig.ok, false);
assert.match((tooBig as { error: string }).error, /12/);

// Reference ids: faces first, only refs that have a mediaId, unique, at most 10.
const ref = (id: string, kind: 'face' | 'outfit', mediaId: string | null) => ({ id, kind, name: id, thumb: '', base64: '', mimeType: 'image/jpeg', mediaId, source: 'file', status: 'ready' }) as any;
assert.deepEqual(
  buildReferenceIds([ref('f1', 'face', 'M1'), ref('f2', 'face', null), ref('f3', 'face', 'M1')], [ref('o1', 'outfit', 'M2')]),
  ['M1', 'M2'],
);
const many = buildReferenceIds(
  Array.from({ length: 3 }, (_, i) => ref(`f${i}`, 'face', `F${i}`)),
  Array.from({ length: 9 }, (_, i) => ref(`o${i}`, 'outfit', `O${i}`)),
);
assert.equal(many.length, 10);
assert.deepEqual(many.slice(0, 3), ['F0', 'F1', 'F2']);

// Face DNA through a scripted Flow.generate.text.
function scriptText(reply: string | Error) {
  const calls: Array<{ prompt: string; options: any }> = [];
  (globalThis as any).__flowStub = {
    generate: { text: async (prompt: string, options: any) => { calls.push({ prompt, options }); if (reply instanceof Error) throw reply; return { text: reply }; } },
  };
  return calls;
}
const faceJson = { summary: 'Oval face, calm brown eyes', faceShape: 'oval', eyes: 'almond brown', brows: 'straight', nose: 'narrow', lips: 'thin', skinTone: 'warm beige', hair: 'short black', facialHair: 'none', ageImpression: 'mid-twenties', distinctiveMarks: 'mole under the right eye' };
let calls = scriptText('```json\n' + JSON.stringify(faceJson) + '\n```');
const faces = [ref('f1', 'face', 'M1'), ref('f2', 'face', 'M2')];
let dna = await describeFace(faces);
assert.equal(dna.summary, 'Oval face, calm brown eyes');
assert.equal(dna.details.eyes, 'almond brown');
assert.equal(calls.length, 1);
assert.equal(calls[0].options.images.length, 2, 'every face image is sent to the model');
const text = formatFaceDna(dna);
assert.ok(text.includes('Oval face') && text.includes('mole under the right eye'));
assert.equal(formatFaceDna({ summary: '', details: {} as any }), '');
const longDna = { summary: 'S'.repeat(300), details: { faceShape: 'a'.repeat(200), eyes: 'b'.repeat(200), brows: 'c'.repeat(200), nose: 'd'.repeat(200), lips: 'e'.repeat(200), skinTone: 'f'.repeat(200), hair: 'g'.repeat(200), facialHair: 'h'.repeat(200), ageImpression: 'i'.repeat(200), distinctiveMarks: 'j'.repeat(200) } };
assert.ok(formatFaceDna(longDna).length <= 420, 'the face description used in the prompt is capped at 420 characters');
assert.ok(formatFaceDna(longDna).startsWith('S'), 'the summary comes first so the clip never drops it');
// The analysis also reports gender and age group so the config can follow the photo.
scriptText(JSON.stringify({ ...faceJson, genderImpression: 'female', ageGroupGuess: 'middle_aged' }));
dna = await describeFace(faces);
assert.equal(dna.genderImpression, 'female');
assert.equal(dna.ageGroupGuess, 'middle_aged');
assert.deepEqual(faceDnaToConfigPatch(dna), { gender: 'female', ageGroup: 'middle_aged', numericAge: null });
scriptText(JSON.stringify({ ...faceJson, genderImpression: 'male', ageGroupGuess: 'teen' }));
assert.deepEqual(faceDnaToConfigPatch(await describeFace(faces)), { gender: 'male', ageGroup: 'teen', numericAge: null });
scriptText(JSON.stringify({ ...faceJson, genderImpression: 'ambiguous', ageGroupGuess: 'senior citizen' }));
dna = await describeFace(faces);
assert.equal(dna.ageGroupGuess, '', 'an unknown age group is dropped');
assert.deepEqual(faceDnaToConfigPatch(dna), {}, 'nothing is auto-filled when the model is unsure');
scriptText(JSON.stringify(faceJson));
assert.deepEqual(faceDnaToConfigPatch(await describeFace(faces)), {}, 'missing fields change nothing');
assert.deepEqual(faceDnaToConfigPatch(null), {});

// Generating straight from a photo (without pressing "lock") must follow the photo too: a live run drew a visibly
// younger woman because the default age 24 stayed in the prompt for a reference of a woman of about 60.
{
  const guessed: any = { summary: 'x', genderImpression: 'female', ageGroupGuess: 'elderly', details: {} };
  const upload = { ...INITIAL_CONFIG, faceSource: 'upload' as const, gender: 'male' as const, ageGroup: 'young_adult' as const, numericAge: 24 };
  const followed = applyFaceDnaToConfig(upload, guessed);
  assert.equal(followed.gender, 'female');
  assert.equal(followed.ageGroup, 'elderly');
  assert.equal(followed.numericAge, null);
  assert.doesNotMatch(buildSheetPrompt(followed, { faceCount: 1, outfitCount: 0, faceDna: 'Mature face' }), /young adult|age 24/i);
  const ai = { ...INITIAL_CONFIG, faceSource: 'ai' as const };
  assert.deepEqual(applyFaceDnaToConfig(ai, guessed), ai, 'an AI-made face keeps the user choices');
  assert.deepEqual(applyFaceDnaToConfig(upload, null), upload, 'no analysis changes nothing');
  assert.equal(upload.numericAge, 24, 'the original config is not mutated');
}

calls = scriptText(JSON.stringify({ summary: 'Only a summary' }));
dna = await describeFace(faces);
assert.equal(dna.details.nose, '', 'missing keys become empty strings');
scriptText('I cannot describe this');
assert.equal((await describeFace(faces)).summary, '', 'unparseable reply degrades to an empty description');
scriptText(new Error('Flow is down'));
await assert.rejects(describeFace(faces));
scriptText('A navy wool blazer over a white shirt, grey trousers, brown loafers.');
assert.match(await describeOutfit([ref('o1', 'outfit', 'M3')]), /navy wool blazer/);

// The prompt refers to reference images by number; faces only count when the face source is 'upload'.
const upload = { ...INITIAL_CONFIG, faceSource: 'upload' as const };
let prompt = buildSheetPrompt(upload, { faceCount: 2, faceDna: 'oval face with almond eyes', outfitCount: 1, outfitDna: 'navy blazer' });
assert.match(prompt, /Reference images 1-2/);
assert.match(prompt, /Reference image 3/);
assert.ok(prompt.includes('oval face with almond eyes') && prompt.includes('navy blazer'));
assert.match(prompt, /recognis/i, '2D styles must keep the real face recognisable');
assert.ok(!/Director/i.test(prompt));
prompt = buildSheetPrompt(upload, { faceCount: 0, outfitCount: 0 });
assert.ok(!/Reference image/i.test(prompt));
prompt = buildSheetPrompt({ ...INITIAL_CONFIG, faceSource: 'ai' }, { faceCount: 2, faceDna: 'should be ignored', outfitCount: 1, outfitDna: 'navy blazer' });
assert.ok(!prompt.includes('should be ignored'), 'faces are ignored when the face source is AI');
assert.match(prompt, /Reference image 1\b/, 'outfit numbering starts at 1 when no face is used');
assert.match(buildSheetPrompt(INITIAL_CONFIG), /Canvas aspect ratio/);

process.exit(0);
