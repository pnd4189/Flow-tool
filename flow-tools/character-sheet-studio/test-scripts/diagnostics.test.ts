// The diagnostics log: ring buffer, truncation, subscriptions, and instrumentation of generation.
// Run through flow-tools/_shared/scripts/check-snapshot.sh.
import assert from 'node:assert/strict';
import { clearDiag, formatDiag, getDiag, logDiag, subscribeDiag } from '../source/services/diagnostics';
import { generateSheetImage } from '../source/services/generation';

clearDiag();
assert.equal(getDiag().length, 0);

// Entries are kept in order and notify subscribers; unsubscribe stops notifications.
let notified = 0;
const unsubscribe = subscribeDiag(() => { notified += 1; });
logDiag('info', 'start', 'hello');
logDiag('call', 'image.generate', 'model=x');
assert.equal(getDiag().length, 2);
assert.equal(notified, 2);
unsubscribe();
logDiag('ok', 'image.generate', 'done');
assert.equal(notified, 2);

// Long details are truncated; the buffer keeps only the newest 300 entries.
logDiag('error', 'big', 'A'.repeat(5000));
assert.ok(getDiag().at(-1)!.detail.length <= 640, 'detail must be truncated to about 600 characters');
for (let i = 0; i < 400; i++) logDiag('info', `n${i}`, String(i));
assert.equal(getDiag().length, 300);
assert.equal(getDiag().at(-1)!.name, 'n399');
assert.equal(getDiag()[0].name, 'n100');

// The text export has one line per entry with the kind and the name.
const text = formatDiag(getDiag().slice(-2));
assert.equal(text.trim().split('\n').length, 2);
assert.match(text, /info/i);
assert.match(text, /n399/);

// generateSheetImage logs the call (with the number of reference images, never their data) and the outcome.
function scriptFlow(outcomes: Array<Error | 'ok'>) {
  (globalThis as any).__flowStub = {
    generate: {
      image: async () => {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return { base64: 'AAAA', mimeType: 'image/png', mediaId: 'media-1' };
      },
      text: async () => ({ text: 'A calm hero.' }),
    },
  };
}
clearDiag();
scriptFlow(['ok']);
await generateSheetImage({ prompt: 'P'.repeat(900), model: '🍌 Nano Banana Pro', aspectRatio: '16:9', referenceMediaIds: ['ref-1', 'ref-2'] });
let entries = getDiag();
const call = entries.find(e => e.kind === 'call' && e.name === 'image.generate');
assert.ok(call, 'the image call is logged before it runs');
assert.match(call!.detail, /refCount=2/);
assert.match(call!.detail, /promptChars=900/);
assert.ok(!call!.detail.includes('PPPPPPPPPP'), 'the full prompt is never stored');
assert.ok(entries.some(e => e.kind === 'ok' && e.name === 'image.generate'));

clearDiag();
scriptFlow([new Error('Dịch vụ tạo hình ảnh không hoạt động. Hãy thử lại.')]);
await assert.rejects(generateSheetImage({ prompt: 'x', model: '🍌 Nano Banana Pro', aspectRatio: '16:9' }));
entries = getDiag();
const failed = entries.find(e => e.kind === 'error' && e.name === 'image.generate');
assert.ok(failed, 'the failure is logged');
assert.match(failed!.detail, /không hoạt động/, 'the raw error message is kept');

process.exit(0);
