# Wikimind

An open-source CLI that compiles raw documents into a structured, interlinked wiki using LLMs. Drop files in. Get a knowledge base out.

Inspired by [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

Most knowledge lives scattered across bookmarks, PDFs, notes, and articles you saved but never revisited. LLMs are good at synthesising information. Your filesystem is good at storing it. Nothing connects the two.

`wikimind` bridges that gap. Point it at a folder of raw documents and it compiles them into a structured wiki — extracting concepts, generating interlinked articles, building indexes, and maintaining the whole thing as your sources grow. Ask it questions. Run health checks. Every interaction compounds the knowledge base.

Built with TypeScript, powered by Claude, and designed to output clean markdown that works natively in Obsidian.

## Install

```bash
npm install -g wikimind
```

## Requirements

- Node.js 18+
- Anthropic API key (`export ANTHROPIC_API_KEY=sk-...`)

## Quick Start

```bash
wikimind init my-research
cd my-research
# Drop your markdown, text, or JSON files into raw/
wikimind ingest
wikimind compile
wikimind query "What are the key themes across my sources?"
wikimind lint
```

## Commands

| Command | Description |
|---------|-------------|
| `wikimind init` | Scaffold project with schema, index, and log |
| `wikimind ingest` | Normalise and track raw source documents |
| `wikimind compile` | Extract concepts, generate articles, build backlinks and graph |
| `wikimind query` | Natural language Q&A against the compiled wiki |
| `wikimind lint` | Structural checks and LLM-powered quality audits |
| `wikimind config` | View and update project settings |

## Roadmap

### v0.1.0 — Scaffolding
- [x] project scaffolding with placeholders

### v0.2.0 — Core CLI (current)
- [x] `wikimind init` — project scaffolding with schema, index, and log
- [x] `wikimind ingest` — normalise and track raw source documents
- [x] `wikimind compile` — LLM-powered concept extraction, article generation, backlinks, graph
- [x] `wikimind query` — natural language Q&A against the compiled wiki
- [x] `wikimind lint` — structural checks and LLM-powered quality audits
- [x] `wikimind config` — view and update settings from CLI

### v0.3.0 — Broader Ingestion
- [ ] URL ingestion (`wikimind ingest --url`)
- [ ] PDF support
- [ ] CSV to markdown tables
- [ ] HTML to markdown conversion

### v0.4.0 — Local UI
- [ ] `wikimind serve` — local web UI with interactive knowledge graph
- [ ] Query interface with chat UI
- [ ] Gaps dashboard

### v0.5.0 — Publish & Share
- [ ] `wikimind publish` — push wiki to llm-wiki.dev
- [ ] Public wiki profiles
- [ ] Embeddable knowledge graphs

### v0.6.0 — Multi-Model & Ecosystem
- [ ] Provider abstraction (OpenAI, Gemini, local models)
- [ ] Akashik Protocol integration (wiki as a shared memory layer)
- [ ] Fork and explore other published wikis

### v1.0.0 — Stable
- [ ] Full Obsidian vault compatibility
- [ ] Plugin system
- [ ] Team wikis and collaborative editing

## License

Apache-2.0