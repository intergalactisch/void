# void Features

## Implemented

| Feature | Description |
|---------|-------------|
| Hexagonal Architecture | Domain/ports/adapters separation with DI container |
| Settings System | Persistent settings with theme, notes path, AI provider config |
| File System Abstraction | Tauri and memory adapters for file operations |
| Credential Storage | Secure keychain integration for API keys |
| ProseMirror Editor | Block-based editor with rich text formatting |
| Slash Menu | Command palette for inserting blocks |
| Drag & Drop | Block reordering with visual feedback |
| AI Rewrite | In-editor text rewriting with AI |
| AI Domain Layer | Tool, ToolInvocation, Message, Conversation entities |
| AI Ports | ToolRegistry, ToolExecutor, ContextProvider, AIAssistantProvider |

## In Progress

| Feature | Priority | Notes |
|---------|----------|-------|
| AI Services | High | AIAssistantService and ToolRegistryService implementation |
| Prompt Window | High | Cmd+K global AI prompt interface |

## Planned

| Feature | Priority | Notes |
|---------|----------|-------|
| Note storage | High | Local file storage for notes |
| Note list | High | Browse and search notes |
| TODO system | High | Task management across notes |
| Organization | Medium | Folders, tags, or other organizing system |
| Search | Medium | Full-text search across notes |
| Export | Low | Export notes to various formats |
| Sync | Low | Cloud sync between devices |
