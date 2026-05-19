---
component: AppShell
date: 2026-02-17
status: ready
designer: @designer
frontender: (assigned after ready)
---

# Design Handoff: Void App Shell Redesign

## Purpose

Transform Void from a prototype-feeling note-taking app into a polished, modern desktop application. This redesign addresses the current cramped header, wasted vertical space from the fixed formatting toolbar, disconnected settings page, missing status bar, and generic empty states. The goal is to create an app that feels like Notion, Linear, or Arc -- calm, layered, and keyboard-first.

## Context

Void is a Tauri v2 desktop app (macOS). This spec covers the complete app shell: sidebar, header/titlebar area, content area, status bar, settings integration, empty states, and the shift from a fixed formatting toolbar to a floating (selection-based) toolbar. The floating toolbar itself already exists in the design system (DESIGN.md Section 6) -- this spec only needs to remove the fixed one and confirm the floating one is the sole formatting mechanism.

---

## 1. New App Shell Layout

### ASCII Diagram

```
+------------------------------------------------------------------------+
|  [drag region - full width]                           44px              |
|  +----------+---------------------------------------------------------+|
|  | Sidebar  | Header / Titlebar                                       ||
|  | toggle   | [breadcrumbs]            [save status] [AI btn]         ||
|  +----------+---------------------------------------------------------+|
+--+----------+---------------------------------------------------------++
|  |          |                                                          |
|  | Sidebar  |                   Content Area                           |
|  | 260px    |                                                          |
|  |          |   +------------------------------------------+           |
|  | [logo]   |   |         Editor (max 720px)               |           |
|  | [search] |   |                                          |           |
|  | [new]    |   |   Note Title                             |           |
|  | [favs]   |   |                                          |           |
|  | -------- |   |   Body content...                        |           |
|  | [work-   |   |   Body content...                        |           |
|  |  spaces] |   |                                          |           |
|  | -------- |   +------------------------------------------+           |
|  | [recent] |                                                          |
|  |          |                                                          |
|  | -------- |                                                          |
|  | [trash]  |                                                          |
|  | [settngs]|                                                          |
+--+----------+----------------------------------------------------------+
|  Status Bar                                                    28px    |
|  [word count]  [char count]          [save status] [Cmd+P] [Cmd+K]    |
+------------------------------------------------------------------------+
```

### Dimensions

| Region | Height/Width | Purpose |
|--------|-------------|---------|
| Header/Titlebar | 44px | Window drag region + navigation + document actions |
| Sidebar | 260px wide (collapsible to 0) | Navigation, workspace identity |
| Content Area | Fills remaining space | Editor or empty state |
| Status Bar | 28px | Metadata, save status, keyboard hints |

### Reasoning

- Header at 44px is the macOS-standard titlebar height, providing a natural window drag region while also housing navigation. This replaces the current 45px header.
- The fixed formatting toolbar (B, I, S, block types, undo/redo) is removed entirely. Formatting happens via the existing floating toolbar on text selection (DESIGN.md Section 6) and keyboard shortcuts.
- Status bar at 28px provides persistent metadata without competing with content. Inspired by VS Code and Notion's subtle bottom bars.

---

## 2. Header / Titlebar Area

### Purpose

The header serves dual duty: macOS window drag region and document navigation. It should feel like a native titlebar, not a web toolbar.

### Layout

```
+------------------------------------------------------------------------+
| [sidebar-toggle]  [breadcrumbs...]                 [save-dot] [AI]     |
+------------------------------------------------------------------------+
```

| Property | Value |
|----------|-------|
| Height | 44px |
| Background | `--bg-app` |
| Border bottom | 1px solid `--border-light` |
| Horizontal padding | 16px (scale 4) |
| Vertical alignment | Center |

### Drag Region

The entire header is the window drag region (`-webkit-app-region: drag`). Interactive elements within it (buttons, breadcrumbs) are marked as no-drag regions.

### Left Side: Navigation

**Sidebar toggle button:**

| Property | Value |
|----------|-------|
| Size | 28x28px visual, 44x44px touch target |
| Icon | Hamburger (3 horizontal lines), 16x16px |
| Color | `--text-secondary` |
| Border radius | `--radius-sm` |
| Hover background | `--bg-hover` |
| Hover color | `--text-primary` |
| Gap to breadcrumbs | 8px (scale 2) |

