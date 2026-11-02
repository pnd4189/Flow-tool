// One generation take: the image is handed over as soon as it exists and the quality check (and its
// retry) runs afterwards, plus bounded parallel takes. Pure logic with scripted generate/inspect.
// Run through flow-tools/_shared/scripts/check-snapshot.sh.
import assert from 'node:assert/strict';
import { rankCandidate, runBestOf, runTake, runWithConcurrency } from '../source/services/takePipeline';

const sheet = (n: number) => ({ base64: `img${n}`, mimeType: 'image/jpeg', mediaId: `m${n}`, promptUsed: `p${n}`, rewriteRound: 0 });
const report = (over: Record<string, unknown> = {}) => ({
  available: true, score: 80, viewCount: 4, expectedViews: 4, hasText: false, textFound: [] as string[],
  layoutOk: true, faceMatch: null as number | null, issues: [] as string[], verdict: 'ok' as 'ok' | 'retry', ...over,
});
const bad = (score = 50) => report({ score, hasText: true, textFound: ['LABEL'], verdict: 'retry' });
const options = (over: Record<string, unknown> = {}) => ({
  prompt: 'P', qcEnabled: true, maxRetries: 1, minScore: 65, strictFace: false,
  isAborted: () => false, onFirstImage: () => {}, onQc: () => {}, ...over,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. The first image is delivered before the quality check finishes.
{
  const events: string[] = [];
  let release!: (value: ReturnType<typeof report>) => void;
  const gate = new Promise<ReturnType<typeof report>>((resolve) => { release = resolve; });
  const deps = {
    generate: async () => { events.push('generate'); return sheet(1); },
    inspect: () => { events.push('inspect'); return gate; },
  };
  const done = runTake(deps, options({ onFirstImage: () => events.push('first'), onQc: () => events.push('qc') }));
  await tick();
  assert.deepEqual(events, ['generate', 'first', 'inspect'], 'the first image must not wait for the quality check');
  release(report());
  await done;
  assert.deepEqual(events, ['generate', 'first', 'inspect', 'qc']);
}

// 2. Quality check off: never inspected, never reported.
{
  let inspected = 0; let reported = 0; let first = 0;
  await runTake(
    { generate: async () => sheet(1), inspect: async () => { inspected += 1; return report(); } },
    options({ qcEnabled: false, onFirstImage: () => { first += 1; }, onQc: () => { reported += 1; } }),
  );
  assert.deepEqual([first, inspected, reported], [1, 0, 0]);
}

// 3. A flawed first image is retried once with an addendum; the better retry replaces it.
{
  const prompts: string[] = []; const updates: Array<{ id: string; changed: boolean; attempts: number }> = [];
  const reports = [bad(50), report({ score: 85 })];
  let n = 0;
  await runTake(
    { generate: async (p: string) => { prompts.push(p); n += 1; return sheet(n); }, inspect: async () => reports.shift()! },
    options({ onQc: (u: any) => updates.push({ id: u.sheet.mediaId, changed: u.changed, attempts: u.attempts }) }),
  );
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], 'P');
  assert.ok(prompts[1].startsWith('P') && prompts[1].length > 1, 'the retry prompt extends the original with an addendum');
  assert.deepEqual(updates, [{ id: 'm1', changed: false, attempts: 0 }, { id: 'm2', changed: true, attempts: 1 }]);
}

// 4. A worse retry is discarded; the first image stays but the attempt is counted.
{
  const updates: Array<{ id: string; changed: boolean; attempts: number }> = [];
  const reports = [bad(50), bad(30)];
  let n = 0;
  await runTake(
    { generate: async () => { n += 1; return sheet(n); }, inspect: async () => reports.shift()! },
    options({ onQc: (u: any) => updates.push({ id: u.sheet.mediaId, changed: u.changed, attempts: u.attempts }) }),
  );
  assert.deepEqual(updates, [{ id: 'm1', changed: false, attempts: 0 }, { id: 'm1', changed: false, attempts: 1 }]);
}

// 5. No retries allowed, or an abort during the check: one generation only.
{
  let generated = 0;
  const deps = { generate: async () => { generated += 1; return sheet(generated); }, inspect: async () => bad() };
  await runTake(deps, options({ maxRetries: 0 }));
  assert.equal(generated, 1, 'maxRetries 0 means no retry');
  generated = 0;
  let aborted = false;
  await runTake(deps, options({ isAborted: () => aborted, onQc: () => { aborted = true; } }));
  assert.equal(generated, 1, 'an abort requested after the first report stops the retry');
}

// 6. A failing check never loses the image and never rejects.
{
  let first = 0; let errors = 0; let reported = 0;
  await runTake(
    { generate: async () => sheet(1), inspect: async () => { throw new Error('qc down'); } },
    options({ onFirstImage: () => { first += 1; }, onQcError: () => { errors += 1; }, onQc: () => { reported += 1; } }),
  );
  assert.deepEqual([first, errors, reported], [1, 1, 0]);
  // a retry generation that fails keeps the first image and its first report
  first = 0; errors = 0; reported = 0;
  let calls = 0;
  await runTake(
    { generate: async () => { calls += 1; if (calls > 1) throw new Error('retry failed'); return sheet(1); }, inspect: async () => bad() },
    options({ onFirstImage: () => { first += 1; }, onQcError: () => { errors += 1; }, onQc: () => { reported += 1; } }),
  );
  assert.deepEqual([first, errors, reported], [1, 1, 1]);
}

