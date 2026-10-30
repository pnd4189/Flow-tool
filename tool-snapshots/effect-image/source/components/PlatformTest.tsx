import React, { useState, useRef, useEffect } from 'react';
import { Flow } from 'flow-sdk';
import { Badge } from './ui/Badge';
import type { Phase0State, ModelTestResult, MockErrorConfig, MockErrorType } from '../types';
import {
  TEST_PROMPT,
  IMAGE_MODELS_TO_TEST,
  testSingleModel,
  testParallaxLayers,
  testAiVision,
} from '../services/platformTest';
import { checkCodecCapabilities, renderAndEncodeTestVideo } from '../services/mp4Encoder';

interface PlatformTestProps {
  mockErrorConfig?: MockErrorConfig;
  setMockErrorConfig?: React.Dispatch<React.SetStateAction<MockErrorConfig>>;
  onNotify?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

interface SuccessfulImageSource {
  base64: string;
  mimeType: string;
  mediaId: string;
  modelName: string;
}

export const PlatformTest: React.FC<PlatformTestProps> = ({
  mockErrorConfig,
  setMockErrorConfig,
  onNotify,
}) => {
  const [state, setState] = useState<Phase0State>({
    modelTests: {},
    videoTest: { status: 'idle', encoderUsed: 'None' },
    parallaxTest: { status: 'idle' },
    aiVisionTest: { status: 'idle' },
    isRunningAll: false,
  });

  const [activeTab, setActiveTab] = useState<'A' | 'B' | 'C' | 'D' | 'MOCK'>('A');

  // Animation canvas state cho parallax preview
  const parallaxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isParallaxPlaying, setIsParallaxPlaying] = useState(false);
  const animationFrameRef = useRef<number | null>(null);

  // Lưu trạng thái download và upload
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Trạng thái cục bộ cho form Giả lập lỗi
  const [selectedMockType, setSelectedMockType] = useState<MockErrorType>(
    mockErrorConfig?.type || 'temporary'
  );
  const [selectedMockCount, setSelectedMockCount] = useState<number>(
    mockErrorConfig?.remainingCount || 1
  );

  // Ref lưu trạng thái tests hiện tại để quy trình chạy tuần tự truy xuất chính xác
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const getFirstSuccessfulImage = (testsMap = stateRef.current.modelTests): SuccessfulImageSource | null => {
    for (const model of IMAGE_MODELS_TO_TEST) {
      const res = testsMap[model];
      if (res && res.status === 'success' && res.base64 && res.mediaId) {
        return {
          base64: res.base64,
          mimeType: res.mimeType || 'image/jpeg',
          mediaId: res.mediaId,
          modelName: res.modelName,
        };
      }
    }
    return null;
  };

  const firstSuccessImg = getFirstSuccessfulImage(state.modelTests);

  // ==========================================
  // PHÉP THỬ A: MODEL ẢNH
  // ==========================================
  const runModelTestA = async (specificModel?: string): Promise<Record<string, ModelTestResult>> => {
    const modelsToRun = specificModel ? [specificModel] : IMAGE_MODELS_TO_TEST;
    let updatedResults = { ...stateRef.current.modelTests };

    for (const model of modelsToRun) {
      setState((prev) => ({
        ...prev,
        modelTests: {
          ...prev.modelTests,
          [model]: { modelName: model, status: 'running' },
        },
      }));

      const res = await testSingleModel(model);
      updatedResults = {
        ...updatedResults,
        [model]: res,
      };

      setState((prev) => ({
        ...prev,
        modelTests: {
          ...prev.modelTests,
          [model]: res,
        },
      }));
    }

    return updatedResults;
  };

