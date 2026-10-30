import { hammingDistance } from './imageScore';

export type AutoPickStrategy = 'coverage' | 'top' | 'balanced' | 'ai';

export interface AutoPickOptions {
  scenes: Array<{ id: string; [key: string]: any }>;
  scores: Map<string, number>;        // sceneId -> combined final score 0..100
  hashes: Map<string, string>;        // sceneId -> 64-bit dHash hex
  count: number;                      // K mục tiêu
  strategy: AutoPickStrategy;         // 'coverage' | 'top' | 'balanced' | 'ai'
  keepFirstLast?: boolean;            // Luôn gồm ảnh đầu và ảnh cuối
  dedupeThreshold?: number;           // Mặc định 6: nếu Hamming distance <= 6 coi là gần giống nhau
}

export interface AutoPickResult {
  selectedSceneIds: string[];         // Danh sách sceneId theo đúng thứ tự xuất hiện ban đầu
  variantsPerScene: Record<string, number>; // Số video phân bổ cho mỗi scene (nếu K > N)
  isReducedByBudget?: boolean;
}

/**
 * Kiểm tra xem sceneId có gần giống với bất kỳ ảnh nào đã được chọn không (theo dHash & dedupeThreshold)
 */
function isDuplicateOfSelected(
  candidateId: string,
  selectedIds: Set<string>,
  hashes: Map<string, string>,
  threshold: number
): boolean {
  if (threshold <= 0) return false;
  const candHash = hashes.get(candidateId);
  if (!candHash) return false;

  for (const selId of selectedIds) {
    const selHash = hashes.get(selId);
    if (selHash) {
      const dist = hammingDistance(candHash, selHash);
      if (dist <= threshold) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Hàm chính lựa chọn ảnh theo chất lượng và phân bổ cốt truyện:
 * Trả về danh sách sceneId theo thứ tự tự nhiên của kịch bản kèm số video cho mỗi ảnh.
 */
export function pickScenes(options: AutoPickOptions): AutoPickResult {
  const {
    scenes,
    scores,
    hashes,
    count,
    strategy = 'balanced',
    keepFirstLast = false,
    dedupeThreshold = 6,
  } = options;

  const N = scenes.length;
  if (N === 0 || count <= 0) {
    return {
      selectedSceneIds: [],
      variantsPerScene: {},
    };
  }

  // TRƯỜNG HỢP 1: K >= N -> Toàn bộ N ảnh đều được chọn.
  // Phân bổ biến thể (số video): mỗi ảnh nhận floor(K / N), phần dư ưu tiên ảnh có điểm cao nhất.
  if (count >= N) {
    const baseVariants = Math.floor(count / N);
    let remainder = count % N;

    // Sắp xếp các scene theo điểm số giảm dần để ưu tiên phân bổ phần dư
    const scenesSortedByScore = [...scenes].sort((a, b) => {
      const sA = scores.get(a.id) || 50;
      const sB = scores.get(b.id) || 50;
      return sB - sA;
    });

    const bonusSceneIds = new Set<string>();
    for (let i = 0; i < remainder; i++) {
      bonusSceneIds.add(scenesSortedByScore[i].id);
    }

    const variantsMap: Record<string, number> = {};
    scenes.forEach(s => {
      variantsMap[s.id] = baseVariants + (bonusSceneIds.has(s.id) ? 1 : 0);
    });

    return {
      selectedSceneIds: scenes.map(s => s.id),
      variantsPerScene: variantsMap,
    };
  }

  // TRƯỜNG HỢP 2: K < N -> Cần chọn đúng K ảnh phù hợp nhất
  const K = Math.min(count, N);
  const selectedSet = new Set<string>();

  // Xử lý keepFirstLast nếu được bật
  let neededK = K;
  if (keepFirstLast && N >= 2) {
    selectedSet.add(scenes[0].id);
    if (K > 1) {
      selectedSet.add(scenes[N - 1].id);
    }
    neededK = Math.max(0, K - selectedSet.size);
  } else if (keepFirstLast && N === 1) {
    selectedSet.add(scenes[0].id);
    return {
      selectedSceneIds: [scenes[0].id],
      variantsPerScene: { [scenes[0].id]: K },
    };
  }

  // Lấy danh sách ứng viên (nếu keepFirstLast thì loại ảnh đầu và cuối ra khỏi nhóm cần chọn tiếp)
  const candidateIndices: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!selectedSet.has(scenes[i].id)) {
      candidateIndices.push(i);
    }
  }

  if (neededK > 0 && candidateIndices.length > 0) {
    if (strategy === 'coverage') {
      // CHIẾN LƯỢC 1: Phủ đều cốt truyện
      const segSize = candidateIndices.length / neededK;

      for (let s = 0; s < neededK; s++) {
        const startIdx = Math.floor(s * segSize);
        const endIdx = Math.floor((s + 1) * segSize);
        const segmentIndices = candidateIndices.slice(startIdx, Math.max(startIdx + 1, endIdx));

        const sortedSegment = [...segmentIndices].sort((a, b) => {
          const sA = scores.get(scenes[a].id) || 50;
          const sB = scores.get(scenes[b].id) || 50;
          return sB - sA;
        });

        let pickedIndex = -1;
        for (const idx of sortedSegment) {
          const id = scenes[idx].id;
          if (!isDuplicateOfSelected(id, selectedSet, hashes, dedupeThreshold)) {
            pickedIndex = idx;
            break;
          }
        }

        if (pickedIndex === -1 && sortedSegment.length > 0) {
          pickedIndex = sortedSegment[0];
        }

        if (pickedIndex !== -1) {
          selectedSet.add(scenes[pickedIndex].id);
        }
      }

    } else if (strategy === 'top') {
      // CHIẾN LƯỢC 2: Điểm cao nhất
      const minSpacing = Math.max(1, Math.floor(N / (2 * K)));

      const sortedCandidates = [...candidateIndices].sort((a, b) => {
        const sA = scores.get(scenes[a].id) || 50;
        const sB = scores.get(scenes[b].id) || 50;
        return sB - sA;
      });

      const chosenIndices: number[] = [];
      scenes.forEach((s, idx) => {
        if (selectedSet.has(s.id)) chosenIndices.push(idx);
      });

      for (const idx of sortedCandidates) {
        if (selectedSet.size >= K) break;
        const id = scenes[idx].id;

        const violatesSpacing = chosenIndices.some(ci => Math.abs(ci - idx) < minSpacing);
        if (violatesSpacing) continue;

        if (isDuplicateOfSelected(id, selectedSet, hashes, dedupeThreshold)) continue;

        selectedSet.add(id);
        chosenIndices.push(idx);
      }

      if (selectedSet.size < K) {
        for (const idx of sortedCandidates) {
          if (selectedSet.size >= K) break;
          const id = scenes[idx].id;
          if (selectedSet.has(id)) continue;
          if (isDuplicateOfSelected(id, selectedSet, hashes, dedupeThreshold)) continue;
          selectedSet.add(id);
        }
      }

      if (selectedSet.size < K) {
        for (const idx of sortedCandidates) {
          if (selectedSet.size >= K) break;
          const id = scenes[idx].id;
          if (!selectedSet.has(id)) {
            selectedSet.add(id);
          }
        }
      }

    } else if (strategy === 'ai') {
      // CHIẾN LƯỢC: AI chọn (đa dạng + dễ chuyển động)
      // Tối ưu hóa đa dạng theo timeline và điểm kết hợp AI (tiềm năng chuyển động + chất lượng)
      const segCount = Math.min(neededK, candidateIndices.length);
      const segSize = candidateIndices.length / segCount;

      for (let s = 0; s < segCount; s++) {
        if (selectedSet.size >= K) break;
        const startIdx = Math.floor(s * segSize);
        const endIdx = Math.floor((s + 1) * segSize);
        const segmentIndices = candidateIndices.slice(startIdx, Math.max(startIdx + 1, endIdx));

        const sortedSegment = [...segmentIndices].sort((a, b) => {
          const sA = scores.get(scenes[a].id) || 50;
          const sB = scores.get(scenes[b].id) || 50;
          return sB - sA;
        });

        let pickedIndex = -1;
        for (const idx of sortedSegment) {
          const id = scenes[idx].id;
          if (!selectedSet.has(id) && !isDuplicateOfSelected(id, selectedSet, hashes, dedupeThreshold)) {
            pickedIndex = idx;
            break;
          }
        }

        if (pickedIndex === -1 && sortedSegment.length > 0) {
          pickedIndex = sortedSegment.find(idx => !selectedSet.has(scenes[idx].id)) ?? sortedSegment[0];
        }

        if (pickedIndex !== -1) {
          selectedSet.add(scenes[pickedIndex].id);
        }
      }

      // Nếu còn thiếu thì bổ sung các ảnh điểm cao nhất còn lại
      if (selectedSet.size < K) {
        const remaining = candidateIndices
          .filter(idx => !selectedSet.has(scenes[idx].id))
          .sort((a, b) => (scores.get(scenes[b].id) || 0) - (scores.get(scenes[a].id) || 0));

        for (const idx of remaining) {
          if (selectedSet.size >= K) break;
          const id = scenes[idx].id;
          if (!isDuplicateOfSelected(id, selectedSet, hashes, dedupeThreshold)) {
            selectedSet.add(id);
          }
        }

        if (selectedSet.size < K) {
          for (const idx of remaining) {
            if (selectedSet.size >= K) break;
            selectedSet.add(scenes[idx].id);
          }
        }
      }

    } else {
      // CHIẾN LƯỢC 3: Cân bằng (mặc định)
      const halfCoverage = Math.ceil(neededK / 2);
      const halfTop = neededK - halfCoverage;

      const segSize = candidateIndices.length / halfCoverage;
      for (let s = 0; s < halfCoverage; s++) {
        const startIdx = Math.floor(s * segSize);
        const endIdx = Math.floor((s + 1) * segSize);
        const segmentIndices = candidateIndices.slice(startIdx, Math.max(startIdx + 1, endIdx));

        const sortedSegment = [...segmentIndices].sort((a, b) => {
          const sA = scores.get(scenes[a].id) || 50;
          const sB = scores.get(scenes[b].id) || 50;
          return sB - sA;
        });

        let pickedIndex = -1;
        for (const idx of sortedSegment) {
          const id = scenes[idx].id;
          if (!isDuplicateOfSelected(id, selectedSet, hashes, dedupeThreshold)) {
            pickedIndex = idx;
            break;
          }
        }
        if (pickedIndex === -1 && sortedSegment.length > 0) {
          pickedIndex = sortedSegment[0];
        }
        if (pickedIndex !== -1) {
          selectedSet.add(scenes[pickedIndex].id);
        }
      }

      if (halfTop > 0) {
        const remainingCandidates = candidateIndices
          .filter(idx => !selectedSet.has(scenes[idx].id))
          .sort((a, b) => {
            const sA = scores.get(scenes[a].id) || 50;
            const sB = scores.get(scenes[b].id) || 50;
            return sB - sA;
          });

        for (const idx of remainingCandidates) {
          if (selectedSet.size >= K) break;
          const id = scenes[idx].id;
          if (isDuplicateOfSelected(id, selectedSet, hashes, dedupeThreshold)) continue;
          selectedSet.add(id);
        }

        if (selectedSet.size < K) {
          for (const idx of remainingCandidates) {
            if (selectedSet.size >= K) break;
            const id = scenes[idx].id;
            selectedSet.add(id);
          }
        }
      }
    }
  }

  // Sắp xếp lại danh sách kết quả theo đúng thứ tự xuất hiện ban đầu trong scenes
  const finalOrderedIds = scenes
    .filter(s => selectedSet.has(s.id))
    .map(s => s.id);

  const variantsMap: Record<string, number> = {};
  finalOrderedIds.forEach(id => {
    variantsMap[id] = 1;
  });

  return {
    selectedSceneIds: finalOrderedIds,
    variantsPerScene: variantsMap,
  };
}
