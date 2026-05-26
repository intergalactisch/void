import { defineTool } from '../define';

interface AttachImageArgs {
  noteId: string;
  url?: string;
  filePath?: string;
  alt?: string;
  title?: string;
  caption?: string;
  width?: number;
  placement?: 'append' | 'media-section' | 'cursor';
  creator?: string;
  license?: string;
  originalName?: string;
}

export default defineTool<AttachImageArgs>({
  id: 'media:attach-image',
  name: 'Attach Image',
  description: 'Download or import a supported image into workspace assets and insert it as a portable block-level markdown image in a note.',
  category: 'media',
  args: {
    noteId: { type: 'string', description: 'Relative note path to attach the image to', required: true },
    url: { type: 'string', description: 'Public HTTPS image URL to download and attach' },
    filePath: { type: 'string', description: 'Absolute local image path to import and attach' },
    alt: { type: 'string', description: 'Image alt text' },
    title: { type: 'string', description: 'Optional markdown image title' },
    caption: { type: 'string', description: 'Optional caption metadata for the image block' },
    width: { type: 'number', description: 'Optional display width in pixels', minimum: 32, maximum: 2400 },
    placement: {
      type: 'string',
      description: 'Where to place the image in the note',
      enum: ['append', 'media-section', 'cursor'],
      default: 'append',
    },
    creator: { type: 'string', description: 'Creator/author attribution when known' },
    license: { type: 'string', description: 'License/usage attribution when known' },
    originalName: { type: 'string', description: 'Optional filename hint for URL downloads' },
  },
  keywords: ['image', 'asset', 'attach', 'download', 'media'],
  examples: [
    'Attach this chart URL to research.md',
    'Import a local screenshot into the current research note',
  ],
  estimatedDuration: 5000,
  accessMode: 'write',
  resourceId: (args) => `note:${args.noteId}`,

  async execute(args, { services, progress }) {
    if (!services.mediaAttachments) throw new Error('Media attachments are not available');
    if (!args.noteId?.trim()) throw new Error('noteId is required');
    if (!args.url && !args.filePath) throw new Error('Provide either url or filePath');

    progress(15, args.url ? 'Downloading image...' : 'Importing image...');
    const options = {
      ...(args.alt !== undefined ? { alt: args.alt } : {}),
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.caption !== undefined ? { caption: args.caption } : {}),
      ...(args.width !== undefined ? { width: args.width } : {}),
      placement: args.placement ?? 'append',
      ...(args.creator !== undefined ? { creator: args.creator } : {}),
      ...(args.license !== undefined ? { license: args.license } : {}),
      ...(args.originalName !== undefined ? { originalName: args.originalName } : {}),
    };
    const result = args.url
      ? await services.mediaAttachments.attachRemoteImage(args.noteId, args.url, options)
      : await services.mediaAttachments.attachLocalImage(args.noteId, args.filePath!, options);
    if (!result.ok) throw new Error(`Failed to attach image: ${result.error.message}`);

    progress(100, 'Image attached');
    return {
      success: true,
      noteId: result.value.notePath,
      markdown: result.value.markdown,
      markdownPath: result.value.markdownPath,
      asset: result.value.asset,
    };
  },

  summary: (_args, result) =>
    `Attached image ${String((result as { asset?: { relativePath?: string } }).asset?.relativePath ?? '')}`,
});
