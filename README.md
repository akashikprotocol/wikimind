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

> Each version addresses scale — from caching and incremental compilation to summarisation hierarchies and vector search — so wikimind stays fast whether you have 10 sources or 10,000.

### v0.3 — Core CLI (current)
- [x] `wikimind init` — project scaffolding with schema, index, and log
- [x] `wikimind ingest` — normalise and track raw source documents (.md, .txt, .json)
- [x] `wikimind compile` — LLM-powered concept extraction, article generation, backlinks, graph
- [x] `wikimind query` — natural language Q&A against the compiled wiki
- [x] `wikimind lint` — structural checks and LLM-powered quality audits
- [x] `wikimind lint --fix` — auto-repair broken links, missing frontmatter, missing connections
- [x] `wikimind config` — view and update settings, custom prompts
- [x] `wikimind graph --cluster` — build knowledge graph with LLM-assigned topic clusters
- [x] `wikimind export --graph --view` — neural pathway visualization in the browser

### v0.4 — Ingest Everything + Scale
- [ ] URL ingestion (`wikimind ingest --url`)
- [ ] PDF ingestion
- [ ] YouTube transcript ingestion (`wikimind ingest --youtube`)
- [ ] CSV and HTML to markdown
- [ ] Parallel ingestion (3-5 files concurrently)
- [ ] Incremental compile with caching (only reprocess what changed)
- [ ] Keyword search index for fast query retrieval on large wikis

### v0.5 — Local UI
- [ ] `wikimind serve` — local web app with interactive knowledge graph
- [ ] Browse and read articles in the browser
- [ ] Query chat interface
- [ ] Lint dashboard with health score
- [ ] Compile budget controls (`--budget`, `--batch`)

### v0.6 — Publish + Share
- [ ] llm-wiki.dev goes live
- [ ] User accounts (GitHub OAuth)
- [ ] `wikimind publish` — push your wiki to the cloud
- [ ] Public wiki profiles (`llm-wiki.dev/@username/wiki-name`)
- [ ] Embeddable knowledge graph widget
- [ ] Summarisation hierarchy for 1000+ article wikis

### v0.7 — Discovery + Community
- [ ] Explore page — trending, newest, by topic
- [ ] Fork a wiki — clone and extend with your own sources
- [ ] Star and follow wikis
- [ ] Wiki health scores — completeness, link density, freshness
- [ ] Comments on articles

### v0.8 — Teams
- [ ] Team workspaces on llm-wiki.dev
- [ ] Invite members with role-based access (admin, editor, viewer)
- [ ] Shared wikis with multiple contributors
- [ ] Activity feed — who added what, when
- [ ] Merge workflow for concurrent edits
- [ ] Slack integration — ingest threads directly into a team wiki
- [ ] Vector embeddings for large-scale team knowledge bases

### v0.9 — Integrations
- [ ] Ingest from Notion, Google Docs, Confluence
- [ ] Meeting transcript ingestion (Otter, Fireflies)
- [ ] API access — query any published wiki programmatically
- [ ] Webhooks — trigger compile on new sources

### v1.0 — Stable Platform
- [ ] Plugin system for custom ingest formats
- [ ] Provider abstraction (OpenAI, Gemini, local models)
- [ ] Self-hosted option for enterprise
- [ ] Full Obsidian vault compatibility
- [ ] Akashik Protocol integration — shared memory layer across wikis

## License

Apache-2.0