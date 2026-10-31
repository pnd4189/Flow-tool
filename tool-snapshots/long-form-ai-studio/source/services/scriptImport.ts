import { Scene, Shot, Character } from './types';

export interface ScriptImportResult {
  scenes: Scene[];
  shots: Shot[];
  totalScenes: number;
  totalShots: number;
  totalDialogues: number;
  isSessionFile?: boolean;
}

/** Tách văn bản thành các câu */
function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g);
  if (!matches) return [text];
  return matches.map((m) => m.trim()).filter((m) => m.length > 0);
}

/** Chuẩn hóa tên nhân vật để so sánh không phân biệt hoa thường */
function normalizeName(n: string): string {
  return n.trim().toLowerCase().replace(/[^a-z0-9àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/g, '');
}

/** Danh sách nhãn kịch bản đã biết (bỏ khoảng trắng quanh '/') */
const KNOWN_LABELS: Record<string, string> = {
  'camera': 'camera',
  'composition': 'composition',
  'storydna': 'storydna',
  'story dna': 'storydna',
  'setting': 'setting',
  'bối cảnh': 'setting',
  'boi canh': 'setting',
  'subject': 'subject',
  'chủ thể': 'subject',
  'chu the': 'subject',
  'action': 'action',
  'action/energy': 'action',
  'action / energy': 'action',
  'hành động': 'action',
  'hanh dong': 'action',
  'style': 'style',
  'phong cách': 'style',
  'phong cach': 'style',
  'lighting': 'lighting',
  'lighting/color': 'lighting',
  'lighting / color': 'lighting',
  'ánh sáng': 'lighting',
  'anh sang': 'lighting',
  'atmosphere': 'atmosphere',
  'không khí': 'atmosphere',
  'khong khi': 'atmosphere',
  'negative': 'negative',
  'tránh': 'negative',
  'tranh': 'negative',
  'dialogue': 'dialogue',
  'lời thoại': 'dialogue',
  'loi thoai': 'dialogue',
  'narration': 'narration',
  'voice-over': 'narration',
  'voice over': 'narration',
  'vo': 'narration',
  'lời dẫn': 'narration',
  'loi dan': 'narration',
  'sfx': 'sfx',
  'âm thanh': 'sfx',
  'am thanh': 'sfx',
  'ambient': 'ambient',
  'startpose': 'startpose',
  'start pose': 'startpose',
  'endpose': 'endpose',
  'end pose': 'endpose',
};

function normalizeLabelKey(label: string): string {
  return label.toLowerCase().replace(/\s*\/\s*/g, '/').trim();
}

/** Regex nhận diện dòng tiêu đề shot/cảnh độc lập (khối có cấu trúc) */
const STRUCTURED_HEADER_REGEX = /^[\s\-=#\[\]*]*(?:scene|cảnh|shot|prompt)\s*#?\s*\d+[\s\-=\]:*]*$/i;

/** Regex nhận diện dòng tiêu đề cảnh thông thường (cho phép ký tự trang trí ở đầu/cuối) */
const SCENE_HEADER_REGEX = /^[\s\-=#\[*]*(INT\.|EXT\.|SCENE\s+\d+|CẢNH\s+\d+|Cảnh\s+\d+:?)/i;

/** Tự nhận diện và parse file kịch bản theo định dạng */
export async function parseImportedScriptFile(
  fileContent: string,
  filename: string,
  characters: Character[] = []
): Promise<ScriptImportResult> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const trimmed = fileContent.trim();

  // 1. KIỂM TRA .JSON
  if (ext === 'json' || (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);

      // Nếu là file phiên của tool (version + shots)
      if (parsed && typeof parsed === 'object' && ('version' in parsed || 'credit' in parsed) && Array.isArray(parsed.shots)) {
        return {
          scenes: [],
          shots: [],
          totalScenes: 0,
          totalShots: 0,
          totalDialogues: 0,
          isSessionFile: true,
        };
      }

      // Nếu là mảng hoặc object có scenes/shots
      if (parsed && typeof parsed === 'object') {
        const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : (Array.isArray(parsed) ? [{ title: 'Scene 1', environment: '', shots: parsed }] : null);
        if (rawScenes) {
          const scenes: Scene[] = [];
          const shots: Shot[] = [];
          let globalOrder = 1;
          let dialogues = 0;

          rawScenes.forEach((sc: any, scIdx: number) => {
            const sceneId = `scene_${Date.now()}_${scIdx + 1}`;
            const sceneObj: Scene = {
              id: sceneId,
              title: sc.title || `Scene 0${scIdx + 1}`,
              environment: sc.environment || '',
              timeOfDay: sc.timeOfDay || 'Daylight',
              ambientDefault: sc.ambientDefault || '',
              lightingDefault: sc.lightingDefault || 'day_flat',
              weather: sc.weather || 'clear',
            };
            scenes.push(sceneObj);

            if (Array.isArray(sc.shots)) {
              sc.shots.forEach((sh: any, sIdx: number) => {
                const isFirstOverall = globalOrder === 1;
                const isFirstInScene = sIdx === 0;
                const transitionIn = isFirstOverall || isFirstInScene ? ('cut' as const) : ('chain' as const);

                // Map character name nếu có
                const charIds: string[] = [];
                if (Array.isArray(sh.characterNames)) {
                  sh.characterNames.forEach((cn: string) => {
                    const matched = characters.find((c) => normalizeName(c.name) === normalizeName(cn));
                    if (matched && !charIds.includes(matched.id)) charIds.push(matched.id);
                  });
                }

                if (sh.dialogue || sh.audioDialogue) dialogues++;

                shots.push({
                  id: `shot_${Date.now()}_${globalOrder}`,
                  sceneId: sceneObj.id,
                  order: globalOrder,
                  actionBeat: sh.actionVi || sh.actionBeat || sh.action || `Shot #${globalOrder}`,
                  action: sh.action || sh.actionBeat || '',
                  subject: sh.subject || '',
                  characterIds: charIds.length > 0 ? charIds : (characters[0] ? [characters[0].id] : []),
                  shotSize: sh.shotSize || 'medium',
                  cameraAngle: sh.cameraAngle || 'eye_level',
                  cameraMovement: sh.cameraMovement || 'pan_slow',
                  lens: sh.lens || 'normal',
                  lighting: sh.lighting || 'day_flat',
                  weather: sh.weather || 'clear',
                  effects: Array.isArray(sh.effects) ? sh.effects.slice(0, 3) : [],
                  transitionIn: sh.transitionIn || transitionIn,
                  audioDialogue: sh.dialogue || sh.audioDialogue || '',
                  audioSfx: sh.sfx || sh.audioSfx || '',
                  ambient: sh.ambient || '',
                  startPose: sh.startPose || '',
                  endPose: sh.endPose || '',
                });
                globalOrder++;
              });
            }
          });

          return {
            scenes,
            shots,
            totalScenes: scenes.length,
            totalShots: shots.length,
            totalDialogues: dialogues,
          };
        }
      }
    } catch {
      // Tiếp tục fallback parser văn bản nếu parse json lỗi
    }
  }

  // 2. PARSE CSV (.csv)
  if (ext === 'csv') {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length > 1) {
      // Đọc header
      const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/['"]/g, ''));
      const sceneCol = header.findIndex((h) => h.includes('scene'));
      const actionCol = header.findIndex((h) => h.includes('action') || h.includes('beat') || h.includes('content'));
      const dialogueCol = header.findIndex((h) => h.includes('dialogue') || h.includes('voice') || h.includes('thoại'));
      const shotSizeCol = header.findIndex((h) => h.includes('shot_size') || h.includes('shotsize') || h.includes('size'));
      const cameraCol = header.findIndex((h) => h.includes('camera') || h.includes('move') || h.includes('movement'));
      const noteCol = header.findIndex((h) => h.includes('note') || h.includes('subject'));

      const sceneGroups = new Map<string, Array<{ action: string; dialogue: string; shotSize: string; camera: string; note: string }>>();

      for (let i = 1; i < lines.length; i++) {
        // Tách CSV cơ bản (hỗ trợ dấu ngoặc kép)
        const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
        const cleanRow = row.map((cell) => cell.replace(/^"|"$/g, '').trim());

        const sceneName = sceneCol >= 0 && cleanRow[sceneCol] ? cleanRow[sceneCol] : 'Scene 1';
        const action = actionCol >= 0 && cleanRow[actionCol] ? cleanRow[actionCol] : `Shot ${i}`;
        const dialogue = dialogueCol >= 0 && cleanRow[dialogueCol] ? cleanRow[dialogueCol] : '';
        const shotSize = shotSizeCol >= 0 && cleanRow[shotSizeCol] ? cleanRow[shotSizeCol] : 'medium';
        const camera = cameraCol >= 0 && cleanRow[cameraCol] ? cleanRow[cameraCol] : 'pan_slow';
        const note = noteCol >= 0 && cleanRow[noteCol] ? cleanRow[noteCol] : '';

        if (!sceneGroups.has(sceneName)) {
          sceneGroups.set(sceneName, []);
        }
        sceneGroups.get(sceneName)!.push({ action, dialogue, shotSize, camera, note });
      }

      const scenes: Scene[] = [];
      const shots: Shot[] = [];
      let globalOrder = 1;
      let dialogues = 0;

      sceneGroups.forEach((items, sTitle) => {
        const sceneId = `scene_${Date.now()}_${scenes.length + 1}`;
        const scene: Scene = {
          id: sceneId,
          title: sTitle.startsWith('Scene') || sTitle.startsWith('Cảnh') ? sTitle : `Scene: ${sTitle}`,
          environment: sTitle,
          timeOfDay: 'Daylight',
          ambientDefault: '',
          lightingDefault: 'day_flat',
          weather: 'clear',
        };
        scenes.push(scene);

        items.forEach((it, idx) => {
          const isFirstOverall = globalOrder === 1;
          const isFirstInScene = idx === 0;
          const transitionIn = isFirstOverall || isFirstInScene ? ('cut' as const) : ('chain' as const);

          if (it.dialogue) dialogues++;

          // Gắn nhân vật nếu có trùng tên trong Vault
          let assignedCharIds: string[] = [];
          for (const char of characters) {
            if (it.action.toLowerCase().includes(char.name.toLowerCase()) || it.dialogue.toLowerCase().includes(char.name.toLowerCase())) {
              assignedCharIds.push(char.id);
            }
          }
          if (assignedCharIds.length === 0 && characters[0]) {
            assignedCharIds = [characters[0].id];
          }

          shots.push({
            id: `shot_${Date.now()}_${globalOrder}`,
            sceneId: scene.id,
            order: globalOrder,
            actionBeat: it.action,
            action: it.action,
            subject: it.note || '',
            characterIds: assignedCharIds,
            shotSize: it.shotSize,
            cameraAngle: 'eye_level',
            cameraMovement: it.camera,
            lens: 'normal',
            lighting: 'day_flat',
            weather: 'clear',
            effects: [],
            transitionIn,
            audioDialogue: it.dialogue,
            audioSfx: '',
            ambient: '',
            startPose: '',
            endPose: '',
          });
          globalOrder++;
        });
      });

      return {
        scenes,
        shots,
        totalScenes: scenes.length,
        totalShots: shots.length,
        totalDialogues: dialogues,
      };
    }
  }

  // 3. PARSE PHỤ ĐỀ SRT (.srt)
  if (ext === 'srt' || /^\d+\r?\n\d\d:\d\d:\d\d/m.test(trimmed)) {
    const blocks = trimmed.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);
    const scenes: Scene[] = [
      {
        id: `scene_${Date.now()}_1`,
        title: 'Scene 1: Subtitle Sequence',
        environment: '',
        timeOfDay: 'Daylight',
        ambientDefault: '',
        lightingDefault: 'day_flat',
        weather: 'clear',
      },
    ];
    const shots: Shot[] = [];
    let globalOrder = 1;
    let dialogues = 0;

    blocks.forEach((blk, idx) => {
      const bLines = blk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Dòng 1: index, Dòng 2: timecode, Dòng 3+: nội dung thoại
      if (bLines.length >= 2) {
        const textLines = bLines.slice(2).join(' ');
        if (textLines) {
          dialogues++;
          const isFirst = globalOrder === 1;
          shots.push({
            id: `shot_${Date.now()}_${globalOrder}`,
            sceneId: scenes[0].id,
            order: globalOrder,
            actionBeat: `speaks: ${textLines.slice(0, 50)}...`,
            action: `speaks: ${textLines}`,
            subject: '',
            characterIds: characters[0] ? [characters[0].id] : [],
            shotSize: idx % 3 === 0 ? 'medium' : idx % 3 === 1 ? 'close_up' : 'medium_close',
            cameraAngle: 'eye_level',
            cameraMovement: 'pan_slow',
            lens: 'normal',
            lighting: 'day_flat',
            weather: 'clear',
            effects: [],
            transitionIn: isFirst ? 'cut' : 'chain',
            audioDialogue: textLines,
            audioSfx: '',
            ambient: '',
            startPose: '',
            endPose: '',
          });
          globalOrder++;
        }
      }
    });

    return {
      scenes,
      shots,
      totalScenes: scenes.length,
      totalShots: shots.length,
      totalDialogues: dialogues,
    };
  }

  // 4. PARSE VĂN BẢN (.txt, .md, .fountain hoặc raw text)
  const rawLines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  // ================= 4.1. THỬ CÁCH KHỐI CÓ CẤU TRÚC TRƯỚC =================
  // Tìm các dòng tiêu đề đứng riêng (khớp STRUCTURED_HEADER_REGEX)
  const headerIndices: number[] = [];
  rawLines.forEach((line, idx) => {
    if (STRUCTURED_HEADER_REGEX.test(line)) {
      headerIndices.push(idx);
    }
  });

  if (headerIndices.length >= 1) {
    // Tách các khối giữa hai tiêu đề
    interface StructuredBlock {
      header: string;
      lines: string[];
      labeledFields: Map<string, string>;
    }

    const blocks: StructuredBlock[] = [];
    for (let h = 0; h < headerIndices.length; h++) {
      const startIdx = headerIndices[h];
      const endIdx = h < headerIndices.length - 1 ? headerIndices[h + 1] : rawLines.length;
      const bHeader = rawLines[startIdx];
      const bLines = rawLines.slice(startIdx + 1, endIdx);

      const labeledFields = new Map<string, string>();
      for (const bLine of bLines) {
        const colonIdx = bLine.indexOf(':');
        if (colonIdx > 0) {
          const rawKey = bLine.slice(0, colonIdx);
          const rawVal = bLine.slice(colonIdx + 1).trim();
          const normKey = normalizeLabelKey(rawKey);
          if (KNOWN_LABELS[normKey]) {
            labeledFields.set(KNOWN_LABELS[normKey], rawVal);
          }
        }
      }

      blocks.push({
        header: bHeader,
        lines: bLines,
        labeledFields,
      });
    }

    // Kiểm tra: ít nhất một nửa số khối có ≥ 2 dòng nhãn đã biết
    const blocksWithAtLeastTwoLabels = blocks.filter((b) => b.labeledFields.size >= 2).length;
    if (blocksWithAtLeastTwoLabels >= Math.ceil(blocks.length / 2)) {
      // Đúng là định dạng khối có cấu trúc!
      // Mỗi khối giữa hai tiêu đề = 1 shot.
      // Các khối liên tiếp cùng Setting gộp thành 1 Scene.
      interface ParsedStructuredShot {
        rawSetting: string;
        action: string;
        actionBeat: string;
        subject: string;
        audioDialogue: string;
        narration: string;
        audioSfx: string;
        ambient: string;
        startPose: string;
        endPose: string;
      }

      const structuredShots: ParsedStructuredShot[] = [];
      let totalDialoguesCount = 0;

      for (const block of blocks) {
        const fields = block.labeledFields;
        const rawSetting = fields.get('setting') || '';
        const rawAction = fields.get('action') || fields.get('storydna') || '';
        const rawStoryDna = fields.get('storydna') || fields.get('action') || '';
        const rawSubject = fields.get('subject') || '';
        const rawDialogue = fields.get('dialogue') || '';
        const rawNarration = fields.get('narration') || '';
        const rawSfx = fields.get('sfx') || '';
        const rawAmbient = fields.get('ambient') || fields.get('atmosphere') || '';
        const rawStartPose = fields.get('startpose') || '';
        const rawEndPose = fields.get('endpose') || '';

        if (rawDialogue) totalDialoguesCount++;

        structuredShots.push({
          rawSetting: rawSetting.trim(),
          action: rawAction.trim(),
          actionBeat: (rawStoryDna || rawAction || block.header).trim().slice(0, 160),
          subject: rawSubject.trim(),
          audioDialogue: rawDialogue.trim(),
          narration: rawNarration.trim(),
          audioSfx: rawSfx.trim(),
          ambient: rawAmbient.trim(),
          startPose: rawStartPose.trim(),
          endPose: rawEndPose.trim(),
        });
      }

      // Gộp các khối liên tiếp cùng Setting thành 1 Scene
      const resultScenes: Scene[] = [];
      const resultShots: Shot[] = [];
      let currentSettingKey = '';
      let activeSceneObj: Scene | null = null;
      let globalOrder = 1;

      for (let sIdx = 0; sIdx < structuredShots.length; sIdx++) {
        const sData = structuredShots[sIdx];
        const effectiveSetting = sData.rawSetting || 'Scene ' + (resultScenes.length + 1);
        const normSetting = effectiveSetting.toLowerCase();

        if (!activeSceneObj || normSetting !== currentSettingKey) {
          currentSettingKey = normSetting;
          const sceneIndex = resultScenes.length + 1;
          const sceneId = `scene_${Date.now()}_${sceneIndex}`;
          const cleanTitle = sData.rawSetting
            ? (sData.rawSetting.slice(0, 40))
            : `Scene 0${sceneIndex}`;

          activeSceneObj = {
            id: sceneId,
            title: cleanTitle,
            environment: sData.rawSetting.slice(0, 400),
            timeOfDay: 'Daylight',
            ambientDefault: sData.ambient,
            lightingDefault: 'day_flat',
            weather: 'clear',
          };
          resultScenes.push(activeSceneObj);
        }

        const isFirstInScene = resultShots.filter((sh) => sh.sceneId === activeSceneObj!.id).length === 0;
        const transitionIn = isFirstInScene ? ('cut' as const) : ('chain' as const);

        // Gắn nhân vật từ Vault nếu có
        const assignedCharIds: string[] = [];
        for (const char of characters) {
          const charNorm = normalizeName(char.name);
          if (
            (sData.subject && normalizeName(sData.subject).includes(charNorm)) ||
            (sData.action && normalizeName(sData.action).includes(charNorm)) ||
            (sData.actionBeat && normalizeName(sData.actionBeat).includes(charNorm)) ||
            (sData.audioDialogue && normalizeName(sData.audioDialogue).includes(charNorm))
          ) {
            assignedCharIds.push(char.id);
          }
        }
        if (assignedCharIds.length === 0 && characters[0]) {
          assignedCharIds.push(characters[0].id);
        }

        resultShots.push({
          id: `shot_${Date.now()}_${globalOrder}`,
          sceneId: activeSceneObj.id,
          order: globalOrder,
          actionBeat: sData.actionBeat,
          action: sData.action || sData.actionBeat,
          subject: sData.subject,
          characterIds: assignedCharIds,
          shotSize: isFirstInScene ? 'wide' : 'medium',
          cameraAngle: 'eye_level',
          cameraMovement: isFirstInScene ? 'pan_slow' : 'push_in',
          lens: 'normal',
          lighting: 'day_flat',
          weather: 'clear',
          effects: [],
          transitionIn,
          audioDialogue: sData.audioDialogue,
          narration: sData.narration,
          audioSfx: sData.audioSfx,
          ambient: sData.ambient,
          startPose: sData.startPose,
          endPose: sData.endPose,
        });

        globalOrder++;
      }

      return {
        scenes: resultScenes,
        shots: resultShots,
        totalScenes: resultScenes.length,
        totalShots: resultShots.length,
        totalDialogues: totalDialoguesCount,
      };
    }
  }

  // ================= 4.2. CÁCH TÁCH THEO DÒNG (KHI KHÔNG PHẢI KHỐI CÓ CẤU TRÚC) =================
  const scenes: Scene[] = [];
  const shots: Shot[] = [];
  let currentScene: Scene | null = null;
  let globalOrder = 1;
  let dialogues = 0;
  let hadAnyExplicitSceneHeader = false;
  interface PendingLabelItem {
    rawKey: string;
    mappedType: string;
    content: string;
  }
  let pendingLabelItems: PendingLabelItem[] = [];

  // Danh sách các tên nhãn đã biết để kiểm tra không bị coi là lời thoại
  const KNOWN_LABEL_KEYS_SET = new Set(Object.keys(KNOWN_LABELS));

  // Helper kiểm tra một dòng có phải là nhãn đã biết hay không
  function parseKnownLabelLine(line: string): { isKnownLabel: boolean; labelKey: string; mappedType: string; rawKey: string; content: string } {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) return { isKnownLabel: false, labelKey: '', mappedType: '', rawKey: '', content: '' };
    const rawKey = line.slice(0, colonIdx).trim();
    const content = line.slice(colonIdx + 1).trim();
    if (!rawKey) return { isKnownLabel: false, labelKey: '', mappedType: '', rawKey: '', content: '' };

    const normKey = normalizeLabelKey(rawKey);
    if (KNOWN_LABEL_KEYS_SET.has(normKey) || KNOWN_LABELS[normKey]) {
      const mappedType = KNOWN_LABELS[normKey] || normKey;
      return { isKnownLabel: true, labelKey: normKey, mappedType, rawKey, content };
    }
    return { isKnownLabel: false, labelKey: '', mappedType: '', rawKey: '', content: '' };
  }

  // Helper kiểm tra một dòng có phải là lời thoại hay không
  function parseDialogueLine(line: string): { isDialogue: boolean; speaker: string; content: string } {
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) return { isDialogue: false, speaker: '', content: '' };

    const rawName = line.slice(0, colonIdx).trim();
    const rawContent = line.slice(colonIdx + 1).trim();

    if (!rawName || !rawContent) return { isDialogue: false, speaker: '', content: '' };

    // 1. Tên chứa chữ số -> KHÔNG phải lời thoại (ví dụ: "Năm 1876", "Scene 1")
    if (/\d/.test(rawName)) {
      return { isDialogue: false, speaker: '', content: '' };
    }

    // 2. Tên thuộc danh sách nhãn đã biết -> KHÔNG phải lời thoại (ví dụ: "Camera", "Subject", "Setting", v.v.)
    const normKey = normalizeLabelKey(rawName);
    if (KNOWN_LABEL_KEYS_SET.has(normKey) || KNOWN_LABELS[normKey]) {
      return { isDialogue: false, speaker: '', content: '' };
    }

    // 3. Kiểm tra điều kiện lời thoại:
    // a. Tên khớp nhân vật trong Vault (normalizeName)
    const normSpeaker = normalizeName(rawName);
    const matchedVaultChar = characters.find((c) => normalizeName(c.name) === normSpeaker);
    if (matchedVaultChar) {
      return { isDialogue: true, speaker: rawName, content: rawContent };
    }

    // b. Tên viết HOA toàn bộ (kiểu kịch bản, độ dài >= 2 chữ cái không dấu/có dấu)
    const lettersOnly = rawName.replace(/[^A-ZÀ-Ỹa-z]/g, '');
    if (lettersOnly.length >= 2 && rawName === rawName.toUpperCase() && /[A-ZÀ-Ỹ]/.test(rawName)) {
      return { isDialogue: true, speaker: rawName, content: rawContent };
    }

    // c. Nội dung bắt đầu bằng dấu ngoặc kép: "..." hoặc “...”
    if (/^["“'«]/.test(rawContent)) {
      return { isDialogue: true, speaker: rawName, content: rawContent.replace(/^["“'«]|["”'»]$/g, '').trim() };
    }

    return { isDialogue: false, speaker: '', content: '' };
  }

  // Helper tìm characterIds cho shot mới tạo, nếu có matchedVaultChar thì đưa lên đầu
  function getCharacterIdsForSpeaker(speaker: string): string[] {
    const assignedCharIds: string[] = [];
    const normSpeaker = normalizeName(speaker);
    const matchedVaultChar = characters.find((c) => normalizeName(c.name) === normSpeaker);
    if (matchedVaultChar) {
      assignedCharIds.push(matchedVaultChar.id);
    }
    // Gắn thêm các nhân vật khác nếu trùng tên trong speaker
    for (const char of characters) {
      if (speaker.toLowerCase().includes(char.name.toLowerCase()) && !assignedCharIds.includes(char.id)) {
        assignedCharIds.push(char.id);
      }
    }
    if (assignedCharIds.length === 0 && characters[0]) {
      assignedCharIds.push(characters[0].id);
    }
    return assignedCharIds;
  }

  // Helper áp pendingLabelItems vào action của shot
  function consumePendingSuffixes(): string {
    if (pendingLabelItems.length === 0) return '';
    const res = ' ' + pendingLabelItems.map((item) => `(${item.rawKey}: ${item.content})`).join(' ');
    pendingLabelItems = [];
    return res;
  }

  // Helper flushPendingAsShot: nếu còn nhãn chờ và currentScene CHƯA có shot nào thì tạo 1 shot beat
  function flushPendingAsShot() {
    if (!currentScene || pendingLabelItems.length === 0) return;
    const sceneShotsCount = shots.filter((s) => s.sceneId === currentScene!.id).length;
    if (sceneShotsCount > 0) return;

    // actionBeat = nội dung nhãn có mappedType 'action' hoặc 'storydna' (không có thì nội dung nhãn đầu tiên)
    const actionItem = pendingLabelItems.find((it) => it.mappedType === 'action' || it.mappedType === 'storydna') || pendingLabelItems[0];
    const actionBeat = actionItem.content;

    // action = actionBeat + các nhãn còn lại dạng ` (${rawKey}: ${content})`
    const otherItems = pendingLabelItems.filter((it) => it !== actionItem);
    const suffix = otherItems.length > 0
      ? ' ' + otherItems.map((it) => `(${it.rawKey}: ${it.content})`).join(' ')
      : '';
    const action = `${actionBeat}${suffix}`;

    const isFirstOverall = globalOrder === 1;
    const transitionIn: 'cut' | 'chain' = isFirstOverall ? 'cut' : 'cut';

    // characterIds mặc định
    const defaultCharIds = characters[0] ? [characters[0].id] : [];

    shots.push({
      id: `shot_${Date.now()}_${globalOrder}`,
      sceneId: currentScene.id,
      order: globalOrder,
      actionBeat,
      action,
      subject: '',
      characterIds: [...defaultCharIds],
      shotSize: 'wide',
      cameraAngle: 'eye_level',
      cameraMovement: 'crane_reveal',
      lens: 'normal',
      lighting: 'day_flat',
      weather: 'clear',
      effects: [],
      transitionIn,
      audioDialogue: '',
      audioSfx: '',
      ambient: '',
      startPose: '',
      endPose: '',
    });
    globalOrder++;
    pendingLabelItems = [];
  }

  // Helper xử lý tạo hoặc gắn thoại
  function handleDialogueItem(speaker: string, content: string) {
    const lastShot = shots.length > 0 ? shots[shots.length - 1] : null;
    if (lastShot && lastShot.sceneId === currentScene!.id && !lastShot.audioDialogue) {
      lastShot.audioDialogue = content;
      if (speaker) {
        const normSpeaker = normalizeName(speaker);
        const matchedChar = characters.find((c) => normalizeName(c.name) === normSpeaker);
        if (matchedChar && !lastShot.characterIds.includes(matchedChar.id)) {
          lastShot.characterIds = [matchedChar.id, ...lastShot.characterIds];
        }
      }
    } else {
      // Tạo shot MỚI trong currentScene
      const isFirstOverall = globalOrder === 1;
      const isFirstInScene = shots.filter((s) => s.sceneId === currentScene!.id).length === 0;
      const transitionIn = isFirstOverall || isFirstInScene ? ('cut' as const) : ('chain' as const);

      const assignedCharIds = getCharacterIdsForSpeaker(speaker);
      const actionText = speaker ? `${speaker} nói` : 'Nhân vật nói';
      const suffix = consumePendingSuffixes();

      shots.push({
        id: `shot_${Date.now()}_${globalOrder}`,
        sceneId: currentScene!.id,
        order: globalOrder,
        actionBeat: actionText,
        action: `${actionText}${suffix}`,
        subject: '',
        characterIds: assignedCharIds,
        shotSize: isFirstInScene ? 'wide' : 'medium',
        cameraAngle: 'eye_level',
        cameraMovement: isFirstInScene ? 'crane_reveal' : 'pan_slow',
        lens: 'normal',
        lighting: 'day_flat',
        weather: 'clear',
        effects: [],
        transitionIn,
        audioDialogue: content,
        audioSfx: '',
        ambient: '',
        startPose: '',
        endPose: '',
      });
      globalOrder++;
    }
    dialogues++;
  }

  for (const line of rawLines) {
    // A. Dòng tiêu đề cảnh: SCENE_HEADER_REGEX cho phép ký tự trang trí ở đầu/cuối
    if (SCENE_HEADER_REGEX.test(line)) {
      hadAnyExplicitSceneHeader = true;
      flushPendingAsShot(); // Gọi flushPendingAsShot ngay TRƯỚC khi xoá danh sách chờ lúc gặp tiêu đề cảnh mới
      pendingLabelItems = []; // Gặp tiêu đề cảnh mới thì xoá danh sách chờ
      // Bỏ dấu trang trí khi lấy title (ví dụ "--- SCENE 001 ---", "## Scene 2", "CẢNH 3:")
      const cleanTitle = line.replace(/^[\s\-=#\[*]+/, '').replace(/[\s\-=\]:*]+$/, '').trim();
      let environmentDesc = '';
      if (cleanTitle.includes('-')) {
        environmentDesc = cleanTitle.split('-').slice(1).join('-').trim();
      } else if (cleanTitle.includes(':')) {
        environmentDesc = cleanTitle.split(':').slice(1).join(':').trim();
      }

      currentScene = {
        id: `scene_${Date.now()}_${scenes.length + 1}`,
        title: cleanTitle,
        environment: environmentDesc,
        timeOfDay: 'Daylight',
        ambientDefault: '',
        lightingDefault: 'day_flat',
        weather: 'clear',
      };
      scenes.push(currentScene);
      continue;
    }

    // Đảm bảo luôn có ít nhất 1 scene
    if (!currentScene) {
      currentScene = {
        id: `scene_${Date.now()}_1`,
        title: 'Scene 01',
        environment: '',
        timeOfDay: 'Daylight',
        ambientDefault: '',
        lightingDefault: 'day_flat',
        weather: 'clear',
      };
      scenes.push(currentScene);
    }

    // B. Kiểm tra dòng nhãn đã biết (Camera, Setting, Dialogue, ...)
    const labelCheck = parseKnownLabelLine(line);
    if (labelCheck.isKnownLabel) {
      if (labelCheck.mappedType === 'dialogue') {
        handleDialogueItem('', labelCheck.content);
        continue;
      }

      const lastShot = shots.length > 0 ? shots[shots.length - 1] : null;
      if (lastShot && lastShot.sceneId === currentScene.id) {
        lastShot.action = `${lastShot.action || lastShot.actionBeat} (${labelCheck.rawKey}: ${labelCheck.content})`;
      } else {
        if (labelCheck.mappedType === 'setting' && !currentScene.environment) {
          currentScene.environment = labelCheck.content;
        } else {
          pendingLabelItems.push({
            rawKey: labelCheck.rawKey,
            mappedType: labelCheck.mappedType,
            content: labelCheck.content,
          });
        }
      }
      continue;
    }

    // C. Kiểm tra dòng thoại
    const diaCheck = parseDialogueLine(line);
    if (diaCheck.isDialogue) {
      handleDialogueItem(diaCheck.speaker, diaCheck.content);
      continue;
    }

    // D. Dòng không phải thoại: xử lý như beat bình thường
    // Đoạn văn dài (> 300 ký tự): cắt theo ranh giới câu, mỗi 1-2 câu = 1 shot
    let beatChunks: string[] = [];
    if (line.length > 300) {
      const sentences = splitIntoSentences(line);
      for (let s = 0; s < sentences.length; s += 2) {
        beatChunks.push(sentences.slice(s, s + 2).join(' '));
      }
    } else {
      beatChunks = [line];
    }

    for (let bIdx = 0; bIdx < beatChunks.length; bIdx++) {
      const beat = beatChunks[bIdx];
      const isFirstOverall = globalOrder === 1;
      const isFirstInScene = shots.filter((s) => s.sceneId === currentScene!.id).length === 0;
      const transitionIn = isFirstOverall || isFirstInScene ? ('cut' as const) : ('chain' as const);

      // Tìm kiếm tên nhân vật trong beat
      const assignedCharIds: string[] = [];
      for (const char of characters) {
        if (beat.toLowerCase().includes(char.name.toLowerCase())) {
          assignedCharIds.push(char.id);
        }
      }
      if (assignedCharIds.length === 0 && characters[0]) {
        assignedCharIds.push(characters[0].id);
      }

      const suffix = consumePendingSuffixes();

      shots.push({
        id: `shot_${Date.now()}_${globalOrder}`,
        sceneId: currentScene.id,
        order: globalOrder,
        actionBeat: beat,
        action: `${beat}${suffix}`,
        subject: '',
        characterIds: assignedCharIds,
        shotSize: isFirstInScene ? 'wide' : 'medium',
        cameraAngle: 'eye_level',
        cameraMovement: isFirstInScene ? 'crane_reveal' : 'pan_slow',
        lens: 'normal',
        lighting: 'day_flat',
        weather: 'clear',
        effects: [],
        transitionIn,
        audioDialogue: '',
        audioSfx: '',
        ambient: '',
        startPose: '',
        endPose: '',
      });
      globalOrder++;
    }
  }

  // Gọi flushPendingAsShot một lần sau khi hết vòng lặp các dòng (trước bước gom 4 shot/scene)
  flushPendingAsShot();

  // Chỉ gom 4 shot/scene khi KHÔNG có dòng tiêu đề nào (scene duy nhất là scene tự tạo "Scene 01");
  // nếu có tiêu đề thì giữ nguyên scene và environment.
  if (!hadAnyExplicitSceneHeader && scenes.length === 1 && shots.length > 5) {
    const chunkedScenes: Scene[] = [];
    const SHOTS_PER_SCENE = 4;
    for (let i = 0; i < shots.length; i += SHOTS_PER_SCENE) {
      const sIdx = chunkedScenes.length + 1;
      const sceneId = `scene_${Date.now()}_${sIdx}`;
      const firstShotBeat = shots[i].actionBeat;
      const sc: Scene = {
        id: sceneId,
        title: `Scene 0${sIdx}: ${firstShotBeat.slice(0, 24)}...`,
        environment: '',
        timeOfDay: 'Daylight',
        ambientDefault: '',
        lightingDefault: 'day_flat',
        weather: 'clear',
      };
      chunkedScenes.push(sc);
      for (let j = i; j < Math.min(i + SHOTS_PER_SCENE, shots.length); j++) {
        shots[j].sceneId = sceneId;
        if (j === i) {
          shots[j].transitionIn = 'cut';
        }
      }
    }
    return {
      scenes: chunkedScenes,
      shots,
      totalScenes: chunkedScenes.length,
      totalShots: shots.length,
      totalDialogues: dialogues,
    };
  }

  return {
    scenes,
    shots,
    totalScenes: scenes.length,
    totalShots: shots.length,
    totalDialogues: dialogues,
  };
}
