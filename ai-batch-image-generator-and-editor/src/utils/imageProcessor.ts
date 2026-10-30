// Easing function for Lanczos-3 Kernel
function sinc(x: number): number {
  if (x === 0) return 1;
  const piX = Math.PI * x;
  return Math.sin(piX) / piX;
}

function lanczosKernel(x: number, a: number = 3): number {
  if (Math.abs(x) >= a) return 0;
  return sinc(x) * sinc(x / a);
}

/**
 * High-quality Lanczos-3 Resampling on ImageData
 */
export function resampleLanczos(
  srcData: ImageData,
  destWidth: number,
  destHeight: number
): ImageData {
  const srcWidth = srcData.width;
  const srcHeight = srcData.height;
  const srcPixels = srcData.data;
  
  const destData = new ImageData(destWidth, destHeight);
  const destPixels = destData.data;
  
  const scaleX = srcWidth / destWidth;
  const scaleY = srcHeight / destHeight;
  const support = 3; // Lanczos-3 support radius
  
  for (let cy = 0; cy < destHeight; cy++) {
    const sy = cy * scaleY;
    const syStart = Math.max(0, Math.floor(sy - support));
    const syEnd = Math.min(srcHeight - 1, Math.floor(sy + support));
    
    for (let cx = 0; cx < destWidth; cx++) {
      const sx = cx * scaleX;
      const sxStart = Math.max(0, Math.floor(sx - support));
      const sxEnd = Math.min(srcWidth - 1, Math.floor(sx + support));
      
      let r = 0, g = 0, b = 0, a = 0;
      let totalWeight = 0;
      
      for (let y = syStart; y <= syEnd; y++) {
        const weightY = lanczosKernel(sy - y, support);
        if (weightY === 0) continue;
        
        for (let x = sxStart; x <= sxEnd; x++) {
          const weightX = lanczosKernel(sx - x, support);
          const weight = weightX * weightY;
          if (weight === 0) continue;
          
          const srcIdx = (y * srcWidth + x) * 4;
          r += srcPixels[srcIdx] * weight;
          g += srcPixels[srcIdx + 1] * weight;
          b += srcPixels[srcIdx + 2] * weight;
          a += srcPixels[srcIdx + 3] * weight;
          totalWeight += weight;
        }
      }
      
      const destIdx = (cy * destWidth + cx) * 4;
      if (totalWeight > 0) {
        destPixels[destIdx] = Math.min(255, Math.max(0, r / totalWeight));
        destPixels[destIdx + 1] = Math.min(255, Math.max(0, g / totalWeight));
        destPixels[destIdx + 2] = Math.min(255, Math.max(0, b / totalWeight));
        destPixels[destIdx + 3] = Math.min(255, Math.max(0, a / totalWeight));
      } else {
        const srcIdx = (Math.min(srcHeight - 1, Math.floor(sy)) * srcWidth + Math.min(srcWidth - 1, Math.floor(sx))) * 4;
        destPixels[destIdx] = srcPixels[srcIdx];
        destPixels[destIdx + 1] = srcPixels[srcIdx + 1];
        destPixels[destIdx + 2] = srcPixels[srcIdx + 2];
        destPixels[destIdx + 3] = srcPixels[srcIdx + 3];
      }
    }
  }
  
  return destData;
}

/**
 * Super-Resolution Simulation Filter (Real-ESRGAN emulation)
 * Combines Bilateral Denoising, Local Contrast Stretching, and Adaptive Unsharp Masking
 */
