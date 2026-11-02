// Variants of an approved sheet: which changes apply, and the prompt that keeps the character.
// Run through flow-tools/_shared/scripts/check-snapshot.sh.
import assert from 'node:assert/strict';
import { FINAL_NO_TEXT_SENTENCE, MAX_PROMPT_CHARS } from '../source/services/promptBuilder';
import { INITIAL_CONFIG, SHEET_LAYOUTS, ASPECT_RATIOS } from '../source/constants';
import { applyVariantChanges, buildVariantPrompt, describeVariantChanges, hasVariantChanges } from '../source/services/variant';

// Which edits count as a change.
assert.equal(hasVariantChanges({}), false);
assert.equal(hasVariantChanges({ outfitDescription: '   ', extra: '' }), false, 'blank text is not a change');
assert.equal(hasVariantChanges({ outfitPreset: 'business' }), true);
assert.equal(hasVariantChanges({ extra: 'holding a red umbrella' }), true);

// Applying changes returns a new config and leaves everything else (and the input) untouched.
const before = JSON.stringify(INITIAL_CONFIG);
const next = applyVariantChanges(INITIAL_CONFIG, { outfitPreset: 'business', hairStyle: 'long_wavy', expression: 'gentle_smile', background: 'pure_white' });
assert.equal(JSON.stringify(INITIAL_CONFIG), before, 'the original config must not be mutated');
assert.equal(next.outfitPreset, 'business');
assert.equal(next.hairStyle, 'long_wavy');
assert.equal(next.expression, 'gentle_smile');
assert.equal(next.background, 'pure_white');
assert.equal(next.tag, INITIAL_CONFIG.tag);
assert.equal(next.layoutId, INITIAL_CONFIG.layoutId);
assert.equal(next.aspectRatio, INITIAL_CONFIG.aspectRatio);
assert.equal(applyVariantChanges(INITIAL_CONFIG, { outfitDescription: 'navy blazer' }).outfitDescription, 'navy blazer');
assert.equal(applyVariantChanges(INITIAL_CONFIG, {}).outfitPreset, INITIAL_CONFIG.outfitPreset);

// The change summary lists only what changed.
assert.equal(describeVariantChanges({}), '');
const summary = describeVariantChanges({ outfitPreset: 'business', expression: 'gentle_smile', extra: 'holding a red umbrella' });
assert.match(summary, /outfit/i);
assert.match(summary, /expression/i);
assert.match(summary, /red umbrella/);
assert.doesNotMatch(summary, /hair|background/i);

// The variant prompt keeps the character and changes only what was asked.
const changes = { outfitPreset: 'business' as const, extra: 'holding a red umbrella' };
const prompt = buildVariantPrompt(applyVariantChanges(INITIAL_CONFIG, changes), changes, { faceCount: 0 });
assert.match(prompt, /Reference image 1/);
assert.match(prompt, /approved/i);
assert.match(prompt, /same (character|person)/i);
assert.match(prompt, /red umbrella/);
assert.match(prompt, /Keep everything else identical/i);
assert.match(prompt, /Canvas aspect ratio 16:9/);
assert.doesNotMatch(prompt, /gentle|laughing|angry/i, 'unchanged fields are not re-described');
assert.ok(prompt.endsWith(FINAL_NO_TEXT_SENTENCE), 'the no-text rule stays the last sentence');

// Accessories belong to the identity: they are restated when the variant does not change them.
assert.match(buildVariantPrompt({ ...INITIAL_CONFIG, accessories: ['glasses'] }, { outfitPreset: 'business' }, { faceCount: 0 }), /glasses|eyeglasses/i, 'glasses were dropped in a real run');
assert.doesNotMatch(buildVariantPrompt({ ...INITIAL_CONFIG, accessories: [] }, { outfitPreset: 'business' }, { faceCount: 0 }), /glasses|eyeglasses/i);

// With face references the numbering continues after the approved sheet.
const withFace = buildVariantPrompt(INITIAL_CONFIG, { expression: 'laughing' }, { faceCount: 2 });
assert.match(withFace, /Reference images 2-3/);
assert.match(withFace, /laugh/i);

// Every layout and aspect stays within the budget, even with long free text.
const long = { outfitDescription: 'lantern '.repeat(120).trim(), extra: 'lantern '.repeat(180).trim(), outfitPreset: 'custom' as const };
for (const layout of SHEET_LAYOUTS) {
  for (const aspectRatio of ASPECT_RATIOS) {
    const config = { ...INITIAL_CONFIG, layoutId: layout.id, aspectRatio };
    const built = buildVariantPrompt(applyVariantChanges(config, long), long, { faceCount: 3 });
    assert.ok(built.length <= MAX_PROMPT_CHARS, `${layout.id}/${aspectRatio}: ${built.length} characters`);
    assert.ok(built.endsWith(FINAL_NO_TEXT_SENTENCE), `${layout.id}/${aspectRatio}: lost the final sentence`);
    assert.match(built, /Reference image 1/);
  }
}

process.exit(0);
