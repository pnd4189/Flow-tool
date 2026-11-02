import React from 'react';
import { CharacterConfig, Gender, Language, AgeGroup, BodyType } from '../types';
import { t } from '../services/i18n';
import { AGE_GROUP_OPTIONS, BODY_TYPE_OPTIONS } from '../constants';
import { sanitizeTag } from '../services/promptBuilder';

interface SectionCharacterProps {
  config: CharacterConfig;
  lang: Language;
  onChange: (patch: Partial<CharacterConfig>) => void;
}

export const SectionCharacter: React.FC<SectionCharacterProps> = ({ config, lang, onChange }) => {
  const handleTagInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/^@/, '');
    const clean = sanitizeTag(raw);
    onChange({ tag: clean });
  };

  const handleNumericAge = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    onChange({ numericAge: isNaN(val) ? null : Math.max(1, Math.min(120, val)) });
  };

  return (
    <div className="space-y-3.5 text-xs text-[#e6e9ef]">
      {/* Identifier tag */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_tag')}
        </label>
        <div className="relative">
          <span className="absolute left-3 top-2.5 text-[#7c9cff] font-mono text-sm">@</span>
          <input
            type="text"
            value={config.tag}
            onChange={handleTagInput}
            maxLength={24}
            className="w-full pl-8 pr-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-sm font-mono text-[#7c9cff] focus:border-[#7c9cff] focus:ring-1 focus:ring-[#7c9cff] focus:outline-none transition-all placeholder-[#8b93a1]/40"
            placeholder="character_tag"
          />
        </div>
        <p className="text-[10px] text-[#8b93a1] mt-1">{t(lang, 'hint_tag')}</p>
      </div>

      {/* Display name */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_display_name')}
        </label>
        <input
          type="text"
          value={config.displayName}
          onChange={(e) => onChange({ displayName: e.target.value })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-sm text-[#e6e9ef] focus:border-[#7c9cff] focus:ring-1 focus:ring-[#7c9cff] focus:outline-none transition-all placeholder-[#8b93a1]/40"
          placeholder={t(lang, 'placeholder_display_name')}
        />
      </div>

      {/* Gender Segmented */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_gender')}
        </label>
        <div className="grid grid-cols-3 gap-1 bg-[#0e1014] p-1 rounded-xl border border-[#262c36]">
          {(['male', 'female', 'other'] as Gender[]).map((g) => {
            const active = config.gender === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => onChange({ gender: g })}
                className={`py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  active
                    ? 'bg-[#7c9cff] text-[#0e1014] shadow-sm'
                    : 'text-[#8b93a1] hover:text-[#e6e9ef]'
                }`}
              >
                {t(lang, `gender_${g}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Age Group + Optional numeric age */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'lbl_age_group')}
          </label>
          <select
            value={config.ageGroup}
            onChange={(e) => onChange({ ageGroup: e.target.value as AgeGroup })}
            className="w-full px-2.5 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
          >
            {AGE_GROUP_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(lang, opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
            {t(lang, 'lbl_numeric_age')}
          </label>
          <input
            type="number"
            min={1}
            max={120}
            value={config.numericAge ?? ''}
            onChange={handleNumericAge}
            className="w-full px-2.5 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none placeholder-[#8b93a1]/40"
            placeholder={t(lang, 'placeholder_numeric_age')}
          />
        </div>
      </div>

      {/* Body Type */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_body_type')}
        </label>
        <select
          value={config.bodyType}
          onChange={(e) => onChange({ bodyType: e.target.value as BodyType })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:outline-none"
        >
          {BODY_TYPE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {t(lang, opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Role / Occupation */}
      <div>
        <label className="block text-[11px] font-semibold text-[#8b93a1] mb-1">
          {t(lang, 'lbl_role_occupation')}
        </label>
        <input
          type="text"
          value={config.roleOccupation}
          onChange={(e) => onChange({ roleOccupation: e.target.value })}
          className="w-full px-3 py-2 bg-[#0e1014] border border-[#262c36] rounded-xl text-xs text-[#e6e9ef] focus:border-[#7c9cff] focus:ring-1 focus:ring-[#7c9cff] focus:outline-none transition-all placeholder-[#8b93a1]/40"
          placeholder={t(lang, 'placeholder_role_occupation')}
        />
      </div>
    </div>
  );
};
