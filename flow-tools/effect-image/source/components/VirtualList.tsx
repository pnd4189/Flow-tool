import React, { useRef, useState, useEffect, useCallback } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  buffer?: number;
  scrollToIndex?: number;
  autoScrollEnabled?: boolean;
}

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  className = '',
  buffer = 10,
  scrollToIndex,
  autoScrollEnabled = true,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  const totalCount = items.length;
  const totalHeight = totalCount * itemHeight;

  // Lắng nghe kích thước viewport container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });

    ro.observe(el);
    setViewportHeight(el.clientHeight || 400);

    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Tự động cuộn đến index nếu được yêu cầu
  useEffect(() => {
    if (!autoScrollEnabled || scrollToIndex === undefined || scrollToIndex < 0) return;
    const el = containerRef.current;
    if (!el) return;

    const targetTop = scrollToIndex * itemHeight;
    const currentTop = el.scrollTop;
    const currentBottom = currentTop + viewportHeight;

    // Chỉ cuộn nếu nằm ngoài vùng nhìn thấy
    if (targetTop < currentTop || targetTop + itemHeight > currentBottom) {
      el.scrollTo({
        top: Math.max(0, targetTop - viewportHeight / 2 + itemHeight / 2),
        behavior: 'smooth',
      });
    }
  }, [scrollToIndex, itemHeight, viewportHeight, autoScrollEnabled]);

  // Tính toán phạm vi render
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + buffer * 2;
  const endIndex = Math.min(totalCount, startIndex + visibleCount);

  const visibleItems: React.ReactNode[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const item = items[i];
    const topPos = i * itemHeight;
    visibleItems.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          top: topPos,
          left: 0,
          right: 0,
          height: itemHeight,
        }}
      >
        {renderItem(item, i)}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`relative overflow-y-auto ${className}`}
      style={{ willChange: 'transform' }}
    >
      <div
        style={{
          height: totalHeight,
          width: '100%',
          position: 'relative',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'auto' }}>
        {visibleItems}
      </div>
    </div>
  );
}
