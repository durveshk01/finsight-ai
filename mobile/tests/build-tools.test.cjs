const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const deepmerge = require("deepmerge");
const { glob, globSync } = require("glob");
const { getAssetData, getAssetSize } = require("../node_modules/metro/src/Assets.js");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
let directory;
before(async () => {
  const cache = path.resolve(__dirname, "../node_modules/.cache");
  await fs.mkdir(cache, { recursive: true });
  directory = await fs.mkdtemp(path.join(cache, "finsight-tools-"));
  await fs.writeFile(path.join(directory, "logo.png"), png);
});
after(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); });

test("patched Metro sizes buffered and file-backed assets with image-size 2", async () => {
  assert.deepEqual(getAssetSize("png", png, "logo.png"), { width: 1, height: 1 });
  const data = await getAssetData(path.join(directory, "logo.png"), ".", [], "android", "/assets");
  assert.equal(data.width, 1);
  assert.equal(data.height, 1);
  assert.equal(data.files.length, 1);
});
test("glob override preserves both synchronous and Promise-based Expo APIs", async () => {
  assert.deepEqual(globSync("**/*.png", { cwd: directory }), ["logo.png"]);
  assert.deepEqual(await glob("**/*.png", { cwd: directory }), ["logo.png"]);
});
test("deepmerge patch blocks prototype poisoning in both operands and nested objects", () => {
  const poison = JSON.parse('{"__proto__":{"isAdmin":true},"nested":{"__proto__":{"isAdmin":true}}}');
  for (const value of [deepmerge(poison, {}), deepmerge({}, poison), deepmerge(Object.create(null), poison)]) {
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.equal(value.isAdmin, undefined);
    assert.equal(value.nested.isAdmin, undefined);
  }
  assert.equal({}.isAdmin, undefined);
  assert.deepEqual(deepmerge({ nested: { one: 1 }, plugins: ["a"] }, { nested: { two: 2 }, plugins: ["b"] }), { nested: { one: 1, two: 2 }, plugins: ["a", "b"] });
});