  // ==========================================
  // PHÉP THỬ B: MÃ HOÁ MP4
  // ==========================================
  const runVideoTestB = async (providedImg?: SuccessfulImageSource | null): Promise<boolean> => {
    const imgSource = providedImg || getFirstSuccessfulImage();
    if (!imgSource) {
      setState((prev) => ({
        ...prev,
        videoTest: {
          status: 'error',
          encoderUsed: 'None',
          errorMessage:
            'Cần ít nhất 1 ảnh thành công từ Phép thử A (Model ảnh) trước khi dựng video. Vui lòng bấm Chạy Phép thử A!',
        },
      }));
      return false;
    }

    setState((prev) => ({
      ...prev,
      videoTest: { status: 'running', encoderUsed: 'None' },
    }));

    try {
      const support = await checkCodecCapabilities();
      const encodeRes = await renderAndEncodeTestVideo(imgSource.base64, imgSource.mimeType);

      setState((prev) => ({
        ...prev,
        videoTest: {
          status: 'success',
          encoderUsed: encodeRes.encoderUsed,
          durationMs: encodeRes.durationMs,
          videoBase64: encodeRes.videoBase64,
          mimeType: encodeRes.mimeType,
          videoUrl: encodeRes.videoUrl,
          supportDetails: support,
        },
      }));
      return true;
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        videoTest: {
          status: 'error',
          encoderUsed: 'None',
          errorMessage: err?.message || String(err),
        },
      }));
      return false;
    }
  };

  // ==========================================
  // PHÉP THỬ C: TÁCH LỚP PARALLAX
  // ==========================================
  const runParallaxTestC = async (providedImg?: SuccessfulImageSource | null): Promise<boolean> => {
    const imgSource = providedImg || getFirstSuccessfulImage();
    if (!imgSource) {
      setState((prev) => ({
        ...prev,
        parallaxTest: {
          status: 'error',
          errorMessage:
            'Cần có 1 ảnh gốc thành công (có mediaId) từ Phép thử A. Vui lòng chạy Phép thử A trước!',
        },
      }));
      return false;
    }

    setState((prev) => ({
      ...prev,
      parallaxTest: { status: 'running' },
    }));

    try {
      const res = await testParallaxLayers(imgSource);
      setState((prev) => ({
        ...prev,
        parallaxTest: {
          status: 'success',
          durationMs: res.durationMs,
          bgBase64: res.bgBase64,
          bgMediaId: res.bgMediaId,
          subjectRawBase64: res.subjectRawBase64,
          subjectCutoutBase64: res.subjectCutoutBase64,
          subjectCutoutDataUrl: res.subjectCutoutDataUrl,
          offsetPx: res.offsetPx,
        },
      }));
      return true;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        parallaxTest: {
          status: 'error',
          errorMessage: msg,
        },
      }));
      return false;
    }
  };

  const startParallaxAnimation = () => {
    const bgBase64 = state.parallaxTest.bgBase64;
    const cutoutUrl = state.parallaxTest.subjectCutoutDataUrl;

    if (!parallaxCanvasRef.current || !bgBase64 || !cutoutUrl) {
      return;
    }

    setIsParallaxPlaying(true);
    const canvas = parallaxCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setIsParallaxPlaying(false);
      return;
    }

    const bg = new Image();
    bg.crossOrigin = 'anonymous';
    bg.src = bgBase64.startsWith('data:') ? bgBase64 : `data:image/jpeg;base64,${bgBase64}`;

    const sub = new Image();
    sub.crossOrigin = 'anonymous';
    sub.src = cutoutUrl;

    let loadedCount = 0;
    const onLoaded = () => {
      loadedCount++;
      if (loadedCount < 2) return;

      const animDuration = 3000;
      const startTime = performance.now();

      const frame = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / animDuration);
        const t = 0.5 - 0.5 * Math.cos(progress * Math.PI);

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        ctx.save();
        const bgShiftX = -w * 0.02 * t;
        ctx.drawImage(bg, bgShiftX, 0, w * 1.05, h);
        ctx.restore();

        ctx.save();
        const subScale = 1.0 + 0.03 * t;
        const subShiftX = w * 0.03 * t;

        ctx.translate(w / 2 + subShiftX, h / 2);
        ctx.scale(subScale, subScale);
        ctx.translate(-w / 2, -h / 2);
        ctx.drawImage(sub, 0, 0, w, h);
        ctx.restore();

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(frame);
        } else {
          setIsParallaxPlaying(false);
        }
      };

      animationFrameRef.current = requestAnimationFrame(frame);
    };

    bg.onload = onLoaded;
    sub.onload = onLoaded;
    bg.onerror = () => setIsParallaxPlaying(false);
    sub.onerror = () => setIsParallaxPlaying(false);
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // ==========================================
  // PHÉP THỬ D: AI SOI ẢNH
  // ==========================================
  const runAiVisionTestD = async (providedImg?: SuccessfulImageSource | null): Promise<boolean> => {
    const imgSource = providedImg || getFirstSuccessfulImage();
    if (!imgSource) {
      setState((prev) => ({
        ...prev,
        aiVisionTest: {
          status: 'error',
          errorMessage:
            'Cần ít nhất 1 ảnh thành công từ Phép thử A để AI tiến hành soi ảnh. Vui lòng chạy Phép thử A trước!',
        },
      }));
      return false;
    }

    setState((prev) => ({
      ...prev,
      aiVisionTest: { status: 'running' },
    }));

    const res = await testAiVision(imgSource.base64, imgSource.mimeType);
    setState((prev) => ({
      ...prev,
      aiVisionTest: res,
    }));
    return res.status === 'success';
  };

  const runAllTests = async () => {
    setState((prev) => ({ ...prev, isRunningAll: true }));
    try {
      setActiveTab('A');
      const modelResults = await runModelTestA();

      const validImage = getFirstSuccessfulImage(modelResults);
      if (!validImage) {
        setState((prev) => ({
          ...prev,
          videoTest: {
            status: 'error',
            encoderUsed: 'None',
            errorMessage: 'Phép thử A không có model nào sinh ảnh thành công. Không thể chạy B, C, D.',
          },
          parallaxTest: {
            status: 'error',
            errorMessage: 'Phép thử A không có model nào sinh ảnh thành công.',
          },
          aiVisionTest: {
            status: 'error',
            errorMessage: 'Phép thử A không có model nào sinh ảnh thành công.',
          },
        }));
        return;
      }

      setActiveTab('B');
      await runVideoTestB(validImage);

      setActiveTab('C');
      await runParallaxTestC(validImage);

      setActiveTab('D');
      await runAiVisionTestD(validImage);
    } finally {
      setState((prev) => ({ ...prev, isRunningAll: false }));
    }
  };

  const handleDownloadVideo = async () => {
    if (!state.videoTest.videoBase64 || !state.videoTest.mimeType) return;
    try {
      setSaveStatus('Đang tải file...');
      const ext = state.videoTest.mimeType === 'video/mp4' ? 'mp4' : 'webm';
      await Flow.download({
        base64: state.videoTest.videoBase64,
        mimeType: state.videoTest.mimeType,
        filename: `effect-image-test.${ext}`,
      });
      setSaveStatus('Đã tải xuống thành công ✓');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      setSaveStatus(`Lỗi tải: ${err?.message || err}`);
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  const handleUploadToFlow = async () => {
    if (!state.videoTest.videoBase64 || !state.videoTest.mimeType) return;
    try {
      setSaveStatus('Đang lưu vào thư viện Flow...');
      const uploaded = await Flow.upload({
        base64: state.videoTest.videoBase64,
        mimeType: state.videoTest.mimeType as any,
        name: 'Effect-Image Test Video',
      });
      setSaveStatus(`Đã lưu Flow Gallery (mediaId: ${uploaded.mediaId.slice(0, 8)}...) ✓`);
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (err: any) {
      setSaveStatus(`Lỗi lưu Flow: ${err?.message || err}`);
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  // Kích hoạt giả lập lỗi (Đợt 2D - Yêu cầu 3)
  const handleApplyMockError = () => {
    if (!setMockErrorConfig) return;
    setMockErrorConfig({
      active: true,
      type: selectedMockType,
      remainingCount: selectedMockCount,
    });
    if (onNotify) {
      onNotify(
        `Đã bật Giả lập lỗi: "${getMockErrorLabel(selectedMockType)}" (${selectedMockCount} lần còn lại)`,
        'warning'
      );
    }
  };

  const handleDisableMockError = () => {
    if (!setMockErrorConfig) return;
    setMockErrorConfig({
      active: false,
      type: selectedMockType,
      remainingCount: 0,
    });
    if (onNotify) {
      onNotify('Đã tắt chế độ Giả lập lỗi sinh ảnh.', 'info');
    }
  };

  const getMockErrorLabel = (type: MockErrorType) => {
    switch (type) {
      case 'temporary':
        return 'Tạm thời: "Dịch vụ tạm thời không hoạt động. Hãy thử lại."';
      case 'image_service':
        return 'Dịch vụ ảnh: "Dịch vụ tạo hình ảnh không hoạt động. Hãy thử lại."';
      case 'safety':
        return 'An toàn: "Generation blocked by safety policy"';
      case 'quota':
        return 'Hạn mức: "Quota exceeded" (Dừng ngay hàng đợi)';
      case 'timeout':
        return 'Timeout: Treo đến khi hết 120s';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0b0b0d] text-[#ececef] overflow-hidden">
      {/* Top Banner & Controller */}
      <div className="p-4 border-b border-[#26262b] bg-[#141417]/80 backdrop-blur flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#f5b301]/10 border border-[#f5b301]/30 flex items-center justify-center text-[#f5b301]">
            <span className="material-symbols-outlined text-[20px]">science</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-100 uppercase">
                CHẨN ĐOÁN HỆ THỐNG (SYSTEM DIAGNOSTICS)
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30">
                0 Credit
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Kiểm tra các model 0 credit, mã hoá MP4, tách chroma key, AI vision và giả lập lỗi kiểm thử.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus && (
            <span className="text-xs font-mono text-[#f5b301] bg-[#f5b301]/10 px-2.5 py-1 rounded border border-[#f5b301]/20">
              {saveStatus}
            </span>
          )}

          <button
            type="button"
            onClick={runAllTests}
            disabled={state.isRunningAll}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#f5b301] text-black font-semibold text-xs rounded-lg hover:bg-[#ffbe1a] transition-all disabled:opacity-50 active:scale-95 shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px]">
              {state.isRunningAll ? 'hourglass_top' : 'play_circle'}
            </span>
            <span>{state.isRunningAll ? 'Đang chạy tuần tự (A→B→C→D)...' : 'Chạy tất cả tuần tự (A → D)'}</span>
          </button>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-[#26262b] bg-[#111114] px-4 gap-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('A')}
          className={`flex items-center gap-2 py-2.5 px-3.5 border-b-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'A'
              ? 'border-[#f5b301] text-[#f5b301] bg-[#18181f]'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#141417]'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">photo_library</span>
          <span>A) Model Ảnh ({IMAGE_MODELS_TO_TEST.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('B')}
          className={`flex items-center gap-2 py-2.5 px-3.5 border-b-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'B'
              ? 'border-[#f5b301] text-[#f5b301] bg-[#18181f]'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#141417]'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">video_settings</span>
          <span>B) Mã hoá MP4 / WebCodecs</span>
          <Badge status={state.videoTest.status} />
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('C')}
          className={`flex items-center gap-2 py-2.5 px-3.5 border-b-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'C'
              ? 'border-[#f5b301] text-[#f5b301] bg-[#18181f]'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#141417]'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">layers</span>
          <span>C) Tách Lớp Parallax</span>
          <Badge status={state.parallaxTest.status} />
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('D')}
          className={`flex items-center gap-2 py-2.5 px-3.5 border-b-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'D'
              ? 'border-[#f5b301] text-[#f5b301] bg-[#18181f]'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#141417]'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">smart_toy</span>
          <span>D) AI Soi Ảnh (Gemini Vision)</span>
          <Badge status={state.aiVisionTest.status} />
        </button>

        {/* Tab Giả lập lỗi sinh ảnh (Đợt 2D - Yêu cầu 3) */}
        <button
          type="button"
          onClick={() => setActiveTab('MOCK')}
          className={`flex items-center gap-2 py-2.5 px-3.5 border-b-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'MOCK'
              ? 'border-rose-500 text-rose-400 bg-[#18181f]'
              : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#141417]'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">bug_report</span>
          <span>Giả lập lỗi sinh ảnh</span>
          {mockErrorConfig?.active && (
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/30">
              {mockErrorConfig.remainingCount} lần
            </span>
          )}
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {/* TAB GIẢ LẬP LỖI SINH ẢNH */}
        {activeTab === 'MOCK' && (
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="p-4 rounded-xl bg-[#141417] border border-[#26262b] space-y-4">
              <div className="flex items-center justify-between border-b border-[#26262b] pb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-rose-400 text-[22px]">
                    error_outline
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      Giả lập lỗi sinh ảnh (Chỉ dùng để kiểm thử)
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Các lần gọi Flow.generate.image tiếp theo qua hàng đợi sẽ ném đúng lỗi đã chọn thay vì gọi thật.
                    </p>
                  </div>
                </div>

                {mockErrorConfig?.active && (
                  <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse">
                    ĐANG BẬT ({mockErrorConfig.remainingCount} LẦN)
                  </span>
                )}
              </div>

              {/* Lựa chọn loại lỗi */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-300">Chọn loại lỗi muốn giả lập:</label>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    {
                      id: 'temporary' as MockErrorType,
                      title: '1. Tạm thời (Temporary Error)',
                      desc: "Thông báo: 'Dịch vụ tạm thời không hoạt động. Hãy thử lại.' (Kích hoạt retry 5s, 15s, 40s)",
                    },
                    {
                      id: 'image_service' as MockErrorType,
                      title: '2. Dịch vụ ảnh (Image Service Error)',
                      desc: "Thông báo: 'Dịch vụ tạo hình ảnh không hoạt động. Hãy thử lại.' (Kích hoạt retry/fallback)",
                    },
                    {
                      id: 'safety' as MockErrorType,
                      title: '3. An toàn (Safety Policy)',
                      desc: "Thông báo: 'Generation blocked by safety policy' (Kích hoạt AI viết lại prompt an toàn)",
                    },
                    {
                      id: 'quota' as MockErrorType,
                      title: '4. Hạn mức (Quota exceeded)',
                      desc: "Thông báo: 'Quota exceeded' (DỪNG ngay hàng đợi, báo toast đỏ, KHÔNG thử lại)",
                    },
                    {
                      id: 'timeout' as MockErrorType,
                      title: '5. Timeout (Treo 120s)',
                      desc: "Treo tiến trình đến khi hết 120s rồi ném lỗi timeout",
                    },
                  ].map((opt) => (
                    <label
                      key={opt.id}
                      className={`p-3 rounded-lg border cursor-pointer flex items-start gap-3 transition-colors ${
                        selectedMockType === opt.id
                          ? 'bg-rose-500/10 border-rose-500/40 text-zinc-100'
                          : 'bg-[#18181f] border-[#26262b] text-zinc-400 hover:bg-[#1e1e26]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="mockErrorType"
                        value={opt.id}
                        checked={selectedMockType === opt.id}
                        onChange={() => setSelectedMockType(opt.id)}
                        className="mt-1 accent-rose-500"
                      />
                      <div className="flex-1 text-xs">
                        <div className="font-semibold text-zinc-200">{opt.title}</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Lựa chọn số lần */}
              <div className="flex items-center justify-between pt-2 border-t border-[#26262b]">
                <div className="space-y-0.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Số lần giả lập:
                  </label>
                  <p className="text-[11px] text-zinc-500">
                    Mỗi lần gọi sinh ảnh sẽ trừ 1 cho đến khi hết lượt.
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  {[1, 2, 3, 5, 10, 20, 30].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setSelectedMockCount(cnt)}
                      className={`px-2 h-8 rounded text-xs font-mono font-semibold transition-colors ${
                        selectedMockCount === cnt
                          ? 'bg-rose-500 text-white'
                          : 'bg-[#1e1e24] text-zinc-400 hover:bg-[#282830] border border-[#2d2d35]'
                      }`}
                    >
                      {cnt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nút hành động */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#26262b]">
                {mockErrorConfig?.active && (
                  <button
                    type="button"
                    onClick={handleDisableMockError}
                    className="px-3.5 py-1.5 rounded-lg bg-[#22222a] hover:bg-[#2a2a35] text-zinc-300 text-xs font-medium border border-[#33333f]"
                  >
                    Tắt giả lập ngay
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleApplyMockError}
                  className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                  <span>
                    Kích hoạt giả lập ({selectedMockCount} lần)
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB A: MODEL ẢNH */}
        {activeTab === 'A' && (
          <div className="space-y-4 max-w-7xl mx-auto">
            <div className="p-3.5 rounded-lg bg-[#141417] border border-[#26262b] flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="text-xs text-zinc-400 font-mono">
                  Prompt cố định:{' '}
                  <span className="text-zinc-200">
                    "{TEST_PROMPT}"
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  Tỷ lệ: 16:9 • Chạy tuần tự qua danh sách 8 model • Hiển thị lỗi nguyên văn nếu không hợp lệ
                </div>
              </div>
              <button
                type="button"
                onClick={() => runModelTestA()}
                className="self-start md:self-auto px-3 py-1.5 bg-[#1e1e24] hover:bg-[#282830] text-zinc-200 border border-[#2d2d35] rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                <span>Chạy kiểm tra tất cả model</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {IMAGE_MODELS_TO_TEST.map((modelName) => {
                const test = state.modelTests[modelName];
                const status = test?.status || 'idle';

                return (
                  <div
                    key={modelName}
                    className="flex flex-col rounded-lg bg-[#141417] border border-[#26262b] overflow-hidden"
                  >
                    <div className="p-3 border-b border-[#26262b] flex items-center justify-between gap-2 bg-[#18181f]">
                      <span className="text-xs font-semibold text-zinc-200 truncate" title={modelName}>
                        {modelName}
                      </span>
                      <Badge status={status} durationMs={test?.durationMs} />
                    </div>

                    <div className="relative aspect-video bg-[#0d0d10] flex items-center justify-center overflow-hidden group">
                      {status === 'running' && (
                        <div className="flex flex-col items-center gap-2 text-zinc-400 text-xs">
                          <span className="w-5 h-5 border-2 border-[#f5b301] border-t-transparent rounded-full animate-spin" />
                          <span className="font-mono text-[11px]">Đang gọi API...</span>
                        </div>
                      )}

                      {status === 'success' && test?.base64 && (
                        <>
                          <img
                            src={`data:${test.mimeType || 'image/jpeg'};base64,${test.base64}`}
                            alt={modelName}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-x-0 bottom-0 p-1.5 bg-black/75 backdrop-blur-xs text-[10px] font-mono text-zinc-300 flex justify-between">
                            <span>{test.width}×{test.height}</span>
                            <span>{test.mimeType}</span>
                          </div>
                        </>
                      )}

                      {status === 'error' && (
                        <div className="p-3 text-center text-rose-400 text-xs overflow-y-auto max-h-full">
                          <span className="material-symbols-outlined text-[20px] mb-1">warning</span>
                          <p className="font-mono text-[10px] break-words text-rose-300/90 leading-tight">
                            {test?.errorMessage || 'Lỗi không xác định'}
                          </p>
                        </div>
                      )}

                      {status === 'idle' && (
                        <span className="text-xs text-zinc-600 font-mono">Chưa kiểm tra</span>
                      )}
                    </div>

                    <div className="p-2.5 bg-[#141417] flex justify-end">
                      <button
                        type="button"
                        onClick={() => runModelTestA(modelName)}
                        disabled={status === 'running'}
                        className="text-[11px] px-2 py-1 rounded bg-[#1c1c22] hover:bg-[#25252e] text-zinc-300 border border-[#2b2b34] font-medium flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                        <span>Thử riêng</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB B: MÃ HOÁ MP4 */}
        {activeTab === 'B' && (
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="p-4 rounded-lg bg-[#141417] border border-[#26262b] space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Kiểm tra WebCodecs Hardware H.264 & mp4-muxer
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Dựng 3 giây (72 khung hình, 24fps) với hiệu ứng slow-zoom 1.0 → 1.15 từ ảnh thành công của Phép thử A.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => runVideoTestB()}
                  disabled={state.videoTest.status === 'running'}
                  className="px-3.5 py-1.5 bg-[#f5b301] text-black font-semibold text-xs rounded-lg hover:bg-[#ffbe1a] transition-all flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">movie_edit</span>
                  <span>Chạy Phép thử B</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#26262b]">
                <div className="p-2.5 rounded bg-[#18181f] border border-[#26262b]">
                  <div className="text-[10px] text-zinc-500 font-mono">VideoEncoder API</div>
                  <div className="text-xs font-semibold mt-0.5">
                    {typeof window !== 'undefined' && 'VideoEncoder' in window ? (
                      <span className="text-emerald-400">✓ Có hỗ trợ</span>
                    ) : (
                      <span className="text-rose-400">✕ Không có</span>
                    )}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-[#18181f] border border-[#26262b]">
                  <div className="text-[10px] text-zinc-500 font-mono">H.264 720p (avc1.42001f)</div>
                  <div className="text-xs font-semibold mt-0.5">
                    {state.videoTest.supportDetails?.h264_720p ? (
                      <span className="text-emerald-400">✓ Sẵn sàng</span>
                    ) : (
                      <span className="text-zinc-400">— Chưa test / Không</span>
                    )}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-[#18181f] border border-[#26262b]">
                  <div className="text-[10px] text-zinc-500 font-mono">H.264 1080p (avc1.640028)</div>
                  <div className="text-xs font-semibold mt-0.5">
                    {state.videoTest.supportDetails?.h264_1080p ? (
                      <span className="text-emerald-400">✓ Sẵn sàng</span>
                    ) : (
                      <span className="text-zinc-400">— Chưa test / Không</span>
                    )}
                  </div>
                </div>

                <div className="p-2.5 rounded bg-[#18181f] border border-[#26262b]">
                  <div className="text-[10px] text-zinc-500 font-mono">Fallback MediaRecorder</div>
                  <div className="text-xs font-semibold mt-0.5">
                    {state.videoTest.supportDetails?.mediaRecorderVp9 ? (
                      <span className="text-emerald-400">✓ VP9 WebM</span>
                    ) : (
                      <span className="text-zinc-400">Chuẩn WebM</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {state.videoTest.status === 'running' && (
              <div className="p-8 rounded-lg bg-[#141417] border border-[#26262b] flex flex-col items-center justify-center gap-3">
                <span className="w-8 h-8 border-3 border-[#f5b301] border-t-transparent rounded-full animate-spin" />
                <div className="text-xs font-mono text-zinc-300">
                  Đang vẽ 72 frame và mã hoá H.264 qua WebCodecs...
                </div>
              </div>
            )}

            {state.videoTest.status === 'error' && (
              <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-1">
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  <span>Lỗi trong quá trình dựng video:</span>
                </div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap bg-black/40 p-2 rounded">
                  {state.videoTest.errorMessage}
                </pre>
              </div>
            )}

            {state.videoTest.status === 'success' && state.videoTest.videoUrl && (
              <div className="p-4 rounded-lg bg-[#141417] border border-[#26262b] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#26262b] pb-3">
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">verified</span>
                      Đã dựng video thành công ({state.videoTest.durationMs}ms)
                    </span>
                    <span className="text-[11px] font-mono text-zinc-400">
                      Engine: {state.videoTest.encoderUsed} • Định dạng: {state.videoTest.mimeType}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadVideo}
                      className="px-3 py-1.5 bg-[#1f1f26] hover:bg-[#282832] text-zinc-200 border border-[#33333d] rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      <span>Tải {state.videoTest.mimeType === 'video/mp4' ? 'MP4' : 'WebM'} thử</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleUploadToFlow}
                      className="px-3 py-1.5 bg-[#f5b301]/10 hover:bg-[#f5b301]/20 text-[#f5b301] border border-[#f5b301]/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">cloud_upload</span>
                      <span>Lưu vào thư viện Flow</span>
                    </button>
                  </div>
                </div>

                <div className="relative aspect-video max-w-2xl mx-auto rounded-lg overflow-hidden bg-black border border-[#26262b] shadow-xl">
                  <video
                    src={state.videoTest.videoUrl}
                    controls
                    autoPlay
                    loop
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB C: TÁCH LỚP PARALLAX */}
        {activeTab === 'C' && (
          <div className="max-w-5xl mx-auto space-y-4">
            <div className="p-4 rounded-lg bg-[#141417] border border-[#26262b] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">
                  Tách lớp Parallax (Nền inpaint + Chủ thể phông xanh #00FF00)
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Dùng Flow.generate.image với referenceImageMediaIds sinh 2 biến thể: lớp nền không chủ thể & chủ thể nền xanh #00FF00, rồi tách chroma key.
                </p>
              </div>

              <button
                type="button"
                onClick={() => runParallaxTestC()}
                disabled={state.parallaxTest.status === 'running'}
                className="px-3.5 py-1.5 bg-[#f5b301] text-black font-semibold text-xs rounded-lg hover:bg-[#ffbe1a] transition-all flex items-center gap-1.5 self-start sm:self-auto"
              >
                <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
                <span>Chạy Phép thử C</span>
              </button>
            </div>

            {state.parallaxTest.status === 'running' && (
              <div className="p-8 rounded-lg bg-[#141417] border border-[#26262b] flex flex-col items-center justify-center gap-2">
                <span className="w-8 h-8 border-3 border-[#f5b301] border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-mono text-zinc-300">
                  Đang sinh lớp nền, lớp chủ thể phông xanh và tách alpha chroma key...
                </span>
              </div>
            )}

            {state.parallaxTest.status === 'error' && (
              <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-1">
                <div className="font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  Lỗi tách lớp Parallax:
                </div>
                <div className="font-mono">{state.parallaxTest.errorMessage}</div>
              </div>
            )}

            {state.parallaxTest.status === 'success' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-[#141417] border border-[#26262b] overflow-hidden flex flex-col">
                    <div className="p-2 bg-[#18181f] text-[11px] font-semibold text-zinc-300 flex items-center justify-between">
                      <span>1. Ảnh gốc</span>
                      <span className="font-mono text-zinc-500 text-[10px]">Reference</span>
                    </div>
                    <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
                      {firstSuccessImg && (
                        <img
                          src={`data:${firstSuccessImg.mimeType};base64,${firstSuccessImg.base64}`}
                          alt="Gốc"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#141417] border border-[#26262b] overflow-hidden flex flex-col">
                    <div className="p-2 bg-[#18181f] text-[11px] font-semibold text-zinc-300 flex items-center justify-between">
                      <span>2. Lớp nền (Inpaint)</span>
                      <span className="font-mono text-zinc-500 text-[10px]">No subject</span>
                    </div>
                    <div className="aspect-video bg-black flex items-center justify-center overflow-hidden">
                      {state.parallaxTest.bgBase64 && (
                        <img
                          src={`data:image/jpeg;base64,${state.parallaxTest.bgBase64}`}
                          alt="Nền"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#141417] border border-[#26262b] overflow-hidden flex flex-col">
                    <div className="p-2 bg-[#18181f] text-[11px] font-semibold text-zinc-300 flex items-center justify-between">
                      <span>3. Chủ thể tách nền</span>
                      <span className="font-mono text-emerald-400 text-[10px]">Chroma key</span>
                    </div>
                    <div
                      className="aspect-video relative overflow-hidden flex items-center justify-center"
                      style={{
                        backgroundImage: `linear-gradient(45deg, #1c1c22 25%, transparent 25%), linear-gradient(-45deg, #1c1c22 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1c1c22 75%), linear-gradient(-45deg, transparent 75%, #1c1c22 75%)`,
                        backgroundSize: '16px 16px',
                        backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                        backgroundColor: '#121216',
                      }}
                    >
                      {state.parallaxTest.subjectCutoutDataUrl ? (
                        <img
                          src={state.parallaxTest.subjectCutoutDataUrl}
                          alt="Chủ thể"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="text-zinc-600 text-xs">Chưa có ảnh</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#141417] border border-[#26262b] overflow-hidden flex flex-col">
                    <div className="p-2 bg-[#18181f] text-[11px] font-semibold text-zinc-300 flex items-center justify-between">
                      <span>4. Bản ghép tĩnh</span>
                      <span className="font-mono text-zinc-500 text-[10px]">Composite</span>
                    </div>
                    <div className="aspect-video relative bg-black flex items-center justify-center overflow-hidden">
                      {state.parallaxTest.bgBase64 && (
                        <img
                          src={`data:image/jpeg;base64,${state.parallaxTest.bgBase64}`}
                          alt="Nền"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                      {state.parallaxTest.subjectCutoutDataUrl && (
                        <img
                          src={state.parallaxTest.subjectCutoutDataUrl}
                          alt="Chủ thể"
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-[#141417] border border-[#26262b] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-zinc-200">
                        Kiểm tra độ dịch chuyển & xem Parallax động 3s
                      </div>
                      <div className="text-[11px] font-mono text-zinc-400">
                        Độ lệch vị trí ước tính: ΔX ={' '}
                        <span className="text-[#f5b301]">{state.parallaxTest.offsetPx?.dx ?? 0}px</span>, ΔY ={' '}
                        <span className="text-[#f5b301]">{state.parallaxTest.offsetPx?.dy ?? 0}px</span> (Tổng cộng:{' '}
                        <span className="text-emerald-400">{state.parallaxTest.offsetPx?.total ?? 0}px</span>)
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={startParallaxAnimation}
                      disabled={isParallaxPlaying || !state.parallaxTest.subjectCutoutDataUrl}
                      className="px-3.5 py-1.5 bg-[#f5b301] text-black font-semibold text-xs rounded-lg hover:bg-[#ffbe1a] transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {isParallaxPlaying ? 'motion_photos_on' : 'play_circle'}
                      </span>
                      <span>{isParallaxPlaying ? 'Đang chạy parallax...' : 'Xem parallax thử (3s)'}</span>
                    </button>
                  </div>

                  <div className="max-w-2xl mx-auto rounded-lg overflow-hidden border border-[#26262b] aspect-video bg-black relative">
                    <canvas
                      ref={parallaxCanvasRef}
                      width={1280}
                      height={720}
                      className="w-full h-full object-contain"
                    />
                    {!isParallaxPlaying && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none text-xs text-zinc-300">
                        Nhấn nút "Xem parallax thử" để kích hoạt chuyển động
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB D: AI SOI ẢNH */}
        {activeTab === 'D' && (
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="p-4 rounded-lg bg-[#141417] border border-[#26262b] flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">
                  AI Soi Ảnh (Gemini Multimodal via Flow.generate.text)
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Gửi ảnh thu nhỏ (JPEG 768px) đến Gemini để chấm điểm độ chuẩn prompt, phát hiện lỗi dị dạng hoặc chữ rác.
                </p>
              </div>

              <button
                type="button"
                onClick={() => runAiVisionTestD()}
                disabled={state.aiVisionTest.status === 'running'}
                className="px-3.5 py-1.5 bg-[#f5b301] text-black font-semibold text-xs rounded-lg hover:bg-[#ffbe1a] transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">psychology</span>
                <span>Chạy Phép thử D</span>
              </button>
            </div>

            {state.aiVisionTest.status === 'running' && (
              <div className="p-8 rounded-lg bg-[#141417] border border-[#26262b] flex flex-col items-center justify-center gap-2">
                <span className="w-8 h-8 border-3 border-[#f5b301] border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-mono text-zinc-300">
                  AI đang phân tích bố cục, nhân vật và phong cách cel-shading...
                </span>
              </div>
            )}

            {state.aiVisionTest.status === 'error' && (
              <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-1">
                <div className="font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  Lỗi gọi AI Vision:
                </div>
                <div className="font-mono">{state.aiVisionTest.errorMessage}</div>
              </div>
            )}

            {state.aiVisionTest.status === 'success' && state.aiVisionTest.parsedJson && (
              <div className="p-4 rounded-lg bg-[#141417] border border-[#26262b] space-y-4">
                <div className="flex items-center justify-between border-b border-[#26262b] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-200">Kết quả đánh giá AI:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase ${
                        state.aiVisionTest.parsedJson.verdict === 'ok'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      Verdict: {state.aiVisionTest.parsedJson.verdict}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-500">
                    {state.aiVisionTest.durationMs}ms
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded bg-[#18181f] border border-[#26262b]">
                    <div className="text-[11px] text-zinc-500 font-mono">Độ chuẩn Prompt</div>
                    <div className="text-xl font-bold font-mono text-[#f5b301] mt-1">
                      {state.aiVisionTest.parsedJson.matchesPrompt}%
                    </div>
                  </div>

                  <div className="p-3 rounded bg-[#18181f] border border-[#26262b]">
                    <div className="text-[11px] text-zinc-500 font-mono">Chữ trong ảnh (hasText)</div>
                    <div className="text-base font-semibold mt-1">
                      {state.aiVisionTest.parsedJson.hasText ? (
                        <span className="text-rose-400">Có phát hiện chữ</span>
                      ) : (
                        <span className="text-emerald-400">Không có chữ (Sạch)</span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 rounded bg-[#18181f] border border-[#26262b] col-span-2 sm:col-span-1">
                    <div className="text-[11px] text-zinc-500 font-mono">Lỗi phát hiện (Artifacts)</div>
                    <div className="text-xs text-zinc-300 mt-1">
                      {state.aiVisionTest.parsedJson.artifacts?.length ? (
                        <span className="text-amber-400">
                          {state.aiVisionTest.parsedJson.artifacts.join(', ')}
                        </span>
                      ) : (
                        <span className="text-emerald-400">Không có dị tật</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded bg-[#18181f] border border-[#26262b] space-y-1">
                  <div className="text-[11px] font-mono text-zinc-400">Ghi chú phân tích chi tiết:</div>
                  <p className="text-xs text-zinc-200 leading-relaxed">
                    {state.aiVisionTest.parsedJson.note}
                  </p>
                </div>

                <details className="text-[11px] font-mono text-zinc-500 cursor-pointer">
                  <summary className="hover:text-zinc-400">Xem Raw JSON phản hồi</summary>
                  <pre className="p-2 mt-2 bg-black/60 rounded text-zinc-400 overflow-x-auto">
                    {JSON.stringify(state.aiVisionTest.parsedJson, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