**Breadcrumbs:**

| Property | Value |
|----------|-------|
| Font size | 13px |
| Font weight | 400 (regular) |
| Color (folder segments) | `--text-muted` |
| Color (current document) | `--text-secondary` |
| Separator | "/" in `--text-placeholder` |
| Separator spacing | 6px (scale 1.5) on each side |
| Truncation | Middle segments collapse to "..." when path is deep |

Breadcrumb states:
- Default: `--text-muted` for folders, `--text-secondary` for current doc
- Hover (folder segments): `--text-secondary`, underline
- Active: `--text-primary`

### Right Side: Actions

**Save status indicator** (when document is open):

| Status | Visual |
|--------|--------|
| Saved | 6px circle, `--color-success`, opacity 60% |
| Saving | 6px circle, `--color-warning`, pulse animation |
| Unsaved/Edited | 6px circle, `--color-error` |

No text label in the header -- the status bar handles the detailed save status text. The header shows only the dot indicator for at-a-glance awareness.

**AI button** (when document is open):

| Property | Value |
|----------|-------|
| Size | 28x28px |
| Icon | Sparkle icon, 16x16px |
| Color | `--text-secondary` |
| Border radius | `--radius-sm` |
| Hover background | `--bg-hover` |
| Hover color | `--text-primary` |

No "AI" text label -- icon only to keep the header minimal.

### What Was Removed

The fixed formatting toolbar (B, I, S, Code, Text, H1, H2, H3, Undo, Redo) that previously sat below the header is eliminated. This reclaims approximately 36px of vertical space. All formatting is now accessible via:
1. Floating toolbar (appears on text selection)
2. Slash menu (type "/")
3. Keyboard shortcuts (Cmd+B, Cmd+I, etc.)

---

## 3. Sidebar Redesign

### Purpose

The sidebar provides workspace navigation, note management, and access to app-level features (trash, settings). The redesign refines visual hierarchy, adds a workspace identity area at the top, and polishes the bottom bar.

### Overall Container

| Property | Value |
|----------|-------|
| Width | 260px (var `--sidebar-width`) |
| Background | `--bg-sidebar` |
| Border right | 1px solid `--border-light` |
| Collapse transition | Width 300ms ease, content opacity 200ms ease |
| User select | None (non-editable navigation) |

### 3.1 Workspace Identity (Top)

A small identity area at the very top of the sidebar, establishing "place."

```
+------------------------------------------+
|  [V]  Void                          [+]  |
+------------------------------------------+
```

| Property | Value |
|----------|-------|
| Height | 44px (aligns with header) |
| Horizontal padding | 12px (scale 3) |
| Background | Transparent (inherits sidebar bg) |
| Border bottom | 1px solid `--border-light` |
| Vertical alignment | Center |

**App icon/logo:**

| Property | Value |
|----------|-------|
| Size | 20x20px |
| Shape | Rounded square, `--radius-sm` |
| Background | `--accent-primary` |
| Text/icon color | `--text-inverse` |
| Content | "V" letter, 11px, font-weight 700 |

**App name:**

| Property | Value |
|----------|-------|
| Text | "Void" |
| Font size | 14px |
| Font weight | 600 |
| Color | `--text-primary` |
| Gap from icon | 8px (scale 2) |

**New Note button (right side):**

| Property | Value |
|----------|-------|
| Size | 24x24px |
| Icon | Plus, 14x14px |
| Color | `--text-muted` |
| Border radius | `--radius-sm` |
| Hover background | `--bg-hover` |
| Hover color | `--text-secondary` |

### 3.2 Search

Directly below workspace identity. Always visible as a clickable row (not an expanded input by default).

```
+------------------------------------------+
|  [search icon]  Search          Cmd+P    |
+------------------------------------------+
```

