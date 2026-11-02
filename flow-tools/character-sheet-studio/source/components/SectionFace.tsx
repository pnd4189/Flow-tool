import React, { useState } from 'react';
import { CharacterConfig, Ethnicity, FaceDna, FaceFidelity, Language, RefImage } from '../types';
import { t } from '../services/i18n';
import { ETHNICITY_OPTIONS } from '../constants';
import { RefDropZone } from './RefDropZone';
import { formatFaceDna, faceDnaToConfigPatch } from '../services/faceDna';
import { faceSourcePatch } from '../services/configRules';

interface ReferencesFaceContext {
  faceRefs: RefImage[];
  faceDna: FaceDna | null;
  faceLocked: boolean;
  error: string | null;
  addFiles: (kind: 'face' | 'outfit', files: File[]) => Promise<void>;
  addFromLibrary: (kind: 'face' | 'outfit') => Promise<void>;
  remove: (id: string) => void;
  lockFace: () => Promise<{ faceRefs: RefImage[]; faceDna: FaceDna } | null>;
  unlockFace: () => void;
  setFaceDna: (dna: FaceDna | null) => void;
}

interface SectionFaceProps {
  config: CharacterConfig;
  lang: Language;
  refs: ReferencesFaceContext;
  onChange: (patch: Partial<CharacterConfig>) => void;
}

