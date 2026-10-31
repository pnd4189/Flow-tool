// Stand-in for the 'flow-sdk' module when tool code runs outside Flow (node tests, browser probes).
// Any test that reaches a real Flow call fails loudly instead of silently passing.
export const Flow = new Proxy({}, {
  get(_target, name) {
    throw new Error(`Flow.${String(name)} is not available outside Flow`);
  },
});
