import React from 'react';
import { CharacterConfig, VisualStyleId, Language } from '../types';
import { VISUAL_STYLES } from '../constants';
import { t } from '../services/i18n';

interface SectionStyleProps {
  config: CharacterConfig;
  lang: Language;
  onChange: (patch: Partial<CharacterConfig>) => void;
}

export const SectionStyle: React.FC<SectionStyleProps> = ({ config, lang, onChange }) => {
  return (
    <div className="space-y-2 text-xs text-[#e6e9ef]">
      <div className="grid grid-cols-2 gap-2">
        {VISUAL_STYLES.map((style) => {
          const active = config.styleId === style.id;
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => onChange({ styleId: style.id })}
              className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between min-h-[92px] ${
                active
                  ? 'bg-[#7c9cff]/10 border-[#7c9cff] ring-1 ring-[#7c9cff]'
                  : 'bg-[#0e1014] border-[#262c36] hover:border-[#8b93a1]/40'
              }`}
            >
              <div className="flex items-start justify-between w-full mb-1">
                <span
                  className={`material-symbols-outlined text-base ${
                    active ? 'text-[#7c9cff]' : 'text-[#8b93a1]'
                  }`}
                >
                  {style.icon}
                </span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                    active
                      ? 'bg-[#7c9cff] text-[#0e1014]'
                      : 'bg-[#161a21] text-[#8b93a1] border border-[#262c36]'
                  }`}
                >
                  {t(lang, style.badgeKey)}
                </span>
              </div>

              <div>
                <h3
                  className={`text-xs font-bold leading-tight ${
                    active ? 'text-[#7c9cff]' : 'text-[#e6e9ef]'
                  }`}
                >
                  {t(lang, style.labelKey)}
                </h3>
                <p className="text-[10px] text-[#8b93a1] leading-tight line-clamp-2 mt-0.5">
                  {t(lang, style.descKey)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
