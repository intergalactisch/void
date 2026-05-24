/**
 * Tool Registry - Collects all *.tool.ts files and registers them
 *
 * Each tool file exports a RegisteredTool via default export.
 * This module imports them all and provides a single registration function.
 *
 * To add a new tool: create a .tool.ts file, import it here, add to ALL_TOOLS.
 */

import type { RegisteredTool, ToolSummaryFn, ToolResourceMeta } from './define';
import type { ToolRegistryPort } from '$lib/ports/outbound/ToolRegistryPort';
import type { ToolExecutorPort } from '$lib/ports/outbound/ToolExecutorPort';
import type { ToolId } from '$lib/domain/values/ToolId';

// Note tools (5)
import noteCreate from './note/create.tool';
import noteRead from './note/read.tool';
import noteUpdate from './note/update.tool';
import noteDelete from './note/delete.tool';
import noteList from './note/list.tool';
import noteCreateFolder from './note/create-folder.tool';

// Editor tools
import editorInsert from './editor/insert.tool';
import editorFormat from './editor/format.tool';
import editorReplace from './editor/replace.tool';
import editorReplaceBlock from './editor/replace-block.tool';
import editorInsertBlocks from './editor/insert-blocks.tool';
import editorInsertCodeBlock from './editor/insert-code-block.tool';
import editorUpdateCodeBlock from './editor/update-code-block.tool';
import editorDeleteBlock from './editor/delete-block.tool';
import editorApplyNotePatch from './editor/apply-note-patch.tool';
import editorConvertBlock from './editor/convert-block.tool';
import editorDisableLine from './editor/disable-line.tool';

// Search tools (3)
import searchNotes from './search/notes.tool';
import searchContent from './search/content.tool';
import searchMedia from './search/media.tool';

// Navigation tools (3)
import navigationGoto from './navigation/goto.tool';
import navigationBack from './navigation/back.tool';
import navigationForward from './navigation/forward.tool';
import navigationHome from './navigation/home.tool';

// Todo tools (5)
import todoCreate from './todo/create.tool';
import todoList from './todo/list.tool';
import todoToggle from './todo/toggle.tool';
import todoUpdate from './todo/update.tool';
import todoDelete from './todo/delete.tool';

// Content tools (5)
import contentSummarize from './content/summarize.tool';
import contentExpand from './content/expand.tool';
import contentOutline from './content/outline.tool';
import contentBrainstorm from './content/brainstorm.tool';
import contentContinue from './content/continue.tool';

// Transform tools (4)
import transformRewrite from './transform/rewrite.tool';
import transformSimplify from './transform/simplify.tool';
import transformTranslate from './transform/translate.tool';
import transformFix from './transform/fix.tool';

// Note organization tools (4)
import noteTag from './note/tag.tool';
import noteMove from './note/move.tool';
import noteDuplicate from './note/duplicate.tool';
import noteMerge from './note/merge.tool';

// Intelligence tools (4)
import intelligenceExtractTodos from './intelligence/extract-todos.tool';
import intelligenceFindRelated from './intelligence/find-related.tool';
import intelligenceDailySummary from './intelligence/daily-summary.tool';
import intelligenceWeeklyReview from './intelligence/weekly-review.tool';

// File system tools (3)
import fsRead from './fs/read.tool';
import fsSummarize from './fs/summarize.tool';
import fsImport from './fs/import.tool';

// Operation tools (2)
import intelligenceResearch from './intelligence/research.tool';
import intelligenceSummarizeFolder from './intelligence/summarize-folder.tool';

// Action tools — single-note (4)
import actionDistill from './actions/distill.tool';
import actionChallenge from './actions/challenge.tool';
import actionMorph from './actions/morph.tool';
import actionContinue from './actions/continue.tool';

// Action tools — cross-note (4)
import actionThread from './actions/thread.tool';
import actionBridge from './actions/bridge.tool';
import actionExtract from './actions/extract.tool';
import actionSynthesize from './actions/synthesize.tool';

// Version tools (2)
import actionReplay from './actions/replay.tool';
import actionVersions from './actions/versions.tool';

// Lineage tools (10)
import lineageHistory from './lineage/history.tool';
import lineageWhy from './lineage/why.tool';
import lineageRevert from './lineage/revert.tool';
import lineageTrace from './lineage/trace.tool';
import lineageBranch from './lineage/branch.tool';
import lineageCompare from './lineage/compare.tool';
import lineageRepair from './lineage/repair.tool';
import lineageContext from './lineage/context.tool';
import lineageActions from './lineage/actions.tool';
import lineageSynthesize from './lineage/synthesize.tool';

