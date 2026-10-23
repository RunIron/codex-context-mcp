# Real Codex integration (2026-10-23)

## Environment and method

Windows, Node 24.19.0, Codex CLI 0.159.3, existing ChatGPT login. Runs used `codex exec --ignore-user-config --ephemeral --skip-git-repo-check --sandbox read-only --json`, with process-local `-c mcp_servers.bounded_context.command=...` and `args=...` pointing to the built server and a synthetic workspace. No persistent Codex configuration was changed. CLI-selected default model was not pinned, so these are integration observations, not a reproducible model benchmark.

## Actual end-to-end protocol check

Codex called `context_search`, then `read_range`, and correctly reported `RETRY_LIMIT = 7` at `retry.ts:1` and `BACKOFF_MS = 320` at `retry.ts:2`. A requested `../outside.txt` read returned a tool error. The response intentionally does not distinguish denial from missing/unreadable inputs. Four completed MCP calls were observed (including the denied call). Parent parsed the original JSONL and asserted successful search, successful read, and refused traversal.

Reported CLI usage: input_tokens 90193, cached_input_tokens 78336, output_tokens 355. Cached input is part of input, not an additional quantity to add. This smoke test has no comparable baseline and establishes **no token savings**.

## Excluded native-shell comparison

A six-file synthetic lookup was attempted in ABBA order: native selective shell search, MCP search+read, MCP search+read, native selective shell search. Both native runs were blocked by execution policy (`rg` and PowerShell `Select-String`) and could not answer. Their exit code was nevertheless zero: model process success is not task success. Both MCP runs returned the correct values and file/line evidence.

This comparison is **invalid for savings measurement** and is excluded, not counted as a win. No shell policies were relaxed to obtain a preferred result. MCP runs reported input_tokens 85788 / 85336 and output_tokens 239 / 268; unsuccessful native runs reported input_tokens 50116 / 50141 and output_tokens 162 / 197. Different task success and tool availability prevent a meaningful cost comparison.

A separate controlled full-read versus selective-retrieval workflow comparison uses the same MCP tool availability on both sides. It must be labeled as that specific comparison, not a claim to beat native selective search or all Codex tasks.

## Final repaired-server workflow comparison

After bounded FIFO serialization replaced busy rejection, all four ABBA runs completed with correct answers and **zero failed tool calls**. Parent parsed actual JSONL tool results, verified both exact source lines in every run, verified all six files were read in each full-read run, and asserted no call failed. The commands retained the same CLI options and MCP configuration as above. Raw local logs were retained outside the repository; the sanitized usage record is [workflow-results.json](workflow-results.json).

- Full-read runs: input + output = **111551**, **105349**; 9 and 8 tool calls.
- Selective runs: input + output = **68531**, **68568**; 3 tool calls each.
- Means: **108450** versus **68549.5**; selective retrieval used **36.79% fewer reported input+output tokens** in this specific experiment.
- Both strategies returned `RETRY_LIMIT = 7` at `module2.ts:38` and `BACKOFF_MS = 320` at `module4.ts:52`.

### Reproduction method

Create `module0.ts` through `module5.ts`, each containing 80 lines with zero-based `n` and `i`: `// module {n} observation {i}: ordinary reference text for deterministic fixture.`. Replace zero-based line 37 in module2 with `export const RETRY_LIMIT = 7;`, and zero-based line 51 in module4 with `export const BACKOFF_MS = 320;`. Use a fresh directory containing only these files. Run Codex against that root with the process-local MCP configuration and JSONL output described above; do not change global configuration.

Common prompt: `Controlled synthetic retrieval workflow test. Find RETRY_LIMIT and BACKOFF_MS. Report exact values, source filenames and 1-based lines. Use only bounded_context MCP, no shell or edits.`

For A append: `For the full-read comparator, first file_inventory, then read_range start=1 end=100 on every listed .ts file, even after finding both answers. Do not use context_search. This intentionally measures full-read retrieval, not an optimized native search baseline.`

For B append: `Use context_search with both terms and then read_range on only the returned evidence lines.`

Execute A, B, B, A; record each `turn.completed.usage` and verify actual tool results, not just the final prose. Future numbers will vary with model, client version, caching and scheduling.

### Interpretation limits

This is one synthetic lookup task with two runs per strategy, not a representative coding benchmark or proof of statistical significance. The baseline is intentionally full-read, not native selective search. Same tool schemas are available in both arms, but prompts and executed calls differ by strategy. Model default was not pinned, cache state was uncontrolled, and there is no billing measurement. Input totals include repeated context and cached tokens; cached input must not be added again, and reasoning output is not added again to output. Small tasks or already-efficient native search may not benefit. No universal savings percentage is advertised.
