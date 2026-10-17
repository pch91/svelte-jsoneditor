# Índice Arquitetural do Projeto (Codebase Index)

Este documento mapeia todos os módulos, convenções de design e atalhos de navegação para acelerar o desenvolvimento e reduzir o consumo de tokens e varreduras desnecessárias de arquivos.

Consulte o documento principal de regras e mapeamento técnico em:

- [AGENTS.md](./AGENTS.md) — Diretrizes invioláveis de arquitetura, Design System, BPMN e economia de tokens.
- [docs/README.md](./docs/README.md) — Índice mestre de documentação técnica.
- [docs/p2p-collab.md](./docs/p2p-collab.md) — Referência técnica e protocolo P2P Collaboration (WebRTC + Yjs).
- [docs/spatial-flow.md](./docs/spatial-flow.md) — Especificação técnica do motor Spatial Flow.

---

## Estrutura Principal dos Módulos

### 1. Núcleo do Editor (`src/lib/`)

- Componentes do editor JSON em modos árvore, texto e tabela.
- Lógica de diff, validação JSON Schema e plugins de consulta (JMESPath, JSONPath, Lodash).

### 2. Workbench & Execução (`src/routes/development/`)

- `+page.svelte`: Casca do aplicativo (Workbench), abas multi-painéis e barra de execução REST.
- `requestsUtils.ts`: Execução de requisições HTTP, interpolação de variáveis `{{var}}` e proxy CORS.
- `flowTypes.ts`: Tipagem completa do grafo espacial, nós, portas e conexões.
- `flowNodeRegistry.ts`: Registro das categorias de nós (Logic, Flow Control, Events, REST).
- `flowGeometry.ts`: Cálculo de âncoras de portas, bezier curves e geometria de formas distintas.

### 3. Colaboração P2P Serverless (`src/routes/development/p2p/`)

- `yjsWorkspace.ts`: Documento CRDT Yjs com persistência em IndexedDB e alternador de auto-sync em background.
- `webrtcManager.ts`: Conexões diretas P2P via WebRTC DataChannels.
- `sdpToken.ts`: Compressão Deflate de SDP em tokens curtos `p2p1_...`, QR Code SVG e hash URLs.
- `gossipMesh.ts`: Relé em malha completa (full mesh gossip swarm).

### 4. Modais Padronizados (`src/routes/development/components/`)

- `EnvironmentManagerModal.svelte`: Gerenciador de ambientes Postman-style.
- `CurlImportModal.svelte`: Importador de comandos cURL.
- `P2PCollaborationModal.svelte`: Gestão de salas P2P, convites, expulsão de membros e rascunho offline.
- `SaveFlowModal.svelte`: Salvamento de fluxos no workspace.

---

## Design System Tokens

O projeto utiliza estritamente variáveis CSS (`--theme-*`) sem cores hexadecimais hardcoded:

- Header do modal: 38px, azul `#3883fa`, tipografia branca, botão de fechar `×`.
- Fundo dos modais: `var(--theme-bg-card, #252526)`.
- Cards e painéis: `var(--theme-bg-panel, #202021)`.
- Inputs e caixas de texto: `var(--theme-bg-input, #202022)`.
- Textos: `var(--theme-t-bright)`, `var(--theme-t-main)`, `var(--theme-t-muted)`.
- Botões: `var(--theme-ac)`, `var(--theme-bg-chrome)`, `var(--theme-danger-text)`.
