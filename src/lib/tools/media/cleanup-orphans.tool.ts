import { defineTool } from '../define';

interface CleanupOrphansArgs {
  dryRun?: boolean;
}

export default defineTool<CleanupOrphansArgs>({
  id: 'media:cleanup-orphans',
  name: 'Cleanup Orphan Images',
  description: 'Find image assets that are no longer referenced by markdown notes. Deletes only when dryRun is false.',
  category: 'media',
  args: {
    dryRun: {
      type: 'boolean',
      description: 'When true, only report orphaned assets. Set false to delete them.',
      default: true,
    },
  },
  keywords: ['image', 'assets', 'orphans', 'cleanup'],
  estimatedDuration: 3000,
  accessMode: 'write',
  requiresConfirmation: true,

  async execute(args, { services, progress }) {
    if (!services.mediaAttachments) throw new Error('Media attachments are not available');
    progress(20, 'Scanning notes and assets...');
    const result = await services.mediaAttachments.cleanupOrphans({ dryRun: args.dryRun ?? true });
    if (!result.ok) throw new Error(`Failed to cleanup orphan assets: ${result.error.message}`);
    progress(100, args.dryRun === false ? 'Orphan cleanup complete' : 'Orphan scan complete');
    return result.value;
  },

  summary: (args, result) => {
    const report = result as { orphaned?: unknown[]; deleted?: unknown[] };
    const count = args.dryRun === false ? (report.deleted?.length ?? 0) : (report.orphaned?.length ?? 0);
    return args.dryRun === false
      ? `Deleted ${count} orphan image asset${count === 1 ? '' : 's'}`
      : `Found ${count} orphan image asset${count === 1 ? '' : 's'}`;
  },
});
