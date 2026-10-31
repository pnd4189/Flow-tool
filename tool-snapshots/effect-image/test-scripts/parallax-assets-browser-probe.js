// Browser probe (needs real Image decoding and blob URLs): run in an about:blank Chrome tab.
// Bundle: esbuild <this file> --bundle --format=iife --global-name=EffectImageParallaxProbe
//   --alias:flow-sdk=flow-builder/scripts/flow-sdk-stub.js --alias:mp4-muxer=flow-builder/scripts/mp4-muxer-stub.js
// then eval: await EffectImageParallaxProbe.runParallaxAssetChecks()
import { prepareRenderAssets } from '../source/services/exportService';
import { renderFrame } from '../source/services/motionEngine';

function solidBlobUrl(width, height, color) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  return new Promise(resolve => canvas.toBlob(blob => resolve(URL.createObjectURL(blob)), 'image/png'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runParallaxAssetChecks() {
  const passed = [];
  const failed = [];
  async function check(name, action) {
    try {
      await action();
      passed.push(name);
    } catch (error) {
      failed.push({ name, error: String(error.message || error) });
    }
  }

  const base = await solidBlobUrl(64, 36, 'red');
  const background = await solidBlobUrl(64, 36, 'blue');
  const subject = await solidBlobUrl(48, 30, 'green');
  // Exactly the fields layerService puts on a ready result: blob URLs, no data URL or base64.
  const readyLayers = { status: 'ready', bgBlobUrl: background, subjectCutoutBlobUrl: subject };
  const item = (enabled, layers) => ({
    promptItem: { order: 1 },
    variants: [{ blobUrl: base }],
    selectedVariantIndex: 0,
    effectConfig: { parallax: { enabled } },
    parallaxLayers: layers,
  });

  await check('ready layers from layerService reach the renderer', async () => {
    const assets = await prepareRenderAssets(item(true, readyLayers));
    assert(assets.parallaxLayers?.isReady === true, 'parallax layers were dropped');
    assert(assets.parallaxLayers.subjectImage.naturalWidth === 48, 'subject layer is not the full cutout');
    assert(assets.parallaxLayers.bgImage.naturalWidth === 64, 'background layer missing');
  });
  await check('the rendered frame draws the parallax layers, not the flat image', async () => {
    const config = {
      camera: { move: 'zoom_in', intensity: 0.4, easing: 'easeInOut' },
      parallax: { enabled: true, direction: 'in', depth: 0.5, subjectBreath: false, subjectFloat: false },
      overlays: [], durationSec: 6, fadeInOut: false, seed: 1, source: 'user',
    };
    const assets = await prepareRenderAssets(item(true, readyLayers));
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    renderFrame(context, assets, config, 3, 64, 36);
    const [r, g, b] = context.getImageData(32, 18, 1, 1).data;
    // Centre pixel: the green subject layer sits on the blue background; the flat base image is red.
    assert(g > 100 && r < 100, `centre pixel rgb(${r},${g},${b}) is not the subject layer`);
  });
  await check('parallax switched off renders the flat image only', async () => {
    const assets = await prepareRenderAssets(item(false, readyLayers));
    assert(!assets.parallaxLayers, 'layers used although parallax is off');
  });
  await check('layers released from memory fall back to the flat image', async () => {
    const assets = await prepareRenderAssets(item(true, { status: 'ready' }));
    assert(!assets.parallaxLayers, 'released layers still used');
  });

  return { pass: failed.length === 0, passed, failed };
}