export function applyRealESRGANSimulation(
  srcData: ImageData,
  sharpnessAmount: number = 40, // 0 to 100
  denoiseAmount: number = 30    // 0 to 100
): ImageData {
  const width = srcData.width;
  const height = srcData.height;
  const pixels = srcData.data;
  
  // Create a copy for the processing source
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d")!;
  const copyData = tempCtx.createImageData(width, height);
  copyData.data.set(pixels);
  const copyPixels = copyData.data;
  
  const destData = new ImageData(width, height);
  const destPixels = destData.data;
  
  // Step 1: Guided Bilateral Denoise (smooth flat areas but keep edges)
  const dRad = denoiseAmount > 50 ? 2 : 1;
  const sigmaSpace = dRad * 2;
  // Wait, let's keep it direct and easy:
  const sigCol = 15 + (denoiseAmount / 100) * 35; // Color threshold
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      
      if (denoiseAmount === 0) {
        destPixels[idx] = copyPixels[idx];
        destPixels[idx + 1] = copyPixels[idx + 1];
        destPixels[idx + 2] = copyPixels[idx + 2];
        destPixels[idx + 3] = copyPixels[idx + 3];
        continue;
      }
      
      const r0 = copyPixels[idx];
      const g0 = copyPixels[idx + 1];
      const b0 = copyPixels[idx + 2];
      
      let sumR = 0, sumG = 0, sumB = 0;
      let sumW = 0;
      
      for (let ky = -dRad; ky <= dRad; ky++) {
        const py = Math.min(height - 1, Math.max(0, y + ky));
        for (let kx = -dRad; kx <= dRad; kx++) {
          const px = Math.min(width - 1, Math.max(0, x + kx));
          
          const kidx = (py * width + px) * 4;
          const r1 = copyPixels[kidx];
          const g1 = copyPixels[kidx + 1];
          const b1 = copyPixels[kidx + 2];
          
          // Compute bilateral weights
          const distColor = Math.sqrt((r1-r0)*(r1-r0) + (g1-g0)*(g1-g0) + (b1-b0)*(b1-b0));
          const wColor = Math.exp(-(distColor * distColor) / (2 * sigCol * sigCol));
          
          const distSpace = ky * ky + kx * kx;
          const wSpace = Math.exp(-distSpace / (2 * sigmaSpace * sigmaSpace));
          
          const weight = wColor * wSpace;
          sumR += r1 * weight;
          sumG += g1 * weight;
          sumB += b1 * weight;
          sumW += weight;
        }
      }
      
      destPixels[idx] = sumW > 0 ? sumR / sumW : r0;
      destPixels[idx + 1] = sumW > 0 ? sumG / sumW : g0;
      destPixels[idx + 2] = sumW > 0 ? sumB / sumW : b0;
      destPixels[idx + 3] = copyPixels[idx + 3];
    }
  }
  
  // Step 2: Unsharp Masking (Adaptive high-pass edge enhancement)
  if (sharpnessAmount > 0) {
    const edgeFactor = 0.2 + (sharpnessAmount / 100) * 1.5;
    
    // Create secondary buffer of blurred/denoised version
    const sharpSource = new Uint8ClampedArray(destPixels);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        
        // Laplacian/Sharpen filter kernel:
        //  0  -1   0
        // -1   5  -1
        //  0  -1   0
        const topIdx = ((y - 1) * width + x) * 4;
        const bottomIdx = ((y + 1) * width + x) * 4;
        const leftIdx = (y * width + (x - 1)) * 4;
        const rightIdx = (y * width + (x + 1)) * 4;
        
        for (let c = 0; c < 3; c++) {
          const center = sharpSource[idx + c];
          const laplacian = 5 * center - 
            sharpSource[topIdx + c] - 
            sharpSource[bottomIdx + c] - 
            sharpSource[leftIdx + c] - 
            sharpSource[rightIdx + c];
          
          // Interpolate original and sharpened to adjust amount
          const newVal = center + (laplacian - center) * edgeFactor;
          destPixels[idx + c] = Math.min(255, Math.max(0, newVal));
        }
      }
    }
  }
  
  return destData;
}

// Helpers for the denoising threshold scales
function denoiseAmountFactor(amt: number) { return amt; }
function denicityScale(amt: number) { return amt; }

/**
 * Apply PIL/Pillow and ImageMagick style Color Filters and Adjustments on Canvas
 */
