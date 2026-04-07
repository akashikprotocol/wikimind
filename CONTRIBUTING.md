# Contributing to Wikimind

Thanks for your interest in contributing to Wikimind. This project is in early development and we welcome contributions of all kinds.

## Getting Started

1. Fork the repo
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/wikimind.git`
3. Install dependencies: `npm install`
4. Build: `npm run build`
5. Link locally for testing: `npm link`

## Development

```bash
npm run dev          # Watch mode — rebuilds on file changes
wikimind init test   # Test your changes
```

You'll need an Anthropic API key to test compile, query, and lint commands:

```bash
export ANTHROPIC_API_KEY=sk-...
```

## Project Structure

```
src/
├── cli.ts               # Entry point and command router
├── commands/             # One file per CLI command
│   ├── init.ts
│   ├── ingest.ts
│   ├── compile.ts
│   ├── query.ts
│   ├── lint.ts
│   └── config.ts
├── llm/                  # LLM client, prompts, and chunking
│   ├── client.ts
│   ├── prompts.ts
│   └── chunker.ts
├── wiki/                 # Wiki manipulation utilities
│   ├── index-builder.ts
│   ├── backlinker.ts
│   ├── log.ts
│   └── graph.ts
├── utils/                # Shared helpers
│   ├── fs.ts
│   ├── markdown.ts
│   └── config.ts
└── types.ts              # Shared TypeScript types
```

## How to Contribute

### Report Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, wikimind version)

### Suggest Features

Open an issue with the `enhancement` label. Describe the use case, not just the solution.

### Submit Code

1. Create a branch: `git checkout -b feat/your-feature`
2. Make your changes
3. Test manually with a real wiki project
4. Commit using conventional commits:
   - `feat: add URL ingestion support`
   - `fix: resolve broken wikilink matching`
   - `docs: update README with new commands`
5. Push and open a PR against `main`

### Good First Issues

Look for issues labelled `good first issue`. Some areas where help is especially welcome:

- **New ingest formats** — PDF, CSV, HTML, EPUB support
- **Prompt improvements** — better concept extraction, article generation, or lint prompts
- **Testing** — unit tests for utils, integration tests for commands
- **Documentation** — usage guides, examples, tutorials

## Code Style

- TypeScript with strict mode
- Async/await everywhere, no callbacks
- One responsibility per file
- JSDoc comments on all exported functions
- Use `WIKI_PATHS` constant for all file paths, no hardcoded strings
- Console output uses chalk: green for success, yellow for warnings, red for errors

## Contributor License Agreement

By submitting a pull request, you agree that your contributions are licensed under the Apache-2.0 license, the same license as the project.

## Questions?

Open a discussion or reach out to [@sahildavid](https://github.com/sahildavid).
