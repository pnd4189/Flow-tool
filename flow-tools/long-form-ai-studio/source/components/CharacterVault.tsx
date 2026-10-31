import React, { useState } from 'react';
import { Flow } from 'flow-sdk';
import { Character, CharacterDNA, ProjectConfig } from '../services/types';
import { makeThumbnail } from '../services/imageUtils';
import { compileCharacterSheetPrompt, suggestCharacterDNAWithAI } from '../services/shotengine';
import { getLook } from '../services/library';

interface CharacterVaultProps {
  characters: Character[];
  onAddCharacter: (char: Character) => void;
  onUpdateCharacter: (char: Character) => void;
  onDeleteCharacter: (id: string) => void;
  config: ProjectConfig;
}

export const defaultDNA: CharacterDNA = {
  faceShape: 'Oval face with sharp anime chin and delicate jawline',
  eyes: 'Large expressive dark amber anime eyes with high-contrast highlights',
  hairstyle: 'Shoulder-length textured jet-black bob with wispy bangs',
  skinTone: 'Warm light-medium peach anime skin tone',
  outfit: 'Navy blue sailor-collared blazer over white shirt with pleated skirt',
  accessories: 'Red ribbon necktie and minimal silver hair clip',
  proportions: '6 heads tall, slender 2D anime proportions',
  palette: '#1E3A8A navy, #DC2626 crimson, #F59E0B amber, #FFFFFF clean white',
};

/** Tạo nhân vật nhanh từ đề xuất AI mà không mở form/alert */
export function createCharacterFromProposal(proposal: {
  name: string;
  dna: Partial<CharacterDNA>;
}): Character {
  return {
    id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: proposal.name || 'Proposed Character',
    dna: {
      faceShape: proposal.dna.faceShape || defaultDNA.faceShape,
      eyes: proposal.dna.eyes || defaultDNA.eyes,
      hairstyle: proposal.dna.hairstyle || defaultDNA.hairstyle,
      skinTone: proposal.dna.skinTone || defaultDNA.skinTone,
      outfit: proposal.dna.outfit || defaultDNA.outfit,
      accessories: proposal.dna.accessories || defaultDNA.accessories,
      proportions: proposal.dna.proportions || defaultDNA.proportions,
      palette: proposal.dna.palette || defaultDNA.palette,
    },
    locked: true,
    createdAt: Date.now(),
  };
}

