# Todo Node Implementation Incomplete

**Discovered:** 2026-02-22
**Status:** Fixed
**Component:** ProseMirror block editor

## The Problem

Todo items in Void were completely non-functional:

1. Slash command `/todo` didn't render a todo
2. Typing `- [ ]` created a bullet list with literal `[ ]` text instead of a checkbox
3. Todos from notes didn't appear in the TODO manager
4. Checkboxes didn't respond to clicks

## Root Causes

Adding a new block type to ProseMirror requires wiring **seven separate systems**. Missing any one breaks the feature:

### 1. Slash Command Missing

**File:** `commands/blocks.ts` — `setBlockTypeFromDomain()`

The function converts current block to a different type. Had cases for `paragraph`, `heading`, `bulletList`, etc. but **no case for `todoItem`**:

```typescript
// Missing from setBlockTypeFromDomain()
case 'todoItem':
    return commands.setBlockType(name, attrs);
```

**Result:** `/todo` slash command couldn't convert blocks to todos.

### 2. No Input Rule for Keyboard Shortcut

**File:** `listInputRules.ts`

Only had input rules for bullet lists (`- `) and ordered lists (`1. `). No rule for GFM task lists (`- [ ] `):

```typescript
// Missing rule
textblockTypeInputRule({
    find: /^\s*[-*]\s\[([ xX])\]\s$/,
    type: schema.nodes.todoItem,
    getAttrs: (match) => ({
        checked: match[1] ? match[1].toLowerCase() === 'x' : false,
    }),
})
```

**Result:** Typing `- [ ]` created a bullet list item with literal `[ ]` text.

### 3. CSS Class Mismatch

**File:** `app.css`

CSS used selectors `.todo-item`, `.todo-checkbox`, `.todo-checked` but the schema's `toDOM` rendered completely different classes: `.void-todo`, `.void-todo-checked`, `.void-todo-content`.

**Result:** Styles didn't apply even when nodes existed.

### 4. No NodeView for Interactive Elements

**File:** Missing `views/TodoItemView.ts`

ProseMirror suppresses native input events on DOM elements rendered by `toDOM`. Checkboxes rendered statically can't be clicked.

**Required:** Custom NodeView that:
- Renders the checkbox
- Attaches click handler
- Dispatches ProseMirror transaction to toggle `checked` state

**Result:** Checkboxes rendered but didn't respond to clicks.

### 5. NodeView Not Registered

**File:** `ProseMirrorAdapter.ts`

Adapters are registered in the editor's nodeViews config. NodeView wasn't registered:

```typescript
// Missing from nodeViews config
todoItem: (node, view, getPos) => new TodoItemView(node, view, getPos),
```

**Result:** Custom NodeView was defined but never used—fell back to static toDOM.

### 6. Markdown Parser Doesn't Detect Task Lists

**File:** `markdown/parser.ts` — `parseBulletList()`

The markdown parser reads `.md` files and converts them to ProseMirror nodes. It handled bullet lists but not GFM task lists (`- [ ] text`).

**Result:** Existing todos in markdown files weren't parsed as `todoItem` nodes—became regular bullet list items.

### 7. Markdown Serializer Doesn't Output Task List Syntax

**File:** `markdown/serializer.ts` (if custom)

The serializer converts ProseMirror nodes back to markdown. Without handling, `todoItem` nodes would serialize as regular list items, losing the checkbox syntax.

## The Fix

### 1. Add Slash Command

In `commands/blocks.ts`, add to `setBlockTypeFromDomain()`:

```typescript
case 'todoItem':
    return commands.setBlockType(name, attrs);
```

### 2. Add Input Rule

In `listInputRules.ts`, add before bullet list rule (ordering matters):

```typescript
textblockTypeInputRule({
    find: /^\s*[-*]\s\[([ xX])\]\s$/,
    type: schema.nodes.todoItem,
    getAttrs: (match) => ({
        checked: match[1] ? match[1].toLowerCase() === 'x' : false,
    }),
}),
```

**Why before bullet list?** Input rules are tried in order. The task list pattern is more specific, so it must run first.

### 3. Fix CSS Classes

In `app.css`, align with schema's `toDOM`:

```css
.void-todo {
    @apply flex items-center gap-2 my-1;
}

.void-todo-checkbox {
    @apply w-4 h-4 cursor-pointer appearance-none border border-gray-300 rounded;
    accent-color: currentColor;
}

.void-todo-checkbox:checked {
    @apply bg-blue-500 border-blue-500;
}

.void-todo-checked {
    @apply text-gray-400 line-through;
}

.void-todo-content {
    @apply flex-1;
}
```

