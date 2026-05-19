# Void Design System

A comprehensive design specification for Void - an AI-powered note-taking desktop app built with Tauri v2 + Svelte 5 + ProseMirror.

---

## Design Direction

**Minimal and Focused** - Clean, distraction-free writing environment that puts content first.

Void follows a restrained visual approach inspired by Notion's elegance, Bear's typography, and Craft's polish. The interface fades away when writing, revealing itself only when needed.

### Core Principles

1. **Content Over Chrome** - Interface elements recede, content dominates
2. **Progressive Disclosure** - Show complexity only when the user seeks it
3. **Subtle Visual Cues** - Gentle feedback, never jarring
4. **Keyboard-First** - Power users can navigate entirely without a mouse
5. **Consistent Rhythm** - Predictable spacing and timing throughout

### DO

- Prioritize the writing experience above all
- Use whitespace generously
- Make AI features discoverable but not intrusive
- Maintain consistent visual weight across elements
- Design for long-form reading and writing sessions

### DON'T

- Clutter the writing space with persistent controls
- Use aggressive colors that strain eyes
- Hide essential features behind too many clicks
- Add animations that distract from content
- Break visual rhythm with inconsistent spacing

---

## 1. Design Tokens

### 1.1 Color Palette

#### Light Theme (Default)

| Token | Value | Purpose |
|-------|-------|---------|
| `--bg-app` | #ffffff | Main application background |
| `--bg-sidebar` | #fbfbfa | Sidebar background (warm off-white) |
| `--bg-hover` | #f7f6f3 | Hover states, subtle backgrounds |
| `--bg-active` | #f0efec | Active/pressed states |
| `--bg-editor` | #ffffff | Editor content area |
| `--bg-card` | #ffffff | Floating elements (menus, popups) |
| `--bg-overlay` | rgba(15, 15, 15, 0.6) | Modal backdrops |

#### Text Colors

| Token | Value | Contrast | Purpose |
|-------|-------|----------|---------|
| `--text-primary` | #37352f | High | Main content, headings |
| `--text-secondary` | #6b6b6b | Medium | Secondary text, labels |
| `--text-muted` | #9b9a97 | Low | Tertiary text, placeholders |
| `--text-placeholder` | #c4c4c4 | Very low | Input placeholders |
| `--text-inverse` | #ffffff | High | Text on colored backgrounds |

#### Accent Colors

| Token | Value | Purpose |
|-------|-------|---------|
| `--accent-primary` | #2383e2 | Links, selected items, primary actions |
| `--accent-secondary` | #e8f0fe | Light accent backgrounds |
| `--accent-hover` | #1a6fc9 | Hover state for accent |
| `--accent-light` | #f0f7ff | Very light accent backgrounds |

#### Border Colors

| Token | Value | Purpose |
|-------|-------|---------|
| `--border-light` | #e9e9e7 | Subtle dividers, card borders |
| `--border-medium` | #dfdfde | Medium emphasis borders |
| `--border-dark` | #c4c4c4 | Strong emphasis borders |

#### Semantic Colors

| Token | Value | Purpose |
|-------|-------|---------|
| `--color-success` | #0f7b6c | Success states, confirmations |
| `--color-success-bg` | #e4f5f2 | Success backgrounds |
| `--color-warning` | #c77700 | Warning states |
| `--color-warning-bg` | #fef4e4 | Warning backgrounds |
| `--color-error` | #e03e3e | Error states |
| `--color-error-bg` | #fce4e4 | Error backgrounds |

#### Selection Colors

| Token | Value | Purpose |
|-------|-------|---------|
| `--selection-bg` | #d3e3fd | Text selection background |
| `--selection-border` | #2383e2 | Selection highlight border |

#### Block Highlight Colors

Used for text background highlighting in the editor:

| Token | Light Value |
|-------|-------------|
| `--bg-highlight-gray` | #f1f1ef |
| `--bg-highlight-brown` | #f4eeee |
| `--bg-highlight-orange` | #fbecdd |
| `--bg-highlight-yellow` | #fbf3db |
| `--bg-highlight-green` | #edf3ec |
| `--bg-highlight-blue` | #e7f3f8 |
| `--bg-highlight-purple` | #f4f0f7 |
| `--bg-highlight-pink` | #f9f2f5 |
| `--bg-highlight-red` | #fdebec |

#### Dark Theme

Dark theme uses a warm dark palette to reduce eye strain:

