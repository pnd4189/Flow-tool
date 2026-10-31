import React, { useState, useRef } from 'react';
import { Flow } from 'flow-sdk';
import { Scene, Shot, Character, ProjectConfig } from '../services/types';
import { parseImportedScriptFile, ScriptImportResult } from '../services/scriptImport';
import {
  generateScriptOutline,
  generateSceneDetailedShots,
  polishScriptWithAI,
  ScriptOutline,
  ScriptPolishResult,
} from '../services/scriptWriter';
import { enforceVariety } from '../services/variety';
import { createCharacterFromProposal } from './CharacterVault';
import { ShotCard } from './ShotCard';

interface ScriptEngineProps {
  scenes: Scene[];
  shots: Shot[];
  characters: Character[];
  config: ProjectConfig;
  onUpdateScenesShots: (scenes: Scene[], shots: Shot[]) => void;
  onAddCharacter: (char: Character) => void;
  onShowToast?: (text: string, type?: 'success' | 'error' | 'info') => void;
}

export function normalizeCharacterName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

const SAMPLE_MANUAL_SCRIPT = `CẢNH 1: Xưởng chế tạo xe hơi hơi nước đầu tiên (Paris, 1769)
Nicolas Cugnot quan sát cỗ máy ba bánh khổng lồ xì khói nghi ngút.
CUGNOT: Chuẩn bị khởi động nồi hơi!
Cugnot lên buồng lái, xoay vô lăng bằng gỗ nặng trịch.
Cỗ xe bắt đầu lăn bánh chầm chậm về phía bức tường đá.
RẦM! Cỗ xe đâm sầm vào tường tạo nên vụ tai nạn ô tô đầu tiên trong lịch sử.`;

