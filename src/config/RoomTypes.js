export const ROOM_TYPES = {
  forge: {
    id: 'forge',
    label: 'The Forge',
    glyph: 'F',
    tint: 0x00ff88,
    accent: 'neon-wire',
    focus: 'feature_build',
    ambient: 'Neon floor wiring, glowing green matrix monitors',
  },
  warroom: {
    id: 'warroom',
    label: 'The War Room',
    glyph: 'W',
    tint: 0xff3344,
    accent: 'pulse-alarm',
    focus: 'debug',
    ambient: 'Dim lighting, pulsing red wall alarms',
  },
  blueprint: {
    id: 'blueprint',
    label: 'The Blueprint Lab',
    glyph: 'B',
    tint: 0x66aaff,
    accent: 'whiteboard',
    focus: 'architecture',
    ambient: 'Whiteboards, large architectural node diagrams',
  },
  lounge: {
    id: 'lounge',
    label: 'The Lounge',
    glyph: 'L',
    tint: 0xffaa66,
    accent: 'fireplace',
    focus: 'documentation',
    ambient: 'Floor-to-ceiling bookshelves, cozy fireplace',
  },
};

const CLASSIFIER_RULES = [
  { type: 'warroom',   keywords: ['debug', 'fix', 'bug', 'error', 'stack trace', 'crash', 'refactor', 'broken'] },
  { type: 'blueprint', keywords: ['schema', 'architecture', 'design', 'prompt', 'plan', 'database', 'db', 'diagram', 'spec'] },
  { type: 'lounge',    keywords: ['doc', 'readme', 'write', 'explain', 'tutorial', 'blog', 'changelog'] },
  { type: 'forge',     keywords: ['build', 'feature', 'implement', 'create', 'ui', 'component', 'add', 'route', 'endpoint'] },
];

export function classifyPrompt(prompt) {
  const text = (prompt || '').toLowerCase();
  for (const rule of CLASSIFIER_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) {
      return rule.type;
    }
  }
  return 'forge';
}
