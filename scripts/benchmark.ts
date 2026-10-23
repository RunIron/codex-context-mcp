import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { getEncoding } from "js-tiktoken";
import { Workspace } from "../src/workspace.js";
// Explicit synthetic corpus, generated deterministically; never real repository data.
const root = await mkdtemp(
  path.join(process.env.TMPDIR || tmpdir(), "context-bench-"),
);
try {
  const files: string[] = [];
  for (let f = 0; f < 40; f++) {
    const lines = Array.from(
      { length: 200 },
      (_, n) =>
        `export const fixture_${f}_${n} = "irrelevant synthetic padding ${f}:${n}";`,
    );
    if (f === 7) lines[42] = "export const RETRY_LIMIT = 7; // retry policy";
    if (f === 21)
      lines[119] = "export const REQUEST_TIMEOUT_MS = 4500; // timeout policy";
    const name = `module-${String(f).padStart(2, "0")}.ts`;
    files.push(name);
    await writeFile(path.join(root, name), lines.join("\n") + "\n");
  }
  const full = await Promise.all(
    files.map(async (file) => ({
      path: file,
      source: await readFile(path.join(root, file), "utf8"),
    })),
  );
  const w = await Workspace.create(root);
  const search = await w.search(["RETRY_LIMIT", "REQUEST_TIMEOUT_MS"]);
  assert.equal(search.incomplete, false);
  assert.equal(search.hits.length, 2);
  const exact = await Promise.all(
    search.hits.map((h) => w.read(h.path, h.line, h.line)),
  );
  for (const [file, line, answer] of [
    ["module-07.ts", 43, "RETRY_LIMIT = 7"],
    ["module-21.ts", 120, "REQUEST_TIMEOUT_MS = 4500"],
  ] as const) {
    const hit = search.hits.find((h) => h.path === file && h.line === line);
    assert.ok(hit?.text.includes(answer));
    assert.ok(
      exact.some(
        (r) =>
          r.path === file &&
          r.lines.some((l) => l.line === line && l.text.includes(answer)),
      ),
    );
    const source = full.find((f) => f.path === file)!.source.split("\n")[
      line - 1
    ];
    assert.equal(hit.text, source);
  }
  const enc = getEncoding("o200k_base");
  const baseline = JSON.stringify(full);
  const bounded = JSON.stringify({ search, exact });
  console.log(
    JSON.stringify(
      {
        fixture: { files: 40, linesPerFile: 200, evidenceChecks: 2 },
        tokenizer:
          "js-tiktoken o200k_base (not a claim about the current Codex tokenizer)",
        fullRead: {
          utf8Bytes: Buffer.byteLength(baseline),
          tokens: enc.encode(baseline).length,
        },
        boundedRetrievalPlusExactReads: {
          utf8Bytes: Buffer.byteLength(bounded),
          tokens: enc.encode(bounded).length,
        },
        evidence: "2/2 exact file+line+answer checks passed",
        scope:
          "Payload-only synthetic comparison. Excludes tool schemas, reasoning, prompts, repeated calls and model output; NOT end-to-end savings or answer-quality evidence.",
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
