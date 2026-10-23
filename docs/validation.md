# Validation record

## Parent repair verification (supersedes the initial snapshot below)

- Windows Node 24.19.0: `npm test` now reports **21 tests, 18 passed, 0 failed, 3 skipped** (Linux FIFO-only cases). The real Windows 8.3 file/directory alias regression ran and passed, not skipped.
- Reproduced the unfinished queue regression: 20 tests, 16 passed, 1 failed, 3 skipped; concurrent reads received `Server busy`. After replacing busy rejection with bounded FIFO serialization, 12 concurrent real protocol reads pass. Additional coverage confirms queue overflow is rejected and a failed read does not stall later calls.
- Canonical resolved paths are revalidated against exclusions, final file metadata is checked before open and again afterward, directory-only ignores prune traversal early, and the package includes this validation document.
- `npm run smoke` after the security fixes: installed bin present, actual installed subprocess handshake and exact read passed. `npm audit`: 0 vulnerabilities at execution time.
- Independent re-review approved the repaired code: no blocking security or logic findings. Independent delayed/failed stdio probes verified exactly 16 of 17 concurrent operations admitted, FIFO order, maximum one active operation, and recovery after failure. GitHub Linux/Windows CI remains a separate gate; no local Linux result is implied. Real Codex observations are in [codex-integration.md](codex-integration.md).

## Initial implementation snapshot (historical)

## Scope and environment

Implementation-child local run on Windows 11, Git Bash, Node `v24.19.0`, npm `11.19.0`. Working directory: `C:/Users/chiha/projects/codex-context-mcp`. The Node wrapper initially on PATH is unsuitable in this host, so commands used:

```sh
export PATH='/c/Program Files/nodejs':$PATH
```

No commit, push, remote creation, registry publication, GitHub authentication change, or Codex registration was performed. `git init` created only this local repository. Independent parent review and actual Codex integration remain required before publishing.

## API discovery

Registry commands returned `@modelcontextprotocol/server 2.3.1` and `@modelcontextprotocol/client 2.3.1`. Source/type declarations from these installed official packages verified the exports, `McpServer.registerTool` signature, Zod object schemas and stdio client transport. Official SDK documentation was also retrieved through search:

- https://ts.sdk.modelcontextprotocol.io/v2/servers/tools
- https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/mcp.html
- https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html

The direct `StdioServerTransport` + `connect` API was retained rather than the newer `serveStdio` convenience factory. SDK client subprocess compatibility is tested; compatibility with a specific Codex build is not inferred from that alone.

A direct extract request failed because the configured web backend was search-only; a guessed raw-GitHub documentation path returned 404. Official indexed documentation plus installed declarations were the successful fallback. `codex mcp add --help` confirmed `codex mcp add <NAME> -- <COMMAND>...` without modifying settings.

## Test-first evidence

Each row records actual executed `npm test` output, not hypothetical results. The project grew through small behavior slices; two related regressions were batched in some red runs rather than strictly one test per run. Additional edge-case coverage was subsequently added against the working implementation and passed immediately; it is validation coverage, not claimed as red-first development.

| Slice | Observed RED | Observed GREEN |
| --- | --- | --- |
| Initial exact range | 0 pass / 1 fail; `ERR_MODULE_NOT_FOUND` for missing workspace module | 1 pass / 0 fail |
| Boundary policy | 1 pass / 1 fail; `Missing expected rejection: link/secret.txt` | 2 pass / 0 fail; build passed |
| Bounded read + lexical retrieval | 2 pass / 2 fail; oversized read JSON and `w.search is not a function` | 4 pass / 0 fail; build passed |
| Actual MCP subprocess + CLI | 4 pass / 2 fail; missing `dist/cli.js` closed connection and usage assertion failed | 6 pass / 0 fail; build passed |
| Credential filename variants | 6 pass / 1 fail; `Missing expected rejection: service-account.json` | 7 pass / 0 fail |
| BOM + long Unicode output boundary | 11 pass / 2 fail; BOM stripped; response exceeded 16000 bytes | 13 pass / 0 fail |

BOM decoding now preserves U+FEFF. Exact-read row budgets reserve the encoded path size, fixing long Unicode metadata overflow. Source/tests/scripts were then formatted with Prettier and the entire suite rerun.

