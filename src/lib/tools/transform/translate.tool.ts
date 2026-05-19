import { defineTool } from '../define';
import { aiPrompt } from '../context';

interface TranslateArgs {
  text: string;
  language: string;
}

export default defineTool<TranslateArgs>({
  id: 'transform:translate',
  name: 'Translate',
  description: 'Translate text to another language',
  category: 'transform',

  args: {
    text: { type: 'string', description: 'Text to translate', required: true },
    language: { type: 'string', description: 'Target language (e.g. "Spanish", "Dutch", "Japanese")', required: true },
  },

  keywords: ['translate', 'language', 'convert'],
  examples: ['Translate this to Spanish', 'Convert to Dutch', 'Translate to Japanese'],
  estimatedDuration: 5000,
  accessMode: 'read',

  async execute(args, { services, progress }) {
    progress(10, 'Translating...');

    const translated = await aiPrompt(services, `Translate the following text to ${args.language}. Only output the translation, no explanations:\n\n${args.text}`);

    progress(100, 'Done');
    return { translated, language: args.language };
  },
});
