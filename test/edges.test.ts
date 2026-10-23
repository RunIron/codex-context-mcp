import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, link, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workspace } from "../src/workspace.js";
async function fixture(t: any) {
  const root = await mkdtemp(
    path.join(process.env.TMPDIR || tmpdir(), "edge-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test("exact reads preserve a UTF-8 BOM", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "bom.txt"), "\ufeffalpha\n");
  const w = await Workspace.create(root);
  assert.equal((await w.read("bom.txt", 1, 1)).lines[0].text, "\ufeffalpha");
});
test("read response stays under 16000 bytes with long Unicode paths", async (t) => {
  const root = await fixture(t);
  const dir = Array(12).fill("中".repeat(70)).join("/");
  await mkdir(path.join(root, dir), { recursive: true });
  const file = dir + "/x.txt";
  await writeFile(path.join(root, file), "a".repeat(13950));
  const w = await Workspace.create(root);
  const r = await w.read(file, 1, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 16000);
});
test("UTF8 exact lines, CRLF, EOF, empty file and validation", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "unicode.txt"), "中文🙂\r\n終點\r\n");
  await writeFile(path.join(root, "empty"), "");
  const w = await Workspace.create(root);
  assert.deepEqual((await w.read("unicode.txt", 1, 2)).lines, [
    { line: 1, text: "中文🙂" },
    { line: 2, text: "終點" },
  ]);
  assert.equal((await w.read("unicode.txt", 1, 500)).truncated, false);
  assert.deepEqual((await w.read("empty", 1, 1)).lines, []);
  assert.deepEqual((await w.read("unicode.txt", 20, 30)).lines, []);
  for (const range of [
    [2, 1],
    [1.5, 2],
    [NaN, 2],
    [1, Infinity],
  ])
    await assert.rejects(w.read("unicode.txt", ...(range as [number, number])));
});
test("binary, malformed UTF8, hardlinks, symlinked ignores and gitignored dirs", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "binary"), Buffer.from([0, 1]));
  await writeFile(path.join(root, "badutf8"), Buffer.from([255]));
  await writeFile(path.join(root, "source"), "abc");
  await link(path.join(root, "source"), path.join(root, "hard"));
  await mkdir(path.join(root, "hidden"));
  await writeFile(path.join(root, "hidden", "a"), "abc");
  await writeFile(path.join(root, ".gitignore"), "hidden/\n");
  const w = await Workspace.create(root);
  for (const f of ["binary", "badutf8", "source", "hard", "hidden/a"])
    await assert.rejects(w.read(f, 1, 1), f);
  const r = await w.search(["abc"]);
  assert.equal(r.incomplete, true);
  assert.ok(r.reasons.includes("skipped_file"));
  assert.equal(r.hits.length, 0);
  const other = await fixture(t);
  await symlink(root, path.join(other, ".contextignore"), "junction");
  await assert.rejects(Workspace.create(other));
});
test("literal not regex; ranking deduplicates terms, ties path/line; output bounded", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "a"),
    "a.*b\na.*b\n" + "x".repeat(1000) + "target\n" + "match\n".repeat(100),
  );
  await writeFile(path.join(root, "b"), "axb\na.*b");
  const w = await Workspace.create(root);
  const r = await w.search(["a.*b", "a.*b"]);
  assert.deepEqual(
    r.hits.map((h) => [h.path, h.line, h.score]),
    [
      ["a", 1, 1],
      ["a", 2, 1],
      ["b", 2, 1],
    ],
  );
  const clipped = await w.search(["target"]);
  assert.ok(clipped.hits[0].text.includes("target"));
  assert.equal(clipped.hits[0].clipped, true);
  const many = await w.search(["match"]);
  assert.equal(many.hits.length, 40);
  assert.equal(many.incomplete, true);
  assert.ok(Buffer.byteLength(JSON.stringify(many)) < 16000);
  for (const terms of [[], [" "], ["x".repeat(129)], Array(13).fill("x")])
    await assert.rejects(w.search(terms));
});
test("file-count and output limits signal incomplete inventory", async (t) => {
  const root = await fixture(t);
  for (let i = 0; i < 1005; i++)
    await writeFile(path.join(root, `${i}.txt`), "needle");
  const w = await Workspace.create(root);
  const r = await w.inventory();
  assert.equal(r.incomplete, true);
  assert.ok(r.files.length <= 1000);
  assert.ok(r.reasons.includes("scan_limit"));
  const search = await w.search(["needle"]);
  assert.equal(search.incomplete, true);
  assert.ok(search.hits.length <= 40);
});