| Property | Value |
|----------|-------|
| Padding | 6px 8px |
| Margin | 8px horizontal, 4px top, 4px bottom |
| Font size | 13px |
| Color | `--text-muted` |
| Border radius | `--radius-md` |
| Background | Transparent |
| Hover background | `--bg-hover` |
| Keyboard shortcut badge | 11px, `--text-placeholder`, background `--bg-hover`, border-radius `--radius-sm`, padding 2px 6px |

Clicking this row or pressing Cmd+P opens the Quick Switcher overlay (not an inline search). The inline search input can be removed from the sidebar -- Quick Switcher handles all search.

### 3.3 Section Headers

| Property | Value |
|----------|-------|
| Padding | 6px 12px 4px |
| Font size | 11px |
| Font weight | 600 |
| Text transform | Uppercase |
| Letter spacing | 0.05em |
| Color | `--text-muted` |
| Opacity | 0.7 (subtler than current) |

### 3.4 Sidebar Items

The standard row used for favorites, workspace files, and recent notes.

| Property | Value |
|----------|-------|
| Padding | 5px 8px |
| Gap (icon to text) | 8px (scale 2) |
| Border radius | `--radius-md` |
| Font size | 13px (down from 14px for density) |
| Line height | 1.4 |
| Color | `--text-secondary` |
| Icon size | 15px (down from 16px) |
| Icon color | `--text-muted` |
| Truncation | Single line, ellipsis |

**States:**

| State | Background | Text Color | Icon Color |
|-------|------------|------------|------------|
| Default | Transparent | `--text-secondary` | `--text-muted` |
| Hover | `--bg-hover` | `--text-secondary` | `--text-secondary` |
| Selected | `--bg-active` | `--text-primary` | `--text-primary` |
| Active/Pressed | `--bg-active` | `--text-primary` | `--text-primary` |
| Focus | `--bg-hover`, focus ring 2px `--accent-primary` | `--text-secondary` | `--text-secondary` |

**Hover actions** (appear on row hover, right side):

| Property | Value |
|----------|-------|
| Size | 20x20px |
| Icon | 3-dot horizontal, 14px |
| Opacity default | 0 |
| Opacity on row hover | 1 |
| Color | `--text-muted` |
| Hover background | `--bg-active` |
| Transition | Opacity 100ms ease |

### 3.5 Section Layout Order

1. **Workspace Identity** (app icon, name, new note)
2. **Search row**
3. Divider (1px `--border-light`, 12px horizontal margin)
4. **Favorites** section (collapsible, section header)
5. Divider
6. **Workspaces** section (folder tree, scrollable -- takes remaining space)
7. Divider
8. **Recent** section (collapsible, max 5 items)
9. **Bottom Bar** (trash, settings -- pinned to bottom)

### 3.6 Bottom Bar

Pinned to the bottom of the sidebar, separated by a border.

```
+------------------------------------------+
|  [trash icon] Trash   [gear] Settings    |
+------------------------------------------+
```

| Property | Value |
|----------|-------|
| Border top | 1px solid `--border-light` |
| Padding | 8px (scale 2) |
| Layout | Two buttons side by side, equal width |

Each button uses the standard sidebar item styling but at slightly smaller proportions:

| Property | Value |
|----------|-------|
| Font size | 12px |
| Padding | 4px 8px |
| Color | `--text-muted` |
| Icon size | 14px |
| Hover background | `--bg-hover` |
| Hover color | `--text-secondary` |

Important: Trash and Settings are buttons, not navigation links. Trash opens a side panel or modal (future scope). Settings opens a slide-over panel (see Section 7).

---

## 4. Content Area

### Purpose

The content area is the primary workspace. When a document is open, it shows the editor. When no document is selected, it shows the empty state.

### Container

| Property | Value |
|----------|-------|
| Background | `--bg-editor` (white) |
| Overflow | Vertical scroll, thin scrollbar |
| Flex | Fills all space between header and status bar |

### Editor Content

