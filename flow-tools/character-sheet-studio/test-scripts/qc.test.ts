// Automatic quality check of a generated sheet: parsing, the retry decision, the retry wording and
// the expected number of views per layout. Scripted Flow. Run through check-snapshot.sh.
import assert from 'node:assert/strict';
import { FINAL_NO_TEXT_SENTENCE, MAX_PROMPT_CHARS, buildSheetPrompt } from '../source/services/promptBuilder';
import { INITIAL_CONFIG, SHEET_LAYOUTS } from '../source/constants';
import { appendRetryAddendum, buildRetryAddendum, decideRetry, expectedViewCount, inspectSheet, parseQc } from '../source/services/qc';

function scriptText(reply: string | Error) {
  const calls: Array<{ prompt: string; options: any }> = [];
  (globalThis as any).__flowStub = {
    generate: { text: async (prompt: string, options: any) => { calls.push({ prompt, options }); if (reply instanceof Error) throw reply; return { text: reply }; } },
  };
  return calls;
}

// Distinct figures a correct sheet must show.
assert.deepEqual(Object.fromEntries(SHEET_LAYOUTS.map(l => [l.id, expectedViewCount(l.id)])), {
  layout_a: 4, layout_b: 7, layout_c: 8, layout_d: 5, layout_e: 3, layout_f: 6,
});

const good = { score: 88, viewCount: 4, hasText: false, textFound: [], layoutOk: true, faceMatch: 80, issues: [] };
// Parsing is tolerant: fences, clamping, defaults; an unusable reply means "QC unavailable", never an exception.
let report = parseQc('```json\n' + JSON.stringify(good) + '\n```', 'layout_a');
assert.equal(report.available, true);
assert.equal(report.score, 88);
assert.equal(report.expectedViews, 4);
assert.equal(report.faceMatch, 80);
report = parseQc(JSON.stringify({ score: 250, viewCount: 'four', hasText: 'yes', issues: 'one problem' }), 'layout_a');
assert.equal(report.score, 100, 'scores are clamped to 0-100');
assert.equal(report.viewCount, 0, 'a non-numeric view count becomes 0');
assert.equal(report.hasText, false, 'only a real boolean counts');
assert.deepEqual(report.issues, [], 'issues must be an array of strings');
report = parseQc('not json at all', 'layout_a');
assert.equal(report.available, false);
assert.equal(report.verdict, 'ok', 'when QC cannot run it must never trigger a retry');
assert.equal(decideRetry(report, { minScore: 65 }).retry, false);

// inspectSheet sends the sheet (and the first face reference when given) and never throws.
let calls = scriptText(JSON.stringify(good));
report = await inspectSheet({ base64: 'AAAA', mimeType: 'image/jpeg', layoutId: 'layout_b' });
assert.equal(calls[0].options.images.length, 1);
assert.match(calls[0].options.systemInstruction, /7/, 'the expected number of views is stated');
assert.equal(report.expectedViews, 7);
calls = scriptText(JSON.stringify(good));
await inspectSheet({ base64: 'AAAA', mimeType: 'image/jpeg', layoutId: 'layout_a', faceRefs: [{ base64: 'BBBB', mimeType: 'image/jpeg' }] });
assert.equal(calls[0].options.images.length, 2);
scriptText(new Error('Flow is down'));
assert.equal((await inspectSheet({ base64: 'AAAA', mimeType: 'image/jpeg', layoutId: 'layout_a' })).available, false);

// Retry decision.
const rep = (patch: Record<string, unknown>) => parseQc(JSON.stringify({ ...good, ...patch }), 'layout_a');
assert.equal(decideRetry(rep({}), { minScore: 65 }).retry, false);
assert.equal(decideRetry(rep({ hasText: true, textFound: ['Director notes'] }), { minScore: 65 }).retry, true);
assert.equal(decideRetry(rep({ layoutOk: false }), { minScore: 65 }).retry, true);
assert.equal(decideRetry(rep({ viewCount: 3 }), { minScore: 65 }).retry, true);
assert.equal(decideRetry(rep({ score: 60 }), { minScore: 65 }).retry, true);
assert.equal(decideRetry(rep({ score: 65 }), { minScore: 65 }).retry, false);
assert.equal(decideRetry(rep({ faceMatch: 30 }), { minScore: 65, strictFace: true }).retry, true);
assert.equal(decideRetry(rep({ faceMatch: 30 }), { minScore: 65, strictFace: false }).retry, false);
assert.ok(decideRetry(rep({ hasText: true }), { minScore: 65 }).reasons.length >= 1);

// Retry wording stays short and says what to fix.
const addendum = buildRetryAddendum(rep({ hasText: true, textFound: ['Director notes'], viewCount: 3, issues: ['extra hand on the side view', 'background not plain', 'third', 'fourth'] }));
assert.ok(addendum.length <= 300, `addendum has ${addendum.length} characters`);
assert.match(addendum, /no (written )?text|remove all (words|text)/i);
assert.match(addendum, /4/, 'the expected number of views is repeated');
assert.match(addendum, /extra hand/);
assert.doesNotMatch(addendum, /fourth/, 'at most three issues are listed');

// The addendum goes in front of the final no-text sentence and never breaks the budget.
const prompt = buildSheetPrompt(INITIAL_CONFIG);
const patched = appendRetryAddendum(prompt, addendum);
assert.ok(patched.length <= MAX_PROMPT_CHARS);
assert.match(patched, /extra hand/);
assert.match(patched.slice(-420), /no text/i, 'the no-text rule stays last');
// One shared constant for the final sentence: every prompt ends with it, so the addendum can always go before it.
for (const layout of SHEET_LAYOUTS) {
  for (const faceSource of ['ai', 'upload'] as const) {
    const built = buildSheetPrompt({ ...INITIAL_CONFIG, layoutId: layout.id, faceSource, extraNotes: 'word '.repeat(200) }, { faceCount: 1, faceDna: 'word '.repeat(150), outfitCount: 1, outfitDna: 'word '.repeat(150) });
    assert.ok(built.endsWith(FINAL_NO_TEXT_SENTENCE), `${layout.id}/${faceSource} does not end with the shared no-text sentence`);
  }
}
// A prompt right at the budget edge: the addendum is trimmed, the final sentence survives.
const edge = 'word '.repeat(Math.floor((MAX_PROMPT_CHARS - FINAL_NO_TEXT_SENTENCE.length - 40) / 5)).trim() + ' ' + FINAL_NO_TEXT_SENTENCE;
assert.ok(edge.length <= MAX_PROMPT_CHARS);
const edgePatched = appendRetryAddendum(edge, addendum);
assert.ok(edgePatched.length <= MAX_PROMPT_CHARS, `patched edge prompt has ${edgePatched.length} characters`);
assert.ok(edgePatched.endsWith(FINAL_NO_TEXT_SENTENCE), 'the final sentence must stay last');
assert.match(edgePatched, /CRITICAL|fix|correct/i, 'some of the addendum is still there');

process.exit(0);