### 4. Create NodeView

Create `views/TodoItemView.ts`:

```typescript
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorView } from '@tiptap/pm/view';

export class TodoItemView {
    dom: HTMLElement;
    checkbox: HTMLInputElement;

    constructor(node: ProseMirrorNode, view: EditorView, getPos: () => number) {
        this.dom = document.createElement('li');
        this.dom.className = 'void-todo';

        this.checkbox = document.createElement('input');
        this.checkbox.type = 'checkbox';
        this.checkbox.className = 'void-todo-checkbox';
        this.checkbox.checked = node.attrs.checked;

        const content = document.createElement('span');
        content.className = 'void-todo-content';
        content.contentEditable = 'true';

        this.dom.appendChild(this.checkbox);
        this.dom.appendChild(content);

        // Handle checkbox click
        this.checkbox.addEventListener('change', () => {
            const pos = getPos();
            view.dispatch(
                view.state.tr.setNodeMarkup(pos, undefined, {
                    checked: this.checkbox.checked,
                })
            );
        });
    }
}
```

### 5. Register NodeView

In `ProseMirrorAdapter.ts`, add to nodeViews config:

```typescript
import { TodoItemView } from '../views/TodoItemView';

const nodeViews = {
    todoItem: (node, view, getPos) => new TodoItemView(node, view, getPos),
    // ... other views
};
```

### 6. Update Markdown Parser

In `markdown/parser.ts`, add function to detect GFM task lists:

```typescript
function parseTodoListItems(lines: string[]): Array<{
    type: 'todoItem' | 'bulletListItem';
    content: string;
    checked: boolean;
}> {
    return lines.map((line) => {
        const todoMatch = line.match(/^\s*[-*]\s\[([ xX])\]\s(.*)$/);
        if (todoMatch) {
            return {
                type: 'todoItem',
                content: todoMatch[2],
                checked: todoMatch[1].toLowerCase() === 'x',
            };
        }
        return {
            type: 'bulletListItem',
            content: line.replace(/^\s*[-*]\s/, ''),
            checked: false,
        };
    });
}
```

Call this in the list parsing logic:

```typescript
// In parseBulletList()
const items = parseTodoListItems(listLines);
items.forEach((item) => {
    if (item.type === 'todoItem') {
        nodes.push(
            schema.nodes.todoItem.create(
                { checked: item.checked },
                schema.text(item.content)
            )
        );
    } else {
        // Regular bullet list item
    }
});
```

### 7. Update Markdown Serializer

In markdown serializer output, detect `todoItem` nodes:

```typescript
case 'todoItem': {
    const checked = node.attrs.checked ? 'x' : ' ';
    return `- [${checked}] ${content}`;
}
```

## Key Learning

**When adding a new block type to ProseMirror, ALL of these must be wired:**

1. **Schema** — Define `node` with `toDOM` and `parseDOM`
2. **Slash Command** — Case in `setBlockTypeFromDomain()` or similar
3. **Input Rule** — Keyboard shortcut pattern for auto-conversion
4. **NodeView** — Interactive elements need click handlers
5. **Registration** — NodeView must be registered in editor config
6. **CSS** — Match the exact class names from `toDOM`/NodeView
7. **Markdown Parser** — Detect syntax when reading `.md` files
8. **Markdown Serializer** — Output correct syntax when writing `.md` files (bonus, but important for portability)

Missing any **one** of these creates a broken experience for one workflow (slash command works but clicks don't, or keyboard shortcut works but slash command doesn't, etc.).

## Testing Checklist

After implementing:

- [ ] Type `/todo` and press Space → Creates todo item
- [ ] Type `- [ ] text` and press Enter → Creates unchecked todo
- [ ] Click checkbox → Toggles checked state visually
- [ ] Save note and reopen → Checkbox state persists
- [ ] Load existing markdown with `- [x] text` → Parses as todo with checked state
- [ ] Save note with todos → Markdown contains `- [x]` syntax
- [ ] Toggle in editor, then save → `.md` file reflects correct state

## Related

- [ProseMirror editor integration guide](../PROFILE.md#editor-architecture) — Block system overview
- [Markdown parser architecture](../domain/README.md) — How notes are read/written
