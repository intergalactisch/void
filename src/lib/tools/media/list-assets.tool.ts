import { defineTool } from '../define';

export default defineTool<Record<string, never>>({
  id: 'media:list-assets',
  name: 'List Assets',
  description: 'List durable workspace image assets and their metadata.',
  category: 'media',
  keywords: ['image', 'assets', 'media', 'list'],
  estimatedDuration: 400,
  accessMode: 'read',

  async execute(_args, { services, progress }) {
    if (!services.mediaAttachments) throw new Error('Media attachments are not available');
    progress(50, 'Listing assets...');
    const result = await services.mediaAttachments.listAssets();
    if (!result.ok) throw new Error(`Failed to list assets: ${result.error.message}`);
    progress(100, 'Assets listed');
    return {
      assets: result.value,
      total: result.value.length,
    };
  },

  summary: (_args, result) =>
    `Listed ${(result as { total?: number }).total ?? 0} image asset${(result as { total?: number }).total === 1 ? '' : 's'}`,
});
