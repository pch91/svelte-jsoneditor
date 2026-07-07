# svelte-jsoneditor-plus

An enhanced fork of **svelte-jsoneditor**, a web-based tool to view, edit, format, transform, compare, preview, and validate JSON.

Try it out: <[https://jsoneditoronline.org](https://pch91.github.io/svelte-jsoneditor/development/)>

[![JSONEditor tree mode screenshot](https://github.com/pch91/svelte-jsoneditor/blob/develop/misc/Screenshot%202026-07-07%20091934.png?raw=true)]
[![JSONEditor text mode screenshot](https://github.com/pch91/svelte-jsoneditor/blob/develop/misc/Screenshot%202026-07-07%20092123.png?raw=true)]
[![JSONEditor compare mode screenshot](https://github.com/pch91/svelte-jsoneditor/blob/develop/misc/Screenshot%202026-07-07%20092347.png?raw=true)]
[![JSONEditor validate mode screenshot](https://github.com/pch91/svelte-jsoneditor/blob/develop/misc/Screenshot%202026-07-07%20092421.png?raw=true)]

> Original project: https://github.com/josdejong/svelte-jsoneditor
>
> All credit for the foundation, architecture, and the vast majority of the editor functionality goes to **Jos de Jong** and all contributors to the original project.
>
> This fork builds on top of their excellent work, extending the editor with preview capabilities, multi-window workflows, IDE-style layouts, advanced comparison tools, and deployment improvements.
>
> Thank you to **Jos de Jong** for creating and maintaining one of the best JSON editing experiences available in the open-source ecosystem.

## About this Fork

This fork expands the original editor with a focus on:

- Rich content previewing
- Multi-window editing workflows
- IDE-style workspace experience
- Advanced JSON comparison tooling
- Improved usability and navigation
- GitHub Pages deployment support
- Stability and workflow fixes

## New Features

### Content Preview System

Added an **Edit with Preview** option inside the Edit dropdown of the context menu (Tree and Table modes).

The preview system supports:

- Markdown
- Math
- HTML
- Plain Text
- Images
- CSV
- Source Code

A dedicated format selector allows switching between renderers while editing content.

### Floating Windows

Introduced a complete floating window framework:

- Draggable windows
- Resizable windows
- Minimize support
- Maximize support
- Multiple concurrent windows
- Automatic z-index management

### Preview Modal

New split-view preview editor featuring:

- Editable text area
- Live preview pane
- Real-time rendering updates
- Support for multiple content formats

### Code Rendering & Syntax Highlighting

Added syntax highlighting support for:

- JavaScript
- TypeScript
- HTML
- CSS
- Java
- JSON

### Preview Window Management

Implemented dedicated preview window infrastructure:

- PreviewWindows store
- Window stacking management
- Multi-window workflow support
- Independent preview sessions

### Save Back to JSON

Added a Save action capable of persisting edited preview content directly back into the JSON document through JSON Patch updates.

### Standalone Preview Renderers

Created reusable preview renderers for:

- Markdown
- Math
- HTML
- Text
- Image
- CSV
- Code

These renderers can be reused independently across the application.

---

## IDE-Style Workspace

This fork introduces a full development workspace experience.

### Full Viewport Layout

- Fixed viewport layout
- No page scrolling
- Dark-theme-first interface
- IDE-inspired user experience

### Tabs

Added a complete tab management system:

- Create tabs
- Close tabs
- Rename tabs
- Move tabs between panes

### Split Panes

Support for:

- 1 to 4 panes
- Vertical splits
- Horizontal splits
- Independent tabs per pane

### Sidebar

New collapsible sidebar with organized settings sections for improved workspace management.

### Toolbar

Extended toolbar controls:

- Theme selection
- Indentation settings
- Parser selection
- Current path display
- Split layout controls

### Status Bar

New status information including:

- Active mode
- Query language
- Pane count
- Tab count

---

## Compare & Diff Features

### JSON Comparison Mode

Added document comparison tooling.

Features include:

- Compare toggle in sidebar
- Automatic difference highlighting
- Visual node comparison
- Yellow-highlighted changed nodes

### Live Diff Tracking

Differences are recalculated automatically whenever content changes.

### Smart Mode Switching

When comparison is enabled, the editor automatically switches to Tree Mode to ensure differences remain visible and easy to inspect.

---

## Window & UI Improvements

### Minimized Windows Bar

Added a minimized window bar inspired by chat interfaces:

- Quick restore actions
- Easy window management
- Persistent access to minimized previews

### Popup Fixes

Resolved popup clipping issues caused by overflow constraints, improving usability of context menus and dialogs.

### Root Routing

Updated application routing so the root path redirects to:

`/development`

---

## Stability Fixes

### Content Preservation

- Preserves content while switching between Tree, Text, and Table modes.

### Reliable Mode Switching

- Reworked mode handling using immutable state updates and dedicated change callbacks.

### Reactive Tab State Improvements

- Fixed tab content synchronization and state reactivity issues.

### Form Submission Fixes

- Added explicit button behavior to prevent accidental page reloads.
- Fixed FloatingWindow header button behavior.

### Markdown Improvements

- Added support for inline HTML rendering inside Markdown.
- Improved Markdown processing to correctly preserve code blocks during link parsing.

---

## Build & Deployment Improvements

### Static Site Support

- Configured static export builds
- Updated Vite build configuration
- Improved asset handling

### GitHub Pages

Added GitHub Pages support:

- Base path configuration
- Deployment workflow
- Automated publishing pipeline

### CI Improvements

- GitHub Actions deployment workflow
- CI build validation
- TypeScript error fixes
- Svelte check fixes
- Snapshot updates
- Warning cleanup

---

## Acknowledgements

This project is a fork of:

**josdejong/svelte-jsoneditor**  
https://github.com/josdejong/svelte-jsoneditor

The original project provides the core JSON editor, architecture, editing models, rendering system, validation framework, transformation engine, and overall foundation that make this fork possible.

Special thanks to:

- **Jos de Jong**
- All contributors to **svelte-jsoneditor**
- The Svelte community

Their work made this project possible.

## License

This fork remains based on the original project and must comply with the license terms provided by the original repository.

Please refer to the original project for license details:

https://github.com/josdejong/svelte-jsoneditor
