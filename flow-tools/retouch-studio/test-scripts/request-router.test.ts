// Rule-based request routing of Retouch Studio. Run through flow-tools/_shared/scripts/check-snapshot.sh.
// The face may only be touched when the request names the face; Vietnamese is matched as whole
// accented words ("chỉnh" must not match "chin", "béo" must not match "eo").
import assert from 'node:assert/strict';
import { routeByRules } from '../source/services/requestRouter';

const ops = (text: string) => (routeByRules(text) ?? []).map((o: any) => o.op).sort().join('+');

const expected: Array<[string, string]> = [
  ['chỉnh bụng nhân vật gọn lại', 'body_slim'],
  ['thon gọn eo 20%', 'body_slim'],
  ['khuôn mặt đỡ béo', 'face_slim'],
  ['làm mặt gọn hơn 10%', 'face_slim'],
  ['cằm thon v-line', 'face_slim'],
  ['mặt bớt béo, ảnh sáng hơn', 'color+face_slim'],
  ['má gọn và bụng thon', 'body_slim+face_slim'],
  ['bụng gọn lại, ảnh sáng hơn', 'body_slim+color'],
  ['ảnh mát hơn', 'color'],
  ['chỉnh màu mặt trời rực hơn', 'color'],
  ['ảnh ấm hơn và nét hơn', 'color'],
  ['làm mờ phông nền', 'blur_background'],
  ['xoá nền', 'remove_background'],
  ['tự động làm đẹp ảnh', 'auto_enhance'],
];
for (const [text, want] of expected) assert.equal(ops(text), want, `"${text}"`);

const strength = (text: string, op: string) => (routeByRules(text) as any[]).find(o => o.op === op)?.strength;
assert.equal(strength('làm mặt gọn hơn 10%', 'face_slim'), 10);
assert.equal(strength('thon gọn eo 20%', 'body_slim'), 20);

// Object removal is not a local algorithm: it must not be routed to any face or body edit.
assert.ok(!/face_slim|body_slim/.test(ops('xoá cái cột điện phía sau')), 'object removal routed to a reshape');

// Exit explicitly: open MessageChannel ports (used to yield during parsing) keep node alive.
process.exit(0);
