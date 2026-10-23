# codex-context-mcp

Read-only, local stdio MCP tools that give Codex bounded source evidence instead of automatically sending whole files. **Codex does the reasoning.** No additional LLM, embeddings, API key, network service, or UI. Initial implementation; not yet a published npm release.

## Install from source

Requires Node.js 22 or 24 and npm. Clone the repository first, then run in this checkout:

```sh
git clone https://github.com/RunIron/codex-context-mcp.git
cd codex-context-mcp
npm ci
npm test
npm run benchmark
npm run smoke
```

`npm test` builds first. Register the built server using absolute paths (replace both paths):

```sh
codex mcp add bounded-context -- node /absolute/path/codex-context-mcp/dist/cli.js --root /absolute/path/your-repository
```

On Windows, use `C:/...` paths and quote paths containing spaces; an absolute `node.exe` path avoids PATH wrappers. Registration changes your Codex configuration; the test suite does not register anything. `codex mcp add --help` documents the command. No npm registry installation is promised before publication.

## Workflow and tools

1. Ask Codex to choose concrete identifiers/literal fragments from your task.
2. Call `context_search` with `{"terms":["RETRY_LIMIT","retry"]}`.
3. Inspect `incomplete`, `reasons`, and each hit's `clipped` flag.
4. Call `read_range` with `{"path":"src/retry.ts","start":20,"end":45}` for exact evidence before editing or concluding.
5. `file_inventory` with `{}` is optional when filenames are unknown.

Search is **case-sensitive literal substring matching**, not regex or semantic search. Each matching line scores the number of distinct terms it contains. Sort is score descending, then relative path (code-unit order), then line ascending. Snippets contain up to 500 UTF-16 code units around the first match, and carry file/1-based line references. A snippet can omit later matched terms; exact reads resolve this. No task understanding or answer-quality guarantee is implied. Results are plain JSON in one MCP text content block (not duplicated as structured content).

`read_range` returns complete source lines without line endings, normalizing CRLF separators. It never silently clips a returned line. At the output cap it returns `truncated` and `nextLine`. A single source line exceeding the cap cannot be returned; inspect it locally. Ranges beyond EOF return the available lines or an empty array.

## Bounds and exclusions

| Limit | Value |
| --- | --- |
| Per file | 256 KiB, regular single-link UTF-8 text, no NUL |
| Traversal | 4,000 directory entries; 1,000 eligible filenames; depth 32 |
| Search content | 8 MiB threshold, at most one additional 256 KiB file |
| Scan/search time | 3-second cooperative checks; not a hard I/O deadline |
| Search | 1–12 terms, max 128 characters each; 1,000 candidate hits; 40 returned hits |
| Read | 500 inclusive lines per request |
| Output | 14,000-byte row budget, plus bounded metadata (under 16,000 bytes inner JSON) |
| Concurrency | One active operation; FIFO queue admits 16 total active/waiting calls; overflow returns a retryable error |

MCP framing/JSON escaping adds wire bytes beyond the inner JSON budget. File inventory is also output bounded; search uses that inventory and inherits incompleteness. Incomplete scans may examine different subsets on different filesystems or under time limits; ranking of collected hits is deterministic, not a promise of exhaustive or globally best matches. Limits apply per call, not per session. OS operations can block beyond cooperative time checks. No runtime token estimates are reported because byte/character counts are not model token counts.

All paths must be root-relative with `/` separators. Absolute paths, traversal, backslashes, Windows device/alternate-stream aliases, symlinks/junctions, and multi-link files are denied. Default exclusions include `.git`, `node_modules`, `vendor`, `dist`, `build`, `coverage`, `.next`, `.cache`, `.ssh`, `.aws`, `.azure`, `.gnupg`, `.env` and variants, credentials/secrets/service-account names, `.npmrc`, `.netrc`, SSH private-key names, and `.pem/.key/.p12/.pfx` files. Defaults cannot be negated.

Root `.gitignore` and `.contextignore` use gitignore syntax and are loaded at startup (restart after changing them). Nested `.gitignore` files and global Git exclusions are not loaded. Example `.contextignore`:

```gitignore
private-data/
*.log
customer-export.csv
```

Inventory lists eligible names, not a guarantee their content is readable. Filename exclusions do not detect all secrets: review the root and add ignores. Tool results can contain sensitive source data and are sent to your MCP client/model. Read [SECURITY.md](SECURITY.md) before using untrusted workspaces.

## Reproducible benchmark

`npm run benchmark` creates and removes 40 synthetic files of 200 lines each. Two known constants are injected at exact file/line coordinates. It compares JSON containing every full file against bounded search plus exact evidence reads and asserts both answers and references. Token counts use `js-tiktoken`'s `o200k_base`, **not an assertion about the tokenizer of your Codex model**.

This is a deliberately selective, synthetic **payload-only** comparison. It excludes prompts, tool schemas, reasoning, retries, and model output. It cannot establish end-to-end token savings, latency, or answer quality. See [docs/validation.md](docs/validation.md) for actual local results and pending checks.

## Development

Official TypeScript MCP SDK v2 split packages: server/client 2.3.1, pinned with lockfile. The implementation uses supported `McpServer.registerTool`, Zod object schemas, `StdioServerTransport`, and SDK client subprocess tests. Reference: https://ts.sdk.modelcontextprotocol.io/v2/servers/tools and https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/mcp.html . The direct transport path is intentionally used rather than the newer factory convenience API; real Codex compatibility is a separate integration gate.

CI covers Linux/Windows × Node 22/24; all four initial validation jobs passed. See [validation evidence](docs/validation.md) and [real Codex workflow results](docs/codex-integration.md), including limitations. `npm run format` formats source/tests/scripts. MIT © RunIron. Traditional Chinese: [README.zh-TW.md](README.zh-TW.md).
