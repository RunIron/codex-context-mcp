import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
const root = await mkdtemp(
  path.join(process.env.TMPDIR || tmpdir(), "pack-smoke-"),
);
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run via npm run smoke");
const run = (args: string[]) =>
  execFileSync(process.execPath, [npm, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
try {
  const packed = JSON.parse(
    run(["pack", "--json", "--pack-destination", root]),
  )[0];
  assert.ok(packed.files.some((f: any) => f.path === "dist/cli.js"));
  assert.ok(
    packed.files.some((f: any) => f.path === "docs/validation.md"),
    "README-linked validation document must ship",
  );
  assert.ok(
    packed.files.some((f: any) => f.path === "docs/codex-integration.md"),
  );
  assert.ok(
    packed.files.some((f: any) => f.path === "docs/workflow-results.json"),
  );
  assert.ok(
    !packed.files.some(
      (f: any) => f.path.startsWith("test/") || f.path.includes(".env"),
    ),
  );
  run([
    "install",
    "--prefix",
    root,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    path.join(root, packed.filename),
  ]);
  const pkg = path.join(root, "node_modules", "codex-context-mcp");
  const manifest = JSON.parse(
    await readFile(path.join(pkg, "package.json"), "utf8"),
  );
  assert.equal(manifest.bin["codex-context-mcp"], "dist/cli.js");
  await stat(
    path.join(
      root,
      "node_modules",
      ".bin",
      "codex-context-mcp" + (process.platform === "win32" ? ".cmd" : ""),
    ),
  );
  await writeFile(path.join(root, "evidence.txt"), "PACK_SMOKE=ok");
  const client = new Client({ name: "packed-smoke", version: "1.0.0" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          path.join(pkg, manifest.bin["codex-context-mcp"]),
          "--root",
          root,
        ],
        stderr: "pipe",
      }),
    );
    assert.equal((await client.listTools()).tools.length, 3);
    const r: any = await client.callTool({
      name: "read_range",
      arguments: { path: "evidence.txt", start: 1, end: 1 },
    });
    assert.match(r.content[0].text, /PACK_SMOKE=ok/);
  } finally {
    await client.close();
  }
  console.log(
    JSON.stringify({
      package: packed.filename,
      files: packed.files.length,
      installedBin: true,
      subprocessHandshake: true,
      exactRead: true,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
