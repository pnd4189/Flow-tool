import React, { useState, useRef, useEffect } from 'react';
import { ProjectConfig, VideoModel, ImageModel, VideoResolution } from '../../services/types';
import { LOOKS, getLook } from '../../services/library';
import { Tooltip } from '../ui/Tooltip';
import { getAllModelCosts } from '../../services/pricing';

interface AppHeaderProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  config: ProjectConfig;
  onConfigChange: (config: ProjectConfig) => void;
  creditBudget: number;
  creditsUsed: number;
  isCalibrated: boolean;
  onCalibrate: (newBudget: number) => void;
  shotsCount: number;
  keyframesCount: { completed: number; total: number };
  videosCount: number;
  onSaveSession: () => void;
  onOpenSession: () => void;
  isSavingSession: boolean;
  hasUnsavedChanges?: boolean;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  projectName,
  onProjectNameChange,
  config,
  onConfigChange,
  creditBudget,
  creditsUsed,
  isCalibrated,
  onCalibrate,
  shotsCount,
  keyframesCount,
  videosCount,
  onSaveSession,
  onOpenSession,
  isSavingSession,
  hasUnsavedChanges = false,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(projectName);
  const [showCreditPopover, setShowCreditPopover] = useState(false);
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);
  const [creditInput, setCreditInput] = useState(creditBudget.toString());

  const creditPopoverRef = useRef<HTMLDivElement>(null);
  const settingsPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNameInput(projectName);
  }, [projectName]);

  useEffect(() => {
    setCreditInput(creditBudget.toString());
  }, [creditBudget]);

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (creditPopoverRef.current && !creditPopoverRef.current.contains(e.target as Node)) {
        setShowCreditPopover(false);
      }
      if (settingsPopoverRef.current && !settingsPopoverRef.current.contains(e.target as Node)) {
        setShowSettingsPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentRemaining = Math.max(0, creditBudget - creditsUsed);
  const activeLook = getLook(config.lookId);

  const handleModeToggle = (mode: 'long' | 'short') => {
    if (mode === 'long') {
      onConfigChange({
        ...config,
        mode: 'long',
        aspectRatio: '16:9',
        targetShots: config.targetShots > 10 ? config.targetShots : 35,
      });
    } else {
      onConfigChange({
        ...config,
        mode: 'short',
        aspectRatio: '9:16',
        targetShots: config.targetShots > 10 ? 6 : config.targetShots,
      });
    }
  };

  const handleModelChange = (model: VideoModel) => {
    const isVeo = model.startsWith('Veo');
    let nextRes: VideoResolution = config.resolution;
    let nextDuration = config.durationSeconds;
    if (isVeo) {
      nextRes = '720p';
      if (nextDuration === 10) nextDuration = 8;
    }
    onConfigChange({
      ...config,
      videoModel: model,
      resolution: nextRes,
      durationSeconds: nextDuration,
    });
  };

  const handleCalibrateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(creditInput, 10);
    if (!isNaN(val) && val >= 0) {
      onCalibrate(val);
      setShowCreditPopover(false);
    }
  };

  const effectiveShots = shotsCount > 0 ? shotsCount : config.targetShots;
  const modelComparisons = getAllModelCosts(config.resolution, config.durationSeconds, effectiveShots);

  return (
    <header className="h-[44px] bg-[#141417] border-b border-[#26262b] px-3 flex items-center justify-between flex-shrink-0 z-30 select-none">
      {/* Left: Project title & Mode switch */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[#f5b301] text-[18px]">movie</span>
          {isEditingName ? (
            <input
              type="text"
              value={nameInput}
              autoFocus
              onBlur={() => {
                setIsEditingName(false);
                onProjectNameChange(nameInput.trim() || 'Untitled Film');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setIsEditingName(false);
                  onProjectNameChange(nameInput.trim() || 'Untitled Film');
                }
              }}
              onChange={(e) => setNameInput(e.target.value)}
              className="bg-[#1b1b20] border border-[#f5b301] rounded px-1.5 py-0.5 text-[13px] font-bold text-[#ececef] focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              className="text-[13px] font-bold text-[#ececef] hover:text-[#f5b301] flex items-center gap-1 group transition"
              title="Click để đổi tên dự án"
            >
              <span>{projectName}</span>
              <span className="material-symbols-outlined text-[14px] text-[#9a9aa3] group-hover:text-[#f5b301] opacity-70">
                edit
              </span>
            </button>
          )}
        </div>

        {/* Mode pill toggle */}
        <div className="flex items-center p-0.5 bg-[#0b0b0d] rounded border border-[#26262b] text-[11px] font-medium">
          <button
            type="button"
            onClick={() => handleModeToggle('long')}
            className={`px-2 py-0.5 rounded transition ${
              config.mode === 'long'
                ? 'bg-[#1b1b20] text-[#ececef] font-semibold'
                : 'text-[#9a9aa3] hover:text-[#ececef]'
            }`}
          >
            Long 16:9
          </button>
          <button
            type="button"
            onClick={() => handleModeToggle('short')}
            className={`px-2 py-0.5 rounded transition ${
              config.mode === 'short'
                ? 'bg-[#1b1b20] text-[#ececef] font-semibold'
                : 'text-[#9a9aa3] hover:text-[#ececef]'
            }`}
          >
            Short 9:16
          </button>
        </div>

        {/* Active Look Badge */}
        <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 rounded bg-[#1b1b20] border border-[#26262b] text-[11px] font-mono text-[#9a9aa3]">
          <span className="material-symbols-outlined text-[13px] text-[#f5b301]">palette</span>
          <span className="text-[#ececef] truncate max-w-[120px]">{activeLook.label}</span>
        </div>
      </div>

      {/* Right Controls: Credit pill, Overview stats, Session & Settings */}
      <div className="flex items-center gap-2">
        {/* Overall Status Pill */}
        <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0b0b0d] border border-[#26262b] text-[11px] font-mono text-[#9a9aa3]">
          <span className="text-[#ececef] font-medium">{shotsCount} shot</span>
          <span className="text-[#36363f]">•</span>
          <span className="text-[#22c55e]">{keyframesCount.completed}/{keyframesCount.total} KF</span>
          <span className="text-[#36363f]">•</span>
          <span className={videosCount > 0 ? 'text-[#22c55e]' : 'text-[#9a9aa3]'}>
            {videosCount}/{shotsCount} video
          </span>
        </div>

        {/* Credit Estimator Popover Button */}
        <div className="relative" ref={creditPopoverRef}>
          <button
            type="button"
            onClick={() => setShowCreditPopover(!showCreditPopover)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1b1b20] hover:bg-[#25252d] border border-[#26262b] text-[11px] font-mono transition"
          >
            <span className="material-symbols-outlined text-[14px] text-[#f5b301]">savings</span>
            <span className="text-[#22c55e] font-bold">{currentRemaining.toLocaleString()} cr</span>
            {!isCalibrated && (
              <span className="text-[10px] text-[#f5b301] hidden sm:inline">(chưa hiệu chỉnh)</span>
            )}
          </button>

          {/* Credit Popover */}
          {showCreditPopover && (
            <div className="absolute right-0 top-full mt-1.5 w-80 bg-[#141417] border border-[#26262b] rounded-lg shadow-2xl p-3 z-50 text-[12px] space-y-3">
              <div className="flex items-center justify-between border-b border-[#26262b] pb-2">
                <span className="font-bold text-[#ececef] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px] text-[#f5b301]">tune</span>
                  Credit Estimator
                </span>
                {!isCalibrated && (
                  <span className="text-[10px] font-mono text-[#f5b301] bg-[#f5b301]/10 px-1 rounded border border-[#f5b301]/30">
                    Chưa hiệu chỉnh
                  </span>
                )}
              </div>

              <form onSubmit={handleCalibrateSubmit} className="space-y-1.5">
                <label className="text-[11px] text-[#9a9aa3] block uppercase tracking-[0.06em]">
                  Số dư credit thực tế:
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={creditInput}
                    onChange={(e) => setCreditInput(e.target.value)}
                    className="flex-1 bg-[#1b1b20] border border-[#26262b] rounded px-2 py-1 text-[#ececef] font-mono text-xs focus:border-[#f5b301] focus:outline-none"
                    placeholder="6000"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 bg-[#f5b301] text-black font-semibold text-xs rounded hover:bg-[#e0a400] transition"
                  >
                    Lưu
                  </button>
                </div>
              </form>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] text-[#9a9aa3] font-mono">
                  <span>So sánh ({effectiveShots} shot • {config.durationSeconds}s):</span>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {modelComparisons.map((row) => {
                    const isSelected = row.model === config.videoModel;
                    const remainingAfter = currentRemaining - row.totalCost;
                    const isOver = remainingAfter < 0;
                    return (
                      <div
                        key={row.model}
                        className={`p-1.5 rounded border text-[11px] ${
                          isSelected
                            ? 'bg-[#f5b301]/10 border-[#f5b301]/60'
                            : 'bg-[#1b1b20] border-[#26262b]'
                        }`}
                      >
                        <div className="flex justify-between items-center font-medium">
                          <span className={isSelected ? 'text-[#f5b301]' : 'text-[#ececef]'}>
                            {row.model}
                          </span>
                          <span className="font-mono text-[#9a9aa3] text-[10px]">
                            {row.perShot} cr/shot
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-mono mt-0.5">
                          <span className="text-[#9a9aa3]">Tổng: {row.totalCost} cr</span>
                          {isOver ? (
                            <span className="text-[#ef4444] font-semibold">Vượt ({remainingAfter})</span>
                          ) : (
                            <span className="text-[#22c55e]">Còn: {remainingAfter.toLocaleString()}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-1.5 bg-[#0b0b0d] rounded border border-[#22c55e]/30 flex justify-between text-[10px] font-mono text-[#22c55e]">
                <span>Sinh ảnh Keyframe</span>
                <span className="font-bold">0 credit</span>
              </div>
            </div>
          )}
        </div>

        {/* Save Session Button - Hiện chấm vàng khi có thay đổi chưa lưu */}
        <Tooltip content="Lưu phiên làm việc v2 (tải file JSON)">
          <button
            type="button"
            disabled={isSavingSession}
            onClick={onSaveSession}
            className="w-7 h-7 rounded bg-[#1b1b20] hover:bg-[#25252d] border border-[#26262b] text-[#ececef] flex items-center justify-center transition disabled:opacity-40 relative"
          >
            <span className={`material-symbols-outlined text-[16px] ${isSavingSession ? 'animate-spin' : ''}`}>
              {isSavingSession ? 'progress_activity' : 'save'}
            </span>
            {hasUnsavedChanges && !isSavingSession && (
              <span
                className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 border border-[#141417] shadow-sm animate-pulse"
                title="Có thay đổi chưa lưu"
              />
            )}
          </button>
        </Tooltip>

        {/* Open Session Button */}
        <Tooltip content="Mở phiên làm việc từ file JSON (v1 & v2)">
          <button
            type="button"
            onClick={onOpenSession}
            className="w-7 h-7 rounded bg-[#1b1b20] hover:bg-[#25252d] border border-[#26262b] text-[#ececef] flex items-center justify-center transition"
          >
            <span className="material-symbols-outlined text-[16px]">file_open</span>
          </button>
        </Tooltip>

        {/* Settings Popover Button */}
        <div className="relative" ref={settingsPopoverRef}>
          <Tooltip content="Cài đặt Model & Dự án">
            <button
              type="button"
              onClick={() => setShowSettingsPopover(!showSettingsPopover)}
              className="w-7 h-7 rounded bg-[#1b1b20] hover:bg-[#25252d] border border-[#26262b] text-[#ececef] flex items-center justify-center transition"
            >
              <span className="material-symbols-outlined text-[16px]">settings</span>
            </button>
          </Tooltip>

          {/* Settings Popover */}
          {showSettingsPopover && (
            <div className="absolute right-0 top-full mt-1.5 w-80 bg-[#141417] border border-[#26262b] rounded-lg shadow-2xl p-3 z-50 text-[12px] space-y-3">
              <div className="flex items-center justify-between border-b border-[#26262b] pb-2">
                <span className="font-bold text-[#ececef] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-[#f5b301]">tune</span>
                  Cài đặt Studio
                </span>
                <button
                  type="button"
                  onClick={() => setShowSettingsPopover(false)}
                  className="text-[#9a9aa3] hover:text-white"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>

              {/* Video Model */}
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                  Video Model
                </label>
                <select
                  value={config.videoModel}
                  onChange={(e) => handleModelChange(e.target.value as VideoModel)}
                  className="w-full bg-[#1b1b20] border border-[#26262b] text-[#ececef] rounded px-2 py-1 text-xs focus:border-[#f5b301] focus:outline-none"
                >
                  <option value="Omni 1.1 Flash">Omni 1.1 Flash (Mặc định)</option>
                  <option value="Veo 3.1 - Lite">Veo 3.1 - Lite</option>
                  <option value="Veo 3.1 - Fast">Veo 3.1 - Fast</option>
                  <option value="Veo 3.1 - Quality">Veo 3.1 - Quality</option>
                </select>
              </div>

              {/* Resolution & Duration */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                    Độ phân giải
                  </label>
                  {config.videoModel === 'Omni 1.1 Flash' ? (
                    <select
                      value={config.resolution}
                      onChange={(e) =>
                        onConfigChange({ ...config, resolution: e.target.value as VideoResolution })
                      }
                      className="w-full bg-[#1b1b20] border border-[#26262b] text-[#ececef] rounded px-2 py-1 text-xs focus:border-[#f5b301] focus:outline-none"
                    >
                      <option value="720p">720p</option>
                      <option value="360p">360p (nháp)</option>
                    </select>
                  ) : (
                    <div className="bg-[#1b1b20] border border-[#26262b] text-[#9a9aa3] rounded px-2 py-1 text-xs flex justify-between">
                      <span>720p</span>
                      <span className="text-[10px] font-mono">Cố định</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium block">
                    Thời lượng
                  </label>
                  <select
                    value={config.durationSeconds}
                    onChange={(e) =>
                      onConfigChange({ ...config, durationSeconds: Number(e.target.value) })
                    }
                    className="w-full bg-[#1b1b20] border border-[#26262b] text-[#ececef] rounded px-2 py-1 text-xs focus:border-[#f5b301] focus:outline-none"
                  >
                    <option value={4}>4s</option>
                    <option value={6}>6s</option>
                    <option value={8}>8s (chuẩn)</option>
                    {config.videoModel === 'Omni 1.1 Flash' && <option value={10}>10s</option>}
                  </select>
                </div>
              </div>

              {/* Image Model for Keyframes */}
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-[0.06em] text-[#9a9aa3] font-medium flex justify-between">
                  <span>Image Model (Keyframes)</span>
                  <span className="text-[#22c55e] font-mono text-[10px]">0 credit</span>
                </label>
                <select
                  value={config.imageModel}
                  onChange={(e) =>
                    onConfigChange({ ...config, imageModel: e.target.value as ImageModel })
                  }
                  className="w-full bg-[#1b1b20] border border-[#26262b] text-[#ececef] rounded px-2 py-1 text-xs focus:border-[#f5b301] focus:outline-none"
                >
                  <option value="🍌 Nano Banana 2.1">🍌 Nano Banana 2.1 (Mặc định)</option>
                  <option value="🍌 Nano Banana Pro">🍌 Nano Banana Pro</option>
                </select>
              </div>

              {/* Target Shots Slider */}
              <div className="space-y-1 pt-1 border-t border-[#26262b]">
                <div className="flex justify-between text-[11px] text-[#ececef]">
                  <span>Số shot mục tiêu:</span>
                  <span className="font-mono text-[#f5b301] font-bold">
                    {config.targetShots} shots ({config.targetShots * config.durationSeconds}s)
                  </span>
                </div>
                <input
                  type="range"
                  min={config.mode === 'long' ? 20 : 4}
                  max={config.mode === 'long' ? 40 : 10}
                  value={config.targetShots}
                  onChange={(e) =>
                    onConfigChange({ ...config, targetShots: Number(e.target.value) })
                  }
                  className="w-full accent-[#f5b301] bg-[#1b1b20] h-1.5 rounded cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
