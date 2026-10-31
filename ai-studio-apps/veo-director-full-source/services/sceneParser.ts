import { Scene, SceneComplexity, VeoModelUI } from '../types';

export const parsePromptFile = (text: string): Scene[] => {
  const splitRegex = /(?=---.*?---|SCENE \d+|##+ |\[SCENE \d+\]|Scene \d+:)/gi;
  const sceneBlocks = text.split(splitRegex);
  
  return sceneBlocks
    .filter(block => block.trim().length > 5)
    .map((block, index) => {
      const sceneNumber = index + 1;
      
      const titleMatch = block.match(/(?:---|##+|SCENE \d+|Scene \d+|\[SCENE \d+\]):?\s*(.*)/i);
      let title = titleMatch && titleMatch[1] ? titleMatch[1].split('\n')[0].trim() : '';
      
      if (!title || /^(VIDEO|PROMPT|SCENE|SCENE \d+)$/i.test(title)) {
        title = `${title || 'Scene'} ${sceneNumber}`;
      }

      const cinematography = extractSection(block, 'Cinematography');
      const subject = extractSection(block, 'Subject');
      const action = extractSection(block, 'Action');
      const context = extractSection(block, 'Context');
      const styleAmbiance = extractSection(block, 'Style & Ambiance');
      
      const { score, tag } = calculateComplexity(block, action, subject);
      const model = recommendModel(tag);

      return {
        id: crypto.randomUUID(),
        sceneNumber,
        title,
        rawText: block.trim(),
        cinematography,
        subject,
        action,
        context,
        styleAmbiance,
        charactersDetected: detectPotentialCharacters(block),
        complexityScore: score,
        complexityTag: tag,
        recommendedModel: model,
        selectedModel: model,
        status: 'pending',
        retryCount: 0
      };
    });
};

const extractSection = (text: string, sectionName: string): string => {
  const regex = new RegExp(`${sectionName}:?\\s*([\\s\\S]*?)(?=\\n[A-Z][a-z ]+:|\\n---|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
};

const calculateComplexity = (full: string, action: string, subject: string): { score: number, tag: SceneComplexity } => {
  let score = 0;
  const simpleKeywords = ['static', 'standing', 'sits', 'quiet', 'still', 'interior', 'close up'];
  const complexKeywords = ['crowd', 'forest', 'rain', 'smoke', 'dust', 'detailed', 'landscape', 'cinematic', 'dolly'];
  const combatKeywords = ['punch', 'kick', 'sword', 'strike', 'battle', 'fight', 'clash', 'explode', 'rush', 'chase', 'weapon'];

  const lowerFull = full.toLowerCase();
  simpleKeywords.forEach(k => { if (lowerFull.includes(k)) score -= 1; });
  complexKeywords.forEach(k => { if (lowerFull.includes(k)) score += 2; });
  combatKeywords.forEach(k => { if (lowerFull.includes(k)) score += 5; });

  if (lowerFull.includes('dolly') || lowerFull.includes('pan') || lowerFull.includes('tracking')) score += 3;

  const charCount = (subject.match(/[A-Z][a-z]+/g) || []).length;
  score += charCount * 1.5;

  if (score < 2) return { score, tag: 'simple' };
  if (score < 6) return { score, tag: 'medium' };
  if (score < 12) return { score, tag: 'complex' };
  return { score, tag: 'combat' };
};

const recommendModel = (tag: SceneComplexity): VeoModelUI => {
  switch (tag) {
    case 'simple': return 'Veo 3.1 - Lite [Lower Priority]';
    case 'medium': return 'Veo 3.1 - Lite';
    case 'complex': return 'Veo 3.1 - Fast';
    case 'combat': return 'Veo 3.1 - Fast';
    default: return 'Veo 3.1 - Lite';
  }
};

const detectPotentialCharacters = (text: string): string[] => {
  const words = text.match(/[A-Z][a-z]+/g) || [];
  const commonWords = new Set(['Scene', 'Cinematography', 'Subject', 'Action', 'Context', 'Style', 'Ambiance', 'The', 'A', 'An', 'He', 'She', 'It', 'They', 'Video', 'Prompt']);
  const potential = words.filter(w => !commonWords.has(w));
  return Array.from(new Set(potential));
};