// Stand-in for the 'flow-sdk' module when tool code runs outside Flow (node tests, browser probes).
// A test can script Flow by setting globalThis.__flowStub = { generate: { ... }, ... }; anything the
// test did not script fails loudly instead of silently passing.
export const Flow = new Proxy({}, {
  get(_target, name) {
    const scripted = globalThis.__flowStub;
    if (scripted && name in scripted) return scripted[name];
    throw new Error(`Flow.${String(name)} is not available outside Flow`);
  },
});
