export interface DerivedResearchTopic {
  displayTitle: string;
  slug: string;
  overviewTitle: string;
  sourcesTitle: string;
  openQuestionsTitle: string;
}

const COMMAND_PREFIXES = [
  /^(please\s+)?(can you|could you|would you|will you|please)\s+/i,
  /^(please\s+)?(do\s+)?(full\s+|deep\s+|extensive\s+|thorough\s+|complete\s+)?research\s+(on|about|into|for)?\s*/i,
  /^(please\s+)?(investigate|study|deep dive into|deep dive|research)\s+(on|about|into|for)?\s*/i,
  /^(doe|maak|voer|start|begin)\s+(een\s+)?(full\s+|deep\s+|uitgebreid(e)?\s+|grondig(e)?\s+|complete\s+|volledig(e)?\s+)?(research|onderzoek)\s+(naar|over|on|about|into|voor)?\s*/i,
  /^(doe\s+)?onderzoek\s+(naar|over|voor)\s+/i,
  /^(kun je|kan je|wil je|zou je)\s+(een\s+)?(full\s+|deep\s+|uitgebreid(e)?\s+|grondig(e)?\s+)?(research|onderzoek\s+doen|onderzoeken)\s+(naar|over|on|about|voor)?\s*/i,
];

const LEADING_FILLER = /^(the|a|an|het|de|een)\s+/i;
const SMALL_TITLE_WORDS = new Set(['of', 'and', 'or', 'in', 'on', 'for', 'to', 'with', 'van', 'de', 'het']);
const ACRONYMS = new Map([
  ['ai', 'AI'],
  ['api', 'API'],
  ['cli', 'CLI'],
  ['ui', 'UI'],
  ['ux', 'UX'],
  ['ml', 'ML'],
  ['llm', 'LLM'],
  ['mcp', 'MCP'],
]);

export function deriveResearchTopic(prompt: string): DerivedResearchTopic {
  const topic = extractTopic(prompt);
  const displayTitle = titleCaseTopic(topic);
  const slug = slugifyTopic(topic);
  return {
    displayTitle,
    slug,
    overviewTitle: `${displayTitle} Research Overview`,
    sourcesTitle: `${displayTitle} Sources`,
    openQuestionsTitle: `${displayTitle} Open Questions`,
  };
}

function extractTopic(prompt: string): string {
  let topic = prompt.trim().replace(/\s+/g, ' ');
  for (const prefix of COMMAND_PREFIXES) {
    topic = topic.replace(prefix, '').trim();
  }
  topic = topic.replace(LEADING_FILLER, '').trim();
  return topic || 'Research';
}

function titleCaseTopic(topic: string): string {
  const words = topic
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'Research';

  return words.map((word, index) => {
    const lower = word.toLowerCase();
    const acronym = ACRONYMS.get(lower);
    if (acronym) return acronym;
    if (index > 0 && SMALL_TITLE_WORDS.has(lower)) return lower;
    return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
  }).join(' ');
}

function slugifyTopic(topic: string): string {
  const words = topic.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index) => !(index === 0 && ['the', 'a', 'an', 'het', 'de', 'een'].includes(word)));
  return words.length > 0 ? words.join('-') : 'research';
}
