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

### `wikimind init [name]`

Scaffolds a new wikimind project. Creates the folder structure, config, state file, schema, index, and log.

```bash
wikimind init              # Initialise in current directory
wikimind init my-research  # Create and initialise a new subdirectory
```

**Creates:**
```
.wikimind/config.json   # Project settings
.wikimind/state.json    # Ingest and compile state
raw/                    # Drop your source files here
wiki/concepts/          # Generated articles live here
wiki/schema.md          # Conventions the LLM follows
wiki/index.md           # Auto-generated master index
wiki/log.md             # Append-only operation log
queries/                # Saved query answers
```

---

### `wikimind ingest [--file <path>]`

Scans `raw/` for new or modified files, normalises them, and updates state. Supports `.md`, `.txt`, and `.json`. Uses SHA-256 hashing to detect changes — unchanged files are skipped.

```bash
wikimind ingest                     # Scan all of raw/
wikimind ingest --file raw/note.md  # Process a single file
```

---

### `wikimind compile [options]`

Extracts concepts from ingested sources using Claude, generates or updates wiki articles, inserts backlinks, rebuilds the concept graph, and regenerates the index.

Only processes sources that have changed since the last compile (incremental by default).

```bash
wikimind compile                                        # Incremental compile
wikimind compile --full                                 # Recompile all sources from scratch
wikimind compile --dry-run                              # Preview what would change, no writes
wikimind compile --prompt "Only extract AI concepts"   # Override custom prompt for this run
```

| Option | Description |
|--------|-------------|
| `--full` | Reprocess all ingested sources, not just changed ones |
| `--dry-run` | Show what would be created/updated without writing files |
| `--prompt <text>` | One-off instruction appended to the system prompt |

---

### `wikimind query [query] [options]`

Finds the most relevant wiki articles for your question and synthesises an answer using Claude. Cites sources with `[[Wikilinks]]`. If no query is provided and stdin is a TTY, enters interactive REPL mode.

```bash
wikimind query "What are the key themes?"              # Single query
wikimind query "Explain X" --save                      # Save answer to queries/
wikimind query "Explain X" --promote                   # Promote answer to wiki/concepts/
wikimind query "Explain X" --prompt "Answer in bullets"
wikimind query                                          # Interactive REPL mode
```

| Option | Description |
|--------|-------------|
| `--save` | Save the answer as a markdown file in `queries/` |
| `--promote` | Save the answer directly to `wiki/concepts/` as a new article |
| `--prompt <text>` | One-off instruction appended to the system prompt |

---

### `wikimind lint [options]`

Runs health checks on the compiled wiki. Phase 1 (always): structural checks with no LLM calls. Phase 2 (default): LLM-powered quality analysis. Phase 3 (opt-in): auto-fix safe issues.

```bash
wikimind lint                                          # Full lint (structural + LLM)
wikimind lint --structural                             # Structural checks only, no LLM
wikimind lint --fix                                    # Auto-fix broken links and missing connections
wikimind lint --prompt "Focus on contradictions only"
```

**Structural checks:**
- Broken `[[wikilinks]]` (with fixability detection)
- Orphaned articles (zero incoming links)
- Stale sources (modified since last compile)
- Empty articles (body < 50 characters)
- Missing frontmatter fields (`title`, `sources`, `related`)

**LLM analysis:**
- Contradictions between articles
- Concept gaps (mentioned but no page exists)
- Weak articles
- Missing connections between articles
- Suggested new articles

| Option | Description |
|--------|-------------|
| `--structural` | Run structural checks only, skip LLM |
| `--fix` | Auto-fix broken links and insert missing connections |
| `--prompt <text>` | One-off instruction appended to the system prompt |

---

### `wikimind config [key] [value]`

View or update project settings stored in `.wikimind/config.json`.

```bash
wikimind config                              # Show all settings
wikimind config model                        # Show one setting
wikimind config model claude-opus-4-5        # Set a value
wikimind config customPrompt "Always cite the podcast this concept appeared in"
```

| Key | Default | Description |
|-----|---------|-------------|
| `model` | `claude-sonnet-4-20250514` | Claude model to use |
| `maxTokensPerChunk` | `4000` | Max tokens per source chunk |
| `outputFormat` | `obsidian` | Output format (`obsidian` or `standard`) |
| `autoBacklink` | `true` | Auto-insert backlinks after compile |
| `customPrompt` | _(empty)_ | Persistent instruction appended to all LLM prompts |

## Roadmap

### v0.1.0 — Scaffolding
- [x] project scaffolding with placeholders

### v0.2.0 — Core CLI
- [x] `wikimind init` — project scaffolding with schema, index, and log
- [x] `wikimind ingest` — normalise and track raw source documents
- [x] `wikimind compile` — LLM-powered concept extraction, article generation, backlinks, graph
- [x] `wikimind query` — natural language Q&A against the compiled wiki
- [x] `wikimind lint` — structural checks and LLM-powered quality audits
- [x] `wikimind config` — view and update settings from CLI

### v0.3.0 — Graph & Export (current)
- [x] `wikimind graph` — rebuild concept graph, optional LLM clustering
- [x] `wikimind export --graph` — standalone interactive HTML knowledge graph
- [x] Custom prompt support (`--prompt` flag and `customPrompt` config)

### v0.4.0 — Broader Ingestion
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