export const CharacterVault: React.FC<CharacterVaultProps> = ({
  characters,
  onAddCharacter,
  onUpdateCharacter,
  onDeleteCharacter,
  config,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('Mira');
  const [dna, setDna] = useState<CharacterDNA>(defaultDNA);
  const [aiSuggestInput, setAiSuggestInput] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const resetForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setName('');
    setDna(defaultDNA);
    setAiSuggestInput('');
    setErrorMsg(null);
  };

  const handleOpenNew = () => {
    setEditingId(null);
    setName('Mira');
    setDna(defaultDNA);
    setAiSuggestInput('');
    setIsFormOpen(true);
    setErrorMsg(null);
  };

  const handleEdit = (char: Character) => {
    setEditingId(char.id);
    setName(char.name);
    const charDna = {
      faceShape: char.dna.faceShape || char.dna.facialStructure || '',
      eyes: char.dna.eyes || '',
      hairstyle: char.dna.hairstyle || '',
      skinTone: char.dna.skinTone || '',
      outfit: char.dna.outfit || '',
      accessories: char.dna.accessories || '',
      proportions: char.dna.proportions || '6 heads tall anime proportions',
      palette: char.dna.palette || '#1E3A8A navy, #F5B301 amber',
    };
    setDna(charDna);
    setIsFormOpen(true);
    setErrorMsg(null);
  };

  const handleAISuggestDNA = async () => {
    if (!aiSuggestInput.trim() && !name.trim()) {
      setErrorMsg('Vui lòng nhập 1 câu mô tả nhân vật để AI gợi ý DNA.');
      return;
    }
    setErrorMsg(null);
    setIsSuggesting(true);
    try {
      const look = getLook(config.lookId);
      const query = aiSuggestInput.trim() || `Character named ${name.trim()}`;
      const suggested = await suggestCharacterDNAWithAI(query, look);
      setDna(suggested);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Gợi ý DNA thất bại');
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleGenerateSheet = async () => {
    if (!name.trim()) {
      setErrorMsg('Vui lòng nhập tên nhân vật');
      return;
    }
    setErrorMsg(null);
    setGenerating(true);

    try {
      const look = getLook(config.lookId);
      const tempChar: Character = {
        id: editingId || 'temp',
        name: name.trim(),
        dna,
        locked: true,
        createdAt: Date.now(),
      };
      const prompt = compileCharacterSheetPrompt(tempChar, look);

      const result = await Flow.generate.image({
        prompt,
        modelDisplayName: config.imageModel,
        aspectRatio: '16:9',
      });

      const fullDataUrl = `data:${result.mimeType};base64,${result.base64}`;
      const thumbBase64 = await makeThumbnail(fullDataUrl, 420);

      const targetId = editingId || `char_${Date.now()}`;
      const updatedChar: Character = {
        id: targetId,
        name: name.trim(),
        dna,
        mediaId: result.mediaId,
        thumbBase64,
        mimeType: 'image/jpeg',
        locked: true,
        createdAt: Date.now(),
      };

      if (editingId) {
        onUpdateCharacter(updatedChar);
      } else {
        onAddCharacter(updatedChar);
      }

      resetForm();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Tạo reference sheet thất bại');
    } finally {
      setGenerating(false);
    }
  };

  const handleSelectFromGallery = async () => {
    if (!name.trim()) {
      setErrorMsg('Vui lòng nhập tên nhân vật trước');
      return;
    }
    setErrorMsg(null);
    setSelecting(true);

    try {
      const media = await Flow.media.select({ filter: 'image' });
      const fullDataUrl = `data:${media.mimeType};base64,${media.base64}`;
      const thumbBase64 = await makeThumbnail(fullDataUrl, 420);

      const targetId = editingId || `char_${Date.now()}`;
      const updatedChar: Character = {
        id: targetId,
        name: name.trim(),
        dna,
        mediaId: media.mediaId,
        thumbBase64,
        mimeType: 'image/jpeg',
        locked: true,
        createdAt: Date.now(),
      };

      if (editingId) {
        onUpdateCharacter(updatedChar);
      } else {
        onAddCharacter(updatedChar);
      }

      resetForm();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Chọn ảnh thất bại');
    } finally {
      setSelecting(false);
    }
  };

  const handleDeleteWithTwoStep = (charId: string) => {
    if (confirmDeleteId === charId) {
      onDeleteCharacter(charId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(charId);
      setTimeout(() => {
        setConfirmDeleteId((cur) => (cur === charId ? null : cur));
      }, 3000);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-amber-400 text-base">brush</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Character Vault (2D)
          </span>
          <span className="text-[10px] font-mono text-slate-500">({characters.length})</span>
        </div>
        {!isFormOpen && (
          <button
            type="button"
            onClick={handleOpenNew}
            className="flex items-center gap-1 text-[11px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-1 rounded transition"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            Tạo mới
          </button>
        )}
      </div>

      {/* Form Drawer */}
      {isFormOpen && (
        <div className="p-3 bg-[#181818] border border-amber-500/40 rounded-lg space-y-2.5 text-xs shadow-lg">
          <div className="flex items-center justify-between border-b border-[#595959]/30 pb-2">
            <span className="font-semibold text-white">
              {editingId ? 'Sửa DNA nhân vật 2D' : 'Tạo nhân vật 2D mới'}
            </span>
            <button
              type="button"
              onClick={resetForm}
              className="text-slate-400 hover:text-white"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">
              Tên nhân vật / Character Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Mira, Ren, Hina..."
              className="w-full bg-[#121212] border border-[#595959]/60 rounded px-2.5 py-1 text-white text-xs focus:border-amber-400 focus:outline-none"
            />
          </div>

          {/* Ô Gợi ý DNA bằng AI (0 credit) */}
          <div className="p-2 bg-[#0e0e0e] rounded border border-amber-500/30 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-amber-400 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">smart_toy</span>
                Gợi ý DNA bằng AI (0 credit)
              </span>
              <span className="text-slate-500 font-mono">Gemini</span>
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={aiSuggestInput}
                onChange={(e) => setAiSuggestInput(e.target.value)}
                placeholder="VD: Nữ sinh kiếm đạo lạnh lùng, tóc ngắn đen, mắt hổ phách..."
                className="flex-1 bg-[#181818] border border-[#595959]/40 rounded px-2 py-1 text-[11px] text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
              />
              <button
                type="button"
                disabled={isSuggesting}
                onClick={handleAISuggestDNA}
                className="px-2 py-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-[11px] rounded transition flex items-center gap-1"
              >
                <span className={`material-symbols-outlined text-[13px] ${isSuggesting ? 'animate-spin' : ''}`}>
                  {isSuggesting ? 'progress_activity' : 'auto_fix_high'}
                </span>
                Gợi ý
              </button>
            </div>
          </div>

          {/* 8 trường DNA hoạt hình 2D */}
          <div className="space-y-1.5">
            <span className="text-[10px] text-amber-400/90 uppercase font-mono block">
              8 Trường DNA Hoạt Hình 2D:
            </span>
            <div>
              <span className="text-[9px] text-slate-400">Khuôn mặt & đầu (faceShape)</span>
              <input
                type="text"
                value={dna.faceShape}
                onChange={(e) => setDna({ ...dna, faceShape: e.target.value })}
                className="w-full bg-[#121212] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
              />
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Mắt - hình dạng, màu (eyes)</span>
              <input
                type="text"
                value={dna.eyes}
                onChange={(e) => setDna({ ...dna, eyes: e.target.value })}
                className="w-full bg-[#121212] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
              />
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Tóc - kiểu, màu (hairstyle)</span>
              <input
                type="text"
                value={dna.hairstyle}
                onChange={(e) => setDna({ ...dna, hairstyle: e.target.value })}
                className="w-full bg-[#121212] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
              />
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Màu da (skinTone)</span>
              <input
                type="text"
                value={dna.skinTone}
                onChange={(e) => setDna({ ...dna, skinTone: e.target.value })}
                className="w-full bg-[#121212] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
              />
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Trang phục (outfit)</span>
              <input
                type="text"
                value={dna.outfit}
                onChange={(e) => setDna({ ...dna, outfit: e.target.value })}
                className="w-full bg-[#121212] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
              />
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Phụ kiện (accessories)</span>
              <input
                type="text"
                value={dna.accessories}
                onChange={(e) => setDna({ ...dna, accessories: e.target.value })}
                className="w-full bg-[#121212] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
              />
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Tỉ lệ cơ thể (proportions)</span>
              <input
                type="text"
                value={dna.proportions}
                placeholder="VD: 6 heads tall, slender anime proportions"
                onChange={(e) => setDna({ ...dna, proportions: e.target.value })}
                className="w-full bg-[#121212] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
              />
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Màu chủ đạo (palette)</span>
              <input
                type="text"
                value={dna.palette}
                placeholder="VD: #1E3A8A navy, #F5B301 amber"
                onChange={(e) => setDna({ ...dna, palette: e.target.value })}
                className="w-full bg-[#121212] border border-[#595959]/50 rounded px-2 py-1 text-white text-[11px]"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-2 rounded bg-red-950/40 border border-red-500/40 text-red-300 text-[11px]">
              {errorMsg}
            </div>
          )}

          <div className="pt-2 flex flex-col gap-1.5">
            <button
              type="button"
              disabled={generating || selecting}
              onClick={handleGenerateSheet}
              className="w-full py-1.5 px-3 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-xs flex items-center justify-center gap-1.5 transition shadow"
            >
              <span className="material-symbols-outlined text-[15px]">
                {generating ? 'progress_activity' : 'auto_fix_high'}
              </span>
              {generating ? 'Đang tạo Model Sheet 2D...' : 'Tạo Model Sheet 2D (16:9 • 0 cr)'}
            </button>

            <button
              type="button"
              disabled={generating || selecting}
              onClick={handleSelectFromGallery}
              className="w-full py-1 px-3 rounded bg-[#2a2a2a] hover:bg-[#333] disabled:opacity-50 text-slate-200 border border-[#595959]/60 text-xs flex items-center justify-center gap-1.5 transition"
            >
              <span className="material-symbols-outlined text-[15px]">photo_library</span>
              {selecting ? 'Đang mở thư viện...' : 'Chọn từ thư viện Flow'}
            </button>
          </div>
        </div>
      )}

      {/* Characters List */}
      <div className="space-y-2">
        {characters.length === 0 && !isFormOpen && (
          <div className="p-4 rounded border border-dashed border-[#595959]/40 text-center text-slate-500 text-xs space-y-1">
            <p>Chưa có nhân vật 2D nào.</p>
            <p className="text-[11px] text-slate-600">
              Bấm "+ Tạo mới" để khóa diện mạo hoạt hình theo look đã chọn.
            </p>
          </div>
        )}

        {characters.map((char) => {
          const isConfirming = confirmDeleteId === char.id;
          return (
            <div
              key={char.id}
              className="p-2.5 rounded-lg bg-[#141414] border border-[#595959]/50 hover:border-slate-400/50 transition space-y-2"
            >
              <div className="flex gap-2.5 items-start">
                <div className="w-16 h-12 bg-[#0a0a0a] rounded overflow-hidden border border-[#595959]/40 flex-shrink-0 flex items-center justify-center relative">
                  {char.thumbBase64 ? (
                    <img
                      src={`data:${char.mimeType || 'image/jpeg'};base64,${char.thumbBase64}`}
                      alt={char.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="material-symbols-outlined text-slate-600">brush</span>
                  )}
                  {char.locked && (
                    <span className="absolute bottom-0.5 right-0.5 bg-emerald-600/90 text-white text-[8px] font-bold px-1 rounded tracking-tighter">
                      2D ON-MODEL
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-white text-xs truncate">{char.name}</h4>
                    {char.mediaId && (
                      <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 px-1 py-0.2 rounded border border-emerald-500/20">
                        ID: {char.mediaId.slice(-6)}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5 leading-snug">
                    {char.dna.outfit || 'DNA 2D'}
                  </p>
                  <p className="text-[9px] text-amber-400/80 mt-0.5 font-mono truncate">
                    {char.dna.proportions || '6 heads'} • {char.dna.palette || 'palette'}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-[#595959]/20 text-[10px]">
                <button
                  type="button"
                  onClick={() => handleEdit(char)}
                  className="px-2 py-0.5 rounded bg-[#242424] hover:bg-[#303030] text-slate-300 transition"
                >
                  Sửa DNA / Sheet
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteWithTwoStep(char.id)}
                  className={`px-2 py-0.5 rounded transition ${
                    isConfirming
                      ? 'bg-red-600 text-white font-bold animate-pulse'
                      : 'bg-red-950/30 hover:bg-red-900/50 text-red-400 border border-red-500/20'
                  }`}
                >
                  {isConfirming ? 'Click lại để xoá' : 'Xoá'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
