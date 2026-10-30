import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ProjectConfig, Character, Scene, Shot } from './services/types';
import { LOOKS, getLook } from './services/library';
import { exportStudioSession, importStudioSession } from './services/sessionService';
import { buildKeyframeSlots } from './services/keyframeService';
import {
  runAIDirectorForShots,
  buildComparisonRows,
  applySuggestionsToShots,
  DirectorComparisonRow,
  DirectorSuggestion,
} from './services/director';
import { normalizeCharacterName } from './components/ScriptEngine';

// Layout components
import { AppHeader } from './components/layout/AppHeader';
import { StepNav, StudioStep } from './components/layout/StepNav';
import { ShotTimeline } from './components/layout/ShotTimeline';
import { ShotInspector } from './components/layout/ShotInspector';

// Domain components
import { CharacterVault } from './components/CharacterVault';
import { ScriptEngine } from './components/ScriptEngine';
import { StoryboardGrid } from './components/StoryboardGrid';
import { RenderQueue } from './components/RenderQueue';
import { ExportStep } from './components/ExportStep';

// Common UI
import { Button } from './components/ui/Button';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function App() {
  // Global Project Configuration - Look mặc định là 'anime_cel'
  const [projectName, setProjectName] = useState<string>('Anime 2D Film Studio');
  const [config, setConfig] = useState<ProjectConfig>({
    mode: 'long',
    targetShots: 35,
    videoModel: 'Omni 1.1 Flash',
    imageModel: '🍌 Nano Banana 2.1',
    resolution: '720p',
    durationSeconds: 8,
    aspectRatio: '16:9',
    lookId: 'anime_cel',
    customStyle: '',
  });

  // State entities
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);

  // Workflow Step: cast | script | direct | storyboard | render | export
  const [currentStep, setCurrentStep] = useState<StudioStep>('cast');

  // Credit budget & calibration
  const [creditBudget, setCreditBudget] = useState<number>(6000);
  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const [isCalibrated, setIsCalibrated] = useState<boolean>(false);

  // Session saving / file input
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Đếm mốc sinh ảnh/video để nhắc lưu phiên
  const lastSavedKfCountRef = useRef<number>(0);
  const lastSavedVideoCountRef = useRef<number>(0);

  // AI Director state
  const [isDirectingAI, setIsDirectingAI] = useState(false);
  const [directorGenre, setDirectorGenre] = useState('');
  const [directorModalOpen, setDirectorModalOpen] = useState(false);
  const [directorComparisonRows, setDirectorComparisonRows] = useState<DirectorComparisonRow[]>([]);
  const [pendingSuggestions, setPendingSuggestions] = useState<DirectorSuggestion[]>([]);

  // Toast notifications (auto-dismiss 4s)
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (
    text: string,
    type: 'success' | 'error' | 'info' = 'info',
    actionLabel?: string,
    onAction?: () => void
  ) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, text, type, actionLabel, onAction }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Tự động gắn characterIds cho mọi shot có characterNames trùng tên nhân vật trong Vault
  useEffect(() => {
    if (characters.length === 0 || shots.length === 0) return;

    let hasChange = false;
    const nextShots = shots.map((sh) => {
      const names = sh.characterNames || [];
      if (names.length === 0) return sh;

      const currentIds = new Set(sh.characterIds);
      let shotChanged = false;

      names.forEach((name) => {
        const norm = normalizeCharacterName(name);
        const matched = characters.find((c) => normalizeCharacterName(c.name) === norm);
        if (matched && !currentIds.has(matched.id)) {
          currentIds.add(matched.id);
          shotChanged = true;
        }
      });

      if (shotChanged) {
        hasChange = true;
        return { ...sh, characterIds: Array.from(currentIds) };
      }
      return sh;
    });

    if (hasChange) {
      setShots(nextShots);
      setHasUnsavedChanges(true);
    }
  }, [characters]);

  // Đếm số keyframe hoàn thành và video hoàn thành
  const keyframesMetric = useMemo(() => {
    const slots = buildKeyframeSlots(shots, scenes, characters, config);
    const completed = slots.filter((s) => s.currentKeyframe).length;
    return { completed, total: slots.length };
  }, [shots, scenes, characters, config]);

  const renderedVideosCount = useMemo(() => {
    return shots.filter((s) => (s.takes && s.takes.length > 0) || s.video).length;
  }, [shots]);

  // NHẮC LƯU PHIÊN: sau mỗi 3 video render xong hoặc 10 keyframe sinh xong mà chưa lưu phiên
  useEffect(() => {
    const newVideos = renderedVideosCount - lastSavedVideoCountRef.current;
    const newKfs = keyframesMetric.completed - lastSavedKfCountRef.current;

    if (newVideos >= 3 || newKfs >= 10) {
      addToast(
        'Nên Lưu phiên (dữ liệu mất khi tải lại trang)',
        'info',
        'Lưu ngay',
        () => handleSaveSession()
      );
      // Đặt lại mốc nhắc
      lastSavedVideoCountRef.current = renderedVideosCount;
      lastSavedKfCountRef.current = keyframesMetric.completed;
      setHasUnsavedChanges(true);
    }
  }, [renderedVideosCount, keyframesMetric.completed]);

  // Character Handlers
  const handleAddCharacter = (char: Character) => {
    setCharacters((prev) => [char, ...prev]);
    setSelectedCharacterId(char.id);
    setHasUnsavedChanges(true);
    addToast(`Đã thêm nhân vật ${char.name} vào Vault`, 'success');
  };

  const handleUpdateCharacter = (updated: Character) => {
    setCharacters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setHasUnsavedChanges(true);
    addToast(`Đã cập nhật nhân vật ${updated.name}`, 'success');
  };

  const handleDeleteCharacter = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    if (selectedCharacterId === id) {
      setSelectedCharacterId(null);
    }
    setHasUnsavedChanges(true);
    addToast('Đã xóa nhân vật', 'info');
  };

  // Credit Handlers
  const handleCalibrate = (newBudget: number) => {
    setCreditBudget(newBudget);
    setCreditsUsed(0);
    setIsCalibrated(true);
    setHasUnsavedChanges(true);
    addToast(`Đã hiệu chỉnh credit thành ${newBudget.toLocaleString()} cr`, 'success');
  };

  const handleDeductCredits = (amount: number) => {
    setCreditsUsed((prev) => prev + amount);
    setHasUnsavedChanges(true);
  };

  // Shot & Scene Handlers
  const handleUpdateScenesShots = (newScenes: Scene[], newShots: Shot[]) => {
    const linkedShots = newShots.map((sh) => {
      const names = sh.characterNames || [];
      if (names.length === 0 || characters.length === 0) return sh;
      const idsSet = new Set(sh.characterIds);
      names.forEach((name) => {
        const norm = normalizeCharacterName(name);
        const matched = characters.find((c) => normalizeCharacterName(c.name) === norm);
        if (matched) idsSet.add(matched.id);
      });
      return { ...sh, characterIds: Array.from(idsSet) };
    });

    setScenes(newScenes);
    setShots(linkedShots);
    setHasUnsavedChanges(true);
    if (!selectedShotId && linkedShots.length > 0) {
      setSelectedShotId(linkedShots[0].id);
    }
  };

  const handleUpdateShotsOnly = (updatedShots: Shot[]) => {
    setShots(updatedShots);
    setHasUnsavedChanges(true);
  };

  const handleUpdateScenesOnly = (updatedScenes: Scene[]) => {
    setScenes(updatedScenes);
    setHasUnsavedChanges(true);
  };

  const handleToggleTransitionIn = (shotId: string) => {
    setShots((prev) =>
      prev.map((s) =>
        s.id === shotId
          ? { ...s, transitionIn: s.transitionIn === 'chain' ? 'cut' : 'chain' }
          : s
      )
    );
    setHasUnsavedChanges(true);
  };

  // AI Director Action
  const handleRunAIDirector = async (scope: 'all' | 'selected') => {
    const targetShots = scope === 'all'
      ? shots
      : shots.filter((s) => s.id === selectedShotId);

    if (targetShots.length === 0) {
      addToast('Không có shot nào để đạo diễn', 'info');
      return;
    }

    setIsDirectingAI(true);
    try {
      const look = getLook(config.lookId);
      const suggestions = await runAIDirectorForShots({
        targetShots,
        allScenes: scenes,
        allCharacters: characters,
        look,
        genreAtmosphere: directorGenre,
      });

      const comparisonRows = buildComparisonRows(targetShots, suggestions);

      if (comparisonRows.length === 0) {
        addToast('Các thông số đạo diễn hiện tại đã tối ưu, không có đề xuất thay đổi.', 'info');
      } else {
        setPendingSuggestions(suggestions);
        setDirectorComparisonRows(comparisonRows);
        setDirectorModalOpen(true);
      }
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Đạo diễn AI thất bại', 'error');
    } finally {
      setIsDirectingAI(false);
    }
  };

  const handleApplyDirectorAll = () => {
    const nextShots = applySuggestionsToShots(shots, pendingSuggestions);
    setShots(nextShots);
    setDirectorModalOpen(false);
    setDirectorComparisonRows([]);
    setPendingSuggestions([]);
    setHasUnsavedChanges(true);
    addToast(`Đã áp dụng đề xuất đạo diễn AI cho ${directorComparisonRows.length} shot`, 'success');
  };

  const handleCancelDirector = () => {
    setDirectorModalOpen(false);
    setDirectorComparisonRows([]);
    setPendingSuggestions([]);
  };

  // Save / Open Session v2
  const handleSaveSession = async () => {
    setIsSavingSession(true);
    try {
      const filename = await exportStudioSession({
        projectTitle: projectName,
        config,
        characters,
        scenes,
        shots,
        creditBudget,
        creditsUsed,
        isCalibrated,
      });

      lastSavedVideoCountRef.current = renderedVideosCount;
      lastSavedKfCountRef.current = keyframesMetric.completed;
      setHasUnsavedChanges(false);
      addToast(`Đã lưu phiên thành công (${filename})`, 'success');
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Lưu phiên thất bại', 'error');
    } finally {
      setIsSavingSession(false);
    }
  };

  const handleOpenSessionClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const restored = importStudioSession(text);
      if (restored.projectTitle) {
        setProjectName(restored.projectTitle);
      }
      setConfig(restored.config);
      setCharacters(restored.characters);
      setScenes(restored.scenes);
      setShots(restored.shots);
      setCreditBudget(restored.creditBudget);
      setCreditsUsed(restored.creditsUsed);
      setIsCalibrated(restored.isCalibrated);
      if (restored.shots.length > 0) {
        setSelectedShotId(restored.shots[0].id);
      }

      lastSavedVideoCountRef.current = restored.shots.filter((s) => s.takes && s.takes.length > 0).length;
      lastSavedKfCountRef.current = restored.shots.filter((s) => s.startKeyframe).length;
      setHasUnsavedChanges(false);

      addToast(
        `Khôi phục phiên v${restored.version} thành công! Takes đã được khôi phục. Dùng "Nạp lại từ thư viện" nếu cần xem lại video.`,
        'success'
      );
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Đọc file phiên thất bại', 'error');
    }
  };

  // Calculated metrics
  const activeShot = useMemo(() => {
    return shots.find((s) => s.id === selectedShotId) || shots[0];
  }, [shots, selectedShotId]);

  const activeScene = useMemo(() => {
    if (!activeShot) return undefined;
    return scenes.find((sc) => sc.id === activeShot.sceneId);
  }, [scenes, activeShot]);

  const activeShotIndex = useMemo(() => {
    if (!activeShot) return -1;
    return shots.findIndex((s) => s.id === activeShot.id);
  }, [shots, activeShot]);

  const currentRemaining = Math.max(0, creditBudget - creditsUsed);

  const isCastReady = characters.some((c) => Boolean(c.thumbBase64 || c.mediaId)) || characters.length === 0;
  const isScriptReady = shots.length > 0;
  const isDirectReady = shots.length > 0;
  const isStoryboardReady = keyframesMetric.total > 0 && keyframesMetric.completed === keyframesMetric.total;
  const isRenderReady = shots.length > 0 && renderedVideosCount === shots.length;
  const isExportReady = renderedVideosCount > 0;

  const activeCharacter = useMemo(() => {
    if (selectedCharacterId) {
      return characters.find((c) => c.id === selectedCharacterId);
    }
    return characters[0];
  }, [characters, selectedCharacterId]);

  return (
    <div className="w-full h-full flex flex-col bg-[#0b0b0d] text-[#ececef] font-sans antialiased overflow-hidden select-none">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 1. AppHeader (44px) - Chấm vàng khi hasUnsavedChanges */}
      <AppHeader
        projectName={projectName}
        onProjectNameChange={(name) => {
          setProjectName(name);
          setHasUnsavedChanges(true);
        }}
        config={config}
        onConfigChange={(cfg) => {
          setConfig(cfg);
          setHasUnsavedChanges(true);
        }}
        creditBudget={creditBudget}
        creditsUsed={creditsUsed}
        isCalibrated={isCalibrated}
        onCalibrate={handleCalibrate}
        shotsCount={shots.length}
        keyframesCount={keyframesMetric}
        videosCount={renderedVideosCount}
        onSaveSession={handleSaveSession}
        onOpenSession={handleOpenSessionClick}
        isSavingSession={isSavingSession}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      {/* 2. StepNav (36px) */}
      <StepNav
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        isCastReady={isCastReady}
        isScriptReady={isScriptReady}
        isDirectReady={isDirectReady}
        isStoryboardReady={isStoryboardReady}
        isRenderReady={isRenderReady}
        isExportReady={isExportReady}
      />

      {/* 3. Middle Area */}
      <main className="flex-1 flex overflow-hidden min-h-0 bg-[#0b0b0d] relative">
        {/* STEP 1: CAST (Nhân vật 2D) */}
        {currentStep === 'cast' && (
          <div className="flex-1 flex overflow-hidden">
            <div className="w-[340px] flex flex-col bg-[#141417] border-r border-[#26262b] flex-shrink-0 overflow-hidden">
              <CharacterVault
                characters={characters}
                onAddCharacter={handleAddCharacter}
                onUpdateCharacter={handleUpdateCharacter}
                onDeleteCharacter={handleDeleteCharacter}
                config={config}
              />
            </div>

            {/* Right: Character Detail & Model Sheet 16:9 */}
            <div className="flex-1 flex flex-col bg-[#0b0b0d] overflow-y-auto p-5">
              {activeCharacter ? (
                <div className="max-w-3xl mx-auto w-full space-y-4">
                  <div className="flex items-center justify-between border-b border-[#26262b] pb-2">
                    <div>
                      <h2 className="text-lg font-bold text-[#ececef] flex items-center gap-2">
                        <span>{activeCharacter.name}</span>
                        {activeCharacter.locked && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30">
                            2D ON-MODEL
                          </span>
                        )}
                      </h2>
                      <p className="text-xs text-[#9a9aa3] font-mono mt-0.5">
                        MediaId: {activeCharacter.mediaId || 'Chưa gán ảnh'}
                      </p>
                    </div>

                    <Button
                      variant="primary"
                      size="sm"
                      icon="arrow_forward"
                      onClick={() => setCurrentStep('script')}
                    >
                      Sang bước 2: Kịch bản
                    </Button>
                  </div>

                  <div className="space-y-4">
                    {/* Model Sheet Turnaround Preview (16:9) */}
                    <div className="aspect-video rounded-lg bg-[#141417] border border-[#26262b] overflow-hidden flex items-center justify-center relative">
                      {activeCharacter.thumbBase64 ? (
                        <img
                          src={`data:${activeCharacter.mimeType || 'image/jpeg'};base64,${activeCharacter.thumbBase64}`}
                          alt={activeCharacter.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center text-[#6b6b75] p-4 space-y-1">
                          <span className="material-symbols-outlined text-4xl">brush</span>
                          <p className="text-xs">Chưa có Character Model Sheet (16:9)</p>
                          <p className="text-[11px] text-[#9a9aa3]">
                            Bấm "Tạo Model Sheet 2D" ở cột trái để tạo turnaround 4 góc 0 credit.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* DNA 8 Fields Summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-[#141417] p-4 rounded-lg border border-[#26262b] text-xs">
                      <div>
                        <span className="text-[10px] text-[#6b6b75] block uppercase font-mono">Khuôn mặt & đầu</span>
                        <span className="text-[#ececef]">{activeCharacter.dna.faceShape || activeCharacter.dna.facialStructure || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#6b6b75] block uppercase font-mono">Mắt</span>
                        <span className="text-[#ececef]">{activeCharacter.dna.eyes || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#6b6b75] block uppercase font-mono">Tóc</span>
                        <span className="text-[#ececef]">{activeCharacter.dna.hairstyle || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#6b6b75] block uppercase font-mono">Màu da</span>
                        <span className="text-[#ececef]">{activeCharacter.dna.skinTone || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#6b6b75] block uppercase font-mono">Trang phục</span>
                        <span className="text-[#ececef]">{activeCharacter.dna.outfit || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#6b6b75] block uppercase font-mono">Phụ kiện</span>
                        <span className="text-[#ececef]">{activeCharacter.dna.accessories || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#6b6b75] block uppercase font-mono">Tỉ lệ cơ thể</span>
                        <span className="text-[#f5b301]">{activeCharacter.dna.proportions || '6 heads'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#6b6b75] block uppercase font-mono">Màu chủ đạo</span>
                        <span className="text-[#22c55e]">{activeCharacter.dna.palette || '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-[#9a9aa3] space-y-2">
                  <span className="material-symbols-outlined text-4xl text-[#f5b301]/60">brush</span>
                  <p className="text-sm font-semibold text-[#ececef]">Chưa có nhân vật 2D trong Vault</p>
                  <p className="text-xs max-w-sm">
                    Tạo nhân vật ở cột trái hoặc bỏ qua để sang bước Kịch bản.
                  </p>
                  <Button
                    variant="amber"
                    size="sm"
                    icon="arrow_forward"
                    onClick={() => setCurrentStep('script')}
                  >
                    Bỏ qua & Sang Kịch bản
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: SCRIPT (Kịch bản) - GIỮ LUÔN ĐƯỢC MOUNT ĐỂ KHÔNG RESET TIẾN TRÌNH */}
        <div className={`flex-1 flex overflow-hidden ${currentStep === 'script' ? '' : 'hidden'}`}>
          <div className="w-[340px] flex flex-col bg-[#141417] border-r border-[#26262b] flex-shrink-0 overflow-y-auto">
            <ScriptEngine
              scenes={scenes}
              shots={shots}
              characters={characters}
              config={config}
              onUpdateScenesShots={handleUpdateScenesShots}
              onAddCharacter={handleAddCharacter}
              onShowToast={addToast}
            />
          </div>

          <div className="flex-1 flex flex-col bg-[#0b0b0d] overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#26262b] pb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs uppercase tracking-[0.06em] text-[#ececef]">
                  Danh sách Scene & Shot
                </span>
                <span className="text-[11px] font-mono text-[#9a9aa3]">
                  ({scenes.length} scenes • {shots.length} shots)
                </span>
              </div>
              {shots.length > 0 && (
                <Button
                  variant="primary"
                  size="xs"
                  icon="arrow_forward"
                  onClick={() => setCurrentStep('direct')}
                >
                  Sang bước 3: Đạo diễn
                </Button>
              )}
            </div>

            {scenes.length === 0 ? (
              <div className="h-64 rounded-lg border border-dashed border-[#26262b] flex flex-col items-center justify-center text-center text-[#9a9aa3] p-6 space-y-2">
                <span className="material-symbols-outlined text-3xl text-[#f5b301]/60">splitscreen</span>
                <p className="text-xs font-semibold text-[#ececef]">Chưa có scene nào.</p>
                <p className="text-[11px] text-[#6b6b75] max-w-sm">
                  Dùng khung bên trái để dán kịch bản và tách shot hoặc dùng AI viết storyboard hoạt hình 2D.
                </p>
              </div>
            ) : (
              scenes.map((sc) => {
                const sceneShots = shots.filter((s) => s.sceneId === sc.id);
                return (
                  <div
                    key={sc.id}
                    className="bg-[#141417] border border-[#26262b] rounded-lg overflow-hidden"
                  >
                    <div className="h-8 px-3 bg-[#18181d] border-b border-[#26262b] flex items-center justify-between text-xs">
                      <span className="font-bold text-[#f5b301] font-mono uppercase">
                        {sc.title}
                      </span>
                      <span className="text-[10px] text-[#9a9aa3] font-mono">
                        {sceneShots.length} shots
                      </span>
                    </div>

                    <div className="divide-y divide-[#26262b]/60">
                      {sceneShots.map((sh) => {
                        const isSelected = sh.id === selectedShotId;
                        return (
                          <div
                            key={sh.id}
                            onClick={() => setSelectedShotId(sh.id)}
                            className={`p-2.5 flex items-center justify-between gap-3 cursor-pointer transition ${
                              isSelected ? 'bg-[#1b1b20] border-l-2 border-[#f5b301]' : 'hover:bg-[#1b1b20]/50'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="font-mono font-bold text-[11px] px-1.5 py-0.2 rounded bg-[#f5b301] text-black">
                                #{sh.order}
                              </span>
                              <span className="text-xs text-[#ececef] truncate">
                                {sh.actionBeat}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1b1b20] border border-[#26262b] text-[#9a9aa3]">
                                {sh.shotSize}
                              </span>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1b1b20] border border-[#26262b] text-[#9a9aa3]">
                                {sh.cameraMovement}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* STEP 3: DIRECT (Đạo diễn & AI Director) */}
        {currentStep === 'direct' && (
          <div className="flex-1 flex overflow-hidden">
            <div className="w-[340px] flex flex-col bg-[#141417] border-r border-[#26262b] flex-shrink-0 overflow-y-auto">
              <div className="p-3 border-b border-[#26262b] bg-[#18181d] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#f5b301] flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">palette</span>
                    Look Hoạt Hình (19 phong cách)
                  </label>
                </div>

                <select
                  value={config.lookId}
                  onChange={(e) => setConfig({ ...config, lookId: e.target.value })}
                  className="w-full bg-[#141417] border border-[#26262b] text-[#ececef] rounded h-7 px-2 text-xs focus:border-[#f5b301] focus:outline-none"
                >
                  <optgroup label="2D Animation">
                    {LOOKS.filter((l) => l.group === '2D').map((lk) => (
                      <option key={lk.id} value={lk.id}>{lk.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Stylized Animation">
                    {LOOKS.filter((l) => l.group === 'Stylized').map((lk) => (
                      <option key={lk.id} value={lk.id}>{lk.label}</option>
                    ))}
                  </optgroup>
                </select>

                <input
                  type="text"
                  value={config.customStyle || ''}
                  onChange={(e) => setConfig({ ...config, customStyle: e.target.value })}
                  placeholder="Style tuỳ chỉnh (VD: warm watercolor, delicate lines...)"
                  className="w-full bg-[#141417] border border-[#26262b] rounded px-2 py-1 text-[11px] text-[#ececef] placeholder:text-[#6b6b75] focus:border-[#f5b301] focus:outline-none"
                />
              </div>

              {/* AI Director Toolbar */}
              <div className="p-3 border-b border-[#26262b] bg-[#101014] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-amber-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[15px]">smart_toy</span>
                    Đạo diễn AI (0 credit)
                  </span>
                  <span className="text-[9px] font-mono text-emerald-400">Gemini</span>
                </div>

                <input
                  type="text"
                  value={directorGenre}
                  onChange={(e) => setDirectorGenre(e.target.value)}
                  placeholder="Thể loại / Không khí (VD: bi tráng, hài hước, kịch tính...)"
                  className="w-full bg-[#18181d] border border-[#26262b] rounded px-2 py-1 text-[11px] text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
                />

                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    type="button"
                    disabled={isDirectingAI || shots.length === 0}
                    onClick={() => handleRunAIDirector('all')}
                    className="py-1.5 px-2 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-[11px] flex items-center justify-center gap-1 transition shadow"
                  >
                    <span className={`material-symbols-outlined text-[13px] ${isDirectingAI ? 'animate-spin' : ''}`}>
                      {isDirectingAI ? 'progress_activity' : 'movie_filter'}
                    </span>
                    Cho toàn phim
                  </button>
                  <button
                    type="button"
                    disabled={isDirectingAI || !selectedShotId}
                    onClick={() => handleRunAIDirector('selected')}
                    className="py-1.5 px-2 rounded bg-[#202026] hover:bg-[#282832] disabled:opacity-40 text-slate-200 border border-[#26262b] font-medium text-[11px] flex items-center justify-center gap-1 transition"
                  >
                    <span className="material-symbols-outlined text-[13px]">tune</span>
                    Shot đang chọn
                  </button>
                </div>
              </div>

              {/* Compact shot list */}
              <div className="p-2 space-y-1 overflow-y-auto flex-1">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-[#9a9aa3]">
                  Chọn shot để tinh chỉnh:
                </div>
                {shots.map((sh) => {
                  const isSelected = sh.id === selectedShotId;
                  return (
                    <button
                      key={sh.id}
                      type="button"
                      onClick={() => setSelectedShotId(sh.id)}
                      className={`w-full text-left p-2 rounded-md flex items-center justify-between text-xs transition ${
                        isSelected
                          ? 'bg-[#1b1b20] text-[#f5b301] border border-[#f5b301]/40 font-semibold'
                          : 'text-[#9a9aa3] hover:text-[#ececef] hover:bg-[#1b1b20]'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono text-[11px]">#{sh.order}</span>
                        <span className="truncate">{sh.actionBeat}</span>
                      </div>
                      <span className="material-symbols-outlined text-[14px]">
                        {isSelected ? 'chevron_right' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: Full ShotInspector */}
            {activeShot ? (
              <ShotInspector
                shot={activeShot}
                scene={activeScene}
                characters={characters}
                config={config}
                hasPrevShot={activeShotIndex > 0}
                hasNextShot={activeShotIndex < shots.length - 1}
                onPrevShot={() => {
                  if (activeShotIndex > 0) {
                    setSelectedShotId(shots[activeShotIndex - 1].id);
                  }
                }}
                onNextShot={() => {
                  if (activeShotIndex < shots.length - 1) {
                    setSelectedShotId(shots[activeShotIndex + 1].id);
                  }
                }}
                onUpdate={(updated) => {
                  setShots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
                  setHasUnsavedChanges(true);
                }}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-[#9a9aa3] p-6 space-y-2">
                <span className="material-symbols-outlined text-4xl text-[#f5b301]/60">tune</span>
                <p className="text-sm font-semibold text-[#ececef]">Chưa có shot nào được tạo</p>
                <p className="text-xs max-w-sm">
                  Chuyển sang bước 2 Kịch bản để tạo shot đầu tiên.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  icon="arrow_back"
                  onClick={() => setCurrentStep('script')}
                >
                  Đến bước 2 Kịch bản
                </Button>
              </div>
            )}
          </div>
        )}

        {/* STEP 4: STORYBOARD (Grid) */}
        {currentStep === 'storyboard' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {shots.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-[#9a9aa3] p-6 space-y-2">
                <span className="material-symbols-outlined text-4xl text-[#f5b301]/60">grid_view</span>
                <p className="text-sm font-semibold text-[#ececef]">Chưa có shot nào để tạo Storyboard</p>
                <Button
                  variant="primary"
                  size="sm"
                  icon="arrow_forward"
                  onClick={() => setCurrentStep('script')}
                >
                  Đến bước 2 Kịch bản
                </Button>
              </div>
            ) : (
              <StoryboardGrid
                shots={shots}
                scenes={scenes}
                characters={characters}
                config={config}
                onUpdateShots={handleUpdateShotsOnly}
                onUpdateScenes={handleUpdateScenesOnly}
              />
            )}
          </div>
        )}

        {/* STEP 5: RENDER (RenderQueue) */}
        {currentStep === 'render' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {shots.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-[#9a9aa3] p-6 space-y-2">
                <span className="material-symbols-outlined text-4xl text-[#f5b301]/60">queue_play_next</span>
                <p className="text-sm font-semibold text-[#ececef]">Chưa có shot nào để Render</p>
                <Button
                  variant="primary"
                  size="sm"
                  icon="arrow_forward"
                  onClick={() => setCurrentStep('script')}
                >
                  Đến bước 2 Kịch bản
                </Button>
              </div>
            ) : (
              <RenderQueue
                shots={shots}
                scenes={scenes}
                characters={characters}
                config={config}
                creditRemaining={currentRemaining}
                isGeneratingKeyframes={false}
                onUpdateShots={handleUpdateShotsOnly}
                onDeductCredits={handleDeductCredits}
              />
            )}
          </div>
        )}

        {/* STEP 6: EXPORT (ExportStep v2: 3 khối chuyên nghiệp) */}
        {currentStep === 'export' && (
          <ExportStep
            projectTitle={projectName}
            config={config}
            scenes={scenes}
            shots={shots}
            onUpdateShots={handleUpdateShotsOnly}
            onShowToast={addToast}
          />
        )}
      </main>

      {/* 4. ShotTimeline (cố định đáy 72px) */}
      {currentStep !== 'cast' && (
        <ShotTimeline
          shots={shots}
          selectedShotId={selectedShotId}
          onSelectShot={(id) => {
            setSelectedShotId(id);
            if (currentStep !== 'direct' && currentStep !== 'render') {
              setCurrentStep('direct');
            }
          }}
          onToggleTransition={handleToggleTransitionIn}
        />
      )}

      {/* Modal Bảng Xem Trước Đạo Diễn AI */}
      {directorModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="max-w-3xl w-full bg-[#141417] border border-amber-500/50 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-3 bg-[#1a1a20] border-b border-[#26262b] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-lg">movie_filter</span>
                <span className="font-bold text-sm text-white">
                  Bảng Xem Trước Đạo Diễn AI ({directorComparisonRows.length} shot có đề xuất)
                </span>
              </div>
              <button
                type="button"
                onClick={handleCancelDirector}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <div className="text-[11px] text-slate-400 font-mono">
                Kiểm tra các thông số đạo diễn được tối ưu theo nhịp 2D trước khi áp dụng:
              </div>

              <div className="divide-y divide-[#26262b] border border-[#26262b] rounded-lg overflow-hidden bg-[#0d0d0f] text-xs">
                {directorComparisonRows.map((row) => (
                  <div key={row.shot.id} className="p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between font-mono">
                      <span className="font-bold text-amber-300">
                        Shot #{row.shot.order}: <span className="text-white font-sans">{row.shot.actionBeat}</span>
                      </span>
                      <span className="text-[10px] text-slate-500">{row.changes.length} thay đổi</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] font-mono">
                      {row.changes.map((ch, idx) => (
                        <div key={idx} className="p-1.5 rounded bg-[#16161b] border border-[#26262b] flex items-center justify-between">
                          <span className="text-slate-400">{ch.label}:</span>
                          <span className="flex items-center gap-1">
                            <span className="text-slate-500 line-through text-[10px]">{ch.oldVal}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-emerald-400 font-semibold">{ch.newVal}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 bg-[#18181d] border-t border-[#26262b] flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-mono">0 credit (sử dụng Gemini Flash)</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelDirector}
                  className="px-3 py-1.5 rounded bg-[#25252b] hover:bg-[#303038] text-slate-300 text-xs font-semibold transition"
                >
                  Huỷ
                </button>
                <button
                  type="button"
                  onClick={handleApplyDirectorAll}
                  className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition shadow"
                >
                  Áp dụng tất cả ({directorComparisonRows.length} shot)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Unified Toast Notifications (Hỗ trợ nút hành động) */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`p-2.5 rounded-lg border shadow-xl flex items-center justify-between gap-2 pointer-events-auto text-xs font-mono transition-all ${
                t.type === 'success'
                  ? 'bg-[#141417] border-[#22c55e]/50 text-[#22c55e]'
                  : t.type === 'error'
                  ? 'bg-[#141417] border-[#ef4444]/50 text-[#ef4444]'
                  : 'bg-[#141417] border-amber-500/50 text-amber-300'
              }`}
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="material-symbols-outlined text-[16px] flex-shrink-0">
                  {t.type === 'success' ? 'check_circle' : t.type === 'error' ? 'error' : 'info'}
                </span>
                <span className="truncate">{t.text}</span>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {t.actionLabel && t.onAction && (
                  <button
                    type="button"
                    onClick={() => {
                      t.onAction!();
                      removeToast(t.id);
                    }}
                    className="px-2 py-0.5 rounded bg-amber-500 text-black font-bold text-[10px] hover:bg-amber-400 transition"
                  >
                    {t.actionLabel}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeToast(t.id)}
                  className="text-[#9a9aa3] hover:text-white p-0.5"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
