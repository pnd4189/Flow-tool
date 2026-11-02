import { CharacterConfig, FaceSource } from '../types';

export function faceSourcePatch(source: FaceSource): Partial<CharacterConfig> {
  if (source === 'upload') {
    return {
      hairStyle: 'auto',
      hairColor: '',
      expression: 'original',
      accessories: [],
      distinctiveFeatures: '',
    };
  }
  return {};
}
