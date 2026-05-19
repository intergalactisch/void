/**
 * Settings entity - Core application configuration
 *
 * This is a pure domain entity with ZERO external dependencies.
 * Part of the Hexagonal Architecture domain layer.
 */

import {
  DEFAULT_TODO_VIEW,
  isValidTodoView,
  type TodoView,
} from '../values/TodoView';

/** Known local CLI provider identifiers */
export type CLIProviderId = 'claude-code' | 'codex';

/** Codex CLI reasoning effort values. Claude Code ignores this setting. */
export type AIReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** UI density / spacing presets. Controls vertical padding across the shell. */
export type UIDensity = 'compact' | 'comfortable' | 'spacious';

/** Where a quick-capture entry is saved. */
export type CaptureTarget = 'inbox' | 'daily';

export const CAPTURE_TARGET_OPTIONS: CaptureTarget[] = ['inbox', 'daily'];
export const DEFAULT_CAPTURE_TARGET: CaptureTarget = 'inbox';
export const DEFAULT_CAPTURE_SHORTCUT = 'mod+shift+enter';

export const CLI_PROVIDER_OPTIONS: CLIProviderId[] = ['codex', 'claude-code'];
export const AI_REASONING_EFFORT_OPTIONS: AIReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export const DEFAULT_AI_REASONING_EFFORT: AIReasoningEffort = 'medium';

export const UI_DENSITY_OPTIONS: UIDensity[] = ['compact', 'comfortable', 'spacious'];
export const DEFAULT_UI_DENSITY: UIDensity = 'comfortable';

export interface Settings {
  notesPath: string;
  theme: 'light' | 'dark' | 'system';
  autoSave: boolean;
  autoSaveDelay: number;
  /** Legacy cloud/API provider setting. Ignored by current AI wiring. */
  aiProvider: 'claude' | 'openai' | 'local' | null;
  /** Local CLI provider for AI operations. */
  cliProvider: CLIProviderId;
  /** Codex CLI reasoning effort. */
  aiReasoningEffort: AIReasoningEffort;
  /** Editor font size in pixels (12-24) */
  fontSize: number;
  /** Editor line height multiplier (1.4-2.0) */
  lineHeight: number;
  /** Editor content max width in pixels (480-960) */
  contentWidth: number;
  /** Full task workspace startup view */
  taskDefaultView: TodoView;
  /**
   * User-defined keyboard shortcut overrides.
   * Map of `commandId → serializedChord` (e.g. `'mod+shift+f'`). An empty
   * string explicitly unbinds the command (so its default no longer fires).
   * Missing entries fall back to the command's `defaultKeybinding`.
   */
  keymapOverrides: Record<string, string>;
  /** UI density preset. Controls vertical padding across the shell. */
  density: UIDensity;
  /**
   * Global OS-level shortcut that opens the quick-capture window. Stored as a
   * serialized chord (e.g. `'mod+alt+space'`). Empty string disables the global
   * shortcut entirely; the in-app `capture.open` command still works.
   */
  captureShortcut: string;
  /** Default save target selected when the capture window opens. */
  captureTargetDefault: CaptureTarget;
}

export const DEFAULT_SETTINGS: Settings = {
  notesPath: '~/Documents/void',
  theme: 'system',
  autoSave: true,
  autoSaveDelay: 1000,
  aiProvider: null,
  cliProvider: 'codex',
  aiReasoningEffort: DEFAULT_AI_REASONING_EFFORT,
  fontSize: 16,
  lineHeight: 1.6,
  contentWidth: 720,
  taskDefaultView: DEFAULT_TODO_VIEW,
  keymapOverrides: {},
  density: DEFAULT_UI_DENSITY,
  captureShortcut: DEFAULT_CAPTURE_SHORTCUT,
  captureTargetDefault: DEFAULT_CAPTURE_TARGET,
};

/** Allowed editor font sizes in pixels. */
export const FONT_SIZE_RANGE = { min: 12, max: 24 } as const;

/** Allowed line-height multipliers. */
export const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.0 } as const;

/** Allowed editor content width in pixels. */
export const CONTENT_WIDTH_RANGE = { min: 480, max: 960 } as const;

/** Allowed autosave delays (ms). */
export const AUTO_SAVE_DELAY_RANGE = { min: 250, max: 60_000 } as const;

function normalizeCliProvider(value: unknown): CLIProviderId {
  return CLI_PROVIDER_OPTIONS.includes(value as CLIProviderId)
    ? value as CLIProviderId
    : DEFAULT_SETTINGS.cliProvider;
}

function normalizeAIReasoningEffort(value: unknown): AIReasoningEffort {
  return AI_REASONING_EFFORT_OPTIONS.includes(value as AIReasoningEffort)
    ? value as AIReasoningEffort
    : DEFAULT_AI_REASONING_EFFORT;
}

/**
 * Validate a Settings object and return a sanitised copy with values
 * clamped into the supported ranges. Use at the boundary (settings
 * adapter, settings UI form) so the rest of the app can trust the shape.
 */
export function validateSettings(input: Partial<Settings>): Settings {
  const clamp = (n: number, min: number, max: number): number =>
    Math.min(Math.max(n, min), max);
  const merged: Settings = { ...DEFAULT_SETTINGS, ...input };

  return {
    ...merged,
    cliProvider: normalizeCliProvider(merged.cliProvider),
    aiReasoningEffort: normalizeAIReasoningEffort(merged.aiReasoningEffort),
    fontSize: clamp(Math.round(merged.fontSize), FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
    lineHeight: clamp(merged.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max),
    contentWidth: clamp(Math.round(merged.contentWidth), CONTENT_WIDTH_RANGE.min, CONTENT_WIDTH_RANGE.max),
    autoSaveDelay: clamp(Math.round(merged.autoSaveDelay), AUTO_SAVE_DELAY_RANGE.min, AUTO_SAVE_DELAY_RANGE.max),
    taskDefaultView: isValidTodoView(merged.taskDefaultView)
      ? merged.taskDefaultView
      : DEFAULT_TODO_VIEW,
    keymapOverrides: normalizeKeymapOverrides(merged.keymapOverrides),
    density: UI_DENSITY_OPTIONS.includes(merged.density as UIDensity)
      ? merged.density
      : DEFAULT_UI_DENSITY,
    captureShortcut: typeof merged.captureShortcut === 'string'
      ? merged.captureShortcut
      : DEFAULT_CAPTURE_SHORTCUT,
    captureTargetDefault: CAPTURE_TARGET_OPTIONS.includes(merged.captureTargetDefault as CaptureTarget)
      ? merged.captureTargetDefault
      : DEFAULT_CAPTURE_TARGET,
  };
}

function normalizeKeymapOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    out[k] = v;
  }
  return out;
}
