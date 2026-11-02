// Prompt builder, option catalogue and i18n invariants of Character Sheet Studio.
// Run through flow-tools/_shared/scripts/check-snapshot.sh.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_PROMPT_CHARS, buildSheetPrompt, describeHairColor, sanitizeTag } from '../source/services/promptBuilder';
import { DICTIONARY } from '../source/services/i18n';
import * as C from '../source/constants';

const failures: string[] = [];
function check(name: string, action: () => void) {
  try { action(); } catch (error) { failures.push(`${name}: ${(error as Error).message}`); }
}

const vi = DICTIONARY.vi;
const en = DICTIONARY.en;
const VIETNAMESE_LETTER = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

check('i18n: VI and EN have identical keys', () => {
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort());
});
check('i18n: no empty values and the same {placeholders} in both languages', () => {
  const placeholders = (s: string) => (s.match(/\{[a-zA-Z_]+\}/g) ?? []).sort().join(',');
  for (const key of Object.keys(vi)) {
    assert.ok(vi[key]?.trim(), `empty VI value for ${key}`);
    assert.ok(en[key]?.trim(), `empty EN value for ${key}`);
    assert.equal(placeholders(vi[key]), placeholders(en[key]), `placeholders differ for ${key}`);
  }
});

const keyedOptions: Array<[string, Array<{ labelKey: string; descKey?: string }>]> = [
  ['VISUAL_STYLES', C.VISUAL_STYLES], ['SHEET_LAYOUTS', C.SHEET_LAYOUTS], ['ETHNICITY', C.ETHNICITY_OPTIONS],
  ['AGE_GROUP', C.AGE_GROUP_OPTIONS], ['BODY_TYPE', C.BODY_TYPE_OPTIONS], ['HAIR_STYLE', C.HAIR_STYLE_OPTIONS],
  ['EXPRESSION', C.EXPRESSION_OPTIONS], ['ACCESSORY', C.ACCESSORY_OPTIONS], ['OUTFIT_PRESET', C.OUTFIT_PRESET_OPTIONS],
  ['FOOTWEAR', C.FOOTWEAR_OPTIONS], ['BACKGROUND', C.BACKGROUND_OPTIONS], ['POSE', C.POSE_OPTIONS],
];
check('every option has a label (and description) in both languages', () => {
  for (const [name, list] of keyedOptions) {
    for (const option of list) {
      for (const key of [option.labelKey, option.descKey].filter(Boolean) as string[]) {
        assert.ok(vi[key] && en[key], `${name}: missing translation for ${key}`);
      }
    }
  }
});
check('option catalogues carry no hard-coded Vietnamese (UI text must come from i18n keys)', () => {
  const lists: Array<[string, unknown[]]> = [...keyedOptions, ['PRESET_HAIR_COLORS', C.PRESET_HAIR_COLORS]];
  for (const [name, list] of lists) {
    for (const option of list as Array<Record<string, unknown>>) {
      for (const [field, value] of Object.entries(option)) {
        assert.ok(!(typeof value === 'string' && VIETNAMESE_LETTER.test(value)), `${name}.${field} = "${value}"`);
      }
    }
  }
});

