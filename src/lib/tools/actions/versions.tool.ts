import { defineTool } from '../define';
import { aiPrompt } from '../context';

export default defineTool({
  id: 'action:versions',
  name: 'Versions',
  description: 'Generate alternative versions of the current note or selection',
  category: 'intelligence',
  args: {
    count: {
      type: 'number',
      description: 'Number of versions to generate (default 3)',
      required: false,
    },
    prompt: {
      type: 'string',
      description: 'Specific direction for the versions',
      required: false,
    },
  },
  keywords: ['versions', 'alternatives', 'branches', 'variations', 'rewrite'],
  examples: ['Give me 3 versions', 'Create alternative versions', 'Show me different takes'],
  estimatedDuration: 20000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    const count = (args as { count?: number }).count ?? 3;
    const userPrompt = (args as { prompt?: string }).prompt ?? '';

    progress(10, 'Reading note...');
    const state = services.editor.getState();
    const content = state.document?.blocks.map((b) => b.content).join('\n') ?? '';
    if (!content) throw new Error('No content to create versions from');

    const title = state.document?.meta.title ?? 'Untitled';
    const versions: string[] = [];

    for (let i = 0; i < count; i++) {
      progress(10 + Math.round((70 / count) * i), `Generating version ${i + 1}/${count}...`);

      const direction = userPrompt
        ? `Direction: ${userPrompt}\n\n`
        : '';

      const result = await aiPrompt(services,
        `Create version ${i + 1} of ${count} alternative versions of this document. Each version should take a distinctly different approach.

${direction}Version ${i + 1} guidelines:
${i === 0 ? '- More concise and direct' : i === 1 ? '- More detailed and expansive' : '- Different structure or perspective'}

Original content:
${content}

Write the complete alternative version. Do not explain what you changed — just write the new version.`
      );

      versions.push(result);
    }

    progress(85, 'Creating version notes...');

    for (let i = 0; i < versions.length; i++) {
      const version = versions[i];
      if (version) {
        await services.collaboration.createNote({
          title: `${title} — Version ${i + 1}`,
          content: version,
          autoFocus: false,
        });
      }
    }

    progress(100, 'Done');
    return { versionsCreated: versions.length, title };
  },

  summary: (_args, result) => {
    const r = result as { versionsCreated?: number; title?: string };
    return `Created ${r.versionsCreated} versions of "${r.title}"`;
  },
});