| Token | Light | Dark |
|-------|-------|------|
| `--bg-app` | #ffffff | #191919 |
| `--bg-sidebar` | #fbfbfa | #202020 |
| `--bg-hover` | #f7f6f3 | #2f2f2f |
| `--bg-active` | #f0efec | #3a3a3a |
| `--text-primary` | #37352f | #e6e6e4 |
| `--text-secondary` | #6b6b6b | #9b9b9b |
| `--accent-primary` | #2383e2 | #528bff |

### 1.2 Typography

#### Font Families

| Token | Value | Purpose |
|-------|-------|---------|
| `--font-sans` | -apple-system, BlinkMacSystemFont, 'Segoe UI'... | UI text, body content |
| `--font-serif` | 'Lyon-Text', Georgia... | Optional for reading mode |
| `--font-mono` | 'SFMono-Regular', Menlo, Consolas... | Code, monospace content |

**Reasoning:** System fonts provide native macOS feel, optimal rendering, and no font loading.

#### Type Scale

| Element | Size | Line Height | Weight |
|---------|------|-------------|--------|
| Note title | 40px | 1.2 | 700 |
| H1 | 30px | 1.3 | 700 |
| H2 | 24px | 1.35 | 600 |
| H3 | 20px | 1.4 | 600 |
| H4 | 18px | 1.4 | 600 |
| H5 | 16px | 1.4 | 600 |
| H6 | 14px | 1.4 | 600 |
| Body | 16px | 1.6 | 400 |
| Small/Caption | 14px | 1.5 | 400 |
| Tiny | 12px | 1.4 | 400 |

**Reasoning:**
- Note titles are extra large (40px) for clear document identification
- Body text at 16px with 1.6 line height for comfortable reading
- Headings use tighter line heights as text gets larger
- Semi-bold (600) for headings to distinguish from body without being too heavy

### 1.3 Spacing System

Based on 4px grid. Use scale numbers, not arbitrary values.

| Scale | Pixels | CSS Token | Use Cases |
|-------|--------|-----------|-----------|
| 0.5 | 2px | `--space-0.5` | Hairline gaps |
| 1 | 4px | `--space-1` | Icon gaps, tight padding |
| 1.5 | 6px | `--space-1.5` | Button padding (vertical) |
| 2 | 8px | `--space-2` | Small gaps, input padding |
| 2.5 | 10px | `--space-2.5` | Medium-small spacing |
| 3 | 12px | `--space-3` | Standard small padding |
| 4 | 16px | `--space-4` | Standard padding, gaps |
| 5 | 20px | `--space-5` | Medium spacing |
| 6 | 24px | `--space-6` | Large padding, section gaps |
| 8 | 32px | `--space-8` | Very large spacing |
| 10 | 40px | `--space-10` | Extra large spacing |
| 12 | 48px | `--space-12` | Page padding |
| 16 | 64px | `--space-16` | Major sections |

### 1.4 Border Radius

| Token | Size | Use Cases |
|-------|------|-----------|
| `--radius-sm` | 4px | Small elements (checkboxes, pills) |
| `--radius-md` | 6px | Default (buttons, inputs) |
| `--radius-lg` | 8px | Cards, modals, large elements |

**Rule:** Nested elements use smaller radius than their container.

### 1.5 Shadows

