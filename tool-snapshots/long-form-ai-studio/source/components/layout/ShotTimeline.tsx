import React, { useRef, useEffect } from 'react';
import { Shot, getActiveTake } from '../../services/types';
import { getShotKeyframes, checkTakeStaleness } from '../../services/renderService';
import { Tooltip } from '../ui/Tooltip';

interface ShotTimelineProps {
  shots: Shot[];
  selectedShotId: string | null;
  onSelectShot: (shotId: string) => void;
  onToggleTransition: (shotId: string) => void;
}

export const ShotTimeline: React.FC<ShotTimelineProps> = ({
  shots,
  selectedShotId,
  onSelectShot,
  onToggleTransition,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Auto scroll to active shot
  useEffect(() => {
    if (selectedRef.current && containerRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [selectedShotId]);

  if (shots.length === 0) {
    return (
      <div className="h-[72px] bg-[#141417] border-t border-[#26262b] px-4 flex items-center justify-center text-[12px] text-[#9a9aa3] font-mono flex-shrink-0">
        Chưa có shot nào trên Timeline. Sang bước 2 (Kịch bản) để tạo.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-[72px] bg-[#141417] border-t border-[#26262b] px-3 flex items-center gap-1.5 overflow-x-auto flex-shrink-0 select-none no-scrollbar z-20"
    >
      {shots.map((shot, idx) => {
        const isSelected = shot.id === selectedShotId;
        const isFirst = idx === 0;

        const activeTake = getActiveTake(shot);
        const takeCount = shot.takes?.length || (shot.video ? 1 : 0);

        // Kiểm tra lệch mạch (stale)
        const currentKf = getShotKeyframes(shot, shots);
        const isStale = activeTake ? checkTakeStaleness(activeTake, currentKf) : false;

        const hasStart = Boolean(shot.startKeyframe);
        const hasEnd = Boolean(shot.endKeyframe);
        const kfReady = hasStart && hasEnd;
        const videoDone = Boolean(activeTake);
        const isRendering = shot.renderStatus === 'rendering';
        const isError = shot.renderStatus === 'error';

        // QC badge color
        let qcDotColor = 'bg-[#6b6b75]';
        if (activeTake?.qc) {
          if (activeTake.qc.totalScore >= 80) qcDotColor = 'bg-[#22c55e]';
          else if (activeTake.qc.totalScore >= 60) qcDotColor = 'bg-[#f5b301]';
          else qcDotColor = 'bg-[#ef4444]';
        }

        return (
          <React.Fragment key={shot.id}>
            {/* Connector between shots */}
            {!isFirst && (
              <Tooltip content={`Đổi kiểu nối cảnh (${shot.transitionIn === 'chain' ? 'Liền mạch' : 'Cắt cảnh'})`}>
                <button
                  type="button"
                  onClick={() => onToggleTransition(shot.id)}
                  className={`w-5 h-8 flex items-center justify-center rounded transition hover:scale-110 flex-shrink-0 ${
                    shot.transitionIn === 'chain'
                      ? 'text-[#22c55e] hover:bg-[#22c55e]/15'
                      : 'text-[#9a9aa3] hover:bg-[#1b1b20]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {shot.transitionIn === 'chain' ? 'link' : 'content_cut'}
                  </span>
                </button>
              </Tooltip>
            )}

            {/* Shot Box 96x54 */}
            <div
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onSelectShot(shot.id)}
              className={`w-[96px] h-[54px] rounded-md overflow-hidden relative cursor-pointer flex-shrink-0 transition border ${
                isSelected
                  ? 'border-[#f5b301] ring-2 ring-[#f5b301]/40 shadow-lg'
                  : 'border-[#26262b] hover:border-[#36363f] bg-[#1b1b20]'
              }`}
            >
              {shot.startKeyframe?.thumbBase64 ? (
                <img
                  src={`data:image/jpeg;base64,${shot.startKeyframe.thumbBase64}`}
                  alt={`Shot #${shot.order}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[#0b0b0d] text-[#6b6b75]">
                  <span className="text-[11px] font-mono font-bold">#{shot.order}</span>
                </div>
              )}

              {/* Shot order badge */}
              <div className="absolute top-0.5 left-0.5 px-1 py-0.2 rounded bg-black/75 text-[9px] font-mono font-bold text-[#ececef] flex items-center gap-0.5">
                <span>#{shot.order}</span>
                {takeCount > 1 && (
                  <span className="text-amber-400 font-bold">×{takeCount}</span>
                )}
              </div>

              {/* Chấm vàng lệch mạch trên timeline */}
              {isStale && (
                <span
                  className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-black animate-pulse"
                  title="⚠ Keyframe đã đổi — clip không còn khớp mạch"
                />
              )}

              {/* Status indicators: KF dot, Video/Take dot, QC dot */}
              <div className="absolute bottom-1 right-1 flex items-center gap-1 px-1 py-0.5 rounded bg-black/80">
                {/* KF status: gray or green */}
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    kfReady ? 'bg-[#22c55e]' : 'bg-[#6b6b75]'
                  }`}
                  title={kfReady ? 'Đủ 2 keyframe' : 'Chưa đủ keyframe'}
                />

                {/* Video status: gray, blue, green, red */}
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    videoDone
                      ? 'bg-[#22c55e]'
                      : isRendering
                      ? 'bg-[#60a5fa] animate-ping'
                      : isError
                      ? 'bg-[#ef4444]'
                      : 'bg-[#6b6b75]'
                  }`}
                  title={
                    videoDone
                      ? `Đã render (${takeCount} take)`
                      : isRendering
                      ? 'Đang render...'
                      : isError
                      ? 'Lỗi render'
                      : 'Chưa render'
                  }
                />

                {/* QC color dot (nếu có take) */}
                {activeTake?.qc && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${qcDotColor}`}
                    title={`QC: ${activeTake.qc.totalScore}/100 (${activeTake.qc.verdict.toUpperCase()})`}
                  />
                )}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
