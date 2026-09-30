#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyConsumer } from "../../packages/lexical-review/package-contract/consumer.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(scriptDirectory, "../..");
const packageDirectory = path.join(
  repositoryDirectory,
  "packages/lexical-review",
);

const requiredEntries = [
  "package.json",
  "README.md",
  "dist/index.js",
  "dist/index.mjs",
  "dist/index.d.ts",
];
const allowedTopLevelFiles = new Set([
  "package.json",
  "README.md",
  "README",
  "LICENSE",
  "LICENSE.md",
  "LICENCE",
  "LICENCE.md",
]);

function fail(stage, message) {
  throw new Error(`release:${stage}: ${message}`);
}

function parseArgument(args, option) {
  const index = args.indexOf(option);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value == null || value.startsWith("--")) {
    fail("args", `${option} requires a value.`);
  }
  return value;
}

function readPackageJson() {
  return JSON.parse(
    readFileSync(path.join(packageDirectory, "package.json"), "utf8"),
  );
}

function cleanReleaseEnvironment() {
  for (const variable of [
    "LEXICAL_COMPATIBILITY_VERSION",
    "REACT_COMPATIBILITY_VERSION",
    "LEXICAL_COMPATIBILITY_MATRIX_VERSION",
  ]) {
    if (process.env[variable] != null) {
      console.log(
        `release:env: ignoring ${variable}=${process.env[variable]} so validation uses the committed graph.`,
      );
      delete process.env[variable];
    }
  }
}

function runPnpm(args, cwd = repositoryDirectory) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error != null) {
    throw result.error;
  }
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status !== 0) {
    fail(
      "exec",
      `pnpm ${args.join(" ")} failed with exit code ${result.status}.`,
    );
  }
  return result.stdout ?? "";
}

function runTar(args, cwd = repositoryDirectory) {
  const result = spawnSync("tar", args, { cwd, encoding: "utf8" });
  if (result.error != null) {
    throw result.error;
  }
  if (result.status !== 0) {
    fail(
      "exec",
      `tar ${args.join(" ")} failed with exit code ${result.status}.`,
    );
  }
  return result.stdout ?? "";
}

async function checkVersion(tag) {
  const packageJson = readPackageJson();
  if (typeof packageJson.version !== "string" || packageJson.version === "") {
    fail("version", "packages/lexical-review/package.json has no version.");
  }
  if (tag == null) {
    console.log(
      `release:version: package is ${packageJson.version} (no --tag given, skipping tag agreement).`,
    );
    return packageJson.version;
  }
  const tagVersion = tag.startsWith("v") ? tag.slice(1) : tag;
  if (tagVersion !== packageJson.version) {
    fail(
      "version",
      `prospective tag ${tag} disagrees with package version ${packageJson.version}.`,
    );
  }
  console.log(
    `release:version: tag ${tag} agrees with package version ${packageJson.version}.`,
  );
  return packageJson.version;
}

async function installDependencies() {
  runPnpm(["install", "--frozen-lockfile"]);
}

async function buildPackage() {
  runPnpm(["--filter", "lexical-review", "build"]);
}

async function packTarball(version, packDirectory) {
  const output = runPnpm(
    ["pack", "--pack-destination", packDirectory],
    packageDirectory,
  );
  const expectedName = `lexical-review-${version}.tgz`;
  const tarballPath = path.join(packDirectory, expectedName);
  try {
    readFileSync(tarballPath);
  } catch {
    fail(
      "pack",
      `expected tarball ${expectedName} in ${packDirectory}; pnpm output:\n${output}`,
    );
  }
  console.log(`release:pack: tarball ${tarballPath}.`);
  return tarballPath;
}

function listTarballEntries(tarballPath) {
  return runTar(["-tzf", tarballPath])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && line !== "package/")
    .map((line) =>
      line.startsWith("package/") ? line.slice("package/".length) : line,
    );
}

async function inspectContents(tarballPath) {
  const entries = listTarballEntries(tarballPath);
  const missing = requiredEntries.filter((name) => !entries.includes(name));
  if (missing.length > 0) {
    fail(
      "contents",
      `tarball is missing required files: ${missing.join(", ")}.`,
    );
  }
  const unexpected = entries.filter((name) => {
    if (name.startsWith("dist/")) {
      return false;
    }
    return !allowedTopLevelFiles.has(name);
  });
  if (unexpected.length > 0) {
    fail(
      "contents",
      `tarball contains files outside dist/ and the allowed top level: ${unexpected.slice(0, 20).join(", ")}${unexpected.length > 20 ? ` (+${unexpected.length - 20} more)` : ""}.`,
    );
  }
  console.log(`release:contents: ${entries.length} entries, all expected.`);
}

