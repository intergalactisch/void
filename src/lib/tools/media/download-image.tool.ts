import { defineTool } from '../define';

interface DownloadImageArgs {
  noteId: string;
  url: string;
  alt?: string;
  title?: string;
  creator?: string;
  license?: string;
  originalName?: string;
}

export default defineTool<DownloadImageArgs>({
  id: 'media:download-image',
  name: 'Download Image',
  description: 'Download a public HTTPS image into the workspace asset folder for a note and return portable markdown without inserting it.',
  category: 'media',
  args: {
    noteId: { type: 'string', description: 'Relative note path used to choose the asset folder', required: true },
    url: { type: 'string', description: 'Public HTTPS image URL', required: true },
    alt: { type: 'string', description: 'Image alt text for returned markdown' },
    title: { type: 'string', description: 'Optional markdown image title' },
    creator: { type: 'string', description: 'Creator/author attribution when known' },
    license: { type: 'string', description: 'License/usage attribution when known' },
    originalName: { type: 'string', description: 'Optional filename hint' },
  },
  keywords: ['image', 'download', 'asset', 'media'],
  estimatedDuration: 5000,
  accessMode: 'write',
  resourceId: (args) => `asset-download:${args.noteId}`,

  async execute(args, { services, progress }) {
    if (!services.mediaAttachments) throw new Error('Media attachments are not available');
    progress(15, 'Downloading image...');
    const result = await services.mediaAttachments.downloadImage(args.noteId, args.url, {
      ...(args.alt !== undefined ? { alt: args.alt } : {}),
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.creator !== undefined ? { creator: args.creator } : {}),
      ...(args.license !== undefined ? { license: args.license } : {}),
      ...(args.originalName !== undefined ? { originalName: args.originalName } : {}),
    });
    if (!result.ok) throw new Error(`Failed to download image: ${result.error.message}`);
    progress(100, 'Image downloaded');
    return result.value;
  },

  summary: (_args, result) =>
    `Downloaded image to ${(result as { asset?: { relativePath?: string } }).asset?.relativePath ?? 'assets/'}`,
});