check('components do not branch on the language inline (use t() keys)', () => {
  const dir = join(process.env.TOOL_DIR ?? '', 'source', 'components');
  const offenders: string[] = [];
  for (const file of readdirSync(dir).filter(name => name.endsWith('.tsx'))) {
    readFileSync(join(dir, file), 'utf8').split('\n').forEach((line, index) => {
      if (/lang\s*===\s*['"](vi|en)['"]\s*\?/.test(line)) offenders.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

check('sanitizeTag keeps a-z, 0-9, _ and at most 24 characters', () => {
  assert.equal(sanitizeTag('  Nhân Vật_01!! '), 'nhnvt_01');
  assert.equal(sanitizeTag('A'.repeat(40)).length, 24);
  assert.equal(sanitizeTag('@Hero Name'), 'heroname');
});

const FORBIDDEN = /\b(nude|nudity|naked|gore|gory|blood|bloody|celebrity)\b|Avoid:/i;
const BRANDS = /pixar|dreamworks|hasselblad|octane|disney|ghibli|marvel|nvidia/i;
const BAD_ARTICLE = /\ban (male|female)\b|\ba androgynous\b/i;
const base = C.INITIAL_CONFIG;
check('every style x layout x aspect x gender yields a clean prompt', () => {
  for (const style of C.VISUAL_STYLES) {
    for (const layout of C.SHEET_LAYOUTS) {
      for (const aspectRatio of C.ASPECT_RATIOS) {
        for (const gender of ['male', 'female', 'other'] as const) {
          const config = { ...base, styleId: style.id, layoutId: layout.id, aspectRatio, gender };
          const prompt = buildSheetPrompt(config);
          const label = `${style.id}/${layout.id}/${aspectRatio}/${gender}`;
          assert.ok(prompt.length > 500 && prompt.length < 3800, `${label}: length ${prompt.length}`);
          assert.ok(!FORBIDDEN.test(prompt), `${label}: contains a policy-trigger word`);
          assert.ok(!BRANDS.test(prompt), `${label}: names a studio or brand`);
          assert.ok(!BAD_ARTICLE.test(prompt), `${label}: wrong article before gender`);
          if (style.id === 'photorealistic') assert.ok(!/2D/.test(prompt), `${label}: photoreal prompt says 2D`);
          else if (style.id !== 'watercolor' && style.id !== 'us_comic' && style.id !== '3d_animation' && style.id !== 'chibi' && style.id !== 'manga_bw') {
            assert.ok(/not photorealistic/i.test(prompt), `${label}: 2D prompt must say not photorealistic`);
          }
        }
      }
    }
  }
});

check('layout text follows the canvas orientation', () => {
  const landscape = buildSheetPrompt({ ...base, layoutId: 'layout_a', aspectRatio: '16:9' });
  const square = buildSheetPrompt({ ...base, layoutId: 'layout_a', aspectRatio: '1:1' });
  const portrait = buildSheetPrompt({ ...base, layoutId: 'layout_a', aspectRatio: '9:16' });
  assert.notEqual(landscape, portrait);
  assert.notEqual(square, portrait);
  assert.ok(landscape.includes('16:9') && portrait.includes('9:16') && square.includes('1:1'), 'prompt must state the aspect ratio');
  assert.ok(/\bleft\b/i.test(landscape), 'landscape layout A is a left/right split');
  assert.ok(!/\bleft\b|\bright\b/i.test(portrait), 'portrait canvas must not describe a left/right split');
  assert.ok(/\btop\b/i.test(portrait) && /\bbottom\b/i.test(portrait), 'portrait canvas stacks the portrait above the views');
});

check('hair colour is described in words, never as a hex code', () => {
  for (const hex of ['#1a181b', '#795548', '#eceff1', '#ff00aa']) {
    const prompt = buildSheetPrompt({ ...base, hairStyle: 'short', hairColor: hex });
    const hairSentence = /Hairstyle: ([^.]*)\./.exec(prompt)?.[1] ?? '';
    assert.ok(hairSentence && !hairSentence.includes('#'), `hair phrase for ${hex}: "${hairSentence}"`);
  }
});

check('user notes are phrased as silent visual requirements and the no-text rule comes last', () => {
  const prompt = buildSheetPrompt({ ...base, distinctiveFeatures: 'small mole under the right eye', extraNotes: 'keep head ratio at 7.5 heads' });
  assert.ok(!/Director/i.test(prompt), 'the word "Director" invites the model to write notes in the picture');
  assert.match(prompt, /never write them as text/i);
  assert.match(prompt, /never as labels or writing/i);
  const tail = prompt.slice(-420);
  assert.match(tail, /no text/i);
  assert.match(tail, /callouts?/i);
  assert.match(tail, /arrows?/i);
});

// Measured on Flow: a 3,097-character prompt with one reference image generates, while 4,190 and 4,300
// characters are rejected within milliseconds ("Dịch vụ tạo hình ảnh không hoạt động"). Stay well below.
check('the prompt budget is a safe fraction of the measured failing length', () => {
  assert.ok(MAX_PROMPT_CHARS <= 3500, `MAX_PROMPT_CHARS = ${MAX_PROMPT_CHARS}`);
});
check('default prompt is compact', () => {
  const length = buildSheetPrompt(base).length;
  assert.ok(length <= 2600, `default prompt has ${length} characters`);
});
check('prompt stays within the budget with maximum free text and references', () => {
  const words = (n: number) => 'lantern '.repeat(n).trim();
  const heavy = { ...base, faceSource: 'upload' as const, roleOccupation: words(60), distinctiveFeatures: words(120), outfitDescription: words(120), colorPalette: words(60), extraNotes: words(180) };
  const refs = { faceCount: 3, faceDna: words(300), outfitCount: 4, outfitDna: words(300) };
  for (const style of C.VISUAL_STYLES) {
    for (const layout of C.SHEET_LAYOUTS) {
      for (const aspectRatio of C.ASPECT_RATIOS) {
        const length = buildSheetPrompt({ ...heavy, styleId: style.id, layoutId: layout.id, aspectRatio }, refs).length;
        assert.ok(length <= MAX_PROMPT_CHARS, `${style.id}/${layout.id}/${aspectRatio}: ${length} > ${MAX_PROMPT_CHARS}`);
      }
    }
  }
});
check('the budget keeps the essentials: aspect ratio, the no-text rule and the reference wording', () => {
  const words = (n: number) => 'lantern '.repeat(n).trim();
  const prompt = buildSheetPrompt({ ...base, faceSource: 'upload', extraNotes: words(400), outfitDescription: words(400) }, { faceCount: 2, faceDna: words(300), outfitCount: 1, outfitDna: words(300) });
  assert.match(prompt, /Canvas aspect ratio/);
  assert.match(prompt.slice(-420), /no text/i);
  assert.match(prompt, /Reference images 1-2/);
  assert.match(prompt, /Reference image 3/);
});

const uploadRefs = { faceCount: 1, faceDna: 'oval face, warm smile', outfitCount: 0 };
check('face from a photo: hair and expression can follow the photo', () => {
  const prompt = buildSheetPrompt({ ...base, faceSource: 'upload', hairStyle: 'auto', hairColor: '', expression: 'original' }, uploadRefs);
  assert.match(prompt, /hair exactly as in the reference photo/i);
  assert.doesNotMatch(prompt, /signature [^.]*hairstyle/i);
  assert.match(prompt, /expression of the reference photo/i);
  assert.doesNotMatch(prompt, /jet black/i, 'an empty hair colour must not be replaced by a default colour');
});
check('an explicit hair choice still overrides the photo', () => {
  const prompt = buildSheetPrompt({ ...base, faceSource: 'upload', hairStyle: 'short', hairColor: '#795548' }, uploadRefs);
  assert.match(prompt, /chestnut/i);
  assert.doesNotMatch(prompt, /hair exactly as in the reference photo/i);
});
check('without a photo, auto hair and original expression keep their old meaning', () => {
  const prompt = buildSheetPrompt({ ...base, faceSource: 'ai', hairStyle: 'auto', expression: 'original' });
  assert.match(prompt, /signature [^.]*hairstyle/i);
  assert.doesNotMatch(prompt, /reference photo/i);
  assert.match(prompt, /neutral/i);
});
check('face fidelity strict puts the identity instruction first; other levels do not', () => {
  const strict = buildSheetPrompt({ ...base, faceSource: 'upload', faceFidelity: 'strict' }, uploadRefs);
  assert.match(strict.slice(0, 450), /unmistakably the same person/i);
  assert.match(strict.slice(0, 450), /Reference image 1/);
  for (const level of ['balanced', 'stylized'] as const) {
    const prompt = buildSheetPrompt({ ...base, faceSource: 'upload', faceFidelity: level }, uploadRefs);
    assert.doesNotMatch(prompt, /unmistakably/i, level);
  }
  assert.match(buildSheetPrompt({ ...base, faceSource: 'upload', faceFidelity: 'stylized' }, uploadRefs), /stylis/i);
});
check('INITIAL_CONFIG defaults the fidelity to balanced', () => {
  assert.equal((base as any).faceFidelity, 'balanced');
});

// The tile says "A + 4 expressions", and the reference tool offers exactly that sheet: large portrait,
// three full-body views and four expression vignettes. A live run of layout C drew only two bodies.
check('layout C is A + 4 expressions: portrait, three full-body views and four expressions', () => {
  for (const aspectRatio of C.ASPECT_RATIOS) {
    const prompt = buildSheetPrompt({ ...base, layoutId: 'layout_c', aspectRatio });
    assert.match(prompt, /portrait/i, `${aspectRatio}: no portrait`);
    assert.match(prompt, /(three|3)[^.]{0,40}full-body/i, `${aspectRatio}: not three full-body views`);
    assert.match(prompt, /(four|4)[^.]{0,40}expression/i, `${aspectRatio}: not four expressions`);
  }
});

// A live run drew a mole and glasses on a character who never asked for them, and the 2D-only
// "head ratio / line weight" note leaked into a photoreal sheet. Nothing the user did not choose may ship.
check('INITIAL_CONFIG ships no hidden free text, accessories or notes', () => {
  assert.deepEqual(base.accessories, []);
  // A typed outfit must never be mixed with a garment list the user did not pick: live runs drew a streetwear hoodie
  // and cargo pockets over a typed burgundy cardigan, so the untouched default is the free-text wardrobe.
  assert.equal(base.outfitPreset, 'custom');
  for (const key of ['roleOccupation', 'distinctiveFeatures', 'outfitDescription', 'colorPalette', 'extraNotes'] as const) {
    assert.equal(base[key], '', `${key} must start empty`);
  }
});
check('a photoreal sheet from the defaults has no mole, glasses or 2D line-weight note', () => {
  for (const style of C.VISUAL_STYLES) {
    const prompt = buildSheetPrompt({ ...base, styleId: style.id });
    assert.doesNotMatch(prompt, /mole|nốt ruồi|glasses|line weight|độ dày viền|tỷ lệ đầu|techwear/i, style.id);
  }
});
check('a typed outfit is written once and wins over the preset garments', () => {
  const typed = 'navy wool cardigan over a grey shirt with a striped bow tie, navy pleated skirt';
  for (const preset of ['custom', 'streetwear', 'business', 'school_uniform', 'casual', 'ao_dai'] as const) {
    const prompt = buildSheetPrompt({ ...base, outfitPreset: preset, outfitDescription: typed });
    assert.equal(prompt.split('navy wool cardigan').length - 1, 1, `${preset}: the typed outfit must appear exactly once`);
    if (preset !== 'custom') {
      assert.match(prompt, /only these details/i, `${preset}: typed details must override the preset garments`);
    }
  }
});

// The reference tool draws its portrait from the shoulders up, so the collar and the top of the garment are
// visible next to the full-body views; a head-only portrait left the outfit out of the close-up.
check('layouts A, B and C draw the portrait head-and-shoulders with the upper garment visible', () => {
  for (const layoutId of ['layout_a', 'layout_b', 'layout_c'] as const) {
    for (const aspectRatio of C.ASPECT_RATIOS) {
      const prompt = buildSheetPrompt({ ...base, layoutId, aspectRatio });
      assert.match(prompt, /head-and-shoulders/i, `${layoutId}/${aspectRatio}: portrait is not head-and-shoulders`);
      assert.match(prompt, /collar|upper garment/i, `${layoutId}/${aspectRatio}: upper garment not asked for`);
    }
  }
});

// A build once rewrote isNaN(g) as isNaN(r), so a bad green channel slipped through to a NaN distance.
check('describeHairColor rejects a bad value in any single channel', () => {
  for (const bad of ['#zz00ff', '#00zz00', '#0000zz']) {
    assert.equal(describeHairColor(bad), 'natural dark', bad);
  }
  assert.equal(describeHairColor('#1a181b'), describeHairColor('1a181b'));
});

// Measured against the reference tool, which drew layout B correctly 4 of 4 times: ours put the three face close-ups
// stacked in a column once and as circles over the portrait once, because the text never said where they go.
check('layout B puts the three face close-ups in a row above the three full-body views', () => {
  for (const aspectRatio of C.ASPECT_RATIOS) {
    const prompt = buildSheetPrompt({ ...base, layoutId: 'layout_b', aspectRatio });
    assert.match(prompt, /three facial[- ]angle close-ups side by side/i, `${aspectRatio}: close-ups not placed in a row`);
    assert.match(prompt, /three full-body views[^.;]*side by side/i, `${aspectRatio}: full-body views not placed in a row`);
    assert.match(prompt, /top row|middle row/i, `${aspectRatio}: close-ups not given their own row above the bodies`);
    assert.doesNotMatch(prompt, /circle|stacked/i, `${aspectRatio}: layout B must not invite circular or stacked close-ups`);
    assert.match(prompt, /no panel overlaps another/i, `${aspectRatio}: layout B must forbid overlapping panels`);
  }
});

// Live runs of the bust-only layouts: E drew a full-body figure next to the busts in 2 of 3 sheets, and F drew
// 7 to 8 panels instead of 6 every time, because the text said "upper-body sheet" and "2x3 grid" without limits.
check('layout E asks for exactly three busts and forbids a full-body figure', () => {
  for (const aspectRatio of C.ASPECT_RATIOS) {
    const prompt = buildSheetPrompt({ ...base, layoutId: 'layout_e', aspectRatio });
    assert.match(prompt, /exactly three head-and-shoulders bust studies/i, `${aspectRatio}: busts not counted`);
    assert.match(prompt, /busts only[^.]*no full-body figure/i, `${aspectRatio}: full-body figure not forbidden`);
  }
});
check('layout F asks for exactly six panels, one expression bust each, and forbids extra panels', () => {
  for (const aspectRatio of C.ASPECT_RATIOS) {
    const prompt = buildSheetPrompt({ ...base, layoutId: 'layout_f', aspectRatio });
    assert.match(prompt, /exactly six equal panels/i, `${aspectRatio}: panels not counted`);
    assert.match(prompt, /no seventh or eighth panel/i, `${aspectRatio}: extra panels not forbidden`);
    assert.match(prompt, /neutral, smile, stern, laughter, sadness, surprise/i, `${aspectRatio}: expressions missing`);
  }
});

check('upload face source asks to match the reference photo', () => {
  assert.match(buildSheetPrompt({ ...base, faceSource: 'upload' }), /reference photo/i);
});

if (failures.length) {
  console.error(`${failures.length} failing check(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
process.exit(0);
