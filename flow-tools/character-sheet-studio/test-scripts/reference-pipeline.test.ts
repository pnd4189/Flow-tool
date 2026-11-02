// What is sent to Flow for a generation: which references are uploaded, whether the face is analysed,
// and how the prompt numbers the reference images. Scripted Flow. Run through check-snapshot.sh.
import assert from 'node:assert/strict';
import { prepareGenerationRefs } from '../source/services/referencePipeline';

const ref = (id: string, kind: 'face' | 'outfit', mediaId: string | null) =>
  ({ id, kind, name: `${id}.jpg`, thumb: '', base64: 'AAAA', mimeType: 'image/jpeg', mediaId, source: 'file', status: 'ready' }) as any;
const FACE_JSON = JSON.stringify({ summary: 'Round face, dark eyes', faceShape: 'round', eyes: 'dark', brows: '', nose: '', lips: '', skinTone: '', hair: '', facialHair: '', ageImpression: '', distinctiveMarks: '' });

function scriptFlow(options: { uploadMediaId?: (n: number) => string } = {}) {
  const calls = { uploads: [] as string[], texts: 0 };
  let n = 0;
  (globalThis as any).__flowStub = {
    upload: async (input: { name: string }) => { calls.uploads.push(input.name); n += 1; return { mediaId: options.uploadMediaId ? options.uploadMediaId(n) : `U${n}` }; },
    generate: { text: async () => { calls.texts += 1; return { text: FACE_JSON }; } },
  };
  return calls;
}
const base = { faceDna: null, outfitDna: '', faceLocked: false } as const;

// Face source AI: faces are ignored (not uploaded, not analysed); only the outfit goes up.
let calls = scriptFlow();
let out = await prepareGenerationRefs({ ...base, faceSource: 'ai', faceRefs: [ref('f1', 'face', null)], outfitRefs: [ref('o1', 'outfit', null)] });
assert.deepEqual(calls.uploads, ['o1.jpg']);
assert.equal(calls.texts, 0);
assert.deepEqual(out.referenceMediaIds, ['U1']);
assert.equal(out.promptRefs.faceCount, 0);
assert.equal(out.promptRefs.outfitCount, 1);

// Face source upload, face not locked yet: upload everything, analyse the face once, faces first.
calls = scriptFlow();
out = await prepareGenerationRefs({ ...base, faceSource: 'upload', faceRefs: [ref('f1', 'face', null), ref('f2', 'face', null)], outfitRefs: [ref('o1', 'outfit', null)] });
assert.equal(calls.uploads.length, 3);
assert.equal(calls.texts, 1);
assert.deepEqual(out.referenceMediaIds, ['U1', 'U2', 'U3']);
assert.equal(out.promptRefs.faceCount, 2);
assert.equal(out.promptRefs.outfitCount, 1);
assert.match(out.promptRefs.faceDna ?? '', /Round face/);
assert.ok(out.faceDna && out.faceDna.summary === 'Round face, dark eyes', 'the new analysis is returned so the UI can store it');
assert.equal(out.faceRefs.every(r => r.mediaId), true);

// Face already locked with a description: no analysis, and refs that already have a mediaId are not re-uploaded.
calls = scriptFlow();
const dna = { summary: 'Edited by the user', details: { faceShape: '', eyes: '', brows: '', nose: '', lips: '', skinTone: '', hair: '', facialHair: '', ageImpression: '', distinctiveMarks: '' } };
out = await prepareGenerationRefs({ faceSource: 'upload', faceRefs: [ref('f1', 'face', 'KEEP1')], outfitRefs: [ref('o1', 'outfit', 'KEEP2')], faceDna: dna, outfitDna: 'navy blazer', faceLocked: true });
assert.equal(calls.uploads.length, 0);
assert.equal(calls.texts, 0);
assert.deepEqual(out.referenceMediaIds, ['KEEP1', 'KEEP2']);
assert.match(out.promptRefs.faceDna ?? '', /Edited by the user/, 'the user-edited description is what the prompt uses');
assert.equal(out.promptRefs.outfitDna, 'navy blazer');
assert.equal(out.promptRefs.outfitCount, 1);

// The outfit description is only sent together with outfit images.
calls = scriptFlow();
out = await prepareGenerationRefs({ faceSource: 'ai', faceRefs: [], outfitRefs: [], faceDna: null, outfitDna: 'left over text', faceLocked: false });
assert.equal(out.promptRefs.outfitCount, 0);
assert.equal(out.promptRefs.outfitDna, undefined);

// Upload source without any face image: nothing is sent and nothing throws.
calls = scriptFlow();
out = await prepareGenerationRefs({ ...base, faceSource: 'upload', faceRefs: [], outfitRefs: [] });
assert.deepEqual(out.referenceMediaIds, []);
assert.equal(out.promptRefs.faceCount, 0);

// Counts follow the ids actually sent: a face whose upload returned no id is dropped from the numbering.
calls = scriptFlow({ uploadMediaId: n => (n === 2 ? '' : `U${n}`) });
out = await prepareGenerationRefs({ ...base, faceSource: 'upload', faceRefs: [ref('f1', 'face', null), ref('f2', 'face', null)], outfitRefs: [ref('o1', 'outfit', null)] });
assert.deepEqual(out.referenceMediaIds, ['U1', 'U3']);
assert.equal(out.promptRefs.faceCount, 1);
assert.equal(out.promptRefs.outfitCount, 1);

// An upload failure stops the run with an error.
(globalThis as any).__flowStub = { upload: async () => { throw new Error('upload failed'); }, generate: { text: async () => ({ text: FACE_JSON }) } };
await assert.rejects(prepareGenerationRefs({ ...base, faceSource: 'upload', faceRefs: [ref('f1', 'face', null)], outfitRefs: [] }), /upload failed/);

// Stages are reported in order.
const stages: string[] = [];
scriptFlow();
await prepareGenerationRefs({ ...base, faceSource: 'upload', faceRefs: [ref('f1', 'face', null)], outfitRefs: [], onStage: s => stages.push(s) });
assert.deepEqual(stages, ['uploading', 'analyzing']);

process.exit(0);
