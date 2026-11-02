import React, { useState, useRef, useEffect } from 'react';
import { Flow } from 'flow-sdk';
import { CharacterConfig, HistoryItem, Language } from './types';
import { INITIAL_CONFIG } from './constants';
import { Header } from './components/Header';
import { ConfigChips } from './components/ConfigChips';
import { AccordionSection } from './components/AccordionSection';
import { SectionCharacter } from './components/SectionCharacter';
import { SectionFace } from './components/SectionFace';
import { SectionStyle } from './components/SectionStyle';
import { SectionAppearance } from './components/SectionAppearance';
import { SectionOutfit } from './components/SectionOutfit';
import { SectionFraming } from './components/SectionFraming';
import { StickyFooter } from './components/StickyFooter';
import { ViewerPanel } from './components/ViewerPanel';
import { PromptModal } from './components/PromptModal';
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer';
import { useGeneration } from './hooks/useGeneration';
import { useReferences } from './hooks/useReferences';
import { VariantChanges } from './services/variant';
import { t } from './services/i18n';
import { parseSession, serializeSession } from './services/session';
import { buildCharacterPack } from './services/pack';
import { formatFaceDna } from './services/faceDna';
import { translateConfigFields } from './services/translate';

export default function App() {
  const [lang, setLang] = useState<Language>('vi');
  const [config, setConfig] = useState<CharacterConfig>(INITIAL_CONFIG);
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({
    1: true,
    2: false,
    3: false,
    4: false,
    5: false,
    6: false,
  });
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDownloadingPack, setIsDownloadingPack] = useState(false);

  const configScrollRef = useRef<HTMLDivElement>(null);

  // References Hook: created once at top level and passed down
  const refsState = useReferences();

  // Generation Hook
  const {
    history,
    setHistory,
    selectedItem,
    selectedId,
    setSelectedId,
    job,
    isRunning,
    errorBanner,
    setErrorBanner,
    run,
    runVariant,
    stop,
    toggleFavorite,
    deleteItem,
  } = useGeneration();

  const updateConfig = (patch: Partial<CharacterConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const toggleSection = (num: number) => {
    setOpenSections((prev) => ({ ...prev, [num]: !prev[num] }));
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const handleJumpToSection = (sectionNumber: number) => {
    setOpenSections((prev) => ({ ...prev, [sectionNumber]: true }));
    setTimeout(() => {
      const el = document.getElementById(`accordion-sec-${sectionNumber}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  };

  const handleGenerate = () => {
    run(config, {
      faceRefs: refsState.faceRefs,
      outfitRefs: refsState.outfitRefs,
      faceDna: refsState.faceDna,
      outfitDna: refsState.outfitDna,
      faceLocked: refsState.faceLocked,
      applyPrepared: refsState.applyPrepared,
    });
  };

  const handleRegenerate = (item: HistoryItem) => {
    run(item.config, {
      faceRefs: refsState.faceRefs,
      outfitRefs: refsState.outfitRefs,
      faceDna: refsState.faceDna,
      outfitDna: refsState.outfitDna,
      faceLocked: refsState.faceLocked,
      applyPrepared: refsState.applyPrepared,
    });
  };

  const handleCreateVariant = (item: HistoryItem, changes: VariantChanges, count: number) => {
    runVariant(
      item,
      changes,
      {
        faceRefs: refsState.faceRefs,
        outfitRefs: refsState.outfitRefs,
        faceDna: refsState.faceDna,
        outfitDna: refsState.outfitDna,
        faceLocked: refsState.faceLocked,
        applyPrepared: refsState.applyPrepared,
      },
      count
    );
  };

  // Save session to JSON file
  const handleSaveSession = async () => {
    try {
      const jsonText = serializeSession({
        config,
        faceDna: refsState.faceDna,
        outfitDna: refsState.outfitDna,
        history,
      });

      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const safeTag = (config.tag || 'character').slice(0, 24);
      const filename = `character-session-${safeTag}-${y}${m}${d}-${hh}${mm}${ss}.json`;

      // UTF-8 safe base64 encoding
      const bytes = new TextEncoder().encode(jsonText);
      const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

      await Flow.download({
        base64,
        mimeType: 'application/json',
        filename,
      });

      showToast(t(lang, 'toast_session_saved'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi lưu phiên.';
      setErrorBanner(msg);
    }
  };

  // Open session from uploaded JSON file
  const handleOpenSessionFile = async (file: File) => {
    try {
      const text = await file.text();
      const result = parseSession(text);
      if (!result.ok) {
        setErrorBanner(result.error);
        return;
      }

      // Replace state
      setConfig(result.config);
      refsState.setFaceDna(result.faceDna);
      refsState.setOutfitDna(result.outfitDna);
      setHistory(result.history);
      if (result.history.length > 0) {
        setSelectedId(result.history[0].id);
      } else {
        setSelectedId(null);
      }

      // Clear face and outfit reference IMAGES (they are not saved in the session file)
      refsState.clearRefs();

      showToast(t(lang, 'session_opened_note'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể đọc tệp phiên làm việc.';
      setErrorBanner(msg);
    }
  };

  // Download Character Pack as .txt with translated English fields
  const handleDownloadPack = async () => {
    if (isDownloadingPack) return;
    setIsDownloadingPack(true);

    try {
      let packConfig = config;
      try {
        packConfig = await translateConfigFields(config);
      } catch {
        // Fall back to original config on translation error
        packConfig = config;
      }

      const faceDnaText = refsState.faceDna ? formatFaceDna(refsState.faceDna) : '';
      const packText = buildCharacterPack(
        packConfig,
        {
          faceDna: faceDnaText,
          outfitDna: refsState.outfitDna,
        },
        lang
      );

      const safeTag = (config.tag || 'character').slice(0, 24);
      const filename = `character-pack-${safeTag}.txt`;

      const bytes = new TextEncoder().encode(packText);
      const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

      await Flow.download({
        base64,
        mimeType: 'text/plain',
        filename,
      });

      showToast(t(lang, 'toast_pack_downloaded'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi tạo gói nhân vật.';
      setErrorBanner(msg);
    } finally {
      setIsDownloadingPack(false);
    }
  };

  // Global Ctrl/Cmd + Enter to trigger generation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const isFaceUploadMissing = config.faceSource === 'upload' && refsState.faceRefs.length === 0;
        if (!isRunning && !isFaceUploadMissing) {
          run(config, {
            faceRefs: refsState.faceRefs,
            outfitRefs: refsState.outfitRefs,
            faceDna: refsState.faceDna,
            outfitDna: refsState.outfitDna,
            faceLocked: refsState.faceLocked,
            applyPrepared: refsState.applyPrepared,
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [config, isRunning, refsState, run]);

  const hasFaceImages = refsState.faceRefs.length > 0;

  return (
    <div className="flex flex-col h-full w-full bg-[#0e1014] text-[#e6e9ef] select-text relative">
      {/* Global Header */}
      <Header
        lang={lang}
        onToggleLang={setLang}
        onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
        onSaveSession={handleSaveSession}
        onOpenSessionFile={handleOpenSessionFile}
        onDownloadPack={handleDownloadPack}
        isDownloadingPack={isDownloadingPack}
        tag={config.tag}
      />

      {/* Dismissible Error Banner */}
      {errorBanner && (
        <div className="px-4 py-2.5 bg-[#ef4444]/15 border-b border-[#ef4444]/30 flex items-center justify-between text-xs text-[#fca5a5] z-30 shrink-0 animate-in fade-in-50">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <span className="material-symbols-outlined text-base text-[#ef4444] shrink-0">
              error
            </span>
            <span className="font-semibold text-[#fee2e2] shrink-0">
              {t(lang, 'err_banner_title')}:
            </span>
            <span className="truncate">{errorBanner}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleGenerate}
              className="px-2.5 py-1 rounded-lg bg-[#ef4444] text-white font-bold text-[11px] hover:bg-[#dc2626] transition-colors"
            >
              {t(lang, 'btn_retry')}
            </button>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="p-1 rounded-lg hover:bg-[#ef4444]/20 text-[#fee2e2] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Dismissible Toast Message */}
      {toastMessage && (
        <div className="px-4 py-2 bg-[#22c55e]/15 border-b border-[#22c55e]/30 flex items-center justify-between text-xs text-[#4ade80] z-30 shrink-0 animate-in fade-in-50">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <span className="material-symbols-outlined text-base text-[#22c55e] shrink-0">
              check_circle
            </span>
            <span className="truncate">{toastMessage}</span>
          </div>

          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="p-1 rounded-lg hover:bg-[#22c55e]/20 text-[#4ade80] transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* Main Workspace Split layout (responsive breakpoint: 900px) */}
      <div className="flex-1 flex flex-col min-[900px]:flex-row overflow-hidden relative">
        {/* Left Config Panel: fixed 380px on desktop, stacks above on <900px */}
        <aside className="w-full min-[900px]:w-[380px] shrink-0 border-b min-[900px]:border-b-0 min-[900px]:border-r border-[#262c36] bg-[#161a21] flex flex-col h-[55vh] min-[900px]:h-full overflow-hidden">
          {/* Quick config chips with face lock indicator and reference images chip */}
          <ConfigChips
            config={config}
            lang={lang}
            faceLocked={refsState.faceLocked}
            faceRefCount={refsState.faceRefs.length}
            outfitRefCount={refsState.outfitRefs.length}
            onJumpToSection={handleJumpToSection}
          />

          {/* Scrollable Accordion list */}
          <div
            ref={configScrollRef}
            className="flex-1 overflow-y-auto divide-y divide-[#262c36] scroll-smooth"
          >
            {/* Section 1: Character */}
            <AccordionSection
              id="accordion-sec-1"
              sectionNumber={1}
              title={t(lang, 'sec_1_title')}
              subtitle={t(lang, 'sec_1_subtitle')}
              isOpen={!!openSections[1]}
              onToggle={() => toggleSection(1)}
            >
              <SectionCharacter
                config={config}
                lang={lang}
                onChange={updateConfig}
              />
            </AccordionSection>

            {/* Section 2: Face */}
            <AccordionSection
              id="accordion-sec-2"
              sectionNumber={2}
              title={t(lang, 'sec_2_title')}
              subtitle={t(lang, 'sec_2_subtitle')}
              isOpen={!!openSections[2]}
              onToggle={() => toggleSection(2)}
            >
              <SectionFace
                config={config}
                lang={lang}
                refs={refsState}
                onChange={updateConfig}
              />
            </AccordionSection>

            {/* Section 3: Visual Style */}
            <AccordionSection
              id="accordion-sec-3"
              sectionNumber={3}
              title={t(lang, 'sec_3_title')}
              subtitle={t(lang, 'sec_3_subtitle')}
              isOpen={!!openSections[3]}
              onToggle={() => toggleSection(3)}
            >
              <SectionStyle
                config={config}
                lang={lang}
                onChange={updateConfig}
              />
            </AccordionSection>

            {/* Section 4: Appearance */}
            <AccordionSection
              id="accordion-sec-4"
              sectionNumber={4}
              title={t(lang, 'sec_4_title')}
              subtitle={t(lang, 'sec_4_subtitle')}
              isOpen={!!openSections[4]}
              onToggle={() => toggleSection(4)}
            >
              <SectionAppearance
                config={config}
                lang={lang}
                onChange={updateConfig}
              />
            </AccordionSection>

            {/* Section 5: Outfit */}
            <AccordionSection
              id="accordion-sec-5"
              sectionNumber={5}
              title={t(lang, 'sec_5_title')}
              subtitle={t(lang, 'sec_5_subtitle')}
              isOpen={!!openSections[5]}
              onToggle={() => toggleSection(5)}
            >
              <SectionOutfit
                config={config}
                lang={lang}
                refs={refsState}
                onChange={updateConfig}
              />
            </AccordionSection>

            {/* Section 6: Framing */}
            <AccordionSection
              id="accordion-sec-6"
              sectionNumber={6}
              title={t(lang, 'sec_6_title')}
              subtitle={t(lang, 'sec_6_subtitle')}
              isOpen={!!openSections[6]}
              onToggle={() => toggleSection(6)}
            >
              <SectionFraming
                config={config}
                lang={lang}
                onChange={updateConfig}
              />
            </AccordionSection>
          </div>

          {/* Sticky footer with count stepper, aspect chip, model picker & functional generation trigger */}
          <StickyFooter
            config={config}
            lang={lang}
            job={job}
            isRunning={isRunning}
            hasFaceImages={hasFaceImages}
            onChange={updateConfig}
            onOpenPrompt={() => setIsPromptModalOpen(true)}
            onGenerate={handleGenerate}
            onStop={stop}
          />
        </aside>

        {/* Right Viewer Panel */}
        <main className="flex-1 flex flex-col h-[45vh] min-[900px]:h-full overflow-hidden">
          <ViewerPanel
            config={config}
            lang={lang}
            history={history}
            selectedItem={selectedItem}
            selectedId={selectedId}
            job={job}
            isRunning={isRunning}
            onOpenPrompt={() => setIsPromptModalOpen(true)}
            onGenerate={handleGenerate}
            onSelectHistory={setSelectedId}
            onRegenerate={handleRegenerate}
            onDeleteHistory={deleteItem}
            onToggleFavorite={toggleFavorite}
            onCreateVariant={handleCreateVariant}
          />
        </main>
      </div>

      {/* Diagnostics Log Drawer */}
      <DiagnosticsDrawer
        isOpen={isDiagnosticsOpen}
        lang={lang}
        onClose={() => setIsDiagnosticsOpen(false)}
      />

      {/* Prompt Inspector Modal */}
      <PromptModal
        config={config}
        lang={lang}
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
      />
    </div>
  );
}
