import { Flow } from 'flow-sdk';
import { Scene, VeoModelUI } from '../types';
import { VEO_MODEL_COSTS, MODEL_OPTIONS } from '../constants';

export const calculateTotalCredits = (scenes: Scene[]): number => {
  return scenes.reduce((acc, scene) => {
    if (scene.status === 'skipped') return acc;
    return acc + (VEO_MODEL_COSTS[scene.selectedModel] || 0);
  }, 0);
};

export const optimizeAllocationWithAI = async (
  scenes: Scene[], 
  limit: number
): Promise<Record<string, VeoModelUI>> => {
  const activeScenes = scenes.filter(s => s.status !== 'skipped');
  if (activeScenes.length === 0) return {};

  const indexToIdMap: Record<number, string> = {};
  const sceneDataForAI = activeScenes.map((s, index) => {
    indexToIdMap[index] = s.id;
    return {
      idx: index,
      type: s.complexityTag,
      score: s.complexityScore
    };
  });

  const validModelsList = MODEL_OPTIONS.join(', ');

  const systemInstruction = `
    Bạn là một trợ lý tối ưu hóa ngân sách sản xuất video.
    Gán model AI cho từng mục sao cho tổng credits <= ${limit}.
    BẢNG GIÁ: Lite [Lower Priority]: 0, Lite: 10, Fast: 20, Omni Flash: 30, Quality: 200.
    ƯU TIÊN: Combat > Complex > Medium > Simple. 
    Trả về duy nhất JSON format: {"0": "Model Name", "1": "Model Name", ...}
  `;

  try {
    const { text } = await Flow.generate.text(
      `Phân bổ ngân sách ${limit} cho: ${JSON.stringify(sceneDataForAI)}`,
      { systemInstruction, thinkingLevel: 'high' }
    );

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Không nhận được JSON từ AI.');

    const allocationIdx: Record<string, string> = JSON.parse(jsonMatch[0]);
    const finalAllocation: Record<string, VeoModelUI> = {};

    Object.entries(allocationIdx).forEach(([idx, modelName]) => {
      const realId = indexToIdMap[parseInt(idx)];
      if (realId && MODEL_OPTIONS.includes(modelName as VeoModelUI)) {
        finalAllocation[realId] = modelName as VeoModelUI;
      }
    });

    return finalAllocation;
  } catch (e: any) {
    throw new Error(e.message?.includes('UNSAFE') 
      ? 'Yêu cầu tối ưu bị chặn. Vui lòng tự gán model thủ công.' 
      : `Lỗi: ${e.message}`);
  }
};