# 🧭 Svelte-JSONEditor & Spatial Flow Engine — Codebase Index & Development Rules

> **CRITICAL DIRECTIVE FOR AGENTS**: Read this file FIRST before searching or reading source files.
> This index prevents redundant searches, saves ~80% of tokens, and enforces the project's inviolable architectural and visual rules.

---

## 1. 🗺️ Architecture & Hotspot Map

| Subsystem / Feature | Primary File | Size / Location | Key Responsibilities |
|---|---|---|---|
| **App Shell & Layout** | `src/routes/development/+page.svelte` | ~314 KB (~9.5k lines) | Main IDE workbench, multi-pane tabs, menus, request runner, theme definitions. **NEVER read entirely!** |
| **Spatial Flow Canvas** | `src/routes/development/components/FlowCanvas.svelte` | ~394 KB | Canvas rendering, dragging, connections, node cards, execution runner, inspector drawer, remote cursors. |
| **Flow Types & Schema** | `src/routes/development/flowTypes.ts` | ~35 KB | Node interfaces, `FlowGraph`, `FlowNode`, `FlowConnection`, categories, serialization, execution state. |
| **Node Registry** | `src/routes/development/flowNodeRegistry.ts` | ~8 KB | Node categories, definitions, labels, colors, default ports. |
| **Node Geometry & Ports** | `src/routes/development/flowGeometry.ts` | ~8 KB | Port coordinates, anchor math, connection bezier paths, shape boundaries. |
| **Documentação Técnica** | `docs/README.md` | Índice mestre de arquitetura e documentos técnicos. |
| **P2P Collaboration Ref** | `docs/p2p-collab.md` | Documento indexado com âncoras para consulta ultrarrápida da feature P2P. |
| **Spatial Flow Planning** | `docs/spatial-flow.md` | Planejamento técnico de nós espaciais, portas e branching. |
| **P2P CRDT Workspace** | `src/routes/development/p2p/yjsWorkspace.ts` | ~23 KB | Yjs document, CRDT maps, group creation, member presence, IndexedDB persistence, autoSync toggle, manual flush. |
| **WebRTC Transport** | `src/routes/development/p2p/webrtcManager.ts` | ~17 KB | PeerConnection setup, DataChannels, ICE candidate gathering, connection tracking. |
| **SDP Signaling Token** | `src/routes/development/p2p/sdpToken.ts` | ~7 KB | `CompressionStream` deflate/inflate, token encoding (`p2p1_...`), QR code SVG generator, URL hash fragments. |
| **Gossip Mesh Swarm** | `src/routes/development/p2p/gossipMesh.ts` | ~6 KB | Full mesh topology relay, peer gossip discovery, ban/kick propagation. |
| **P2P Modal UI** | `src/routes/development/components/P2PCollaborationModal.svelte` | ~44 KB | Groups, invite tokens/QR, join flow, member kick, background sync pause/resume, profile. |
| **Environment Manager** | `src/routes/development/components/EnvironmentManagerModal.svelte` | ~28 KB | Postman-style environments & globals table, variable interpolation. |
| **cURL Importer** | `src/routes/development/components/CurlImportModal.svelte` | ~14 KB | cURL command parsing to structured request. |
| **REST Requests Engine**| `src/routes/development/requestsUtils.ts` | ~27 KB | Variable interpolation (`{{var}}`), HTTP fetch via proxy, response parsing. |
| **Service Worker / PWA** | `src/service-worker.ts` & `static/manifest.webmanifest` | - | Offline-first asset caching, standalone PWA support. |

---

## 2. 🎨 Inviolable Design System & Theming Rules (MANDATORY)

The user has strict requirements for visual polish, theme adherence, and consistency. **NEVER VIOLATE THESE RULES:**

### 2.1. Strict Token Usage — Zero Hardcoded Hex Colors
Every modal, panel, card, input, and button **MUST** strictly use the project's CSS custom properties:
- **Backgrounds**:
  - Modal Window: `var(--theme-bg-card, #252526)`
  - Chrome / Toolbars / Headers: `var(--theme-bg-chrome, #181818)`
  - Cards / Panels / Step Boxes: `var(--theme-bg-panel, #202021)`
  - Inputs / Textareas: `var(--theme-bg-input, #202022)`
  - Backdrop Overlays: `var(--theme-bg-overlay, rgba(0, 0, 0, 0.65))` with `backdrop-filter: blur(2px)`
  - Hover States: `var(--theme-bg-hover, rgba(255, 255, 255, 0.08))`
- **Borders**:
  - Structural / Panel Borders: `1px solid var(--theme-b-main, #3e3e42)`
  - Input Borders: `1px solid var(--theme-b-input, #3c3c3c)`
  - Radius: Modal = `6px`; Cards/Buttons/Inputs = `4px`. **NEVER use rounded 12px/14px/16px phone-app styles.**
