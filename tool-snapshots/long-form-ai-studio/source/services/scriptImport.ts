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

  const scenes: Scene[] = [];
  const shots: Shot[] = [];
  let currentScene: Scene | null = null;
  let globalOrder = 1;
  let dialogues = 0;

  // Regex nhận diện tiêu đề cảnh
  const SCENE_HEADER_REGEX = /^(INT\.|EXT\.|SCENE\s+\d+|CẢNH\s+\d+|Cảnh\s+\d+:|#+\s+)/i;

  // Regex nhận diện dòng thoại: "TÊN: lời thoại" hoặc "TÊN — lời thoại"
  const DIALOGUE_REGEX = /^([A-ZÀ-Ỹa-z0-9_\s]{2,20})\s*[:—–-]\s*(.+)$/;

  for (const line of rawLines) {
    // A. Dòng tiêu đề cảnh
    if (SCENE_HEADER_REGEX.test(line)) {
      const cleanTitle = line.replace(/^#+\s*/, '').trim();
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

    // B. Dòng thoại: gán vào audioDialogue của shot gần nhất (nếu có)
    const diaMatch = line.match(DIALOGUE_REGEX);
    if (diaMatch && shots.length > 0) {
      const speakerName = diaMatch[1].trim();
      const dialogueText = diaMatch[2].trim();
      const lastShot = shots[shots.length - 1];

      lastShot.audioDialogue = dialogueText;
      dialogues++;

      // Gắn nhân vật trùng tên trong Vault nếu có
      const matchedChar = characters.find((c) => normalizeName(c.name) === normalizeName(speakerName));
      if (matchedChar) {
        if (!lastShot.characterIds.includes(matchedChar.id)) {
          lastShot.characterIds = [matchedChar.id, ...lastShot.characterIds];
        }
      }
      continue;
    }

    // C. Đoạn văn dài (> 300 ký tự): cắt theo ranh giới câu, mỗi 1-2 câu = 1 shot
    let beatChunks: string[] = [];
    if (line.length > 300) {
      const sentences = splitIntoSentences(line);
      for (let s = 0; s < sentences.length; s += 2) {
        beatChunks.push(sentences.slice(s, s + 2).join(' '));
      }
    } else {
      beatChunks = [line];
    }

    for (const beat of beatChunks) {
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

      shots.push({
        id: `shot_${Date.now()}_${globalOrder}`,
        sceneId: currentScene.id,
        order: globalOrder,
        actionBeat: beat,
        action: beat,
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

  // Tự động gom nếu chỉ có 1 scene nhưng > 4 shot
  if (scenes.length === 1 && shots.length > 5) {
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
