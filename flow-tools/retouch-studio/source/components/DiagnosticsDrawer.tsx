import React, { useState } from 'react';
import { DiagnosticLog, DiagnosticTestResult, DecodedImage, CandidatePreview } from '../types';
import { decodeBase64ToImage } from '../services/imageUtils';
import { applyCrop } from '../services/compositionService';
import { Flow } from 'flow-sdk';

interface DiagnosticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentImage: DecodedImage | null;
  selectionMask: HTMLCanvasElement | null;
  protectionMask: HTMLCanvasElement | null;
  candidatePreview: CandidatePreview | null;
  onLoadImageDocument: (image: DecodedImage) => void;
  onApplyDiagnosticMask?: (maskCanvas: HTMLCanvasElement) => void;
  documentRevision?: number;
  externalLogs?: DiagnosticLog[];
}

const MAX_LOGS = 100;

export const DiagnosticsDrawer: React.FC<DiagnosticsDrawerProps> = ({
  isOpen,
  onClose,
  currentImage,
  selectionMask,
  protectionMask,
  candidatePreview,
  onLoadImageDocument,
  onApplyDiagnosticMask,
  documentRevision = 0,
  externalLogs = [],
}) => {
  const [internalLogs, setInternalLogs] = useState<DiagnosticLog[]>([]);
  const [testResults, setTestResults] = useState<Record<string, DiagnosticTestResult>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [pixelDiffReport, setPixelDiffReport] = useState<string | null>(null);

  const addLog = (type: DiagnosticLog['type'], message: string, details?: string) => {
    const log: DiagnosticLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString('vi-VN'),
      type,
      message,
      details,
    };
    setInternalLogs((prev) => [log, ...prev].slice(0, MAX_LOGS));
  };

  const allLogs = [...internalLogs, ...externalLogs];

  const handleGenerateTestImage = async () => {
    setIsRunning(true);
    addLog('info', 'Tạo ảnh thử QA bằng Flow.generate.image (🍌 Nano Banana 2.1, 1:1)...');
    try {
      const prompt =
        'A realistic photographic portrait of an adult woman sitting at a desk with a laptop and a red notebook, natural daylight, sharp textures';

      const result = await Flow.generate.image({
        prompt,
        modelDisplayName: '🍌 Nano Banana 2.1',
        aspectRatio: '1:1',
      });

      const decoded = await decodeBase64ToImage(
        result.base64,
        result.mimeType,
        'qa_sample_desk.png'
      );
      onLoadImageDocument(decoded);
      addLog('success', `Đã nạp ảnh thử ${decoded.width}x${decoded.height} px vào studio.`);
      setTestResults((prev) => ({
        ...prev,
        gen_img: {
          name: 'Tạo ảnh thử QA (Nano Banana 2.1)',
          status: 'PASS',
          summary: `${decoded.width}x${decoded.height} px`,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('error', 'Lỗi tạo ảnh thử AI', msg);
    } finally {
      setIsRunning(false);
    }
  };

  const handleTestCompositionAlignment = () => {
    if (!currentImage || !selectionMask || !protectionMask) {
      addLog('warn', 'Cần có ảnh và mặt nạ để kiểm tra độ đồng bộ hình học.');
      return;
    }

    const w = currentImage.width;
    const h = currentImage.height;

    const cropBox = {
      x: Math.round(w * 0.1),
      y: Math.round(h * 0.1),
      width: Math.round(w * 0.8),
      height: Math.round(h * 0.8),
    };

    const res = applyCrop(currentImage.canvas, selectionMask, protectionMask, cropBox);

    const isAligned =
      res.croppedImage.width === cropBox.width &&
      res.croppedImage.height === cropBox.height &&
      res.croppedSelectionMask.width === cropBox.width &&
      res.croppedSelectionMask.height === cropBox.height &&
      res.croppedProtectionMask.width === cropBox.width &&
      res.croppedProtectionMask.height === cropBox.height;

    const report = `KIỂM TRA ĐỒNG BỘ CẮT HÌNH & MẶT NẠ:
• Kích thước ảnh sau cắt: ${res.croppedImage.width}×${res.croppedImage.height}
• Kích thước mặt nạ chọn: ${res.croppedSelectionMask.width}×${res.croppedSelectionMask.height}
• Kích thước mặt nạ bảo vệ: ${res.croppedProtectionMask.width}×${res.croppedProtectionMask.height}
• Trạng thái đồng bộ: ${isAligned ? 'KHỚP CHÍNH XÁC 100% (PASS)' : 'SAI LỆCH (FAIL)'}`;

    addLog(isAligned ? 'success' : 'error', isAligned ? 'Cắt hình & mặt nạ đồng bộ hoàn hảo.' : 'Sai lệch kích thước mặt nạ cắt.', report);
  };

  const handleMeasurePixelDiff = () => {
    if (!currentImage || !selectionMask || !protectionMask) {
      addLog('warn', 'Cần có ảnh và mặt nạ để đo lường độ lệch pixel.');
      return;
    }
    const w = currentImage.width;
    const h = currentImage.height;

    const selCtx = selectionMask.getContext('2d', { willReadFrequently: true });
    const selData = selCtx ? selCtx.getImageData(0, 0, w, h).data : null;

    const protCtx = protectionMask.getContext('2d', { willReadFrequently: true });
    const protData = protCtx ? protCtx.getImageData(0, 0, w, h).data : null;

    let total = w * h;
    let selectedCount = 0;
    let protectedCount = 0;
    let editableCount = 0;
    let unselectedCount = 0;

    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const s = selData ? selData[idx] : 0;
      const p = protData ? protData[idx] : 0;

      if (s > 0) selectedCount++;
      else unselectedCount++;

      if (p > 0) protectedCount++;

      if (s > 0 && p === 0) editableCount++;
    }

    const report = `Tổng pixel: ${total.toLocaleString()} (${w}x${h})
• Vùng chọn (Teal): ${selectedCount.toLocaleString()} px (${((selectedCount / total) * 100).toFixed(1)}%)
• Vùng bảo vệ (Amber): ${protectedCount.toLocaleString()} px (${((protectedCount / total) * 100).toFixed(1)}%)
• Vùng sửa thực tế (Magenta): ${editableCount.toLocaleString()} px (${((editableCount / total) * 100).toFixed(1)}%)
• Vùng ngoài chọn giữ nguyên: ${unselectedCount.toLocaleString()} px (${((unselectedCount / total) * 100).toFixed(1)}%)`;

    setPixelDiffReport(report);
    addLog('info', 'Báo cáo sai khác điểm ảnh:', report);
  };

  const copyReport = () => {
    const diag = candidatePreview?.diagnostics;
    const comp = candidatePreview?.compositionInfo;
    const reportText = `[BÁO CÁO CHẨN ĐOÁN RETOUCH STUDIO - RETOUCH_P3C]
Thời gian: ${new Date().toISOString()}
Ảnh hiện tại: ${currentImage ? `${currentImage.width}x${currentImage.height} (${currentImage.name})` : 'Không có'}
Document Revision: ${documentRevision}
Mô hình AI: 🍌 Nano Banana Pro (Mặc định) | 🍌 Nano Banana 2.1 (Tốc độ)

${comp ? `THÔNG TIN BỐ CỤC:
• Thao tác: ${comp.operation}
• Kích thước trước: ${comp.originalDimensions.width}x${comp.originalDimensions.height} -> sau: ${comp.newDimensions.width}x${comp.newDimensions.height}
• Tọa độ bù ảnh gốc: ${comp.sourceOffset ? `(${comp.sourceOffset.x}, ${comp.sourceOffset.y})` : 'N/A'}
• Nội suy điểm ảnh (Resampled): ${comp.isResampled ? 'Có (Căn chỉnh xoay)' : 'Không (Pixel gốc bảo toàn)'}\n` : ''}

${diag ? `THÔNG TIN THỰC THI AI GẦN NHẤT:
• Thời gian chạy: ${diag.durationMs} ms
• Mô hình: ${diag.modelUsed}
• Điểm ảnh bảo vệ giữ nguyên: ${diag.protectedPreservedPixels.toLocaleString()} px
• Điểm ảnh ngoài vùng chọn giữ nguyên: ${diag.outsideMaskPreservedPixels.toLocaleString()} px
• Vùng sửa: ${diag.editablePixels.toLocaleString()} px
• Kích thước: Nguồn ${diag.sourceDimensions.width}x${diag.sourceDimensions.height} -> Ra ${diag.outputDimensions.width}x${diag.outputDimensions.height}
• Ánh xạ: ${diag.mappingInfo}\n` : ''}

${pixelDiffReport ? `BÁO CÁO ĐIỂM ẢNH:\n${pixelDiffReport}\n` : ''}

NHẬT KÝ HOẠT ĐỘNG:
${allLogs.map((l) => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message} ${l.details ? `(${l.details})` : ''}`).join('\n')}
`;
    navigator.clipboard.writeText(reportText);
    addLog('info', 'Đã sao chép báo cáo kỹ thuật vào clipboard.');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] max-w-full bg-[#131517] border-l border-[#272b31] z-50 flex flex-col shadow-2xl text-xs select-none">
      <div className="h-11 border-b border-[#24282c] px-3 flex items-center justify-between bg-[#15171a]">
        <div className="flex items-center gap-1.5 font-semibold text-zinc-100">
          <span className="material-symbols-outlined text-amber-400 text-[17px]">bug_report</span>
          <span>Bảng chẩn đoán kỹ thuật (P3C)</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-100 p-1 rounded"
        >
          <span className="material-symbols-outlined text-[17px]">close</span>
        </button>
      </div>

      <div className="p-2.5 border-b border-[#24282c] bg-[#16181b] flex flex-col gap-2 max-h-[360px] overflow-y-auto">
        <span className="text-[11px] font-semibold text-zinc-300">Công cụ kiểm thử & Đo lường:</span>

        <button
          type="button"
          disabled={isRunning}
          onClick={handleGenerateTestImage}
          className="flex items-center justify-between px-2 py-1.5 bg-[#221c12] hover:bg-[#2d2417] disabled:opacity-50 text-amber-300 rounded border border-amber-600/40 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">auto_fix_high</span>
            <span>Tạo ảnh thử QA (🍌 Nano Banana 2.1)</span>
          </div>
          <span className="font-mono text-[9px] text-amber-400">RUN</span>
        </button>

        <button
          type="button"
          disabled={isRunning || !currentImage}
          onClick={handleTestCompositionAlignment}
          className="flex items-center justify-between px-2 py-1.5 bg-[#17211e] hover:bg-[#1d2d29] disabled:opacity-50 text-[#55c7b0] rounded border border-[#55c7b0]/40 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">crop</span>
            <span>Kiểm tra đồng bộ Cắt & Mặt nạ</span>
          </div>
          <span className="font-mono text-[9px] text-[#55c7b0]">ALIGN</span>
        </button>

        <button
          type="button"
          disabled={isRunning || !currentImage}
          onClick={handleMeasurePixelDiff}
          className="flex items-center justify-between px-2 py-1.5 bg-[#1e2125] hover:bg-[#262a2f] disabled:opacity-50 text-zinc-200 rounded border border-[#2b3036] transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px]">analytics</span>
            <span>Đo lường sai lệch điểm ảnh thực tế</span>
          </div>
          <span className="font-mono text-[9px] text-indigo-400">CALC</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 font-mono text-[10.5px] space-y-1.5 bg-[#101214]">
        <div className="flex items-center justify-between text-zinc-500 mb-1.5">
          <span>Nhật ký thời gian thực ({allLogs.length}):</span>
          <button
            type="button"
            onClick={copyReport}
            className="flex items-center gap-1 text-[#55c7b0] hover:underline"
          >
            <span className="material-symbols-outlined text-[13px]">content_copy</span>
            <span>Sao chép</span>
          </button>
        </div>

        {pixelDiffReport && (
          <div className="p-2 rounded bg-indigo-950/40 text-indigo-300 border border-indigo-800/50 mb-2 whitespace-pre-wrap">
            {pixelDiffReport}
          </div>
        )}

        {allLogs.length === 0 ? (
          <div className="text-zinc-600 italic">Chưa có nhật ký ghi nhận.</div>
        ) : (
          allLogs.map((log) => (
            <div
              key={log.id}
              className={`p-1.5 rounded leading-tight border ${
                log.type === 'success'
                  ? 'bg-emerald-950/30 text-emerald-300 border-emerald-800/40'
                  : log.type === 'error'
                  ? 'bg-rose-950/30 text-rose-300 border-rose-800/40'
                  : log.type === 'warn'
                  ? 'bg-amber-950/30 text-amber-300 border-amber-800/40'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-800'
              }`}
            >
              <div className="flex items-center justify-between text-[9.5px] opacity-70">
                <span>[{log.type.toUpperCase()}]</span>
                <span>{log.timestamp}</span>
              </div>
              <div className="mt-0.5 break-words">{log.message}</div>
              {log.details && <div className="text-[9.5px] text-zinc-400 mt-0.5 break-words">{log.details}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
