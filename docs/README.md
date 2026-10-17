# 📚 Documentação Técnica — Svelte-JSONEditor & Spatial Flow Engine

Este diretório centraliza toda a documentação técnica, especificações de arquitetura e guias de referência rápida do projeto.

---

## 📑 Índice da Documentação

| Documento | Descrição | Principais Tópicos |
|---|---|---|
| 🤝 **[P2P Collaboration Engine](p2p-collab.md)** | Engine serverless de colaboração em tempo real via WebRTC e Yjs. | [Zero-Bleed Lvl1](p2p-collab.md#2-isolamento-estrito-por-pasta-lvl1-zero-bleed), [Mapa de Arquivos](p2p-collab.md#3-mapa-de-arquivos--linhas-chave), [Sinalização SDP](p2p-collab.md#5-protocolo-de-sinalização-sdp-serverless), [APIs](p2p-collab.md#6-catálogo-de-funções-da-api) |
| 📐 **[Spatial Flow Engine](spatial-flow.md)** | Planejamento arquitetural e técnico dos nós espaciais, portas e branching. | Node Registry, Geometria de Portas, Execution Engine, Dead-Path routing |
| 🧭 **[Guia e Regras para Agentes](../AGENTS.md)** | Índice de navegação rápida por linhas, design system e regras invioláveis. | Mapa de linhas, tokens de tema, regras de edição cirúrgica |

---

## 🏗️ Estrutura de Diretórios da Documentação

```text
docs/
├── README.md           # Este índice mestre
├── p2p-collab.md       # Guia completo & referência P2P (WebRTC + Yjs CRDT)
└── spatial-flow.md     # Planejamento & especificação da engine de grafos espaciais
```

---

## 🎯 Regras de Manutenção
1. **Documentação Objetiva:** Mantenha os arquivos enxutos e focados em tabelas, âncoras e mapas de linha.
2. **Atualização Contínua:** Ao introduzir ou modificar uma funcionalidade, atualize a seção correspondente em `docs/` e o changelog daquele documento.
3. **Links e Âncoras:** Todo documento em `docs/` deve ter um sumário com links diretos (`#ancora`) para leitura imediata sem necessidade de rolagem ou busca.