## Final clean-install verification

Executed in sequence, overall exit code **0**:

```sh
npm run format
npm ci
npm test
npm run benchmark
npm run smoke
npm audit
git status --short
git remote -v
git rev-list --all --count
```

Actual results:

- `npm ci`: added 24 packages, audited 25 packages, found 0 vulnerabilities.
- npm 11 emitted an `allow-scripts` warning for esbuild's postinstall; no global approval was changed. The installed platform binary worked: all tsx tests/scripts completed.
- `npm test` runs `tsc` first. Build exited 0. Tests: **13**, pass **13**, fail **0**, skipped **0**. Final run duration: `3002.084 ms` (not a performance guarantee).
- `npm audit`: **found 0 vulnerabilities** at execution time; not a permanent security guarantee.
- `git remote -v`: no output. `git rev-list --all --count`: **0**.

Tests cover exact line references; invalid/beyond-EOF ranges; CRLF, Unicode, BOM and empty files; long lines and long Unicode paths; traversal and Windows aliases; real outside-root junction; secrets and user ignores; oversized files; invalid UTF-8/NUL; hardlinks; symlinked ignore files; literal-not-regex matching; deterministic deduplicated ranking; clipped snippets; result/file-count bounds and incompleteness; actual SDK stdio initialize/list/call; tool input/denial/missing-file errors; and invalid CLI startup.

### Package/install smoke

`npm run smoke` really packs, installs the tarball into a temporary directory with production dependencies, verifies the npm bin shim exists, launches the installed entry point through the SDK stdio client, lists tools and reads a known source line. Temporary installation and tarball are removed afterward. Output:

```json
{"package":"codex-context-mcp-0.1.0.tgz","files":7,"installedBin":true,"subprocessHandshake":true,"exactRead":true}
```

This tests the installed JS entry point and shim presence, not interactive execution through every shell-specific npm shim.

### Synthetic payload benchmark

`npm run benchmark` output (repeated runs matched):

```json
{
  "fixture": {"files":40,"linesPerFile":200,"evidenceChecks":2},
  "tokenizer":"js-tiktoken o200k_base (not a claim about the current Codex tokenizer)",
  "fullRead":{"utf8Bytes":564607,"tokens":160390},
  "boundedRetrievalPlusExactReads":{"utf8Bytes":900,"tokens":249},
  "evidence":"2/2 exact file+line+answer checks passed",
  "scope":"Payload-only synthetic comparison. Excludes tool schemas, reasoning, prompts, repeated calls and model output; NOT end-to-end savings or answer-quality evidence."
}
```

Fixture source and assertions are in `scripts/benchmark.ts`. It deliberately gives explicit identifiers with only two relevant lines among padding. It is not a representative benchmark suite, not a model-generated answer test, and not evidence of real-world/end-to-end savings.

## Remaining gates and limitations

- Parent must independently review and run real Codex integration. No real model answer or billing measurement was performed.
- Linux and Node 22 were not executed locally. CI matrix is configured for Linux/Windows × Node 22/24 but has not run remotely.
- Stable trusted local workspace only: portable path checks cannot eliminate malicious concurrent mutation/TOCTOU races. Use an immutable snapshot or OS sandbox for hostile repositories. No claim of atomic containment under an active filesystem adversary.
- Time bounds are cooperative, not hard deadlines. Blocking OS operations may exceed them. Special filesystem/device behavior and network filesystems are outside the supported deployment assumptions.
- Filename exclusions are not secret-content scanning; users must inspect scope and ignores. Root ignore files are startup snapshots; nested/global ignore rules are unsupported.
- Huge lines cannot be returned exactly through the bounded API; clipped search snippets point back to source. Limit-truncated scans may select different subsets across filesystems/time loads, though collected-hit ordering is deterministic.
- CI covers ordinary functional cases, not exhaustive races, resource-flood tests, or every SDK protocol revision. Dependency audit is not a security review.

## Reuse workflow

Keep red/green evidence factual; preserve observed failures. Run clean install → build/tests → benchmark evidence assertions → pack/install subprocess smoke → audit. Review known threat-model limits separately from happy-path results. Do not publish until independent review and actual intended-client integration have passed. This workflow is recorded here rather than changing agent-profile skills outside the allowed project scope.
