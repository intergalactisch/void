import { defineTool } from '../define';
import { aiPrompt } from '../context';

const FORMAT_PROMPTS: Record<string, string> = {
  email: 'Transform into a professional email. Include subject line, greeting, body, sign-off. Preserve all key information.',
  slides: 'Transform into a presentation outline. Each slide has a title and 3-5 bullet points. Add speaker notes where helpful.',
  slack: 'Transform into a concise Slack message. Casual tone, use bullet points, mention key action items. Keep under 200 words.',
  spec: 'Transform into a formal specification. Add sections: Overview, Requirements, Constraints, Acceptance Criteria. Be precise.',
  'tweet-thread': 'Transform into a Twitter/X thread. Each tweet under 280 chars. Number them. Make the first tweet a hook.',
  'executive-summary': 'Transform into an executive summary. Lead with the conclusion, then supporting evidence. Keep under 300 words. Business language.',
};

const SUPPORTED_FORMATS = Object.keys(FORMAT_PROMPTS);

export default defineTool({
  id: 'action:morph',
  name: 'Morph',
  description: 'Transform a note into a different format — email, slides, slack, spec, tweet-thread, executive-summary',
  category: 'intelligence',
  args: {
    format: {
      type: 'string',
      description: `Target format: ${SUPPORTED_FORMATS.join(', ')}`,
      required: true,
    },
  },
  keywords: ['morph', 'transform', 'convert', 'format', 'email', 'slides', 'slack'],
  examples: ['Morph to email', 'Convert to slides', 'Transform to spec'],
  estimatedDuration: 8000,
  accessMode: 'write',

  async execute(args, { services, progress }) {
    const format = (args as { format?: string }).format ?? 'email';
    const formatPrompt = FORMAT_PROMPTS[format];

    if (!formatPrompt) {
      throw new Error(`Unknown format: ${format}. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
    }

    progress(10, 'Reading note...');
    const state = services.editor.getState();
    const content = state.document?.blocks.map(b => b.content).join('\n') ?? '';
    const title = state.document?.meta.title ?? 'Untitled';

    if (!content.trim()) throw new Error('No note content to morph');

    progress(30, `Morphing to ${format}...`);
    const result = await aiPrompt(services,
      `${formatPrompt}\n\nSource document "${title}":\n${content}`
    );

    progress(70, 'Creating new note...');
    const morphTitle = `${title} — ${format}`;
    const createResult = await services.collaboration.createNote({
      title: morphTitle,
      content: result,
      autoFocus: true,
    });

    if (!createResult.ok) {
      throw new Error(`Failed to create morphed note: ${createResult.error.message}`);
    }

    progress(100, 'Done');
    return { morphed: true, format, newPath: createResult.value.path };
  },

  summary: (_args, result) => {
    const r = result as { format?: string };
    return `Morphed note to ${r.format ?? 'new format'}`;
  },
});