// 7. A failing first generation rejects and shows nothing.
{
  let first = 0;
  await assert.rejects(
    runTake({ generate: async () => { throw new Error('no image'); }, inspect: async () => report() }, options({ onFirstImage: () => { first += 1; } })),
    /no image/,
  );
  assert.equal(first, 0);
}

// 8. Bounded parallelism: never more than `limit` in flight, results in index order, one failure does not stop the rest.
{
  let inFlight = 0; let peak = 0;
  const task = async (i: number) => { inFlight += 1; peak = Math.max(peak, inFlight); await sleep(10 + (i % 2) * 5); inFlight -= 1; return i * 10; };
  let results = await runWithConcurrency(5, 2, task);
  assert.equal(peak, 2);
  assert.deepEqual(results.map((r) => (r.status === 'fulfilled' ? r.value : null)), [0, 10, 20, 30, 40]);
  inFlight = 0; peak = 0;
  results = await runWithConcurrency(4, 10, task);
  assert.equal(peak, 4, 'a limit above the count starts every task at once');
  inFlight = 0; peak = 0;
  await runWithConcurrency(3, 0, task);
  assert.equal(peak, 1, 'a non-positive limit falls back to one at a time');
  const mixed = await runWithConcurrency(3, 3, async (i) => { if (i === 1) throw new Error('boom'); return i; });
  assert.deepEqual(mixed.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.deepEqual(await runWithConcurrency(0, 3, task), []);
}

// 9. Ranking: an unflagged sheet always beats a flagged one; then the score; a face match dominates when there is one.
{
  const o = { minScore: 65, strictFace: false };
  assert.ok(rankCandidate(report({ score: 70 }), o) > rankCandidate(bad(90), o), 'an unflagged sheet beats a flagged one with a higher score');
  assert.ok(rankCandidate(report({ score: 76 }), o) > rankCandidate(report({ score: 70 }), o));
  assert.ok(
    rankCandidate(report({ score: 70, faceMatch: 80 }), o) > rankCandidate(report({ score: 75, faceMatch: 40 }), o),
    'a better face match wins even with a lower score',
  );
  assert.equal(rankCandidate(null, o), 0);
  assert.equal(rankCandidate(report({ available: false }), o), 0);
  assert.ok(rankCandidate(report({ score: 20 }), { minScore: 10, strictFace: false }) > 1000, 'a low score above the threshold is not flagged');
}

// 10. Best of K: K sheets in parallel, only the best is kept; failures are tolerated until none is left.
{
  let inFlight = 0; let peak = 0; let n = 0;
  const scores: Record<string, ReturnType<typeof report>> = { m1: report({ score: 70 }), m2: bad(90), m3: report({ score: 74 }) };
  const deps = {
    generate: async () => { inFlight += 1; peak = Math.max(peak, inFlight); n += 1; const id = n; await sleep(10); inFlight -= 1; return sheet(id); },
    inspect: async (s: { mediaId: string }) => scores[s.mediaId],
  };
  const best = await runBestOf(deps, { prompt: 'P', count: 3, minScore: 65, strictFace: false, isAborted: () => false });
  assert.equal(peak, 3, 'all candidates are generated at the same time');
  assert.equal(best.sheet.mediaId, 'm3', 'the unflagged sheet with the best score wins');
  assert.equal(best.report?.score, 74);
  assert.equal(best.candidates, 3);

  // one failing generation and one failing inspection do not sink the run
  let calls = 0;
  const flaky = await runBestOf(
    {
      generate: async () => { calls += 1; if (calls === 1) throw new Error('gen failed'); return sheet(calls); },
      inspect: async (s: { mediaId: string }) => { if (s.mediaId === 'm2') throw new Error('qc down'); return report({ score: 71 }); },
    },
    { prompt: 'P', count: 3, minScore: 65, strictFace: false, isAborted: () => false },
  );
  assert.equal(flaky.sheet.mediaId, 'm3', 'a sheet whose check failed ranks below one that was checked');
  assert.equal(flaky.candidates, 2);

  // every inspection fails: still deliver a sheet, with no report
  const unchecked = await runBestOf(
    { generate: async () => sheet(1), inspect: async () => { throw new Error('qc down'); } },
    { prompt: 'P', count: 2, minScore: 65, strictFace: false, isAborted: () => false },
  );
  assert.equal(unchecked.report, null);
  assert.equal(unchecked.sheet.mediaId, 'm1');

  // every generation fails: reject
  await assert.rejects(
    runBestOf({ generate: async () => { throw new Error('all failed'); }, inspect: async () => report() }, { prompt: 'P', count: 2, minScore: 65, strictFace: false, isAborted: () => false }),
    /all failed/,
  );
}

process.exit(0);