// Commitment lineage tools (2)
import commitmentSource from './commitment/source.tool';
import commitmentStaleCheck from './commitment/stale-check.tool';

// AI meta tools (1)
import aiPlan from './ai/plan.tool';

const ALL_TOOLS: RegisteredTool[] = [
  // Note tools (5)
  noteCreate,
  noteRead,
  noteUpdate,
  noteDelete,
  noteList,
  noteCreateFolder,

  // Editor tools
  editorInsert,
  editorFormat,
  editorReplace,
  editorReplaceBlock,
  editorInsertBlocks,
  editorInsertCodeBlock,
  editorUpdateCodeBlock,
  editorDeleteBlock,
  editorApplyNotePatch,
  editorConvertBlock,
  editorDisableLine,

  // Search tools (3)
  searchNotes,
  searchContent,
  searchMedia,

  // Navigation tools (3)
  navigationGoto,
  navigationBack,
  navigationForward,
  navigationHome,

  // Todo tools (5)
  todoCreate,
  todoList,
  todoToggle,
  todoUpdate,
  todoDelete,

  // Content tools (5)
  contentSummarize,
  contentExpand,
  contentOutline,
  contentBrainstorm,
  contentContinue,

  // Transform tools (4)
  transformRewrite,
  transformSimplify,
  transformTranslate,
  transformFix,

  // Note organization tools (4)
  noteTag,
  noteMove,
  noteDuplicate,
  noteMerge,

  // Intelligence tools (4)
  intelligenceExtractTodos,
  intelligenceFindRelated,
  intelligenceDailySummary,
  intelligenceWeeklyReview,

  // File system tools (3)
  fsRead,
  fsSummarize,
  fsImport,

  // Operation tools (2)
  intelligenceResearch,
  intelligenceSummarizeFolder,

  // Action tools — single-note (4)
  actionDistill,
  actionChallenge,
  actionMorph,
  actionContinue,

  // Action tools — cross-note (4)
  actionThread,
  actionBridge,
  actionExtract,
  actionSynthesize,

  // Version tools (2)
  actionReplay,
  actionVersions,

  // Lineage tools (10)
  lineageHistory,
  lineageWhy,
  lineageRevert,
  lineageTrace,
  lineageBranch,
  lineageCompare,
  lineageRepair,
  lineageContext,
  lineageActions,
  lineageSynthesize,

  // Commitment lineage tools (2)
  commitmentSource,
  commitmentStaleCheck,

  // AI meta tools (1)
  aiPlan,
];

/**
 * Register all tools with the registry and executor.
 */
export async function registerAllTools(
  registry: ToolRegistryPort,
  executor: ToolExecutorPort
): Promise<void> {
  for (const { id, tool, handler } of ALL_TOOLS) {
    await registry.register(tool);
    executor.registerHandler(id, handler);
  }
}

/**
 * Get the total number of registered tools.
 */
export function getToolCount(): number {
  return ALL_TOOLS.length;
}

/**
 * Get all registered tools (for testing/inspection).
 */
export function getAllTools(): readonly RegisteredTool[] {
  return ALL_TOOLS;
}

// Summary resolver - maps toolId to summary function
const summaryMap = new Map<ToolId, ToolSummaryFn>(
  ALL_TOOLS
    .filter((t) => t.summary !== undefined)
    .map((t) => [t.id, t.summary!])
);

// Resource metadata resolver - maps toolId to resource metadata
const resourceMap = new Map<ToolId, ToolResourceMeta>(
  ALL_TOOLS
    .filter((t) => t.resource !== undefined)
    .map((t) => [t.id, t.resource!])
);

/**
 * Get resource metadata for a tool.
 * Returns null if the tool has no resource metadata.
 */
export function getToolResourceMeta(toolId: ToolId): ToolResourceMeta | null {
  return resourceMap.get(toolId) ?? null;
}

/**
 * Get a human-readable summary for a completed tool invocation.
 * Returns null if the tool has no summary function defined.
 */
export function getToolSummary(
  toolId: ToolId,
  args: Record<string, unknown>,
  result: unknown
): string | null {
  const fn = summaryMap.get(toolId);
  if (!fn) return null;
  try {
    return fn(args, result);
  } catch {
    return null;
  }
}