async function checkTarballConsumer(tarballPath) {
  const consumerDirectory = await mkdtemp(
    path.join(os.tmpdir(), "lexical-review-release-consumer-"),
  );
  try {
    await writeFile(
      path.join(consumerDirectory, "package.json"),
      JSON.stringify(
        {
          name: "lexical-review-release-consumer",
          private: true,
          type: "module",
        },
        null,
        2,
      ) + "\n",
    );
    try {
      runPnpm(["add", tarballPath], consumerDirectory);
      const installedPackageJson = JSON.parse(
        readFileSync(
          path.join(
            consumerDirectory,
            "node_modules",
            "lexical-review",
            "package.json",
          ),
          "utf8",
        ),
      );
      const peers = Object.entries(
        installedPackageJson.peerDependencies ?? {},
      ).map(([name, range]) => `${name}@${range}`);
      if (peers.length > 0) {
        runPnpm(["add", ...peers], consumerDirectory);
      }
    } catch (error) {
      fail(
        "consumer",
        `installing the tarball failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
    try {
      await verifyConsumer(consumerDirectory);
    } catch (error) {
      fail(
        "consumer",
        `tarball consumer checks failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  } finally {
    await rm(consumerDirectory, { force: true, recursive: true });
  }
}

async function dryRunPublish(tarballPath) {
  runPnpm(["publish", tarballPath, "--dry-run", "--no-git-checks"]);
}

async function writeExpectedJobs(packDirectory) {
  // Dynamic import: semver (via the compatibility runner) is only resolvable
  // after the install stage, so this must not be a static import.
  const {
    createCompatibilityMatrix,
    createE2ECompatibilityMatrix,
    getCurrentLexicalVersion,
    loadCompatibilityConfig,
  } = await import("../compatibility/runner.mjs");
  const config = loadCompatibilityConfig();
  const currentVersion = getCurrentLexicalVersion();
  const unit = createCompatibilityMatrix(config, currentVersion);
  const e2e = createE2ECompatibilityMatrix(config, currentVersion);
  const jobs = {
    "lexical-compatibility.yml": [
      "Resolve compatibility matrix",
      ...unit.map(({ version }) => `Lexical ${version}`),
      ...e2e.map(
        ({ lexicalVersion, reactVersion, project }) =>
          `E2E Lexical ${lexicalVersion} React ${reactVersion} (${project})`,
      ),
    ],
    "package-contract.yml": ["Verify published package contract"],
  };
  await writeFile(
    path.join(packDirectory, "release-jobs.json"),
    JSON.stringify(jobs, null, 2) + "\n",
  );
  console.log(
    `release:jobs: wrote ${jobs["lexical-compatibility.yml"].length + jobs["package-contract.yml"].length} expected gate jobs.`,
  );
}

async function runStage(name, task) {
  console.log(`release:${name}: start.`);
  try {
    const result = await task();
    console.log(`release:${name}: ok.`);
    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`release:${name}:`)
    ) {
      throw error;
    }
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

function printHelp() {
  console.log(`Usage:
  pnpm release:dry-run [-- --tag <vX.Y.Z>] [--pack-dir <directory>]

Validates the v3 release artifact without publishing: tag/version agreement,
frozen install, production build, single pack, packed-contents inspection,
tarball consumer checks, and an npm publication dry run.`);
}

async function verify(args) {
  cleanReleaseEnvironment();
  const tag = parseArgument(args, "--tag");
  const packDirectory = path.resolve(
    repositoryDirectory,
    parseArgument(args, "--pack-dir") ??
      mkdtempSync(path.join(os.tmpdir(), "lexical-review-release-tarball-")),
  );
  await mkdir(packDirectory, { recursive: true });
  const version = await runStage("version", () => checkVersion(tag));
  await runStage("install", installDependencies);
  await runStage("jobs", () => writeExpectedJobs(packDirectory));
  await runStage("build", buildPackage);
  const tarballPath = await runStage("pack", () =>
    packTarball(version, packDirectory),
  );
  await runStage("contents", () => inspectContents(tarballPath));
  await runStage("consumer", () => checkTarballConsumer(tarballPath));
  await runStage("dry-run", () => dryRunPublish(tarballPath));
  console.log(`release: verified ${tarballPath} without publishing.`);
}

async function main(args) {
  if (args.includes("--help")) {
    printHelp();
    return;
  }
  const command = args[0] ?? "verify";
  if (command !== "verify") {
    fail("args", `unknown command ${command}; expected verify.`);
  }
  await verify(command === "verify" ? args.slice(1) : args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