| Property | Value |
|----------|-------|
| Max width | 720px (`--content-max-width`) |
| Horizontal centering | Auto margins |
| Horizontal padding | 64px (scale 16) |
| Top padding | 48px (scale 12) |
| Bottom padding | 120px (generous bottom space for comfortable writing -- ensures last line isn't at very bottom of viewport) |

### Note Title

| Property | Value |
|----------|-------|
| Font size | 40px (`--text-note-title`) |
| Font weight | 700 (`--text-note-title-weight`) |
| Line height | 1.2 (`--text-note-title-line-height`) |
| Color | `--text-primary` |
| Margin bottom | 16px (scale 4) |
| Placeholder text | "Untitled" in `--text-placeholder` |

The note title should wrap across lines (not single-line with truncation as currently specified). Long titles are common in notes.

### Editor Body

All existing ProseMirror/block styles from `app.css` remain unchanged. The only layout change is the removal of the fixed toolbar above the editor -- the editor area now starts immediately after the header.

### Floating Toolbar (Text Selection)

The floating toolbar already specified in DESIGN.md Section 6 becomes the sole formatting interface. No changes to its spec are needed. It appears above selected text with formatting options (Bold, Italic, Strikethrough, Code, Headings, Highlight, Link).

---

## 5. Status Bar

### Purpose

A persistent, minimal bar at the bottom of the app showing document metadata, save status, and keyboard shortcut hints. Provides ambient awareness without demanding attention.

### Container

```
+------------------------------------------------------------------------+
| 420 words  ·  2,847 chars               Saved  ·  Cmd+P  ·  Cmd+K     |
+------------------------------------------------------------------------+
```

| Property | Value |
|----------|-------|
| Height | 28px |
| Background | `--bg-sidebar` |
| Border top | 1px solid `--border-light` |
| Horizontal padding | 12px (scale 3) |
| Vertical alignment | Center |
| Font size | 11px |
| Font weight | 400 |
| Color | `--text-muted` |
| Layout | Flexbox, space-between |
| z-index | `--z-base` (no special stacking) |

### Left Side: Document Metadata

When a document is open:

```
420 words  ·  2,847 chars
```

| Property | Value |
|----------|-------|
| Separator | Middle dot "·" in `--text-placeholder` |
| Separator spacing | 8px (scale 2) on each side |
| Numbers | Formatted with locale thousands separator |

When no document is open:

```
(empty -- no metadata shown)
```

### Right Side: Status + Shortcuts

```
Saved  ·  Cmd+P  ·  Cmd+K
```

**Save status text:**

| Status | Text | Color |
|--------|------|-------|
| Saved | "Saved" | `--text-muted` |
| Saving | "Saving..." | `--text-muted` |
| Unsaved | "Unsaved changes" | `--color-warning` |

**Keyboard shortcut hints:**

| Property | Value |
|----------|-------|
| Text | "Cmd+P", "Cmd+K" etc. |
| Font family | `--font-mono` |
| Font size | 10px |
| Color | `--text-placeholder` |
| Background | `--bg-hover` |
| Padding | 1px 5px |
| Border radius | `--radius-sm` |

Shortcut hints are visible by default but can be toggled off in settings (future enhancement). They help with discoverability.

### Status Bar States

When sidebar is collapsed, the status bar extends full width. When sidebar is visible, the status bar also extends full width (it sits below both sidebar and content).

### New Token Recommendation

| Token | Value | Rationale |
|-------|-------|-----------|
| `--statusbar-height` | 28px | Standard reference for status bar height in layout calculations. Currently no token exists for this dimension. |

---

## 6. Empty State (No Document Selected)

### Purpose

When no document is selected, the content area should feel inviting and guide the user toward action. It should communicate premium quality, not emptiness.

### Layout

Centered vertically and horizontally within the content area.

```
+------------------------------------------+
|                                          |
|                                          |
|             [subtle icon]                |
|                                          |
|          Select a note to begin          |
|    or press Cmd+N to create a new one    |
|                                          |
|              [New note]                  |
|                                          |
|                                          |
+------------------------------------------+
```

### Visual Specification

**Icon:**

| Property | Value |
|----------|-------|
| Type | Document/page outline icon (existing icon, lighter treatment) |
| Size | 48x48px |
| Color | `--border-medium` |
| Stroke width | 1px (thinner than default for subtlety) |
| Opacity | 0.5 |

Reasoning: The icon should be barely there -- a whisper of visual interest, not a focal point. Using `--border-medium` at 50% opacity makes it feel like a watermark.

**Heading:**

| Property | Value |
|----------|-------|
| Text | "Select a note to begin" |
| Font size | 16px |
| Font weight | 500 |
| Color | `--text-secondary` |
| Margin top | 20px (scale 5) below icon |

**Subtext:**

| Property | Value |
|----------|-------|
| Text | "or press Cmd+N to create a new one" |
| Font size | 13px |
| Font weight | 400 |
| Color | `--text-muted` |
| Margin top | 6px (scale 1.5) below heading |

**Button:**

| Property | Value |
|----------|-------|
| Text | "New note" |
| Style | Ghost/secondary (not primary -- keep it subtle) |
| Font size | 13px |
| Padding | 6px 14px |
| Color | `--text-secondary` |
| Background | Transparent |
| Border | 1px solid `--border-light` |
| Border radius | `--radius-md` |
| Margin top | 20px (scale 5) below subtext |
| Hover background | `--bg-hover` |
| Hover border color | `--border-medium` |

**Keyboard hint** (below button):

| Property | Value |
|----------|-------|
| Text | "Cmd+N" |
| Font family | `--font-mono` |
| Font size | 11px |
| Color | `--text-placeholder` |
| Margin top | 12px (scale 3) |
| Background | `--bg-hover` |
| Padding | 2px 8px |
| Border radius | `--radius-sm` |

### Reasoning

The empty state is deliberately understated. A premium app doesn't shout "CREATE SOMETHING!" -- it calmly presents the option. The muted icon, medium-weight heading, and ghost button create a layered hierarchy: notice the message, optionally act on it. The keyboard shortcut hint rewards power users without cluttering the experience for mouse users.

---

## 7. Settings Integration

### Problem

Currently, settings live on a separate route (`/settings`), which causes a full page navigation away from the editor. This breaks flow and feels web-like, not desktop-like. Desktop apps present settings as an overlay or panel.

### Solution: Settings Slide-Over Panel

Settings should appear as a panel that slides in from the right side of the content area, overlaying the editor without navigating away.

### Layout

```
+----------+---------------------------+--------------+
|          |                           |              |
| Sidebar  |    Editor (dimmed)        |  Settings    |
|          |                           |  Panel       |
|          |                           |  380px       |
|          |                           |              |
+----------+---------------------------+--------------+
```

### Panel Container

| Property | Value |
|----------|-------|
| Width | 380px |
| Position | Fixed, right edge of content area |
| Height | Full height (header to status bar) |
| Background | `--bg-app` |
| Border left | 1px solid `--border-light` |
| Shadow | `--shadow-lg` (gives depth, creates layer separation) |
| z-index | `--z-dropdown` |

### Backdrop

When settings panel is open, the content area behind it dims slightly:

| Property | Value |
|----------|-------|
| Background | `rgba(0, 0, 0, 0.03)` (very subtle in light mode) |
| Clicks | Close the settings panel (click-away-to-close) |
| Transition | Opacity 200ms ease |

### Panel Header

```
+------------------------------------------+
|  Settings                           [X]  |
+------------------------------------------+
```

| Property | Value |
|----------|-------|
| Height | 48px |
| Padding | 0 16px (scale 4) |
| Border bottom | 1px solid `--border-light` |
| Title font size | 14px |
| Title font weight | 600 |
| Title color | `--text-primary` |
| Close button | 24x24px, "X" icon 14px, `--text-muted` |
| Close hover | `--bg-hover`, `--text-secondary` |

### Panel Content

Scrollable area below the header.

| Property | Value |
|----------|-------|
| Padding | 16px (scale 4) |
| Gap between setting groups | 24px (scale 6) |
| Overflow | Vertical scroll, thin scrollbar |

### Setting Group

Each setting group (Theme, Notes Path, Auto Save, etc.):

```
+------------------------------------------+
|  THEME                                   |
|  [Light] [Dark] [System]                 |
+------------------------------------------+
```

**Group label:**

| Property | Value |
|----------|-------|
| Font size | 11px |
| Font weight | 600 |
| Text transform | Uppercase |
| Letter spacing | 0.05em |
| Color | `--text-muted` |
| Margin bottom | 8px (scale 2) |

**Group content:**
Same visual styling as the current settings page form elements (toggle switches, button groups, inputs) but adapted to the narrower 380px panel width.

### Opening/Closing

| Trigger | Action |
|---------|--------|
| Sidebar "Settings" button | Opens panel |
| Panel close button (X) | Closes panel |
| Escape key | Closes panel |
| Click on dimmed backdrop | Closes panel |
| Cmd+, (standard macOS shortcut) | Toggles panel |

### Animation

| Property | Value |
|----------|-------|
| Enter | Slide from right, 250ms ease-out. `translateX(100%)` to `translateX(0)` |
| Exit | Slide to right, 200ms ease-in. `translateX(0)` to `translateX(100%)` |
| Backdrop | Fade in/out, 200ms ease |

### Reasoning

A slide-over panel keeps the user in context. They can see their document behind the settings and return instantly. This is the pattern used by Linear, Notion, and most modern desktop apps. The Cmd+, shortcut is the macOS standard for preferences and should feel native.

---

## 8. Component Change Summary

### Header (`+page.svelte` header section)

Changes:
- Reduce to essential elements: sidebar toggle, breadcrumbs, save dot, AI button
- Remove save status text (move to status bar)
- Keep 44px height
- Save status becomes a small colored dot only (no text)

### Fixed Formatting Toolbar (REMOVE)

The entire toolbar section below the header (lines containing B, I, S, Code, Text, H1, H2, H3, Undo, Redo buttons) should be removed. Users format via:
- Floating toolbar on text selection
- Slash menu
- Keyboard shortcuts

### Sidebar (`Sidebar.svelte`)

Changes:
- Add workspace identity section at top (app icon + name + new note button)
- Replace inline search with a clickable row that opens Quick Switcher
- Reduce font size from 14px to 13px for sidebar items
- Reduce icon size from 16px to 15px
- Change Settings link from `<a href="/settings">` to a button that opens the settings slide-over panel
- Change Trash link from `<a href="/trash">` to a button (future: opens trash panel)
- Reduce bottom bar font size to 12px

### Status Bar (NEW COMPONENT)

New component that sits at the absolute bottom of the app, spanning full width below both sidebar and content area.

### Settings Panel (NEW COMPONENT)

New slide-over panel component replacing the settings route.

### Empty State (modification in `+page.svelte`)

Redesigned empty state with subtler visual treatment: smaller icon, refined copy, ghost button instead of primary button.

---

## 9. Animation Specification

### Sidebar Collapse/Expand

| Property | Value |
|----------|-------|
| Duration | 300ms |
| Easing | ease |
| Properties animated | Width (sidebar container), opacity (sidebar content) |
| Content opacity | Fades to 0 during collapse, fades to 1 during expand |

### Settings Panel Slide

| Property | Value |
|----------|-------|
| Enter duration | 250ms |
| Enter easing | ease-out |
| Enter transform | `translateX(100%)` to `translateX(0)` |
| Exit duration | 200ms |
| Exit easing | ease-in |
| Exit transform | `translateX(0)` to `translateX(100%)` |
| Backdrop fade | 200ms ease |

### Status Bar Appearance

The status bar is always present -- no animation needed. Its content updates (save status, word count) should transition text opacity:

| Property | Value |
|----------|-------|
| Text change | Opacity 0 to 1, 150ms ease |

### Editor Content on Note Switch

Already specified: fade-in using `--duration-fast` (150ms) ease-out. No changes needed.

### Empty State

| Property | Value |
|----------|-------|
| Appearance | Fade in, 200ms ease-out, slight scale from 0.98 to 1 |
| Use existing class | `animate-scale-in-subtle` |

### Floating Toolbar (Selection)

Already specified in DESIGN.md Section 6.1: 150ms, translateY(4px) to translateY(0), opacity 0 to 1. No changes needed.

---

## 10. Accessibility

### Color Contrast

All combinations already verified in DESIGN.md Section 15.1. The status bar text uses `--text-muted` (#9b9a97) on `--bg-sidebar` (#fbfbfa) which is 3.4:1 -- passes WCAG AA for text 14px+ but is borderline. This is acceptable for supplementary metadata (word count, shortcuts) that is never the primary content.

### Focus Management

- Status bar elements are not focusable (display-only metadata)
- Settings panel: focus trap when open. First focus goes to close button. Escape closes panel.
- Settings panel: focus returns to the trigger button (sidebar Settings button) when panel closes
- Sidebar items: full keyboard navigation with arrow keys within each section

### Touch Targets

- All sidebar buttons: minimum 44px effective touch height (padding extends hit area)
- Header buttons: 28px visual, 44px touch target via transparent padding
- Status bar: not interactive, no touch targets needed

### Screen Reader

- Status bar: `role="status"`, `aria-live="polite"` for save status changes
- Status bar word count: `aria-label` with full text (e.g., "420 words, 2847 characters")
- Settings panel: `role="dialog"`, `aria-label="Settings"`, `aria-modal="true"`
- Empty state: `role="status"` with appropriate labeling

### Keyboard Shortcuts

| Action | Shortcut | Context |
|--------|----------|---------|
| Toggle sidebar | Cmd+B | Global |
| Open settings | Cmd+, | Global |
| Close settings | Escape | When settings panel is open |
| Quick switcher | Cmd+P | Global |
| AI prompt | Cmd+K | Global |
| New note | Cmd+N | Global |
| Save | Cmd+S | When document is open |

---

## 11. Token Extensions

### New Tokens

| Token | Value | Rationale |
|-------|-------|-----------|
| `--statusbar-height` | 28px | Layout calculations for the new status bar. No existing token covers this dimension. The sidebar, header, toolbar, and content-max-width all have tokens; the status bar should too. |
| `--settings-panel-width` | 380px | Consistent reference for the settings slide-over panel width. Avoids magic numbers in component code. |

### Modified Tokens

No existing tokens need modification. The header stays at 44px (close to current 45px; should be updated to exactly 44px for macOS alignment). Update:

| Token | Old Value | New Value | Rationale |
|-------|-----------|-----------|-----------|
| `--header-height` | 45px | 44px | Standard macOS titlebar height |

---

## 12. Edge Cases

### Narrow Window

When window width is less than 700px:
- Sidebar auto-collapses
- Settings panel takes full content area width (not 380px)
- Status bar content wraps: metadata on left, shortcuts hidden

### Very Long File Paths (Breadcrumbs)

When the breadcrumb path exceeds available header space:
- Middle segments collapse: `Notes / ... / Subfolder / Document`
- Only first segment, last folder, and document name remain visible
- Full path visible in tooltip on hover

### No Notes Exist (Fresh Install)

Sidebar workspaces section shows:
```
+------------------------------------------+
|                                          |
|          No notes yet                    |
|         [Create a note]                  |
|                                          |
+------------------------------------------+
```

Same styling as current empty sidebar state. The main content area shows the redesigned empty state from Section 6.

### Save Error

Status bar save status shows "Save failed" in `--color-error`. A toast notification also appears with error details (uses existing toast system from DESIGN.md Section 13).

### Dark Mode

All design tokens have dark mode variants already defined in `app.css`. The status bar uses `--bg-sidebar` which maps to `#202020` in dark mode. Settings panel uses `--bg-app` which maps to `#191919`. No additional dark mode tokens are needed.

---

## References

- Existing design system: `docs/DESIGN.md`
- Current main page: `src/routes/+page.svelte`
- Current sidebar: `src/lib/components/navigation/Sidebar.svelte`
- Current CSS tokens: `src/app.css`
- Current settings page: `src/routes/settings/+page.svelte`
- Inspiration: Notion (layout proportions), Linear (settings panel), Arc (sidebar density), VS Code (status bar)

---

## Implementation Notes

- The settings route (`/settings/+page.svelte`) can be deprecated once the settings panel is implemented. The route file can remain temporarily for fallback.
- The status bar is a new component -- it should sit outside the main flexbox column so it always appears at the absolute bottom, spanning the full app width including below the sidebar.
- Word count and character count should be computed reactively from the ProseMirror document state. Consider debouncing the calculation (every 500ms) to avoid performance impact during fast typing.
- The settings panel's click-away-to-close behavior should not close when clicking inside the panel itself -- only on the dimmed backdrop area.
