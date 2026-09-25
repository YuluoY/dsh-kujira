import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectHarnessDependencies, prepareHarnessDependencies } from "../lib/host/harness-dependencies.js";
import { installCommand } from "../lib/host/harness-install.js";

const version = "0.1.7-alpha.2", old = "0.1.6-alpha.2";
const host = "@deepseek-ai/dsh", consumer = "@deepseek-ai/dsh-session-title-first-prompt-llm";
const producer = "@deepseek-ai/dsh-session-title-llm";
const metadata = (name) => ({ name, version, dist: { tarball: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`, integrity: "sha512-test" } });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "kujira-dependencies-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const put = async (name, fields = {}, location = join(directory, "node_modules", name)) => {
    await mkdir(location, { recursive: true });
    await writeFile(join(location, "package.json"), JSON.stringify({ name, version, ...fields }));
    return location;
  };
  await put(host, { dependencies: { [consumer]: version } });
  await put(consumer, { peerDependencies: { [producer]: version } });
  await put(producer, { version: old });
  const installation = { path: join(directory, "node_modules", host), supported: true, manager: "pnpm", command: { file: "pnpm", args: [] } };
  return { directory, put, installation };
}

test("finds old peers even when the host and consumer already have the target version", async (t) => {
  const { installation } = await fixture(t);
  const result = await inspectHarnessDependencies(installation);
  assert.deepEqual(result.issues, [{ name: producer, version: old, expected: version }]);
});

test("one install aligns reachable global pins and leaves unrelated or retired tools untouched", async (t) => {
  const { installation } = await fixture(t);
  const requested = [];
  const packages = await prepareHarnessDependencies(installation, version, {
    run: async (command) => {
      assert.deepEqual(command.args, ["list", "--global", "--depth", "0", "--json"]);
      return JSON.stringify([{ dependencies: { [host]: {}, [producer]: {}, "@deepseek-ai/dsh-code-runtime": {}, "other-cli": {} } }]);
    },
    registry: async (path) => { requested.push(path); return metadata(producer); },
  });
  assert.deepEqual(packages, [producer]);
  assert.deepEqual(requested, [`/@deepseek-ai%2Fdsh-session-title-llm/${version}`]);
  for (const manager of ["pnpm", "npm"]) {
    const command = installCommand({ ...installation, manager }, version, packages);
    assert(command.args.includes(`${host}@${version}`));
    assert(command.args.includes(`${producer}@${version}`));
    assert(!command.args.some((arg) => arg.includes("code-runtime")));
  }
  assert.throws(() => installCommand(installation, version, ["--ignore-scripts"]), /invalid-package/);
});

test("missing release, malformed inventory and foreign package metadata stop preflight", async (t) => {
  const { installation } = await fixture(t);
  const run = async () => JSON.stringify({ dependencies: { [host]: {}, [producer]: {} } });
  for (const registry of [async () => { throw Error("404"); }, async () => metadata("@deepseek-ai/dsh-other")])
    await assert.rejects(prepareHarnessDependencies(installation, version, { run, registry }), /dependency-release-unavailable/);
  await assert.rejects(prepareHarnessDependencies(installation, version, { run: async () => "truncated", registry: assert.fail }), /dependency-check-failed/);
});

test("post-install inspection follows replaced symlinks and checks missing required peers", async (t) => {
  const f = await fixture(t);
  const link = join(f.directory, "node_modules", producer);
  await rm(link, { recursive: true });
  const oldPath = await f.put(producer, { version: old }, join(f.directory, "store", "old"));
  const newPath = await f.put(producer, {}, join(f.directory, "store", "new"));
  await symlink(oldPath, link, "junction");
  assert.equal((await inspectHarnessDependencies(f.installation)).issues.length, 1);
  await unlink(link); await symlink(newPath, link, "junction");
  assert.deepEqual((await inspectHarnessDependencies(f.installation)).issues, []);
  await unlink(link);
  assert.deepEqual((await inspectHarnessDependencies(f.installation)).issues, [{ name: producer, version: null, expected: version }]);
});

test("absent optional peers are allowed but installed incompatible optional peers are checked", async (t) => {
  const f = await fixture(t);
  await f.put(consumer, { peerDependencies: { [producer]: version }, peerDependenciesMeta: { [producer]: { optional: true } } });
  assert.equal((await inspectHarnessDependencies(f.installation)).issues.length, 1);
  await rm(join(f.directory, "node_modules", producer), { recursive: true });
  assert.deepEqual((await inspectHarnessDependencies(f.installation)).issues, []);
});

test("stale implicit peers are added without pinning every healthy dependency", async (t) => {
  const { installation } = await fixture(t);
  const options = { run: async () => JSON.stringify({ dependencies: { [host]: {} } }), registry: async () => metadata(producer) };
  assert.deepEqual(await prepareHarnessDependencies(installation, version, options), [producer]);
});