Two-part shadows for realistic depth:

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-sm` | 0 1px 2px rgba(0,0,0,0.04) | Subtle lift |
| `--shadow-md` | 0 4px 12px rgba(0,0,0,0.08) | Cards, floating toolbar |
| `--shadow-lg` | 0 8px 24px rgba(0,0,0,0.12) | Dropdowns, menus |
| `--shadow-dialog` | 0 8px 32px rgba(15,15,15,0.16) | Modals, dialogs |

### 1.6 Transitions

| Type | Duration | Easing | Token |
|------|----------|--------|-------|
| Instant | 100ms | ease | `--duration-instant` |
| Fast | 150ms | ease | `--duration-fast` |
| Normal | 200ms | ease | `--duration-normal` |
| Slow | 300ms | ease | `--duration-slow` |
| Slower | 500ms | ease | `--duration-slower` |

**Guidelines:**
- Color/opacity changes: 100-150ms
- Multiple property changes: 200ms
- Movement/position changes: 300ms
- Layout reflows: 300-500ms

### 1.7 Z-Index Scale

| Layer | Value | Token | Use |
|-------|-------|-------|-----|
| Base | 0 | `--z-base` | Default content |
| Dropdown | 100 | `--z-dropdown` | Dropdowns, autocomplete |
| Sticky | 200 | `--z-sticky` | Sticky headers |
| Overlay | 300 | `--z-overlay` | Backdrop overlays |
| Modal | 400 | `--z-modal` | Modal dialogs |
| Popover | 500 | `--z-popover` | Popovers, floating toolbar |
| Toast | 600 | `--z-toast` | Toast notifications |
| Tooltip | 700 | `--z-tooltip` | Tooltips |

### 1.8 Layout Dimensions

| Token | Value | Purpose |
|-------|-------|---------|
| `--sidebar-width` | 260px | Sidebar navigation width |
| `--header-height` | 45px | Top toolbar height |
| `--toolbar-height` | 44px | Floating toolbar height |
| `--content-max-width` | 720px | Editor content max width |

---

## 2. Editor Layout

### 2.1 Overall Structure

```
+----------------------------------------------------------+
|                      Header Toolbar                       | 45px
+----------+-----------------------------------------------+
|          |                                               |
| Sidebar  |              Editor Area                      |
| 260px    |                                               |
|          |  +---------------------------------------+    |
|          |  |         Content (max 720px)          |    |
|          |  |                                       |    |
|          |  |  Note Title (40px, bold)              |    |
|          |  |                                       |    |
|          |  |  Block content...                     |    |
|          |  |  Block content...                     |    |
|          |  |  Block content...                     |    |
|          |  +---------------------------------------+    |
|          |                                               |
+----------+-----------------------------------------------+
```

### 2.2 Editor Content Area

| Property | Value | Reasoning |
|----------|-------|-----------|
| Max width | 720px | Optimal line length for readability (65-75 characters) |
| Horizontal padding | 64px (scale 16) | Generous breathing room |
| Vertical padding | 48px (scale 12) | Space for note title |
| Background | `--bg-editor` | Clean white for focus |

### 2.3 Note Title

| Property | Value |
|----------|-------|
| Font size | 40px |
| Font weight | 700 (bold) |
| Line height | 1.2 |
| Margin bottom | 16px (scale 4) |
| Color | `--text-primary` |
| Placeholder | "Untitled" in `--text-placeholder` |

**Behavior:**
- Single-line, no wrapping
- Truncate with ellipsis if too long
- Editable inline (contenteditable)

### 2.4 Block Structure

Each block has a consistent structure for drag handles:

```
+--------+--------------------------------------------------+
| Gutter |                   Block Content                   |
| 56px   |                                                   |
+--------+--------------------------------------------------+
```

| Property | Value |
|----------|-------|
| Gutter width | 56px |
| Block min-height | 24px (for empty paragraphs) |
| Vertical margin | 3px (tight rhythm) |

---

## 3. Block Types

### 3.1 Paragraph

| Property | Value |
|----------|-------|
| Font size | 16px |
| Line height | 1.6 |
| Color | `--text-primary` |
| Margin | 3px 0 |

**Placeholder (first empty paragraph):**
- Text: "Type / for commands..."
- Color: `--text-placeholder`
- Disappears on focus

### 3.2 Headings

| Level | Size | Weight | Top Margin | Bottom Margin |
|-------|------|--------|------------|---------------|
| H1 | 30px | 700 | 2em | 0.5em |
| H2 | 24px | 600 | 1.5em | 0.5em |
| H3 | 20px | 600 | 1.25em | 0.5em |
| H4 | 18px | 600 | 1em | 0.5em |
| H5 | 16px | 600 | 1em | 0.5em |
| H6 | 14px | 600 | 1em | 0.5em |

**Special case:** First heading has no top margin.

### 3.3 Lists (Bullet and Numbered)

| Property | Value |
|----------|-------|
| Left padding | 1.5em |
| Item margin | 0.125em 0 |
| Item left padding | 0.25em |
| Bullet color | `--text-secondary` |

### 3.4 Todo/Checkbox

```
+----+------------------------------------------+
| [] | Todo item text                           |
+----+------------------------------------------+
```

| Property | Value |
|----------|-------|
| Checkbox size | 16x16px |
| Gap | 0.5em (8px) |
| Checked state | Line-through, opacity 60% |

**Checkbox States:**

| State | Appearance |
|-------|------------|
| Default | Empty square, border `--border-medium` |
| Hover | Border `--accent-primary` |
| Checked | Filled `--accent-primary`, white checkmark |
| Focus | Ring 2px `--accent-primary` |

### 3.5 Blockquote

| Property | Value |
|----------|-------|
| Left border | 3px solid `--border-medium` |
| Left padding | 1em |
| Text color | `--text-secondary` |
| Margin | 1em 0 |

### 3.6 Code Block

| Property | Value |
|----------|-------|
| Background | `--bg-sidebar` |
| Padding | 1em |
| Border radius | `--radius-md` |
| Font family | `--font-mono` |
| Font size | 0.875em (14px) |
| Line height | 1.5 |
| Margin | 1em 0 |

**Language selector (top-right):**
- Font size: 11px
- Color: `--text-muted`
- Background: transparent
- Hover: `--bg-hover`

### 3.7 Inline Code

| Property | Value |
|----------|-------|
| Background | `--color-error-bg` (soft red) |
| Text color | `--color-error` |
| Padding | 0.125em 0.375em |
| Border radius | `--radius-sm` |
| Font family | `--font-mono` |
| Font size | 0.875em |

### 3.8 Horizontal Rule (Divider)

| Property | Value |
|----------|-------|
| Border | 1px solid `--border-light` |
| Margin | 2em 0 |

### 3.9 Image

| Property | Value |
|----------|-------|
| Max width | 100% |
| Border radius | `--radius-md` |
| Margin | 1em 0 |

**Caption:**
- Font size: 0.875em
- Color: `--text-secondary`
- Text align: center
- Margin top: 0.5em

### 3.10 Callout

```
+----------------------------------------------------------+
| [icon] Callout content...                                 |
+----------------------------------------------------------+
```

| Variant | Background | Border Color |
|---------|------------|--------------|
| info | `--accent-light` | `--accent-primary` |
| warning | `--color-warning-bg` | `--color-warning` |
| error | `--color-error-bg` | `--color-error` |
| success | `--color-success-bg` | `--color-success` |
| note | `--bg-highlight-gray` | `--text-muted` |

| Property | Value |
|----------|-------|
| Padding | 1em |
| Border radius | `--radius-md` |
| Left border | 4px solid [variant color] |
| Margin | 1em 0 |

---

## 4. Block Handles

Block handles appear when hovering over a block, providing drag-and-drop and menu access.

### 4.1 Handle Container

```
+------+------+
| Drag | Menu |
+------+------+
```

| Property | Value |
|----------|-------|
| Position | Absolute, left of content |
| Left offset | -56px from content edge |
| Top offset | 2px (align with first line of text) |
| Gap between buttons | 2px |
| Opacity (default) | 0 |
| Opacity (hover) | 1 |
| Transition | opacity 150ms ease |

### 4.2 Drag Handle Button

The 6-dot grip pattern (3 rows x 2 columns of circles).

| Property | Value |
|----------|-------|
| Size | 24x24px |
| Icon size | 14x14px |
| Padding | 4px |
| Border radius | `--radius-sm` |
| Cursor | grab (grabbing when active) |

**States:**

| State | Background | Icon Color |
|-------|------------|------------|
| Default | transparent | `--text-muted` |
| Hover | `--bg-hover` | `--text-secondary` |
| Active | `--bg-active` | `--text-secondary` |
| Focus | ring 2px `--accent-primary` | `--text-secondary` |

### 4.3 Menu Trigger Button

Vertical 3-dot pattern.

| Property | Value |
|----------|-------|
| Size | 24x24px |
| Icon size | 14x14px |
| Padding | 4px |
| Border radius | `--radius-sm` |
| Cursor | pointer |

**States:** Same as drag handle.

### 4.4 Drop Indicator

Visual feedback showing where a dragged block will be inserted.

| Property | Value |
|----------|-------|
| Height | 2px |
| Color | `--accent-primary` |
| Border radius | 1px |
| Box shadow | 0 0 0 2px `--accent-secondary` |

**Circle indicator (left edge):**
- Size: 8x8px
- Background: `--accent-primary`
- Border radius: 50%
- Position: -4px from line start

### 4.5 Dragging State

When a block is being dragged:

| Property | Value |
|----------|-------|
| Opacity | 0.4 |
| Pointer events | none |

---

## 5. Slash Menu

The command palette triggered by typing "/" in the editor.

### 5.1 Container

| Property | Value |
|----------|-------|
| Position | Fixed, below cursor |
| Width | 280px |
| Max height | 400px |
| Background | `--bg-card` |
| Border | 1px solid `--border-light` |
| Border radius | `--radius-lg` |
| Box shadow | `--shadow-lg` |
| Z-index | `--z-popover` |

**Animation (appear):**
- Duration: 200ms
- Easing: ease-out
- Transform: scale(0.95) to scale(1)
- Opacity: 0 to 1
- Origin: top left

### 5.2 Search Header

```
+----------------------------------------------------------+
| /  Type to filter...                                      |
+----------------------------------------------------------+
```

| Property | Value |
|----------|-------|
| Padding | 10px 12px |
| Background | `--bg-secondary` / `--bg-sidebar` |
| Border bottom | 1px solid `--border-light` |

**Slash symbol:**
- Font size: 14px
- Font weight: 600
- Color: `--accent-primary`

**Query text:**
- Font size: 14px
- Color: `--text-primary`

**Placeholder:**
- Text: "Type to filter..."
- Color: `--text-muted`

### 5.3 Command List

| Property | Value |
|----------|-------|
| Max height | ~320px (scrollable) |
| Padding | 4px 0 |
| Overflow | auto (thin scrollbar) |

### 5.4 Category Headers

| Property | Value |
|----------|-------|
| Padding | 6px 12px 4px |
| Font size | 11px |
| Font weight | 600 |
| Text transform | uppercase |
| Letter spacing | 0.05em |
| Color | `--text-muted` |

### 5.5 Command Items

```
+----------------------------------------------------------+
| [icon]  Label                                    [kbd]    |
|         Description (optional)                            |
+----------------------------------------------------------+
```

| Property | Value |
|----------|-------|
| Padding | 8px 12px |
| Gap | 10px |
| Border radius | 0 (full-width hover) |

**Icon container:**
- Size: 28x28px
- Background: `--bg-hover`
- Border radius: `--radius-sm`
- Font size: 12px (for text icons like "H1")

**Label:**
- Font size: 13px
- Font weight: 500
- Color: `--text-primary`

**Description:**
- Font size: 11px
- Color: `--text-muted`
- Truncate with ellipsis

**Keyboard shortcut:**
- Background: `--bg-active`
- Padding: 2px 6px
- Border radius: `--radius-sm`
- Font family: `--font-mono`
- Font size: 11px
- Color: `--text-muted`

### 5.6 Command Item States

| State | Background | Icon Background | Label Color |
|-------|------------|-----------------|-------------|
| Default | transparent | `--bg-hover` | `--text-primary` |
| Hover | `--bg-hover` | `--bg-active` | `--text-primary` |
| Selected | `--accent-light` | `--accent-secondary` | `--accent-primary` |
| Focus | ring 2px inset | `--accent-secondary` | `--accent-primary` |

### 5.7 Footer Hints

| Property | Value |
|----------|-------|
| Padding | 8px 12px |
| Background | `--bg-secondary` / `--bg-sidebar` |
| Border top | 1px solid `--border-light` |
| Font size | 11px |
| Color | `--text-muted` |

Content: "Up/Down navigate, Enter select, Esc close"

---

## 6. Floating Toolbar

Selection-based formatting toolbar that appears above selected text.

### 6.1 Container

| Property | Value |
|----------|-------|
| Position | Fixed, above selection |
| Background | `--bg-card` |
| Border | 1px solid `--border-light` |
| Border radius | `--radius-md` |
| Box shadow | `--shadow-md` |
| Z-index | `--z-popover` |
| Padding | 6px 8px |
| Gap | 4px |

**Animation:**
- Duration: 150ms
- Transform: translateY(4px) to translateY(0)
- Opacity: 0 to 1

**Positioning:**
- 8px gap above selection
- Centered horizontally
- If not enough space above, show below selection
- Constrain to viewport edges (8px margin)

### 6.2 Toolbar Buttons

| Property | Value |
|----------|-------|
| Size | 28x28px |
| Border radius | `--radius-sm` |
| Background | transparent |
| Color | `--text-secondary` |

**States:**

| State | Background | Color |
|-------|------------|-------|
| Default | transparent | `--text-secondary` |
| Hover | `--bg-hover` | `--text-primary` |
| Active (pressed) | `--bg-active` | `--text-primary` |
| Active (toggled) | `--accent-light` | `--accent-primary` |
| Disabled | transparent, opacity 50% | `--text-muted` |
| Focus | ring 2px `--accent-primary` | - |

### 6.3 Toolbar Divider

| Property | Value |
|----------|-------|
| Width | 1px |
| Height | 12px |
| Background | `--border-light` |
| Margin | 0 4px |

### 6.4 Button Groups

- **Formatting:** Bold, Italic, Strikethrough, Code
- **Headings:** H1, H2, H3
- **Highlight:** Color picker button
- **Link:** Link button

### 6.5 Highlight Color Picker

Dropdown grid of color swatches.

| Property | Value |
|----------|-------|
| Position | Below toolbar button |
| Grid | 5 columns |
| Gap | 4px |
| Padding | 8px |
| Background | `--bg-card` |
| Border | 1px solid `--border-light` |
| Border radius | `--radius-md` |
| Box shadow | `--shadow-md` |

**Color swatch:**
- Size: 24x24px
- Border: 1px solid `--border-light`
- Border radius: `--radius-sm`
- Hover: scale(1.1), shadow 0 2px 4px rgba(0,0,0,0.1)

---

## 7. AI Rewrite Popup

Popup showing AI processing state and results.

### 7.1 Container

| Property | Value |
|----------|-------|
| Position | Fixed, near selection |
| Min width | 280px |
| Max width | 400px |
| Background | `--bg-card` |
| Border | 1px solid `--border-light` |
| Border radius | `--radius-lg` |
| Box shadow | `--shadow-lg` |
| Z-index | 1000 (above all) |

**Animation:** Same as slash menu.

### 7.2 Processing State

```
+----------------------------------------------------------+
| [spinner]  Rewriting...                        [Cancel]   |
+----------------------------------------------------------+
```

| Element | Property | Value |
|---------|----------|-------|
| Container | Padding | 12px 16px |
| Container | Gap | 12px |
| Spinner | Size | 20x20px |
| Spinner | Color | `--accent-primary` |
| Spinner | Animation | rotate 1s linear infinite |
| Label | Font weight | 500 |
| Label | Color | `--text-primary` |
| Cancel button | Font size | 12px |
| Cancel button | Color | `--text-muted` |

### 7.3 Error State

| Property | Value |
|----------|-------|
| Background | `--color-error-bg` |
| Icon color | `--color-error` |
| Text color | `--color-error` |

### 7.4 Result State

```
+----------------------------------------------------------+
|  Rewrite Result                                           |
+----------------------------------------------------------+
|  ORIGINAL                                                 |
|  [original text preview]                                  |
|                                                           |
|      v (arrow)                                            |
|                                                           |
|  RESULT                                                   |
|  [new text preview]                                       |
+----------------------------------------------------------+
|  [Reject]                              [Accept]           |
+----------------------------------------------------------+
```

**Header:**
- Padding: 12px 16px
- Border bottom: 1px solid `--border-light`
- Font weight: 600

**Preview sections:**
- Label: 11px, uppercase, `--text-muted`
- Text container: 8px padding, `--bg-sidebar` background
- Max height: 80px (scrollable)
- Font size: 13px
- Border radius: `--radius-sm`

**Result text container:**
- Background: `--color-success-bg`
- Border: 1px solid `--color-success`

**Action bar:**
- Padding: 12px 16px
- Background: `--bg-sidebar`
- Gap: 8px
- Border radius: 0 0 `--radius-lg` `--radius-lg`

### 7.5 Action Buttons

| Button | Background | Color | Icon |
|--------|------------|-------|------|
| Reject | `--bg-card`, border `--border-light` | `--text-primary` | X |
| Accept | `--accent-primary` | `--text-inverse` | Checkmark |

| State | Reject | Accept |
|-------|--------|--------|
| Hover | `--bg-hover` | `--accent-hover` |
| Focus | ring 2px `--accent-primary` | ring 2px `--accent-primary` |

### 7.6 Keyboard Shortcuts

- **Escape:** Cancel (processing) or Reject (result)
- **Cmd+Enter:** Accept result

---

## 8. Block Menu

Context menu when clicking block menu trigger.

### 8.1 Container

| Property | Value |
|----------|-------|
| Width | 200px |
| Background | `--bg-card` |
| Border | 1px solid `--border-light` |
| Border radius | `--radius-md` |
| Box shadow | `--shadow-lg` |
| Z-index | `--z-dropdown` |
| Padding | 4px 0 |

### 8.2 Menu Items

```
+----------------------------------------------------------+
| [icon]  Delete                                   Del      |
+----------------------------------------------------------+
```

| Property | Value |
|----------|-------|
| Padding | 8px 12px |
| Gap | 8px |
| Font size | 13px |
| Color | `--text-primary` |

**States:**

| State | Background |
|-------|------------|
| Default | transparent |
| Hover | `--bg-hover` |
| Focus | `--bg-hover`, ring inset |

**Destructive items (Delete):**
- Color: `--color-error`
- Hover background: `--color-error-bg`

### 8.3 Menu Actions

- Turn into (submenu: Paragraph, H1, H2, H3, Bullet, Numbered, Todo, Quote, Code)
- Duplicate
- Copy link to block
- ---
- Delete

---

## 9. Sidebar

### 9.1 Container

| Property | Value |
|----------|-------|
| Width | 260px (collapsible to 0) |
| Background | `--bg-sidebar` |
| Border right | 1px solid `--border-light` |
| Transition | width 300ms ease |

### 9.2 Sections

**Section header:**
- Padding: 8px 12px 4px
- Font size: 11px
- Font weight: 600
- Text transform: uppercase
- Letter spacing: 0.05em
- Color: `--text-muted`

**Sections:**
1. Quick Access (Search, New Note, Favorites)
2. Workspaces (Folder tree)
3. Recent (Last accessed notes)
4. Bottom bar (Trash, Settings)

### 9.3 Sidebar Items

| Property | Value |
|----------|-------|
| Padding | 6px 8px |
| Gap | 10px |
| Border radius | `--radius-md` |
| Font size | 14px |
| Color | `--text-secondary` |

**States:**

| State | Background | Color |
|-------|------------|-------|
| Default | transparent | `--text-secondary` |
| Hover | `--bg-hover` | `--text-secondary` |
| Selected | `--bg-active` | `--text-primary` |
| Focus | `--bg-hover`, ring | `--text-secondary` |

### 9.4 Folder Tree

**Expand/collapse chevron:**
- Size: 16x16px
- Color: `--text-muted`
- Rotation: 0deg (collapsed), 90deg (expanded)
- Transition: 150ms

**Indentation:** 16px per level

---

## 10. Editor Toolbar (Fixed)

The fixed toolbar at the top of the editor area.

### 10.1 Container

| Property | Value |
|----------|-------|
| Height | 44px |
| Background | `--bg-app` |
| Border bottom | 1px solid `--border-light` |
| Padding | 6px 16px |

### 10.2 Toolbar Buttons

Same as floating toolbar buttons, but always visible.

---

## 11. Quick Switcher (Cmd+P)

Global search/navigation overlay.

### 11.1 Overlay

| Property | Value |
|----------|-------|
| Position | Fixed, full screen |
| Background | `--bg-overlay` |
| Z-index | `--z-modal` |

### 11.2 Modal

| Property | Value |
|----------|-------|
| Width | 500px |
| Max height | 400px |
| Position | centered, top 20% |
| Background | `--bg-card` |
| Border radius | `--radius-lg` |
| Box shadow | `--shadow-dialog` |

### 11.3 Search Input

| Property | Value |
|----------|-------|
| Padding | 16px |
| Font size | 16px |
| Border bottom | 1px solid `--border-light` |

### 11.4 Results List

| Property | Value |
|----------|-------|
| Max height | ~300px |
| Padding | 4px 0 |

**Result item:**
- Padding: 10px 16px
- Show: title, path breadcrumb
- States: same as command items

---

## 12. AI Prompt Window (Cmd+K)

Global AI assistant overlay.

### 12.1 Layout

Similar to Quick Switcher but with chat interface.

### 12.2 Input Area

| Property | Value |
|----------|-------|
| Min height | 44px |
| Max height | 200px (expandable) |
| Padding | 12px 16px |
| Border top | 1px solid `--border-light` |

### 12.3 Message Bubbles

**User message:**
- Background: `--bg-hover`
- Border radius: `--radius-md`
- Align: right

**AI message:**
- Background: transparent
- Border left: 2px solid `--accent-primary`
- Padding left: 12px

**Loading state:**
- Animated dots or typing indicator
- Color: `--text-muted`

---

## 13. Toast Notifications

### 13.1 Container

| Property | Value |
|----------|-------|
| Position | Fixed, bottom-right |
| Offset | 16px from edges |
| Z-index | `--z-toast` |

### 13.2 Toast

| Property | Value |
|----------|-------|
| Min width | 280px |
| Max width | 400px |
| Padding | 12px 16px |
| Background | `--bg-card` |
| Border | 1px solid `--border-light` |
| Border radius | `--radius-md` |
| Box shadow | `--shadow-md` |

**Variants:**
- Info: left border 3px `--accent-primary`
- Success: left border 3px `--color-success`
- Warning: left border 3px `--color-warning`
- Error: left border 3px `--color-error`

**Animation:**
- Enter: slide-in-right, 300ms
- Exit: slide-out-right, 200ms
- Auto-dismiss: 5 seconds default

---

## 14. Component States Summary

All interactive elements support these states:

| State | Description |
|-------|-------------|
| Default | Base appearance |
| Hover | Mouse over (desktop) |
| Active/Pressed | During click/tap |
| Focus | Keyboard focus (visible ring) |
| Disabled | Non-interactive (opacity 50%, cursor not-allowed) |
| Loading | Processing (spinner or skeleton) |
| Error | Validation failure (red border/text) |

### Focus Ring Standard

```
outline: 2px solid var(--accent-primary);
outline-offset: 2px;
```

---

## 15. Accessibility

### 15.1 Color Contrast

All text must meet WCAG 2.1 AA standards:

| Combination | Ratio | Passes |
|-------------|-------|--------|
| `--text-primary` on `--bg-app` | 12.6:1 | AAA |
| `--text-secondary` on `--bg-app` | 5.9:1 | AA |
| `--text-muted` on `--bg-app` | 3.5:1 | AA Large |
| `--accent-primary` on `--bg-app` | 4.5:1 | AA |
| `--text-inverse` on `--accent-primary` | 4.5:1 | AA |

### 15.2 Focus Management

- All interactive elements have visible focus indicators
- Focus trap in modals/dialogs
- Escape closes modals and menus
- Arrow keys navigate menus and lists
- Tab navigates between focusable elements

### 15.3 Touch Targets

Minimum touch target size: 44x44px
(Even if visual element is smaller, clickable area meets minimum)

### 15.4 Screen Reader

- Proper ARIA labels on all interactive elements
- Live regions for dynamic content
- Landmark roles for main sections
- Skip links for keyboard navigation

### 15.5 Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New note | Cmd+N |
| Save | Cmd+S |
| Search/Quick Switcher | Cmd+P |
| AI Prompt | Cmd+K |
| Toggle sidebar | Cmd+B |
| Bold | Cmd+B |
| Italic | Cmd+I |
| Undo | Cmd+Z |
| Redo | Cmd+Shift+Z |
| Close menu/modal | Escape |
| Accept AI result | Cmd+Enter |

---

## 16. Animation Guidelines

### 16.1 Principles

- **Purpose:** Animations communicate state changes and spatial relationships
- **Speed:** Fast enough to not impede productivity
- **Easing:** Natural ease curves, never linear for UI
- **Consistency:** Same animation for same type of action

### 16.2 Standard Animations

| Animation | Duration | Transform | Use |
|-----------|----------|-----------|-----|
| fade-in | 200ms | opacity 0 to 1 | Content appearing |
| scale-in | 200ms | scale(0.95) to scale(1) | Menus, popups |
| slide-in-up | 200ms | translateY(10px) to 0 | Toasts, notifications |
| slide-in-down | 200ms | translateY(-10px) to 0 | Dropdown menus |

### 16.3 Micro-interactions

- Button press: scale(0.98) for 100ms
- Toggle switch: 200ms slide
- Checkbox: 150ms scale bounce
- Loading spinner: 1s linear rotation

---

## 17. Dark Mode Considerations

When `[data-theme='dark']` is applied:

### 17.1 Adjustments

- Reduce contrast slightly (pure white is harsh)
- Shadows become more subtle (darker backgrounds absorb shadow)
- Accent colors shift lighter for visibility
- Borders become subtler

### 17.2 Never Do

- Use pure black (#000000) backgrounds
- Use pure white (#ffffff) text
- Keep same shadow opacity as light mode
- Forget to test highlight colors

---

## 18. Implementation Notes

### 18.1 CSS Variables

All design tokens are defined as CSS custom properties in `:root` with dark theme overrides in `[data-theme='dark']`.

### 18.2 Spacing

Use Tailwind spacing scale (1-16+) mapped to 4px grid.

### 18.3 Component Architecture

Components should:
- Accept style customization via CSS variables
- Support all 7 states where applicable
- Handle keyboard navigation
- Include ARIA attributes
- Respect reduced motion preferences

### 18.4 Testing

Design verification checklist:
- [ ] All states are visually distinct
- [ ] Focus is always visible
- [ ] Contrast meets WCAG AA
- [ ] Touch targets meet 44px minimum
- [ ] Animations respect reduced motion
- [ ] Dark mode tested thoroughly
- [ ] Keyboard navigation works

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-01 | Initial comprehensive design specification |
