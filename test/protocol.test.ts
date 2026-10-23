import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawnSync } from "node:child_process";
test("real stdio handshake, discovery, retrieval, exact evidence and errors", async (t) => {
  const root = await mkdtemp(
    path.join(process.env.TMPDIR || tmpdir(), "mcp-wire-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "answer.ts"), "const RETRY_LIMIT = 7;\n");
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/cli.js"), "--root", root],
    stderr: "pipe",
  });
  t.after(() => client.close());
  await client.connect(transport);
  const names = (await client.listTools()).tools.map((x) => x.name).sort();
  assert.deepEqual(names, ["context_search", "file_inventory", "read_range"]);
  const call = async (name: string, args: any) =>
    client.callTool({ name, arguments: args });
  const r: any = await call("context_search", { terms: ["RETRY_LIMIT"] });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /RETRY_LIMIT = 7/);
  const exact: any = await call("read_range", {
    path: "answer.ts",
    start: 1,
    end: 1,
  });
  assert.match(exact.content[0].text, /RETRY_LIMIT = 7/);
  for (const args of [
    { path: "../x", start: 1, end: 1 },
    { path: ".env", start: 1, end: 1 },
    { path: "missing", start: 1, end: 1 },
  ]) {
    const e: any = await call("read_range", args);
    assert.equal(e.isError, true);
  }
  const invalid: any = await call("read_range", {
    path: "answer.ts",
    start: 0,
    end: 1,
  });
  assert.equal(invalid.isError, true);
});
test("concurrent protocol reads succeed below the queue limit", async (t) => {
  const root = await mkdtemp(
    path.join(process.env.TMPDIR || tmpdir(), "mcp-queue-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "answer.txt"), "QUEUED_EVIDENCE\n");
  const client = new Client({ name: "queue-test", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("dist/cli.js"), "--root", root],
      stderr: "pipe",
    }),
  );
  const results: any[] = await Promise.all(
    Array.from({ length: 12 }, () =>
      client.callTool({
        name: "read_range",
        arguments: { path: "answer.txt", start: 1, end: 1 },
      }),
    ),
  );
  for (const result of results) {
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.match(result.content[0].text, /QUEUED_EVIDENCE/);
  }
});

test("queue overload is bounded and errors do not stall later requests", async (t) => {
  const root = await mkdtemp(
    path.join(process.env.TMPDIR || tmpdir(), "mcp-overflow-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "answer.txt"), "RECOVERED\n");
  const client = new Client({ name: "overload-test", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("dist/cli.js"), "--root", root],
      stderr: "pipe",
    }),
  );
  const results: any[] = await Promise.all(
    Array.from({ length: 64 }, (_, i) =>
      client.callTool({
        name: "read_range",
        arguments: {
          path: i === 0 ? "missing.txt" : "answer.txt",
          start: 1,
          end: 1,
        },
      }),
    ),
  );
  assert.equal(results[0].isError, true);
  assert.ok(
    results.some((r) => r.isError && /Queue full/.test(r.content[0].text)),
  );
  assert.ok(
    results.some((r) => !r.isError && /RECOVERED/.test(r.content[0].text)),
  );
  const recovered: any = await client.callTool({
    name: "read_range",
    arguments: { path: "answer.txt", start: 1, end: 1 },
  });
  assert.equal(recovered.isError, undefined);
  assert.match(recovered.content[0].text, /RECOVERED/);
});

test("CLI rejects implicit root and unknown arguments", () => {
  for (const args of [[], ["--wat"]]) {
    const p = spawnSync(process.execPath, ["dist/cli.js", ...args], {
      encoding: "utf8",
    });
    assert.equal(p.status, 1);
    assert.match(p.stderr, /--root/);
    assert.equal(p.stdout, "");
  }
});
