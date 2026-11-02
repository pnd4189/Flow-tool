// Translation of the free-text fields before prompting, with a scripted Flow.
// Run through flow-tools/_shared/scripts/check-snapshot.sh.
import assert from 'node:assert/strict';
import { needsTranslation, translateConfigFields } from '../source/services/translate';
import { INITIAL_CONFIG } from '../source/constants';

function scriptText(handler: (prompt: string, options: any) => string | Error) {
  const calls: Array<{ prompt: string; options: any }> = [];
  (globalThis as any).__flowStub = {
    generate: {
      text: async (prompt: string, options: any) => {
        calls.push({ prompt, options });
        const reply = handler(prompt, options);
        if (reply instanceof Error) throw reply;
        return { text: reply };
      },
    },
  };
  return calls;
}
const english = { ...INITIAL_CONFIG, roleOccupation: 'detective', distinctiveFeatures: 'small mole under the right eye', outfitDescription: 'black windbreaker with a hood', colorPalette: 'charcoal and neon green', extraNotes: 'keep head ratio at 7.5' };

assert.equal(needsTranslation('hello world 123'), false);
assert.equal(needsTranslation('Nốt ruồi nhỏ'), true);
assert.equal(needsTranslation(''), false);

// Pure English text never calls Flow.
let calls = scriptText(() => new Error('must not be called'));
let out = await translateConfigFields(english);
assert.equal(calls.length, 0);
assert.deepEqual(out, english);

// Vietnamese fields are translated in ONE call; names and tags are untouched; the same text is cached.
const vietnamese = { ...english, displayName: 'Minh Trí', tag: 'minh_tri', roleOccupation: 'Thám tử tự do', distinctiveFeatures: 'Nốt ruồi nhỏ dưới khóe mắt phải', extraNotes: '' };
calls = scriptText(() => JSON.stringify({ roleOccupation: 'freelance detective', distinctiveFeatures: 'a small mole under the right eye corner' }));
out = await translateConfigFields(vietnamese);
assert.equal(calls.length, 1);
assert.match(calls[0].options.systemInstruction, /25 words/, 'translations must be asked to stay short');
assert.match(calls[0].prompt, /Thám tử tự do/);
assert.doesNotMatch(calls[0].prompt, /black windbreaker/, 'English fields do not need translating');
assert.equal(out.roleOccupation, 'freelance detective');
assert.equal(out.distinctiveFeatures, 'a small mole under the right eye corner');
assert.equal(out.displayName, 'Minh Trí');
assert.equal(out.tag, 'minh_tri');
assert.equal(out.outfitDescription, english.outfitDescription);
await translateConfigFields(vietnamese);
assert.equal(calls.length, 1, 'second run with the same text must hit the cache');

// Code fences around the JSON are tolerated.
const fenced = { ...english, roleOccupation: 'Người kể chuyện' };
scriptText(() => '```json\n{"roleOccupation":"storyteller"}\n```');
assert.equal((await translateConfigFields(fenced)).roleOccupation, 'storyteller');

// Any failure keeps the original text and never throws.
const failing = { ...english, roleOccupation: 'Bác sĩ pháp y' };
scriptText(() => new Error('Flow is down'));
assert.equal((await translateConfigFields(failing)).roleOccupation, 'Bác sĩ pháp y');
const garbage = { ...english, roleOccupation: 'Thợ rèn kiếm' };
scriptText(() => 'sorry, I cannot do that');
assert.equal((await translateConfigFields(garbage)).roleOccupation, 'Thợ rèn kiếm');

// A missing key keeps that field's original text.
const partial = { ...english, roleOccupation: 'Nhà thám hiểm', extraNotes: 'Giữ tỷ lệ đầu 7.5' };
scriptText(() => JSON.stringify({ roleOccupation: 'explorer' }));
out = await translateConfigFields(partial);
assert.equal(out.roleOccupation, 'explorer');
assert.equal(out.extraNotes, 'Giữ tỷ lệ đầu 7.5');

// Exit explicitly: the 30 s timeout timer would keep node alive.
process.exit(0);
