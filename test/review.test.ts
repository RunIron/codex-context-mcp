import { test } from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workspace } from "../src/workspace.js";

test("unsafe final file metadata is rejected before opening", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "directory"));
  await writeFile(path.join(root, "large"), Buffer.alloc(262145));
  await writeFile(path.join(root, "source"), "text");
  await fs.link(path.join(root, "source"), path.join(root, "hard"));
  const w = await Workspace.create(root);
  const opened: string[] = [];
  const original = fs.open;
  t.mock.method(fs, "open", async (p: string) => {
    opened.push(p);
    throw new Error("unexpected open before metadata check");
  });
  syncBuiltinESMExports();
  try {
    for (const name of ["directory", "large", "hard"])
      await assert.rejects(
        w.read(name, 1, 1),
        /Not a bounded single-link regular file/,
      );
    assert.deepEqual(opened, []);
  } finally {
    fs.open = original;
    syncBuiltinESMExports();
    t.mock.restoreAll();
  }
});

for (const name of ["pipe", ".gitignore", ".contextignore"]) {
  test(
    `real Linux FIFO ${name} rejects without hanging`,
    { skip: process.platform !== "linux" ? "Requires Linux mkfifo" : false },
    async (t) => {
      const root = await fixture(t);
      execFileSync("mkfifo", [path.join(root, name)]);
      const source = new URL("../src/workspace.ts", import.meta.url).href;
      const code = `import assert from 'node:assert/strict';
      import { Workspace } from ${JSON.stringify(source)};
      const run = async () => {
        const w = await Workspace.create(${JSON.stringify(root)});
        ${name === "pipe" ? 'await w.read("pipe", 1, 1);' : ""}
      };
      await assert.rejects(run(), ${name === "pipe" ? "/Not a bounded single-link regular file/" : "/Cannot safely load/"});`;
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", code],
        { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" },
      );
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      assert.equal(result.status, 0, result.stderr);
    },
  );
}

test("directory-only ignores prune before consuming the scan budget", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "ignored"));
  await writeFile(path.join(root, ".gitignore"), "ignored/\n");
  await writeFile(path.join(root, "visible.txt"), "evidence");
  for (let batch = 0; batch < 41; batch++)
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        writeFile(path.join(root, "ignored", `${batch}-${i}.txt`), "ignored"),
      ),
    );
  const w = await Workspace.create(root);
  const result = await w.inventory();
  assert.equal(result.incomplete, false, JSON.stringify(result.reasons));
  assert.deepEqual(result.files, [".gitignore", "visible.txt"]);
});

async function fixture(t: any) {
  const root = await mkdtemp(
    path.join(process.env.TMPDIR || tmpdir(), "review-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test(
  "Windows real 8.3 aliases cannot bypass canonical exclusions",
  {
    skip:
      process.platform !== "win32"
        ? "Windows 8.3 aliases unavailable on this platform"
        : false,
  },
  async (t) => {
    const root = await fixture(t);
    await writeFile(path.join(root, "credentials.json"), "denied");
    await writeFile(path.join(root, "private-data.txt"), "denied");
    await mkdir(path.join(root, "private-directory"));
    await writeFile(path.join(root, "private-directory", "ok.txt"), "denied");
    await mkdir(path.join(root, "secret-directory"));
    await writeFile(path.join(root, "secret-directory", "ok.txt"), "denied");
    await writeFile(
      path.join(root, ".contextignore"),
      "private-data.txt\nprivate-directory/\n",
    );
    const names = [
      "credentials.json",
      "private-data.txt",
      "private-directory",
      "secret-directory",
    ];
    const aliases = names.map((name, i) =>
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$f = New-Object -ComObject Scripting.FileSystemObject; $f.${i < 2 ? "GetFile" : "GetFolder"}('${path.join(root, name).replaceAll("'", "''")}').ShortName`,
        ],
        { encoding: "utf8" },
      ).trim(),
    );
    if (
      aliases.some((alias, i) => alias.toLowerCase() === names[i].toLowerCase())
    ) {
      t.skip("8.3 short-name generation unavailable on fixture volume");
      return;
    }
    assert.ok(
      aliases.every((alias) => alias.includes("~")),
      JSON.stringify(aliases),
    );
    const w = await Workspace.create(root);
    for (let i = 0; i < aliases.length; i++) {
      const file = aliases[i] + (i < 2 ? "" : "/ok.txt");
      await assert.rejects(w.read(file, 1, 1), /Path denied/, file);
    }
  },
);