export const SectionFace: React.FC<SectionFaceProps> = ({
  config,
  lang,
  refs,
  onChange,
}) => {
  const [isLocking, setIsLocking] = useState(false);
  const [showAutoFillNote, setShowAutoFillNote] = useState(false);

  const handleSourceChange = (src: 'ai' | 'upload') => {
    const patch = faceSourcePatch(src);
    onChange({
      faceSource: src,
      ...patch,
    });
  };

  const handleFiles = async (files: File[]) => {
    // If locked, automatically unlock and clear faceDna when adding images
    if (refs.faceLocked) {
      refs.unlockFace();
      refs.setFaceDna(null);
      setShowAutoFillNote(false);
    }
    await refs.addFiles('face', files);
  };

  const handleLibrary = async () => {
    if (refs.faceLocked) {
      refs.unlockFace();
      refs.setFaceDna(null);
      setShowAutoFillNote(false);
    }
    await refs.addFromLibrary('face');
  };

  const handleRemove = (id: string) => {
    if (refs.faceLocked) {
      refs.unlockFace();
      refs.setFaceDna(null);
      setShowAutoFillNote(false);
    }
    refs.remove(id);
  };

  const handleLockFace = async () => {
    if (refs.faceRefs.length === 0 || isLocking) return;
    setIsLocking(true);
    try {
      const lockRes = await refs.lockFace();
      if (lockRes && lockRes.faceDna) {
        const patch = faceDnaToConfigPatch(lockRes.faceDna);
        if (Object.keys(patch).length > 0) {
          onChange(patch);
          setShowAutoFillNote(true);
        }
      }
    } finally {
      setIsLocking(false);
    }
  };

  const handleUnlock = () => {
    refs.unlockFace();
    setShowAutoFillNote(false);
  };

  const handleFaceDnaSummaryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (refs.faceDna) {
      refs.setFaceDna({
        ...refs.faceDna,
        summary: val,
      });
    } else {
      refs.setFaceDna({
        summary: val,
        details: {
          faceShape: '',
          eyes: '',
          brows: '',
          nose: '',
          lips: '',
          skinTone: '',
          hair: '',
          facialHair: '',
          ageImpression: '',
          distinctiveMarks: '',
        },
      });
    }
  };

  const faceDnaValue = refs.faceDna
    ? refs.faceDna.summary || formatFaceDna(refs.faceDna)
    : '';

  const fidelity = config.faceFidelity || 'balanced';

  return (
    <div className="space-y-3.5 text-xs text-[#e6e9ef]">
      {/* Face source segmented */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_face_source')}
        </label>
        <div className="grid grid-cols-2 gap-1 bg-[#0e1014] p-1 rounded-xl border border-[#262c36]">
          <button
            type="button"
            onClick={() => handleSourceChange('ai')}
            className={`py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              config.faceSource === 'ai'
                ? 'bg-[#7c9cff] text-[#0e1014] shadow-sm'
                : 'text-[#8b93a1] hover:text-[#e6e9ef]'
            }`}
          >
            <span className="material-symbols-outlined text-sm">auto_awesome</span>
            {t(lang, 'face_source_ai')}
          </button>
          <button
            type="button"
            onClick={() => handleSourceChange('upload')}
            className={`py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all ${
              config.faceSource === 'upload'
                ? 'bg-[#7c9cff] text-[#0e1014] shadow-sm'
                : 'text-[#8b93a1] hover:text-[#e6e9ef]'
            }`}
          >
            <span className="material-symbols-outlined text-sm">add_photo_alternate</span>
            {t(lang, 'face_source_upload')}
          </button>
        </div>
      </div>

      {/* AI Mode: Ethnicity selector */}
      {config.faceSource === 'ai' && (
        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold text-[#8b93a1]">
            {t(lang, 'lbl_ethnicity')}
          </label>
          <select
            value={config.ethnicity}
            onChange={(e) => onChange({ ethnicity: e.target.value as Ethnicity })}
            className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
          >
            {ETHNICITY_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(lang, opt.labelKey)}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-[#8b93a1]">
            {config.ethnicity === 'vietnamese'
              ? '✨ Tối ưu hóa nét mặt người Việt: đường nét tự nhiên, thanh tú, mắt có hồn.'
              : 'Định hình cấu trúc xương mặt và đặc điểm sắc tộc trên mọi góc chụp.'}
          </p>
        </div>
      )}

      {/* Upload Mode: RefDropZone + Fidelity + Lock Face + Face DNA */}
      {config.faceSource === 'upload' && (
        <div className="space-y-3">
          {/* Likeness Fidelity Segmented Control */}
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-[#8b93a1]">
              {t(lang, 'lbl_face_fidelity')}
            </label>
            <div className="grid grid-cols-3 gap-1 bg-[#0e1014] p-1 rounded-xl border border-[#262c36]">
              {(['stylized', 'balanced', 'strict'] as FaceFidelity[]).map((f) => {
                const active = fidelity === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => onChange({ faceFidelity: f })}
                    className={`py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      active
                        ? 'bg-[#7c9cff] text-[#0e1014] shadow-sm font-bold'
                        : 'text-[#8b93a1] hover:text-[#e6e9ef]'
                    }`}
                  >
                    {t(lang, `fidelity_${f}`)}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-[#8b93a1] pt-0.5 leading-snug">
              {t(lang, `fidelity_${fidelity}_hint`)}
            </p>
          </div>

          <RefDropZone
            kind="face"
            items={refs.faceRefs}
            max={3}
            lang={lang}
            disabled={isLocking}
            onFiles={handleFiles}
            onLibrary={handleLibrary}
            onRemove={handleRemove}
          />

          {/* Error line from refs.error */}
          {refs.error && (
            <div className="p-2 rounded-lg bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#fca5a5] text-xs flex items-start gap-1.5 animate-in fade-in-50">
              <span className="material-symbols-outlined text-sm text-[#ef4444] shrink-0 mt-0.5">
                error
              </span>
              <span className="leading-tight">{refs.error}</span>
            </div>
          )}

          {/* Action Row: Lock / Unlock */}
          {!refs.faceLocked ? (
            <div>
              <button
                type="button"
                onClick={handleLockFace}
                disabled={refs.faceRefs.length === 0 || isLocking}
                className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-[#7c9cff] to-[#6366f1] text-[#0e1014] text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-[#7c9cff]/20 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {isLocking ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">autorenew</span>
                    <span>{t(lang, 'btn_locking_face')}</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">lock</span>
                    <span>{t(lang, 'btn_lock_face')}</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-2.5 p-3 rounded-xl bg-[#0e1014] border border-[#22c55e]/30 animate-in fade-in-50">
              {/* Green Locked Badge & Unlock button */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30 text-[11px] font-bold">
                  <span className="material-symbols-outlined text-xs">lock</span>
                  <span>{t(lang, 'badge_face_locked')}</span>
                </span>

                <button
                  type="button"
                  onClick={handleUnlock}
                  className="px-2.5 py-1 rounded-lg bg-[#161a21] border border-[#262c36] text-[#8b93a1] hover:text-[#e6e9ef] hover:border-[#8b93a1] text-[11px] font-semibold transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-xs">lock_open</span>
                  <span>{t(lang, 'btn_unlock_face')}</span>
                </button>
              </div>

              {/* Auto-fill notification note */}
              {showAutoFillNote && (
                <div className="p-2 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/25 text-[#4ade80] text-[11px] flex items-center gap-1.5 leading-snug">
                  <span className="material-symbols-outlined text-xs shrink-0">check_circle</span>
                  <span>{t(lang, 'note_dna_applied')}</span>
                </div>
              )}

              {/* Editable Face DNA textarea */}
              <div>
                <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
                  {t(lang, 'lbl_face_dna')}
                </label>
                <textarea
                  rows={3}
                  value={faceDnaValue}
                  onChange={handleFaceDnaSummaryChange}
                  className="w-full px-3 py-2 bg-[#161a21] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none resize-none leading-relaxed"
                  placeholder="Face DNA details..."
                />
                <p className="text-[10px] text-[#8b93a1] mt-1 leading-tight">
                  {t(lang, 'hint_face_dna')}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
