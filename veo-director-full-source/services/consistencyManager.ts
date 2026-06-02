import { Scene, CharacterProfile, ProjectSettings } from '../types';

export const createDefaultCharacter = (name: string): CharacterProfile => ({
  id: crypto.randomUUID(),
  name,
  age: 'Adult',
  physique: 'Average',
  hair: 'Dark',
  face: 'Standard',
  clothing: 'Casual',
  accessories: 'None',
  isLocked: false
});

const SAFETY_MAP: Record<string, string> = {
  'punch': 'dynamic hand gesture',
  'kick': 'graceful leg movement',
  'hit': 'impact effect',
  'strike': 'rapid motion',
  'kill': 'defeat',
  'murder': 'overcome',
  'blood': 'red fluid effects',
  'death': 'fading light',
  'attack': 'advancing movement',
  'fight': 'choreographed dance battle',
  'combat': 'rhythmic interaction',
  'sword': 'prop blade',
  'blade': 'metallic tool',
  'gun': 'cylindrical device',
  'weapon': 'equipment',
  'violence': 'theatrical performance',
  'stab': 'point toward',
  'wound': 'mark',
  'scream': 'expressive face',
  'explode': 'burst of light',
  'clash': 'meeting of forces',
  'shoot': 'release energy',
  'burn': 'warm glow effect',
  'smash': 'break apart dramatically',
  'crush': 'press firmly',
  'choke': 'struggle for breath',
  'drown': 'submerge gracefully',
  'torture': 'intense trial',
  'suicide': 'end of journey',
  'bomb': 'burst of energy',
  'assassinate': 'remove from scene',
  'behead': 'exit frame',
  'mutilate': 'alter appearance',
  'gore': 'intense visual effect',
  'corpse': 'still figure',
  'dead': 'motionless',
  'dying': 'fading away',
  'bleed': 'flow effect',
  'bullet': 'projectile',
  'arrow': 'pointed object',
  'knife': 'sharp tool',
  'axe': 'cutting implement',
  'poison': 'dark substance',
  'abuse': 'mistreatment',
  'lethal': 'decisive',
  'fatal': 'final',
  'rifle': 'long device',
  'grenade': 'round object',
  'missile': 'flying object',
  'war': 'great conflict',
  'battle': 'grand contest',
  'massacre': 'overwhelming event',
  'slaughter': 'sweeping change',
  'execute': 'carry out action',
  'dangerous': 'intense',
  'hostage': 'captive figure',
  'terrorist': 'extremist figure',
  'threat': 'challenge',
  'harm': 'affect',
  'destroy': 'transform dramatically',
};

export const checkSafetyRisk = (text: string): boolean => {
  const riskyWords = Object.keys(SAFETY_MAP);
  const lowerText = text.toLowerCase();
  return riskyWords.some(word => lowerText.includes(word));
};

export const buildFinalPrompt = (
  scene: Scene, 
  characters: CharacterProfile[], 
  settings: ProjectSettings,
  isSafeMode: boolean = false
): string => {
  const parts: string[] = [];

  if (isSafeMode) {
    parts.push(`[Style: Artistic performance, cinematic choreography, stylized movement, zero violence, theatrical lighting]`);
  } else if (settings.globalStyleAnchor) {
    parts.push(`[Style Anchor: ${settings.globalStyleAnchor}]`);
  }

  const activeChars = characters.filter(c => 
    scene.rawText.toLowerCase().includes(c.name.toLowerCase()) || 
    scene.subject.toLowerCase().includes(c.name.toLowerCase())
  );

  if (activeChars.length > 0) {
    let charBlock = `Characters: `;
    activeChars.forEach(c => {
      if (isSafeMode) {
        charBlock += `${c.name} (Human, ${c.hair} hair, peaceful expression). `;
      } else {
        charBlock += `${c.name} (${c.age}, ${c.physique}, ${c.hair} hair, wearing ${c.clothing}). `;
      }
    });
    parts.push(charBlock);
  }

  let actionText = scene.action;
  let subjectText = scene.subject;

  if (isSafeMode) {
    Object.entries(SAFETY_MAP).forEach(([danger, safe]) => {
      const regex = new RegExp(`\\b${danger}\\b`, 'gi');
      actionText = actionText.replace(regex, safe);
      subjectText = subjectText.replace(regex, safe);
    });
    parts.push(`Action: ${actionText}. Focus on ${subjectText}. Abstract and poetic visualization.`);
  } else {
    parts.push(`Cinematography: ${scene.cinematography}. Subject: ${subjectText}. Action: ${actionText}. Style: ${scene.styleAmbiance}.`);
  }

  if (!isSafeMode && settings.negativeConsistencyPrompt) {
    parts.push(`[Negative: ${settings.negativeConsistencyPrompt}]`);
  } else if (isSafeMode) {
    parts.push(`[Negative: violence, blood, gore, weapons, pain, aggression, injury, dark themes]`);
  }

  return parts.join('\n\n');
};

export const autoExtractCharacters = (scenes: Scene[]): CharacterProfile[] => {
  const names = Array.from(new Set(scenes.flatMap(s => s.charactersDetected)));
  return names.map(createDefaultCharacter);
};