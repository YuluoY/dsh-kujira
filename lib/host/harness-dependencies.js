import { readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compareVersions, HARNESS_PACKAGE, NPM_REGISTRY, runCommand } from "./harness-install.js";

const officialPackage = (name) => /^@deepseek-ai\/dsh(?:-[a-z0-9]+)*$/.test(name);

async function manifest(path) {
  const file = await realpath(path);
  return { ...JSON.parse(await readFile(file, "utf8")), file };
}

async function resolveDependency(from, name) {
  let directory = dirname(from);
  for (;;) {
    try { return await manifest(join(directory, "node_modules", name, "package.json")); }
    catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * @description Inspect actual DSH dependency and peer resolutions without Node's module cache.
 * @param {object} installation Verified global package location.
 * @returns {Promise<object>} Reachable official packages and release mismatches or missing dependencies.
 */
export async function inspectHarnessDependencies(installation) {
  const root = await manifest(join(installation.path, "package.json"));
  if (root.name !== HARNESS_PACKAGE) throw Error("dependency-check-failed");
  const pending = [root], seen = new Set(), peers = new Set(), packages = [], issues = [];
  while (pending.length) {
    const item = pending.pop();
    if (seen.has(item.file)) continue;
    if (seen.size >= 2000) throw Error("dependency-check-failed");
    seen.add(item.file);
    packages.push({ name: item.name, version: item.version });
    if (item.version !== root.version) issues.push({ name: item.name, version: item.version, expected: root.version });
    const dependencies = { ...item.peerDependencies, ...item.optionalDependencies, ...item.dependencies };
    for (const name of Object.keys(dependencies).filter(officialPackage)) {
      const child = await resolveDependency(item.file, name);
      if (child?.name === name) {
        pending.push(child);
        if (Object.hasOwn(item.peerDependencies || {}, name)) peers.add(name);
      } else if (!Object.hasOwn(item.optionalDependencies || {}, name) && !item.peerDependenciesMeta?.[name]?.optional) {
        issues.push({ name, version: null, expected: root.version });
        if (Object.hasOwn(item.peerDependencies || {}, name)) peers.add(name);
      }
    }
  }
  return { packages, peers: [...peers], issues };
}

/**
 * @description Validate the identity and official download location of one coordinated release package.
 * @param {object} metadata Registry package version document.
 * @param {string} name Expected official package name.
 * @param {string} version Exact target release.
 * @returns {boolean} Whether the metadata matches the requested official package.
 */
export function validHarnessMetadata(metadata, name, version) {
  const leaf = name.split("/").at(-1);
  return officialPackage(name) && metadata?.name === name && metadata.version === version &&
    typeof metadata.dist?.tarball === "string" && metadata.dist.tarball.startsWith(`${NPM_REGISTRY}/${name}/-/${leaf}-`) &&
    typeof metadata.dist.integrity === "string" && metadata.dist.integrity.length > 0;
}

/**
 * @description Preflight global DSH pins and required peer providers for a coordinated install.
 * @param {object} installation Verified installation and package manager.
 * @param {string} version Exact target release.
 * @param {object} options Registry reader and injectable inspection/command adapters.
 * @returns {Promise<string[]>} Reachable official packages to install alongside the host.
 */
export async function prepareHarnessDependencies(installation, version, {
  registry, run = runCommand, inspect = inspectHarnessDependencies, signal,
} = {}) {
  compareVersions(version, version);
  const graph = await inspect(installation);
  const output = await run({ file: installation.command.file,
    args: [...installation.command.args, "list", "--global", "--depth", "0", "--json"] }, { signal });
  let inventory;
  try {
    const parsed = JSON.parse(output);
    inventory = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
    if (!inventory?.dependencies || !Object.hasOwn(inventory.dependencies, HARNESS_PACKAGE)) throw Error();
  } catch { throw Error("dependency-check-failed"); }
  const reachable = new Set(graph.packages.map((item) => item.name));
  for (const issue of graph.issues) reachable.add(issue.name);
  const mismatches = new Set(graph.issues.map((issue) => issue.name));
  const candidates = new Set([...Object.keys(inventory.dependencies), ...(graph.peers || []).filter((name) => mismatches.has(name))]);
  const packages = [...candidates].filter((name) =>
    name !== HARNESS_PACKAGE && officialPackage(name) && reachable.has(name)).sort();
  for (let start = 0; start < packages.length; start += 4) {
    await Promise.all(packages.slice(start, start + 4).map(async (name) => {
      let metadata;
      try { metadata = await registry(`/${name.replace("/", "%2F")}/${version}`); }
      catch { throw Error("dependency-release-unavailable"); }
      if (!validHarnessMetadata(metadata, name, version)) throw Error("dependency-release-unavailable");
    }));
  }
  return packages;
}
