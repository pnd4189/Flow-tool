import { applyLocalWaistSlimming } from '../source/services/bodyReshapeService';
import { applyFaceSlim } from '../source/services/faceSlimService';

function canvas(width = 200, height = 160, color = 'black') {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  const context = result.getContext('2d', { willReadFrequently: true });
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return result;
}

function rectMask(width, height, x, y, w, h) {
  const mask = canvas(width, height);
  const context = mask.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(x, y, w, h);
  return mask;
}

function pixels(value) {
  return value.getContext('2d').getImageData(0, 0, value.width, value.height).data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function gradientCanvas(width, height) {
  const result = canvas(width, height);
  const context = result.getContext('2d');
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      image.data.set([x % 256, y % 256, (x + y) % 256, 255], (y * width + x) * 4);
    }
  }
  context.putImageData(image, 0, 0);
  return { canvas: result, data: image.data };
}

function darkWidthAt(data, width, row) {
  let count = 0;
  for (let x = 0; x < width; x++) if (data[(row * width + x) * 4] < 128) count++;
  return count;
}

export function runBodyReshapeChecks() {
  const passed = [];
  const failed = [];
  function check(name, action) {
    try {
      action();
      passed.push(name);
    } catch (error) {
      failed.push({ name, error: String(error.message || error) });
    }
  }

  // Body slimming: the selection bounding box is the body; a background band of 30% of the body
  // width on each side stretches to fill the space, so pixels outside the selection may change,
  // but protected pixels and everything outside the work box must stay byte-identical.
  const { canvas: source, data: original } = gradientCanvas(200, 160);
  const selection = rectMask(200, 160, 60, 20, 80, 120);
  const protection = rectMask(200, 160, 90, 20, 20, 15);
  const result = applyLocalWaistSlimming(source, selection, protection, { strengthPercent: 20 });
  const output = pixels(result.outputCanvas);
  const protectedPixels = pixels(protection);
  const cx = (60 + 139) / 2;
  const span = 139 - 60;
  const halfBody = (span / 2) * 1.02;
  const halfWork = Math.min(halfBody + 0.3 * span, cx, 199 - cx);
  const workLeft = Math.ceil(cx - halfWork);
  const workRight = Math.floor(cx + halfWork);
  const inWork = (x, y) => y >= 20 && y <= 139 && x >= workLeft && x <= workRight;

  check('native dimensions and immutable source', () => {
    assert(result.outputCanvas.width === 200 && result.outputCanvas.height === 160, 'Dimensions changed');
    assert(pixels(source).every((value, index) => value === original[index]), 'Source mutated');
  });
  check('protected pixels and pixels outside the work box are preserved', () => {
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 200; x++) {
        const index = (y * 200 + x) * 4;
        if (protectedPixels[index] > 0 || !inWork(x, y)) {
          for (let channel = 0; channel < 4; channel++) {
            assert(output[index + channel] === original[index + channel], `Changed locked pixel ${x},${y}`);
          }
        }
      }
    }
  });
  check('background beside the body is used to fill the narrowed silhouette', () => {
    let changedOutsideSelection = 0;
    const selected = pixels(selection);
    for (let index = 0; index < output.length; index += 4) {
      if (selected[index] === 0 && output[index] !== original[index]) changedOutsideSelection++;
    }
    assert(changedOutsideSelection > 0, 'Background band was not stretched');
  });
  check('reported counts match measured pixels', () => {
    let changed = 0;
    let protectedCount = 0;
    let outside = 0;
    let editable = 0;
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 200; x++) {
        const index = (y * 200 + x) * 4;
        if ([0, 1, 2, 3].some(channel => output[index + channel] !== original[index + channel])) changed++;
        if (protectedPixels[index] > 0) protectedCount++;
        else if (inWork(x, y)) editable++;
        else outside++;
      }
    }
    assert(changed > 0 && changed === result.changedPixelCount, `Changed ${changed} vs ${result.changedPixelCount}`);
    assert(result.protectedPreservedCount === protectedCount, `Protected ${result.protectedPreservedCount} vs ${protectedCount}`);
    assert(result.outsidePreservedCount === outside, `Outside ${result.outsidePreservedCount} vs ${outside}`);
    assert(result.editableCount === editable, `Editable ${result.editableCount} vs ${editable}`);
  });
  check('maximum strength keeps horizontal sample order', () => {
    const { canvas: ramp } = gradientCanvas(200, 160);
    const changed = applyLocalWaistSlimming(ramp, rectMask(200, 160, 60, 0, 80, 160), canvas(), { strengthPercent: 30 });
    const row = pixels(changed.outputCanvas);
    for (let x = 1; x < 200; x++) {
      assert(row[(80 * 200 + x) * 4] >= row[(80 * 200 + x - 1) * 4], `Fold at x=${x}`);
    }
  });
  check('body contour actually narrows', () => {
    const shape = canvas(200, 160, 'white');
    shape.getContext('2d').fillStyle = 'black';
    shape.getContext('2d').fillRect(60, 0, 80, 160);
    const changed = applyLocalWaistSlimming(shape, rectMask(200, 160, 60, 0, 80, 160), canvas(), { strengthPercent: 20 });
    const width = darkWidthAt(pixels(changed.outputCanvas), 200, 80);
    assert(width < 72 && width > 55, `Contour width ${width}, original 80`);
  });
  check('transparent edge interpolation keeps opaque color', () => {
    const shape = canvas(200, 160, 'transparent');
    shape.getContext('2d').fillStyle = 'white';
    shape.getContext('2d').fillRect(60, 0, 80, 160);
    const changed = applyLocalWaistSlimming(shape, rectMask(200, 160, 60, 0, 80, 160), canvas(), { strengthPercent: 18 });
    const data = pixels(changed.outputCanvas);
    let edgePixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 0 && data[index + 3] < 255) {
        edgePixels++;
        assert(data[index] === 255 && data[index + 1] === 255 && data[index + 2] === 255, 'Dark transparent edge');
      }
    }
    assert(edgePixels > 0, 'No interpolated edge exercised');
  });
  check('invalid strength, empty selection and body touching the edge are rejected', () => {
    for (const value of [0, -1, NaN, Infinity]) {
      let rejected = false;
      try { applyLocalWaistSlimming(source, selection, protection, { strengthPercent: value }); }
      catch { rejected = true; }
      assert(rejected, `Accepted strength ${value}`);
    }
    let rejected = false;
    try { applyLocalWaistSlimming(source, canvas(), protection, { strengthPercent: 20 }); }
    catch { rejected = true; }
    assert(rejected, 'Accepted empty selection');
    rejected = false;
    try { applyLocalWaistSlimming(source, canvas(200, 160, 'white'), canvas(), { strengthPercent: 20 }); }
    catch { rejected = true; }
    assert(rejected, 'Accepted a body with no background room');
  });

  // Face slimming: only the cheek/jaw contour may move. Eyes, nose and mouth (the core band around
  // the nose, widened to the mouth corners) and every row above the cheeks stay byte-identical.
  const faceW = 400;
  const faceH = 400;
  const face = canvas(faceW, faceH, 'white');
  const faceContext = face.getContext('2d');
  faceContext.fillStyle = 'black';
  faceContext.fillRect(120, 80, 160, 260);
  faceContext.fillStyle = 'red';
  faceContext.fillRect(150, 150, 100, 20);
  faceContext.fillStyle = 'blue';
  faceContext.fillRect(165, 250, 70, 12);
  const faceOriginal = pixels(face).slice();
  const contour = {
    noseX: 200, leftX: 120, rightX: 280, eyeY: 160, chinY: 340,
    mouthLeftX: 165, mouthRightX: 235, width: 160, height: 180,
  };
  const faceResult = applyFaceSlim(face, contour, 12);
  const faceOut = pixels(faceResult.outputCanvas);

  check('face slim keeps the eye, nose and mouth core byte-identical', () => {
    assert(faceResult.coreChanged === 0, `Core changed ${faceResult.coreChanged}`);
    for (let y = 0; y < faceH; y++) {
      for (let x = 150; x <= 250; x++) {
        const index = (y * faceW + x) * 4;
        for (let channel = 0; channel < 4; channel++) {
          assert(faceOut[index + channel] === faceOriginal[index + channel], `Core pixel ${x},${y} changed`);
        }
      }
    }
  });
  check('face slim leaves rows at and above the eyes untouched', () => {
    const firstEditableRow = Math.floor(160 + 0.12 * (340 - 160));
    for (let y = 0; y < firstEditableRow; y++) {
      for (let x = 0; x < faceW; x++) {
        const index = (y * faceW + x) * 4;
        assert(faceOut[index] === faceOriginal[index], `Row ${y} changed at x=${x}`);
      }
    }
  });
  check('face slim narrows the jaw contour', () => {
    const before = darkWidthAt(faceOriginal, faceW, 300);
    const after = darkWidthAt(faceOut, faceW, 300);
    assert(after < before - 10, `Jaw width ${after}, original ${before}`);
  });
  check('face slim reports measured changes', () => {
    let changed = 0;
    for (let index = 0; index < faceOut.length; index += 4) {
      if ([0, 1, 2, 3].some(channel => faceOut[index + channel] !== faceOriginal[index + channel])) changed++;
    }
    assert(changed > 0 && changed === faceResult.changedPixelCount, `Changed ${changed} vs ${faceResult.changedPixelCount}`);
  });

  // A round (cartoon) face whose landmarks put the cheek edge F inside the widest row, as the AI does
  // when it measures at mouth level: the slimmed contour must stay smooth (no pinch where the true
  // edge crosses F) and nothing below the chin (neck, shoulders) may move.
  const round = canvas(faceW, faceH, 'white');
  const roundContext = round.getContext('2d');
  roundContext.fillStyle = 'black';
  roundContext.beginPath();
  roundContext.arc(200, 200, 120, 0, Math.PI * 2);
  roundContext.fill();
  roundContext.fillRect(100, 330, 200, 70);
  const roundOriginal = pixels(round).slice();
  const roundFace = { noseX: 200, leftX: 110, rightX: 290, eyeY: 170, chinY: 320, width: 180, height: 150 };
  const roundOut = pixels(applyFaceSlim(round, roundFace, 12).outputCanvas);
  check('face slim keeps a round contour convex (no pinched cheek above a wide jaw)', () => {
    // Below its widest row a convex face narrows ever faster: the width drop over 8 rows may only grow.
    // The old peaked profile pinched the rows whose edge sat at F, giving an S-shaped contour.
    const widths = [];
    for (let y = 200; y <= 312; y++) widths.push(darkWidthAt(roundOut, faceW, y));
    let worst = 0;
    for (let i = 0; i + 16 < widths.length; i++) {
      const dropNow = widths[i] - widths[i + 8];
      const dropNext = widths[i + 8] - widths[i + 16];
      worst = Math.max(worst, dropNow - dropNext);
    }
    assert(worst <= 5, `contour bends back by ${worst} px (S-shaped cheek)`);
    assert(darkWidthAt(roundOut, faceW, 260) < darkWidthAt(roundOriginal, faceW, 260) - 6, 'face did not narrow');
  });
  check('face slim leaves everything below the chin untouched', () => {
    const lastRow = Math.ceil(320 + 0.05 * 150);
    for (let y = lastRow + 1; y < faceH; y++) {
      for (let x = 0; x < faceW; x++) {
        const index = (y * faceW + x) * 4;
        assert(roundOut[index] === roundOriginal[index], `Row ${y} below the chin changed at x=${x}`);
      }
    }
  });

  // Two faces side by side. The neighbour's head (face plus an ear/hair margin of 20% of its face
  // width, which the AI landmarks exclude) carries a horizontal ramp so any stretch is visible.
  const target = { noseX: 125, leftX: 60, rightX: 190, eyeY: 160, chinY: 340, width: 130, height: 180 };
  function pairScene(neighbourLeftX) {
    const neighbour = {
      noseX: neighbourLeftX + 65, leftX: neighbourLeftX, rightX: neighbourLeftX + 130,
      eyeY: 160, chinY: 340, width: 130, height: 180,
    };
    const headLeft = neighbourLeftX - 26;
    const headRight = Math.min(faceW - 1, neighbour.rightX + 26);
    const scene = canvas(faceW, faceH, 'white');
    const context = scene.getContext('2d');
    context.fillStyle = 'black';
    context.fillRect(60, 80, 130, 260);
    const fill = context.createImageData(headRight - headLeft + 1, 260);
    for (let y = 0; y < 260; y++) {
      for (let x = 0; x <= headRight - headLeft; x++) fill.data.set([0, 40 + (x % 200), 0, 255], (y * (headRight - headLeft + 1) + x) * 4);
    }
    context.putImageData(fill, headLeft, 80);
    const original = pixels(scene).slice();
    const headChanged = data => {
      let count = 0;
      for (let y = 0; y < faceH; y++) {
        for (let x = headLeft; x <= headRight; x++) {
          const index = (y * faceW + x) * 4;
          if ([0, 1, 2, 3].some(channel => data[index + channel] !== original[index + channel])) count++;
        }
      }
      return count;
    };
    return { scene, neighbour, original, headChanged };
  }

  // Neighbour close enough that the full stretch band reaches its ear, far enough to still slim.
  const near = pairScene(236);
  check('face slim without neighbour info reaches the next head (guard is needed)', () => {
    const unguarded = pixels(applyFaceSlim(near.scene, target, 12).outputCanvas);
    assert(near.headChanged(unguarded) > 0, 'Unguarded warp did not reach the neighbour; test geometry is too loose');
  });
  check('face slim leaves a neighbouring head, ear included, byte-identical', () => {
    const guarded = applyFaceSlim(near.scene, target, 12, [near.neighbour]);
    const data = pixels(guarded.outputCanvas);
    assert(near.headChanged(data) === 0, `Neighbour head changed ${near.headChanged(data)} px`);
    assert(!guarded.skippedFace, 'Face skipped although there was room');
    assert(darkWidthAt(data, faceW, 300) < darkWidthAt(near.original, faceW, 300), 'Target jaw did not narrow');
  });
  // Cheek to cheek: no room on one side, so the whole face is left alone to stay symmetric.
  const touching = pairScene(205);
  check('face slim skips a face that touches another head', () => {
    const guarded = applyFaceSlim(touching.scene, target, 12, [touching.neighbour]);
    const data = pixels(guarded.outputCanvas);
    assert(guarded.skippedFace === true, 'Face was not skipped');
    assert(data.every((value, index) => value === touching.original[index]), 'Skipped face still changed pixels');
  });

  return { pass: failed.length === 0, passed, failed };
}