export const ScriptEngine: React.FC<ScriptEngineProps> = ({
  scenes,
  shots,
  characters,
  config,
  onUpdateScenesShots,
  onAddCharacter,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<'manual' | 'upload' | 'ai'>('ai');

  // Ô nhập tab Kịch bản tay mặc định RỖNG (không chứa sẵn giá trị thật)
  const [manualText, setManualText] = useState<string>('');
  const [manualError, setManualError] = useState<string | null>(null);

  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const [importedFileInfo, setImportedFileInfo] = useState<{
    name: string;
    lineCount: number;
    previewLines: string[];
    parsedResult?: ScriptImportResult;
    error?: string;
  } | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const [aiGenre, setAiGenre] = useState('Kể chuyện phát minh kỳ lạ');
  const [aiIdea, setAiIdea] = useState(
    'Chiếc ô tô chạy bằng hơi nước đầu tiên của Nicolas Cugnot và vụ tai nạn xe hơi đầu tiên trong lịch sử nhân loại năm 1769.'
  );
  const [inventionTopic, setInventionTopic] = useState('Chiếc ô tô chạy bằng hơi nước đầu tiên');
  const [inventionCount, setInventionCount] = useState<number>(1);
  const [narratorSelection, setNarratorSelection] = useState<string>('ai_propose');

  const [aiAudience, setAiAudience] = useState('Mọi lứa tuổi');
  const [aiDialogueLang, setAiDialogueLang] = useState('Tiếng Việt');

  const getDefaultStructure = (genre: string, mode: 'long' | 'short') => {
    if (genre === 'Kể chuyện phát minh kỳ lạ' || genre === 'Lịch sử thú vị') {
      return mode === 'long'
        ? 'Câu móc gây tò mò – bối cảnh thời đại – nhà phát minh & ý tưởng điên rồ – thử nghiệm thất bại hài hước – bước ngoặt thành công – ảnh hưởng đến ngày nay – câu chốt bất ngờ'
        : 'Câu hỏi móc 3 giây – phát minh kỳ lạ xuất hiện – nó hoạt động thế nào – sự thật bất ngờ – câu chốt';
    }
    return mode === 'short'
      ? 'Hook 3 giây – phát triển – cao trào – kết bất ngờ'
      : '3 hồi: mở – thắt – mở nút';
  };

  const [aiStructure, setAiStructure] = useState(getDefaultStructure(aiGenre, config.mode));

  const handleGenreChange = (newGenre: string) => {
    setAiGenre(newGenre);
    setAiStructure(getDefaultStructure(newGenre, config.mode));
  };

  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [outline, setOutline] = useState<ScriptOutline | null>(null);
  const [outlineError, setOutlineError] = useState<string | null>(null);

  const [isWritingDetails, setIsWritingDetails] = useState(false);
  const [currentWritingSceneIdx, setCurrentWritingSceneIdx] = useState<number>(0);
  const [writingProgressText, setWritingProgressText] = useState('');
  const abortWritingRef = useRef(false);

  // Trạng thái lưu scene/shot đã viết dở dang khi bị lỗi giữa chừng
  const [partialWritingState, setPartialWritingState] = useState<{
    completedScenes: Scene[];
    completedShots: Shot[];
    failedSceneIndex: number;
    accumulatedContext: string;
    errorMessage: string;
  } | null>(null);

  const [proposedCharacters, setProposedCharacters] = useState<any[]>([]);

  const [isPolishingAI, setIsPolishingAI] = useState(false);
  const [polishModalOpen, setPolishModalOpen] = useState(false);
  const [polishResult, setPolishResult] = useState<ScriptPolishResult | null>(null);
  const [polishOverwriteAll, setPolishOverwriteAll] = useState(false);
  const [translateToEnglishChoice, setTranslateToEnglishChoice] = useState(true);
  const [generateNarrationChoice, setGenerateNarrationChoice] = useState(true);
  const [polishNotice, setPolishNotice] = useState<string | null>(null);

  const [collapsedSceneIds, setCollapsedSceneIds] = useState<Record<string, boolean>>({});

  const toggleSceneCollapse = (sceneId: string) => {
    setCollapsedSceneIds((prev) => ({ ...prev, [sceneId]: !prev[sceneId] }));
  };

  const notify = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (onShowToast) {
      onShowToast(text, type);
    } else {
      setImportNotice(text);
    }
  };

  const isHistoryOrInvention =
    aiGenre === 'Kể chuyện phát minh kỳ lạ' ||
    aiGenre === 'Lịch sử thú vị';

  const handleEnforceVarietyManually = () => {
    if (shots.length === 0) return;
    const { shots: variedShots, modifiedCount } = enforceVariety(shots);
    if (modifiedCount > 0) {
      onUpdateScenesShots(scenes, variedShots);
      notify(`Đã đa dạng hoá ${modifiedCount} shot (chống lặp góc/cỡ cảnh)`, 'success');
    } else {
      notify('Các góc máy và cỡ cảnh đã đa dạng, không cần thay đổi.', 'info');
    }
  };

  // ================= A. TẢI KỊCH BẢN LÊN =================
  const handleTriggerFileUpload = () => {
    if (fileUploadInputRef.current) {
      fileUploadInputRef.current.value = '';
      fileUploadInputRef.current.click();
    }
  };

  const handleFileUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportNotice(null);
    try {
      const text = await file.text();
      const allLines = text.split(/\r?\n/);
      const previewLines = allLines.slice(0, 30);

      const parsed = await parseImportedScriptFile(text, file.name, characters);

      if (parsed.isSessionFile) {
        setImportedFileInfo({
          name: file.name,
          lineCount: allLines.length,
          previewLines,
          error: 'Đây là file phiên của tool, vui lòng dùng nút "Mở phiên" ở thanh tiêu đề.',
        });
        return;
      }

      setImportedFileInfo({
        name: file.name,
        lineCount: allLines.length,
        previewLines,
        parsedResult: parsed,
      });
    } catch (err: unknown) {
      setImportedFileInfo({
        name: file.name,
        lineCount: 0,
        previewLines: [],
        error: `Lỗi đọc file: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleApplyImportedScript = (mode: 'replace' | 'append') => {
    if (!importedFileInfo?.parsedResult) return;
    const { scenes: newScenes, shots: newShots } = importedFileInfo.parsedResult;

    if (newShots.length === 0) {
      setImportNotice('Không tìm thấy shot nào trong file để nhập.');
      return;
    }

    if (mode === 'replace') {
      const { shots: varied } = enforceVariety(newShots);
      onUpdateScenesShots(newScenes, varied);
      notify(`Đã thay thế storyboard bằng ${newScenes.length} scene và ${newShots.length} shot mới.`, 'success');
    } else {
      const baseOrder = shots.length;
      const shiftedShots = newShots.map((s, idx) => ({
        ...s,
        order: baseOrder + idx + 1,
        transitionIn: idx === 0 ? ('cut' as const) : s.transitionIn,
      }));
      const { shots: variedNew } = enforceVariety(shiftedShots);
      onUpdateScenesShots([...scenes, ...newScenes], [...shots, ...variedNew]);
      notify(`Đã thêm ${newScenes.length} scene và ${newShots.length} shot vào cuối storyboard.`, 'success');
    }
  };

  // ================= B. AI VIẾT KỊCH BẢN HOẠT HÌNH =================
  const handleGenerateOutline = async () => {
    const promptSubject = isHistoryOrInvention ? (inventionTopic.trim() || aiIdea.trim()) : aiIdea.trim();
    if (!promptSubject) {
      setOutlineError('Vui lòng nhập chủ đề phát minh hoặc ý tưởng kịch bản.');
      return;
    }
    setOutlineError(null);
    setIsGeneratingOutline(true);
    setOutline(null);
    setProposedCharacters([]);
    setPartialWritingState(null);

    try {
      const chosenNarrator = narratorSelection === 'ai_propose'
        ? 'Linh vật dẫn chuyện (AI Mascot)'
        : (characters.find((c) => c.id === narratorSelection)?.name || 'Người dẫn chuyện');

      const res = await generateScriptOutline({
        idea: aiIdea.trim() || inventionTopic.trim(),
        genre: aiGenre,
        audience: aiAudience,
        structure: aiStructure,
        dialogueLanguage: aiDialogueLang,
        targetShots: config.targetShots,
        projectMode: config.mode,
        existingCharacters: characters,
        inventionTopic: inventionTopic.trim(),
        inventionCount,
        narratorCharacterName: chosenNarrator,
      });

      setOutline(res);
      if (res.characters && res.characters.length > 0) {
        setProposedCharacters(res.characters);
      }
    } catch (err: unknown) {
      setOutlineError(err instanceof Error ? err.message : 'Tạo dàn ý thất bại');
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  // Viết chi tiết tuần tự, hỗ trợ tiếp tục từ scene startIndex
  const runDetailedWritingLoop = async (
    startIndex: number,
    initialScenes: Scene[],
    initialShots: Shot[],
    initialContext: string
  ) => {
    if (!outline || outline.scenes.length === 0) return;

    abortWritingRef.current = false;
    setIsWritingDetails(true);
    setOutlineError(null);
    setPartialWritingState(null);

    const generatedScenes: Scene[] = [...initialScenes];
    const generatedShots: Shot[] = [...initialShots];
    let globalOrder = initialShots.length + 1;
    let accumulatedContext = initialContext;
    let hadError = false;

    for (let scIdx = startIndex; scIdx < outline.scenes.length; scIdx++) {
      if (abortWritingRef.current) break;

      setCurrentWritingSceneIdx(scIdx);
      const scOutline = outline.scenes[scIdx];
      setWritingProgressText(`Đang viết chi tiết scene ${scIdx + 1}/${outline.scenes.length}: ${scOutline.title}`);

      try {
        const shotResults = await generateSceneDetailedShots({
          outline,
          sceneIndex: scIdx,
          dialogueLanguage: aiDialogueLang,
          characters: characters.map((c) => ({ id: c.id, name: c.name })),
          previousScenesSummary: accumulatedContext,
          genre: aiGenre,
          durationSeconds: config.durationSeconds,
          onAbortSignal: () => abortWritingRef.current,
        });

        if (abortWritingRef.current) break;

        const sceneId = `scene_${Date.now()}_${scIdx + 1}`;
        const newScene: Scene = {
          id: sceneId,
          title: scOutline.title,
          environment: scOutline.environment,
          environmentVi: scOutline.environmentVi || scOutline.environment,
          timeOfDay: scOutline.timeOfDay || 'Daylight',
          ambientDefault: '',
          lightingDefault: scOutline.lighting || 'day_flat',
          weather: scOutline.weather || 'clear',
        };
        generatedScenes.push(newScene);

        shotResults.forEach((sh, sIdx) => {
          const assignedIds: string[] = [];
          sh.characterNames.forEach((cn) => {
            const matched = characters.find(
              (c) => normalizeCharacterName(c.name) === normalizeCharacterName(cn)
            );
            if (matched && !assignedIds.includes(matched.id)) assignedIds.push(matched.id);
          });
          if (assignedIds.length === 0 && characters[0]) {
            assignedIds.push(characters[0].id);
          }

          generatedShots.push({
            id: `shot_${Date.now()}_${globalOrder}`,
            sceneId: newScene.id,
            order: globalOrder,
            actionBeat: sh.actionVi || sh.action,
            action: sh.action,
            actionVi: sh.actionVi,
            subject: sh.subject,
            characterIds: assignedIds,
            characterNames: [...sh.characterNames],
            shotSize: sh.shotSize,
            cameraAngle: sh.cameraAngle,
            cameraMovement: sh.cameraMovement,
            lens: sh.lens,
            lighting: newScene.lightingDefault,
            weather: newScene.weather || 'clear',
            effects: sh.effects,
            transitionIn: sIdx === 0 ? 'cut' : sh.transitionIn,
            audioDialogue: sh.dialogue,
            narration: sh.narration,
            eraLabel: sh.eraLabel,
            factNote: sh.factNote,
            audioSfx: sh.sfx,
            ambient: sh.ambient,
            startPose: sh.startPose,
            endPose: sh.endPose,
          });
          globalOrder++;
        });

        accumulatedContext += `\nScene ${scIdx + 1} (${scOutline.title}): ${scOutline.beats.join(', ')}`;
      } catch (err: unknown) {
        hadError = true;
        const realErrorMsg = err instanceof Error ? err.message : String(err);
        setOutlineError(`Lỗi ở scene ${scIdx + 1} (${scOutline.title}): ${realErrorMsg}`);

        // LƯU TRẠNG THÁI DỞ DANG VÀ TUYỆT ĐỐI KHÔNG THAY ĐỔI STORYBOARD HIỆN TẠI
        setPartialWritingState({
          completedScenes: generatedScenes,
          completedShots: generatedShots,
          failedSceneIndex: scIdx,
          accumulatedContext,
          errorMessage: realErrorMsg,
        });
        break;
      }
    }

    // CHỈ KHI VIẾT XONG HẾT TOÀN BỘ VÀ KHÔNG LỖI MỚI THAY STORYBOARD VÀ BÁO HOÀN TẤT
    if (!abortWritingRef.current && !hadError && generatedShots.length > 0) {
      const { shots: variedShots, modifiedCount } = enforceVariety(generatedShots);
      onUpdateScenesShots(generatedScenes, variedShots);
      setPartialWritingState(null);

      if (modifiedCount > 0) {
        notify(`Hoàn tất kịch bản (${generatedScenes.length} scenes, ${generatedShots.length} shots). Đã tự đa dạng hoá ${modifiedCount} shot camera!`, 'success');
      } else {
        notify(`Hoàn tất viết chi tiết kịch bản: ${generatedScenes.length} scenes, ${generatedShots.length} shots.`, 'success');
      }
    }

    setIsWritingDetails(false);
    setWritingProgressText('');
  };

  const handleStartDetailedWriting = async () => {
    setPartialWritingState(null);
    await runDetailedWritingLoop(0, [], [], '');
  };

  // 9. Xử lý nút 1: Thêm N scene đã viết xong vào cuối storyboard:
  // Chỉ chạy enforceVariety cho các shot MỚI (shot cũ giữ nguyên camera/keyframe/take); shot mới đầu tiên có transitionIn 'cut'
  const handleAppendPartialToStoryboard = () => {
    if (!partialWritingState || partialWritingState.completedShots.length === 0) return;
    const { completedScenes: newScenes, completedShots: newShots } = partialWritingState;

    const baseOrder = shots.length;
    const shiftedShots = newShots.map((s, idx) => ({
      ...s,
      order: baseOrder + idx + 1,
      transitionIn: idx === 0 ? ('cut' as const) : s.transitionIn,
    }));

    // Chỉ chạy enforceVariety riêng cho các shot MỚI
    const { shots: variedNewShots } = enforceVariety(shiftedShots);

    const combinedScenes = [...scenes, ...newScenes];
    // Shot cũ giữ nguyên 100%, không re-run variety lên shot cũ
    const combinedShots = [...shots, ...variedNewShots];

    onUpdateScenesShots(combinedScenes, combinedShots);
    notify(`Đã thêm ${newScenes.length} scene (${newShots.length} shot) đã viết xong vào cuối Storyboard.`, 'success');
    setPartialWritingState(null);
    setOutlineError(null);
  };

  // Xử lý nút 2: Thử lại từ scene lỗi (tiếp tục từ scene k với ngữ cảnh đã có)
  const handleRetryFromFailedScene = async () => {
    if (!partialWritingState) return;
    const { completedScenes, completedShots, failedSceneIndex, accumulatedContext } = partialWritingState;
    await runDetailedWritingLoop(failedSceneIndex, completedScenes, completedShots, accumulatedContext);
  };

  const handleCancelWritingDetails = () => {
    abortWritingRef.current = true;
    setIsWritingDetails(false);
    setWritingProgressText('Đã huỷ viết chi tiết.');
  };

  const handleAddProposedCharacterToVault = (propChar: any) => {
    if (!onAddCharacter) {
      notify('Lỗi: Chức năng thêm nhân vật vào Vault chưa sẵn sàng.', 'error');
      return;
    }
    const newChar = createCharacterFromProposal({
      name: propChar.name,
      dna: {
        faceShape: propChar.faceShape,
        eyes: propChar.eyes,
        hairstyle: propChar.hairstyle,
        skinTone: propChar.skinTone,
        outfit: propChar.outfit,
        accessories: propChar.accessories,
        proportions: propChar.proportions,
        palette: propChar.palette,
      },
    });
    onAddCharacter(newChar);
    setProposedCharacters((prev) => prev.filter((c) => c.name !== propChar.name));
    notify(`Đã thêm nhân vật ${propChar.name} vào Vault`, 'success');
  };

  const handleAddAllProposedCharactersToVault = () => {
    if (!onAddCharacter) {
      notify('Lỗi: Chức năng thêm nhân vật vào Vault chưa sẵn sàng.', 'error');
      return;
    }
    if (proposedCharacters.length === 0) return;
    const addedCount = proposedCharacters.length;
    proposedCharacters.forEach((propChar) => {
      const newChar = createCharacterFromProposal({
        name: propChar.name,
        dna: {
          faceShape: propChar.faceShape,
          eyes: propChar.eyes,
          hairstyle: propChar.hairstyle,
          skinTone: propChar.skinTone,
          outfit: propChar.outfit,
          accessories: propChar.accessories,
          proportions: propChar.proportions,
          palette: propChar.palette,
        },
      });
      onAddCharacter(newChar);
    });
    setProposedCharacters([]);
    notify(`Đã thêm tất cả ${addedCount} nhân vật đề xuất vào Vault!`, 'success');
  };

  const handleOpenPolishModal = async () => {
    if (shots.length === 0) return;
    setIsPolishingAI(true);
    setPolishNotice(null);

    try {
      const result = await polishScriptWithAI({
        shots,
        scenes,
        characters,
        translatePromptFieldsToEnglish: translateToEnglishChoice,
        generateNarrationIfEmpty: generateNarrationChoice,
        dialogueLanguage: aiDialogueLang,
        durationSeconds: config.durationSeconds,
      });
      setPolishResult(result);
      setPolishModalOpen(true);
    } catch (err: unknown) {
      setPolishNotice(err instanceof Error ? err.message : 'Lỗi hoàn thiện kịch bản bằng AI.');
    } finally {
      setIsPolishingAI(false);
    }
  };

  const handleApplyPolishAll = () => {
    if (!polishResult) return;

    const sceneUpdateMap = new Map<string, any>();
    polishResult.scenes.forEach((sc) => sceneUpdateMap.set(sc.sceneId, sc));

    const nextScenes = scenes.map((sc) => {
      const u = sceneUpdateMap.get(sc.id);
      if (!u) return sc;
      return {
        ...sc,
        environment: polishOverwriteAll ? (u.environment || sc.environment) : (sc.environment || u.environment),
        environmentVi: u.environmentVi || sc.environmentVi || sc.environment,
        timeOfDay: polishOverwriteAll ? (u.timeOfDay || sc.timeOfDay) : (sc.timeOfDay || u.timeOfDay),
        weather: polishOverwriteAll ? (u.weather || sc.weather) : (sc.weather || u.weather),
        lightingDefault: polishOverwriteAll ? (u.lighting || sc.lightingDefault) : (sc.lightingDefault || u.lighting),
      };
    });

    const shotUpdateMap = new Map<number, any>();
    polishResult.shots.forEach((sh) => shotUpdateMap.set(sh.order, sh));

    const nextShots = shots.map((sh) => {
      const u = shotUpdateMap.get(sh.order);
      if (!u) return sh;

      let nextCharIds = [...sh.characterIds];
      const mergedNames = Array.from(new Set([...(sh.characterNames || []), ...(u.characterNames || [])]));

      mergedNames.forEach((cn: string) => {
        const matched = characters.find(
          (c) => normalizeCharacterName(c.name) === normalizeCharacterName(cn)
        );
        if (matched && !nextCharIds.includes(matched.id)) nextCharIds.push(matched.id);
      });

      return {
        ...sh,
        characterNames: mergedNames,
        action: polishOverwriteAll ? (u.action || sh.action) : (sh.action || u.action),
        actionVi: u.actionVi || sh.actionVi || sh.actionBeat,
        subject: polishOverwriteAll ? (u.subject || sh.subject) : (sh.subject || u.subject),
        characterIds: nextCharIds.length > 0 ? nextCharIds : sh.characterIds,
        narration: polishOverwriteAll ? (u.narration || sh.narration) : (sh.narration || u.narration),
        eraLabel: polishOverwriteAll ? (u.eraLabel || sh.eraLabel) : (sh.eraLabel || u.eraLabel),
        factNote: polishOverwriteAll ? (u.factNote || sh.factNote) : (sh.factNote || u.factNote),
        startPose: polishOverwriteAll ? (u.startPose || sh.startPose) : (sh.startPose || u.startPose),
        endPose: polishOverwriteAll ? (u.endPose || sh.endPose) : (sh.endPose || u.endPose),
        ambient: polishOverwriteAll ? (u.ambient || sh.ambient) : (sh.ambient || u.ambient),
        audioSfx: polishOverwriteAll ? (u.sfx || sh.audioSfx) : (sh.audioSfx || u.sfx),
      };
    });

    onUpdateScenesShots(nextScenes, nextShots);
    setPolishModalOpen(false);
    setPolishResult(null);
    notify('Đã áp dụng toàn bộ đề xuất hoàn thiện kịch bản!', 'success');
  };

  // DÙNG CHUNG bộ phân tích văn bản parseImportedScriptFile để nhận diện tiêu đề cảnh và dòng thoại chuẩn xác
  const handleSplitManual = async () => {
    setManualError(null);
    const textToParse = manualText.trim();
    if (!textToParse) {
      setManualError('Vui lòng nhập kịch bản hoặc bấm "Dán ví dụ" trước khi tách.');
      return;
    }

    try {
      const parsed = await parseImportedScriptFile(textToParse, 'manual_script.txt', characters);
      if (parsed.shots.length === 0) {
        setManualError('Không tìm thấy shot nào trong văn bản đã nhập.');
        return;
      }
      const { shots: varied } = enforceVariety(parsed.shots);
      onUpdateScenesShots(parsed.scenes, varied);
      notify(`Đã tách thành ${parsed.scenes.length} scene và ${varied.length} shots vào Storyboard`, 'success');
    } catch (err: unknown) {
      setManualError(err instanceof Error ? err.message : 'Tách kịch bản thất bại');
    }
  };

  const handleUpdateShot = (updated: Shot) => {
    onUpdateScenesShots(
      scenes,
      shots.map((s) => (s.id === updated.id ? { ...updated, userEdited: true } : s))
    );
  };

  const handleDeleteShot = (shotId: string) => {
    const nextShots = shots
      .filter((s) => s.id !== shotId)
      .map((s, idx) => ({ ...s, order: idx + 1 }));
    const activeSceneIds = new Set(nextShots.map((s) => s.sceneId));
    const nextScenes = scenes.filter((sc) => activeSceneIds.has(sc.id));
    onUpdateScenesShots(nextScenes.length > 0 ? nextScenes : scenes, nextShots);
  };

  const handleMoveShot = (shotId: string, direction: 'up' | 'down') => {
    const index = shots.findIndex((s) => s.id === shotId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= shots.length) return;

    const copy = [...shots];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;
    const reordered = copy.map((s, idx) => ({ ...s, order: idx + 1 }));
    onUpdateScenesShots(scenes, reordered);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0a0a] overflow-hidden">
      <input
        ref={fileUploadInputRef}
        type="file"
        accept=".txt,.md,.fountain,.srt,.csv,.json"
        className="hidden"
        onChange={handleFileUploadChange}
      />

      {/* Top Header & Tab Navigation */}
      <div className="bg-[#121212] border-b border-[#595959]/50 px-3 py-2 flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400 text-lg">movie_filter</span>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-100">
              Kịch Bản Hoạt Hình 2D
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
              {shots.length > 0 ? `${shots.length} shots` : `Mục tiêu ${config.targetShots}`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {shots.length > 0 && (
              <button
                type="button"
                onClick={handleEnforceVarietyManually}
                className="px-2.5 py-1 rounded bg-[#1e1e24] hover:bg-[#252530] text-slate-300 border border-[#26262b] text-xs font-semibold flex items-center gap-1 transition"
                title="Tự động kiểm tra và thay đổi chuyển động/cỡ cảnh bị lặp 3-4 shot liên tiếp"
              >
                <span className="material-symbols-outlined text-[14px] text-amber-400">autorenew</span>
                <span>Tự đa dạng hoá máy quay</span>
              </button>
            )}

            <button
              type="button"
              disabled={isPolishingAI || shots.length === 0}
              onClick={handleOpenPolishModal}
              className="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1 transition shadow-sm disabled:opacity-40"
              title="Dịch hành động sang tiếng Anh, điền bối cảnh, viết lời dẫn và tư thế (0 credit)"
            >
              <span className={`material-symbols-outlined text-[14px] ${isPolishingAI ? 'animate-spin' : ''}`}>
                {isPolishingAI ? 'progress_activity' : 'auto_fix_high'}
              </span>
              <span>{isPolishingAI ? 'Đang hoàn thiện...' : 'AI hoàn thiện kịch bản (0 cr)'}</span>
            </button>
          </div>
        </div>

        {/* 3 Tab Switchers */}
        <div className="flex gap-1.5 text-xs border-b border-[#595959]/20 pb-1">
          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className={`px-3 py-1 rounded font-medium transition flex items-center gap-1.5 ${
              activeTab === 'ai'
                ? 'bg-[#252525] text-amber-400 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">smart_toy</span>
            AI viết kịch bản
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`px-3 py-1 rounded font-medium transition flex items-center gap-1.5 ${
              activeTab === 'upload'
                ? 'bg-[#252525] text-amber-400 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">cloud_upload</span>
            Tải file
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`px-3 py-1 rounded font-medium transition flex items-center gap-1.5 ${
              activeTab === 'manual'
                ? 'bg-[#252525] text-amber-400 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">edit_note</span>
            Kịch bản tay
          </button>
        </div>

        {/* TAB 3: AI VIẾT KỊCH BẢN HOẠT HÌNH */}
        {activeTab === 'ai' && (
          <div className="space-y-3 bg-[#161616] p-3 rounded-lg border border-[#595959]/40 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[9px] text-amber-400 font-mono block font-bold uppercase">
                  Thể loại (Genre)
                </label>
                <select
                  value={aiGenre}
                  onChange={(e) => handleGenreChange(e.target.value)}
                  className="w-full bg-[#0d0d0d] border border-amber-500/40 rounded px-1.5 py-1 text-white text-[11px] font-semibold"
                >
                  <option value="Kể chuyện phát minh kỳ lạ">Kể chuyện phát minh kỳ lạ (Mới)</option>
                  <option value="Lịch sử thú vị">Lịch sử thú vị (Mới)</option>
                  <option value="Phiêu lưu">Phiêu lưu</option>
                  <option value="Hài hước">Hài hước</option>
                  <option value="Cổ tích">Cổ tích</option>
                  <option value="Học đường">Học đường</option>
                  <option value="Kỳ ảo/phép thuật">Kỳ ảo/phép thuật</option>
                  <option value="Hành động">Hành động</option>
                  <option value="Khoa học viễn tưởng">Khoa học viễn tưởng</option>
                  <option value="Giáo dục thiếu nhi">Giáo dục thiếu nhi</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] text-slate-400 font-mono block">Khán giả (Audience)</label>
                <select
                  value={aiAudience}
                  onChange={(e) => setAiAudience(e.target.value)}
                  className="w-full bg-[#0d0d0d] border border-[#595959]/50 rounded px-1.5 py-1 text-white text-[11px]"
                >
                  <option value="Mọi lứa tuổi">Mọi lứa tuổi</option>
                  <option value="Trẻ em">Trẻ em</option>
                  <option value="Thiếu niên">Thiếu niên</option>
                  <option value="Người lớn">Người lớn</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] text-slate-400 font-mono block">Ngôn ngữ lời dẫn / thoại</label>
                <select
                  value={aiDialogueLang}
                  onChange={(e) => setAiDialogueLang(e.target.value)}
                  className="w-full bg-[#0d0d0d] border border-[#595959]/50 rounded px-1.5 py-1 text-white text-[11px]"
                >
                  <option value="Tiếng Việt">Tiếng Việt</option>
                  <option value="English">English</option>
                </select>
              </div>
            </div>

            {isHistoryOrInvention && (
              <div className="p-2.5 rounded-lg bg-[#0e0e11] border border-amber-500/30 space-y-2">
                <div className="flex items-center gap-1.5 text-amber-300 font-bold text-[11px]">
                  <span className="material-symbols-outlined text-[15px]">history_edu</span>
                  <span>Thiết lập chuỗi kể chuyện phát minh / lịch sử</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <label className="text-[9px] text-slate-300 font-mono block">
                      Phát minh / chủ đề * (VD: Chiếc ô tô hơi nước đầu tiên, Máy bay đạp chân...)
                    </label>
                    <input
                      type="text"
                      value={inventionTopic}
                      onChange={(e) => setInventionTopic(e.target.value)}
                      placeholder="VD: Chiếc ô tô chạy bằng hơi nước đầu tiên của Nicolas Cugnot"
                      className="w-full bg-[#16161a] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px] focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] text-slate-300 font-mono block">
                      Số phát minh trong tập
                    </label>
                    <select
                      value={inventionCount}
                      onChange={(e) => setInventionCount(Number(e.target.value))}
                      className="w-full bg-[#16161a] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
                    >
                      <option value={1}>1 (Kể sâu một phát minh)</option>
                      <option value={3}>3 (Dạng top list 3 phát minh)</option>
                      <option value={5}>5 (Dạng top list 5 phát minh)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[9px] text-slate-300 font-mono block">
                    Nhân vật dẫn chuyện (Host / Mascot)
                  </label>
                  <select
                    value={narratorSelection}
                    onChange={(e) => setNarratorSelection(e.target.value)}
                    className="w-full bg-[#16161a] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
                  >
                    <option value="ai_propose">AI đề xuất người dẫn chuyện (Linh vật cố định)</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (Từ Character Vault)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 font-mono block uppercase">
                {isHistoryOrInvention ? 'Mô tả chi tiết / Sự kiện' : 'Ý tưởng cốt lõi (Premise / Logline) *'}
              </label>
              <textarea
                rows={2}
                value={aiIdea}
                onChange={(e) => setAiIdea(e.target.value)}
                placeholder="VD: Chiếc ô tô hơi nước của Nicolas Cugnot đâm vào tường đá..."
                className="w-full bg-[#0d0d0d] border border-[#595959]/60 rounded px-2.5 py-1 text-white text-xs focus:border-amber-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[9px] text-slate-400 font-mono block">Cấu trúc kịch bản (Tự động gán theo thể loại)</label>
              <input
                type="text"
                value={aiStructure}
                onChange={(e) => setAiStructure(e.target.value)}
                className="w-full bg-[#0d0d0d] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-400 font-mono">
                {characters.length > 0 ? (
                  <span className="text-emerald-400 font-semibold">✓ {characters.length} nhân vật trong Vault</span>
                ) : (
                  <span className="text-amber-400">Vault trống: AI sẽ đề xuất người dẫn / nhân vật lịch sử</span>
                )}
              </span>

              <button
                type="button"
                disabled={isGeneratingOutline || isWritingDetails}
                onClick={handleGenerateOutline}
                className="px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-xs flex items-center gap-1.5 transition shadow"
              >
                <span className={`material-symbols-outlined text-[15px] ${isGeneratingOutline ? 'animate-spin' : ''}`}>
                  {isGeneratingOutline ? 'progress_activity' : 'format_list_bulleted'}
                </span>
                {isGeneratingOutline ? 'Đang lên dàn ý...' : `Bước 1: Lập Dàn Ý (${config.targetShots} shots)`}
              </button>
            </div>

            {outlineError && (
              <div className="p-2.5 rounded bg-red-950/70 border border-red-500/50 text-red-200 text-xs font-mono space-y-2">
                <div className="flex items-center gap-1.5 text-red-300 font-bold">
                  <span className="material-symbols-outlined text-base">error</span>
                  <span>{outlineError}</span>
                </div>

                {partialWritingState && (
                  <div className="pt-2 border-t border-red-500/30 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-300">
                      Đã viết xong {partialWritingState.completedScenes.length} scene ({partialWritingState.completedShots.length} shot) trước khi lỗi.
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAppendPartialToStoryboard}
                        className="px-2.5 py-1 rounded bg-[#2a2a32] hover:bg-[#353540] text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1 transition shadow-sm"
                      >
                        <span className="material-symbols-outlined text-[14px]">playlist_add</span>
                        Thêm {partialWritingState.completedScenes.length} scene đã viết vào cuối
                      </button>
                      <button
                        type="button"
                        onClick={handleRetryFromFailedScene}
                        className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold flex items-center gap-1 transition shadow"
                      >
                        <span className="material-symbols-outlined text-[14px]">refresh</span>
                        Thử lại từ scene {partialWritingState.failedSceneIndex + 1}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {proposedCharacters.length > 0 && (
              <div className="p-2.5 rounded bg-[#0f0f12] border border-amber-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1 font-mono uppercase">
                    <span className="material-symbols-outlined text-[14px]">face</span>
                    Nhân vật đề xuất từ AI ({proposedCharacters.length} nhân vật • DNA tiếng Anh):
                  </span>
                  <button
                    type="button"
                    onClick={handleAddAllProposedCharactersToVault}
                    className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-bold transition flex items-center gap-1 shadow"
                  >
                    <span className="material-symbols-outlined text-[13px]">group_add</span>
                    Thêm tất cả vào Vault
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {proposedCharacters.map((prop, idx) => (
                    <div key={idx} className="p-2 rounded bg-[#18181d] border border-[#26262b] flex items-center justify-between text-xs">
                      <div className="min-w-0 pr-2">
                        <span className="font-bold text-white block truncate">{prop.name}</span>
                        <span className="text-[10px] text-slate-400 line-clamp-1">{prop.outfit} • {prop.proportions}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddProposedCharacterToVault(prop)}
                        className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-medium transition flex-shrink-0"
                      >
                        + Thêm vào Vault
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {outline && (
              <div className="p-3 bg-[#0d0d0f] rounded-lg border border-amber-500/50 space-y-2.5 text-xs font-mono">
                <div className="flex items-center justify-between border-b border-[#26262b] pb-1.5">
                  <div>
                    <h3 className="font-bold text-white text-sm">{outline.title}</h3>
                    <p className="text-[11px] text-slate-400 font-sans">{outline.logline}</p>
                  </div>
                  <span className="text-amber-400 font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
                    {outline.scenes.reduce((sum, s) => sum + s.shotCount, 0)} shots
                  </span>
                </div>

                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {outline.scenes.map((sc, sIdx) => (
                    <div key={sIdx} className="p-1.5 rounded bg-[#16161b] border border-[#26262b] flex items-center justify-between text-[11px]">
                      <div>
                        <span className="font-bold text-slate-200">
                          Scene {sIdx + 1}: {sc.title}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          {sc.environment} • {sc.beats?.length || 0} beats
                        </span>
                      </div>
                      <span className="text-amber-300 font-bold px-1.5 py-0.5 rounded bg-black/50">
                        {sc.shotCount} shots
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#26262b]">
                  <span className="text-[11px] text-slate-400">
                    {isWritingDetails ? writingProgressText : 'Dàn ý đã sẵn sàng.'}
                  </span>
                  {isWritingDetails ? (
                    <button
                      type="button"
                      onClick={handleCancelWritingDetails}
                      className="px-3 py-1 rounded bg-red-950 text-red-300 border border-red-500/40 text-xs font-semibold"
                    >
                      Huỷ
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStartDetailedWriting}
                      className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-1.5 transition shadow"
                    >
                      <span className="material-symbols-outlined text-[15px]">edit_note</span>
                      Bước 2: Viết Chi Tiết Từng Scene (Kèm Lời Dẫn & Đa Dạng Máy Quay)
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 1: TẢI FILE KỊCH BẢN */}
        {activeTab === 'upload' && (
          <div className="space-y-2.5 bg-[#161616] p-3 rounded-lg border border-[#595959]/40 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-medium">
                Tải lên file kịch bản (.txt, .md, .fountain, .srt, .csv, .json):
              </span>
              <button
                type="button"
                onClick={handleTriggerFileUpload}
                className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-1 transition shadow"
              >
                <span className="material-symbols-outlined text-[15px]">upload_file</span>
                Chọn file từ máy
              </button>
            </div>

            {importedFileInfo && (
              <div className="space-y-2 p-2.5 bg-[#0e0e0e] rounded border border-[#595959]/40 font-mono text-[11px]">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="font-bold text-amber-400 truncate max-w-[220px]">
                    📄 {importedFileInfo.name} ({importedFileInfo.lineCount} dòng)
                  </span>
                  {importedFileInfo.parsedResult && (
                    <span className="text-emerald-400 font-semibold">
                      {importedFileInfo.parsedResult.totalScenes} scene • {importedFileInfo.parsedResult.totalShots} shot • {importedFileInfo.parsedResult.totalDialogues} thoại
                    </span>
                  )}
                </div>

                {importedFileInfo.error && (
                  <div className="p-2 rounded bg-red-950/60 border border-red-500/40 text-red-300">
                    {importedFileInfo.error}
                  </div>
                )}

                <div className="max-h-24 overflow-y-auto bg-[#141417] p-2 rounded border border-[#26262b] text-[10px] text-slate-400 whitespace-pre-wrap select-text">
                  {importedFileInfo.previewLines.join('\n')}
                </div>

                {importedFileInfo.parsedResult && !importedFileInfo.error && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#595959]/30">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleApplyImportedScript('replace')}
                        className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs transition"
                      >
                        Nhập vào storyboard (Thay thế)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyImportedScript('append')}
                        className="px-2.5 py-1 rounded bg-[#242424] hover:bg-[#303030] text-slate-200 border border-[#595959]/50 text-xs transition"
                      >
                        Thêm vào cuối
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: KỊCH BẢN TAY */}
        {activeTab === 'manual' && (
          <div className="space-y-2 bg-[#161616] p-2.5 rounded-lg border border-[#595959]/40 text-xs">
            <div className="flex items-center justify-between text-slate-400 text-[11px]">
              <span>Dán kịch bản (mỗi dòng 1 shot; CẢNH / INT / EXT để mở scene mới):</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setManualText(SAMPLE_MANUAL_SCRIPT)}
                  className="text-amber-400 hover:underline flex items-center gap-0.5 text-[11px]"
                  title="Dán kịch bản mẫu về phát minh Nicolas Cugnot"
                >
                  <span className="material-symbols-outlined text-[13px]">content_paste</span>
                  <span>Dán ví dụ</span>
                </button>
                <span className="font-mono text-slate-500 text-[10px]">
                  Gợi ý: {config.targetShots} shots
                </span>
              </div>
            </div>
            <textarea
              rows={4}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder={`Ví dụ:\n${SAMPLE_MANUAL_SCRIPT}`}
              className="w-full bg-[#0d0d0d] border border-[#595959]/60 rounded p-2 text-white text-xs font-sans focus:border-amber-400 focus:outline-none placeholder:text-slate-600"
            />
            {manualError && (
              <div className="p-2 rounded bg-red-950/50 border border-red-500/40 text-red-300 text-[11px] font-mono">
                {manualError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleSplitManual}
                className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center gap-1 transition shadow"
              >
                <span className="material-symbols-outlined text-[15px]">splitscreen</span>
                Tách kịch bản vào Storyboard
              </button>
            </div>
          </div>
        )}

        {importNotice && (
          <div className="p-2 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">check_circle</span>
            <span>{importNotice}</span>
          </div>
        )}
      </div>

      {/* Storyboard Stream View */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {scenes.length === 0 ? (
          <div className="h-64 rounded-xl border border-dashed border-[#595959]/40 flex flex-col items-center justify-center p-6 text-center text-slate-500 space-y-2">
            <span className="material-symbols-outlined text-4xl text-amber-500/60">splitscreen</span>
            <h3 className="text-sm font-semibold text-slate-300">Chưa có Scene nào trong Storyboard</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              Dùng tab "AI viết kịch bản" hoặc nhập nội dung ở tab "Kịch bản tay" để bắt đầu.
            </p>
          </div>
        ) : (
          scenes.map((scene) => {
            const sceneShots = shots.filter((s) => s.sceneId === scene.id);
            const isCollapsed = Boolean(collapsedSceneIds[scene.id]);

            return (
              <div
                key={scene.id}
                className="rounded-xl bg-[#141414] border border-[#595959]/60 overflow-hidden shadow-md"
              >
                <div className="bg-[#1c1c1c] border-b border-[#595959]/50 px-3 py-2 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSceneCollapse(scene.id)}
                      className="text-slate-400 hover:text-white"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {isCollapsed ? 'expand_more' : 'expand_less'}
                      </span>
                    </button>
                    <div>
                      <span className="font-bold text-xs text-amber-300 font-mono uppercase tracking-wide">
                        {scene.title}
                      </span>
                      {scene.environment && (
                        <span className="text-[10px] text-slate-400 font-mono ml-2">
                          [{scene.environment}]
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 bg-[#252525] px-1.5 py-0.5 rounded font-mono">
                      {sceneShots.length} shots
                    </span>
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="p-3 space-y-3">
                    {sceneShots.map((shot) => {
                      const hasMissingModelSheet = characters
                        .filter((c) => shot.characterIds.includes(c.id))
                        .some((c) => !c.thumbBase64 && !c.mediaId);

                      return (
                        <div key={shot.id} className="space-y-1.5">
                          {hasMissingModelSheet && (
                            <div className="p-1 px-2 rounded bg-amber-950/70 border border-amber-500/50 text-amber-300 text-[10px] font-mono flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[13px]">warning</span>
                              <span>Nhân vật chưa có model sheet — keyframe sẽ kém nhất quán</span>
                            </div>
                          )}

                          {(shot.eraLabel || shot.narration) && (
                            <div className="p-2 rounded bg-[#0d0d0f] border border-[#26262b] flex flex-col gap-1 text-[11px]">
                              <div className="flex items-center justify-between">
                                {shot.eraLabel ? (
                                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                    ⏳ {shot.eraLabel}
                                  </span>
                                ) : <span />}
                                {shot.narration && (
                                  <span className="text-[9px] font-mono text-slate-500">
                                    Lời dẫn ({shot.narration.split(/\s+/).filter(Boolean).length} từ)
                                  </span>
                                )}
                              </div>
                              {shot.narration && (
                                <p className="italic text-slate-300 font-sans leading-relaxed select-text">
                                  "{shot.narration}"
                                </p>
                              )}
                            </div>
                          )}

                          <ShotCard
                            shot={shot}
                            scene={scene}
                            characters={characters}
                            config={config}
                            isFirst={shot.order === 1}
                            isLast={shot.order === shots.length}
                            onUpdate={handleUpdateShot}
                            onDelete={handleDeleteShot}
                            onMoveUp={(id) => handleMoveShot(id, 'up')}
                            onMoveDown={(id) => handleMoveShot(id, 'down')}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* MODAL AI HOÀN THIỆN KỊCH BẢN */}
      {polishModalOpen && polishResult && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="max-w-4xl w-full bg-[#141417] border border-amber-500/50 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-3 bg-[#1a1a20] border-b border-[#26262b] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-lg">auto_fix_high</span>
                <span className="font-bold text-sm text-white">
                  Xem Trước: AI Hoàn Thiện Kịch Bản & Lời Dẫn (0 credit)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPolishModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 font-mono bg-[#111] p-2.5 rounded border border-[#26262b]">
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-1.5 cursor-pointer text-emerald-400 font-bold">
                    <input
                      type="checkbox"
                      checked={translateToEnglishChoice}
                      onChange={(e) => setTranslateToEnglishChoice(e.target.checked)}
                      className="accent-emerald-500 rounded"
                    />
                    <span>Dịch các trường prompt sang tiếng Anh (Action, Poses, Ambient, SFX)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-amber-300 font-bold">
                    <input
                      type="checkbox"
                      checked={generateNarrationChoice}
                      onChange={(e) => setGenerateNarrationChoice(e.target.checked)}
                      className="accent-amber-500 rounded"
                    />
                    <span>Viết lời dẫn (Narration) cho shot đang trống</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-400">
                    <input
                      type="checkbox"
                      checked={polishOverwriteAll}
                      onChange={(e) => setPolishOverwriteAll(e.target.checked)}
                      className="accent-amber-500 rounded"
                    />
                    <span>Ghi đè tất cả</span>
                  </label>
                </div>
              </div>

              <div className="divide-y divide-[#26262b] border border-[#26262b] rounded-lg overflow-hidden bg-[#0d0d0f] text-xs font-mono">
                {polishResult.shots.map((ps) => {
                  const origShot = shots.find((s) => s.order === ps.order);
                  return (
                    <div key={ps.order} className="p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-amber-300">Shot #{ps.order}</span>
                          {ps.eraLabel && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">
                              ⏳ {ps.eraLabel}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-emerald-400">
                          Nhân vật: {ps.characterNames?.join(', ') || 'Chưa gắn'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                        <div className="p-2 rounded bg-[#16161b] border border-[#26262b]">
                          <span className="text-slate-400 block text-[10px] uppercase font-bold">Kịch bản gốc:</span>
                          <p className="text-slate-300 mt-0.5">{origShot?.actionBeat || '—'}</p>
                          {origShot?.narration && (
                            <p className="text-slate-400 italic text-[10px] mt-1">
                              Lời dẫn cũ: "{origShot.narration}"
                            </p>
                          )}
                        </div>

                        <div className="p-2 rounded bg-[#16161b] border border-amber-500/30 space-y-1">
                          <span className="text-amber-400 block text-[10px] uppercase font-bold">AI đề xuất hoàn thiện:</span>
                          <p className="text-emerald-300 font-medium">{ps.action}</p>
                          {ps.narration && (
                            <div className="p-1 rounded bg-[#0b0b0d] text-amber-200 text-[10px] italic">
                              🎤 Lời dẫn: "{ps.narration}"
                            </div>
                          )}
                          {ps.factNote && (
                            <div className="text-[9px] text-slate-400">
                              🔍 Fact: {ps.factNote}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-3 bg-[#18181d] border-t border-[#26262b] flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-mono">0 credit • Gemini Flash</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPolishModalOpen(false)}
                  className="px-3 py-1.5 rounded bg-[#25252b] hover:bg-[#303038] text-slate-300 text-xs font-semibold transition"
                >
                  Huỷ
                </button>
                <button
                  type="button"
                  onClick={handleApplyPolishAll}
                  className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition shadow"
                >
                  Áp dụng tất cả
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
