import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workspace } from "../src/workspace.js";
export async function fixture(t: any) {
  const root = await mkdtemp(
    path.join(process.env.TMPDIR || tmpdir(), "context-test-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("exact line read is bounded and referenced", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "a.ts"), "one\ntwo\nthree\n");
  const w = await Workspace.create(root);
  const r = await w.read("a.ts", 2, 2);
  assert.deepEqual(r.lines, [{ line: 2, text: "two" }]);
  assert.equal(r.path, "a.ts");
  await assert.rejects(w.read("a.ts", 0, 2));
  await assert.rejects(w.read("a.ts", 1, 501));
});
test("read output is bounded without altering returned source lines", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "long.txt"), "x".repeat(20000) + "\nsmall");
  const w = await Workspace.create(root);
  const r = await w.read("long.txt", 1, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) <= 16000);
  assert.equal(r.truncated, true);
  assert.equal(r.nextLine, 1);
});
test("literal retrieval ranks unique terms and returns bounded evidence", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "a.ts"), "alpha\nother");
  await writeFile(path.join(root, "b.ts"), "alpha beta\nend");
  await writeFile(path.join(root, ".env"), "alpha beta");
  const w = await Workspace.create(root);
  const r = await w.search(["alpha", "beta"]);
  assert.equal(r.hits[0].path, "b.ts");
  assert.equal(r.hits[0].line, 1);
  assert.equal(r.hits[0].text, "alpha beta");
  assert.equal(r.hits.length, 2);
  assert.equal(r.incomplete, false);
  assert.deepEqual(await w.search(["alpha", "beta"]), r);
  const inventory = await w.inventory();
  assert.deepEqual(inventory.files, ["a.ts", "b.ts"]);
  await assert.rejects(w.search([""]));
});
test("Windows aliases and secret filename variants cannot bypass policy", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "service-account.json"), "private_key");
  await writeFile(path.join(root, "app.credentials.json"), "password");
  const w = await Workspace.create(root);
  for (const p of [
    "service-account.json",
    "app.credentials.json",
    "file.",
    "file ",
    "CON",
    "NUL.txt",
    "x/PRN",
  ])
    await assert.rejects(w.read(p, 1, 1), p);
});
test("boundary rejects traversal, symlinks, secrets, ignores and oversized files", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await writeFile(path.join(outside, "secret.txt"), "outside");
  await writeFile(path.join(root, ".env"), "PASSWORD=bad");
  await writeFile(path.join(root, "credentials.json"), "bad");
  await writeFile(path.join(root, "private.txt"), "hidden");
  await writeFile(path.join(root, ".contextignore"), "private.txt\n");
  await writeFile(path.join(root, "big.txt"), "x".repeat(262145));
  await mkdir(path.join(root, "vendor"));
  await symlink(outside, path.join(root, "link"), "junction");
  const w = await Workspace.create(root);
  for (const p of [
    "../secret.txt",
    outside,
    "link/secret.txt",
    ".env",
    "credentials.json",
    "private.txt",
    "big.txt",
    "C:secret",
    "a/../.env",
  ])
    await assert.rejects(w.read(p, 1, 1), p);
});
