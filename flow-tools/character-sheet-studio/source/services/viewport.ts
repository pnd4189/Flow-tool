export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export function resetView(): ViewState {
  return { scale: 1, x: 0, y: 0 };
}

export function clampZoom(scale: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
}

export function clampPan(view: ViewState, size: { width: number; height: number }): ViewState {
  if (view.scale <= 1) {
    return { scale: 1, x: 0, y: 0 };
  }

  const minX = size.width * (1 - view.scale);
  const minY = size.height * (1 - view.scale);

  const clampedX = Math.max(minX, Math.min(0, view.x));
  const clampedY = Math.max(minY, Math.min(0, view.y));

  return {
    scale: view.scale,
    x: clampedX,
    y: clampedY,
  };
}

export function zoomAt(
  view: ViewState,
  point: { x: number; y: number },
  factor: number,
  size: { width: number; height: number }
): ViewState {
  const targetScale = clampZoom(view.scale * factor);
  if (targetScale === view.scale) {
    return clampPan(view, size);
  }

  // The content point under p is ((p.x - x) / scale, (p.y - y) / scale)
  const contentX = (point.x - view.x) / view.scale;
  const contentY = (point.y - view.y) / view.scale;

  // New offset to keep the content point under the pointer fixed:
  // p.x - contentX * targetScale
  const newX = point.x - contentX * targetScale;
  const newY = point.y - contentY * targetScale;

  return clampPan({ scale: targetScale, x: newX, y: newY }, size);
}

export function panBy(
  view: ViewState,
  dx: number,
  dy: number,
  size: { width: number; height: number }
): ViewState {
  if (view.scale <= 1) {
    return { scale: 1, x: 0, y: 0 };
  }

  return clampPan(
    {
      scale: view.scale,
      x: view.x + dx,
      y: view.y + dy,
    },
    size
  );
}