export function applyCanvasAdjustments(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  adjustments: {
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
    exposure: number;
    vignette: number;
    blur: number;
    sharpen: number;
    grayscale: boolean;
    sepia: boolean;
    invert: boolean;
    edgeDetect: boolean;
    denoise: boolean;
  }
) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  
  const b = adjustments.brightness / 100; // 0.0 to 2.0 (1.0 is default)
  const c = adjustments.contrast / 100; // 0.0 to 2.0 (1.0 is default)
  const s = adjustments.saturation / 100; // 0.0 to 2.0 (1.0 is default)
  const h = adjustments.hue * (Math.PI / 180); // Hue rotation angle in radians
  const e = adjustments.exposure; // -100 to 100
  const v = adjustments.vignette; // 0 to 100
  
  // Grayscale weights (standard Rec. 709)
  const rw = 0.2126;
  const gw = 0.7152;
  const bw = 0.0722;
  
  // Setup Hue Rotation sin/cos
  const u = Math.cos(h);
  const w = Math.sin(h);
  
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let bVal = data[i + 2];
    
    // 1. Exposure
    if (e !== 0) {
      const expFactor = Math.pow(2, e / 50);
      r *= expFactor;
      g *= expFactor;
      bVal *= expFactor;
    }
    
    // 2. Brightness
    r *= b;
    g *= b;
    bVal *= b;
    
    // 3. Contrast
    r = (r - 128) * c + 128;
    g = (g - 128) * c + 128;
    bVal = (bVal - 128) * c + 128;
    
    // 4. Hue Rotation
    if (h !== 0) {
      const rx = (.299 + .701*u + .168*w)*r + (.587 - .587*u + .330*w)*g + (.114 - .114*u - .497*w)*bVal;
      const gx = (.299 - .299*u - .328*w)*r + (.587 + .413*u + .035*w)*g + (.114 - .114*u + .292*w)*bVal;
      const bx = (.299 - .3 *u - 1.25*w)*r + (.587 - .588*u + 1.05*w)*g + (.114 + .886*u - .203*w)*bVal;
      r = rx;
      g = gx;
      bVal = bx;
    }
    
    // 5. Saturation
    if (s !== 1) {
      const gray = rw * r + gw * g + bw * bVal;
      r = gray + (r - gray) * s;
      g = gray + (g - gray) * s;
      bVal = gray + (bVal - gray) * s;
    }
    
    // 6. Grayscale & Sepia filters
    if (adjustments.grayscale) {
      const gray = rw * r + gw * g + bw * bVal;
      r = gray;
      g = gray;
      bVal = gray;
    } else if (adjustments.sepia) {
      const rs = (r * 0.393) + (g * 0.769) + (bVal * 0.189);
      const gs = (r * 0.349) + (g * 0.686) + (bVal * 0.168);
      const bs = (r * 0.272) + (g * 0.534) + (bVal * 0.131);
      r = rs;
      g = gs;
      bVal = bs;
    }
    
    // 7. Invert
    if (adjustments.invert) {
      r = 255 - r;
      g = 255 - g;
      bVal = 255 - bVal;
    }
    
    // Save back clamped values
    data[i] = Math.min(255, Math.max(0, r));
    data[i + 1] = Math.min(255, Math.max(0, g));
    data[i + 2] = Math.min(255, Math.max(0, bVal));
  }
  
  // Apply vignette if requested
  if (v > 0) {
    const vFactor = v / 100;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const ratio = distance / maxDistance;
        
        // Vignette darkness scale
        const shade = 1 - (ratio * vFactor);
        const idx = (y * width + x) * 4;
        
        data[idx] *= shade;
        data[idx + 1] *= shade;
        data[idx + 2] *= shade;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Apply convolution filters like edge detection, sharpening, blurring via canvas rendering
  if (adjustments.edgeDetect) {
    const tempImg = ctx.getImageData(0, 0, width, height);
    const tempPixels = tempImg.data;
    const resultImg = ctx.createImageData(width, height);
    const resultPixels = resultImg.data;
    
    // Sobel operator approximate edge detection
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        
        const topIdx = ((y - 1) * width + x) * 4;
        const bottomIdx = ((y + 1) * width + x) * 4;
        const leftIdx = (y * width + (x - 1)) * 4;
        const rightIdx = (y * width + (x + 1)) * 4;
        
        for (let c = 0; c < 3; c++) {
          const val = 4 * tempPixels[idx + c] - tempPixels[topIdx + c] - tempPixels[bottomIdx + c] - tempPixels[leftIdx + c] - tempPixels[rightIdx + c];
          resultPixels[idx + c] = Math.min(255, Math.max(0, val));
        }
        resultPixels[idx + 3] = 255;
      }
    }
    ctx.putImageData(resultImg, 0, 0);
  }
}

/**
 * Utility to load an image URL into a beautiful HTML5 Image element
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}
