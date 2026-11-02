// Zoom and pan maths of the image viewer (pure functions). Run through check-snapshot.sh.
import assert from 'node:assert/strict';
import { MAX_ZOOM, MIN_ZOOM, clampPan, clampZoom, panBy, resetView, zoomAt } from '../source/services/viewport';

const size = { width: 400, height: 200 };
assert.equal(MIN_ZOOM, 1);
assert.equal(MAX_ZOOM, 4);
assert.deepEqual(resetView(), { scale: 1, x: 0, y: 0 });
assert.equal(clampZoom(0.2), 1);
assert.equal(clampZoom(9), 4);
assert.equal(clampZoom(2.5), 2.5);

// Zooming keeps the content point under the pointer where it is.
let view = zoomAt(resetView(), { x: 100, y: 50 }, 2, size);
assert.deepEqual(view, { scale: 2, x: -100, y: -50 });
const contentUnderPointer = (v: { scale: number; x: number; y: number }, p: { x: number; y: number }) => ({ x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale });
const before = zoomAt(resetView(), { x: 300, y: 120 }, 2, size);
const after = zoomAt(before, { x: 250, y: 90 }, 1.5, size);
const a = contentUnderPointer(before, { x: 250, y: 90 });
const b = contentUnderPointer(after, { x: 250, y: 90 });
assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, 'the point under the pointer moved');

// Limits: zoom out below 1 resets, zoom in stops at 4.
assert.deepEqual(zoomAt(resetView(), { x: 100, y: 50 }, 0.5, size), resetView());
assert.deepEqual(zoomAt(view, { x: 100, y: 50 }, 0.5, size), resetView(), 'back at 1x the pan returns to the origin');
assert.equal(zoomAt({ scale: 3, x: -100, y: -50 }, { x: 10, y: 10 }, 2, size).scale, 4);

// Panning cannot leave the image: x in [width*(1-scale), 0].
assert.deepEqual(panBy({ scale: 2, x: 0, y: 0 }, 50, 50, size), { scale: 2, x: 0, y: 0 });
assert.deepEqual(panBy({ scale: 2, x: 0, y: 0 }, -1000, -1000, size), { scale: 2, x: -400, y: -200 });
assert.deepEqual(panBy(resetView(), 30, 30, size), resetView(), 'no panning at 1x');
assert.deepEqual(clampPan({ scale: 2, x: 99, y: -999 }, size), { scale: 2, x: 0, y: -200 });

process.exit(0);