- **Typography & Text Colors**:
  - Headings / Active items: `var(--theme-t-bright, #ffffff)`
  - Body text: `var(--theme-t-main, #d4d4d4)`
  - Secondary / Muted / Subtitles: `var(--theme-t-muted, #94a3b8)`
- **Accent & Primary Actions**:
  - Primary Blue: `var(--theme-ac, #3883fa)` (hover: `var(--theme-ac-hover, #0067b8)`)
  - Accent Text: `var(--theme-accent-text, #38bdf8)`
  - Accent Subtle: `var(--theme-ac-subtle, rgba(56, 131, 250, 0.15))`
  - Danger / Kick: `background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: var(--theme-danger-text, #f87171);` (hover: `#dc2626; color: #fff`)

### 2.2. Modal Window Standard (Postman / Svelte-Jsoneditor Pattern)
All modals (`EnvironmentManagerModal`, `CurlImportModal`, `P2PCollaborationModal`, `SaveFlowModal`) share the exact same header:
```html
<div class="modal-header">
  <div class="modal-title">
    <span class="header-title">Título</span>
    <span class="header-badge">Subtítulo / Badge</span>
  </div>
  <button type="button" class="modal-close" on:click={onClose} title="Fechar (Esc)">×</button>
</div>
```
- Header CSS: `height: 38px; min-height: 38px; background: var(--theme-ac, #3883fa); color: #ffffff; padding: 0 12px;`
- Title: `font-size: 14px; font-weight: 600; color: #ffffff;`
- Badge: `font-size: 10px; background: rgba(255, 255, 255, 0.2); color: #ffffff; padding: 2px 7px; border-radius: 10px;`
- Close button: `background: transparent; border: none; color: #ffffff; font-size: 20px; width: 28px; height: 28px; border-radius: 3px; cursor: pointer;`

### 2.3. Dual Theme Support (Dark & Light)
All modals and components **must automatically look native** in:
1. Dark Modern (`.jse-theme-dark` / default)
2. Light Modern (`.jse-theme-light` / `.jse-theme-default`)
3. Big Orange Theme (`.jse-theme-big`)
Do NOT hardcode dark purples/blues (`#1e1e2e`, etc.). Always fallback through CSS variables.

---

## 3. 📐 Spatial Flow & BPMN Engine Rules

1. **Distinct Geometric Shapes (BPMN / Flowchart Visual Grammar)**:
   - Flow nodes must NOT look like generic rounded rectangles.
   - Start / Terminate / Event Throw / Catch = Circular (`border-radius: 50%`) with BPMN boundary rings.
   - Router / Condition = Diamond / Rhombus.
   - REST / API = Card with HTTP method pill (GET green, POST amber, etc.).
   - JS Block / Transform = Structured compute card.
   - Loop / Iterator = Circular feedback icon with iterations counter.
2. **Top-Left Corner is Reserved**:
   - The top-left corner of any node card is strictly reserved for the NodeTypeSwitcher. Do not mount ports or drag handles there.
3. **Execution Engine & Dead-Paths**:
   - Router branching evaluates conditions; only matching ports activate downstream nodes. Inactive branches are marked as skipped (`dead-path`).
   - Loop nodes execute body nodes per item without deadlocking before transitioning to the `Done` port.
   - Transform nodes map payloads via JMESPath/JSONPath/Lodash/JS and write directly into environments/workspace.

---

## 4. ⚡ Token Economy & Line Range Guide

To avoid high token costs and latency:
1. **Never read `+page.svelte` or `FlowCanvas.svelte` in full.**
   - `+page.svelte`:
     - Lines 1–150: Imports & types
     - Lines 500–600: P2P, Environment & Chain state definitions
     - Lines 5100–5250: Request Header Toolbar (P2P Collab pill, Env dropdown, Proxy pill)
     - Lines 5250–5300: FlowCanvas mounting & handlers
     - Lines 6250–6270: Modals mount (`P2PCollaborationModal`, `EnvironmentManagerModal`, etc.)
     - Lines 6290–6520: CSS Theme Variable Definitions (`.app-shell` tokens)
   - `FlowCanvas.svelte`:
     - Lines 1–250: Component props, reactive state, pan/zoom
     - Lines 500–1200: Node execution engine (`runNode`, `executeGraph`, dead-paths)
     - Lines 1800–2600: Node rendering markup, SVG connections layer, remote cursors
     - Lines 3500+: Inspector sidebar and styles
2. **Use Surgical Edits**:
   - Use `replace_file_content` targeting small line ranges (under 50 lines).
   - Use `npx svelte-check --tsconfig ./tsconfig.json` for fast compile diagnostics.
   - Run specific vitest files instead of the entire suite when iterating:
     `npx vitest run src/routes/development/p2p/p2pGroupSync.test.ts`
     `npx vitest run src/routes/development/components/FlowCanvas.test.ts`
