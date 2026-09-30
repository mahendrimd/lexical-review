import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const packageContractDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(packageContractDirectory, "..");
const repositoryDirectory = path.resolve(packageDirectory, "../..");
const fixtureDirectory = path.join(packageContractDirectory, "fixtures");
const typeFixtures = ["root.ts", "cjs-root.cts"];
const runtimeFixtures = ["runtime-root.mjs", "runtime-root.cjs"];

async function linkDependencies(consumerDirectory) {
  const nodeModulesDirectory = path.join(consumerDirectory, "node_modules");
  await mkdir(nodeModulesDirectory, { recursive: true });

  for (const dependency of ["@lexical", "lexical"]) {
    const source = path.join(packageDirectory, "node_modules", dependency);
    const target = path.join(nodeModulesDirectory, dependency);

    await mkdir(path.dirname(target), { recursive: true });
    await symlink(source, target, "dir");
  }
}

async function createConsumer(temporaryDirectory) {
  const consumerDirectory = path.join(temporaryDirectory, "consumer");
  const packageTarget = path.join(
    consumerDirectory,
    "node_modules",
    "lexical-review",
  );

  await mkdir(packageTarget, { recursive: true });
  await writeFile(
    path.join(consumerDirectory, "package.json"),
    JSON.stringify(
      {
        name: "lexical-review-package-consumer",
        private: true,
        type: "module",
      },
      null,
      2,
    ) + "\n",
  );
  await cp(
    path.join(packageDirectory, "package.json"),
    path.join(packageTarget, "package.json"),
  );
  await cp(
    path.join(packageDirectory, "dist"),
    path.join(packageTarget, "dist"),
    { recursive: true },
  );
  await linkDependencies(consumerDirectory);

  return consumerDirectory;
}

async function copyFixtures(consumerDirectory) {
  for (const fixture of [...typeFixtures, ...runtimeFixtures]) {
    await cp(
      path.join(fixtureDirectory, fixture),
      path.join(consumerDirectory, fixture),
    );
  }

  await writeFile(
    path.join(consumerDirectory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          lib: ["ESNext", "DOM", "DOM.Iterable"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        files: typeFixtures,
      },
      null,
      2,
    ) + "\n",
  );
}

async function runTypecheck(consumerDirectory) {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  try {
    await execFileAsync(
      pnpmCommand,
      [
        "exec",
        "tsc",
        "--noEmit",
        "--project",
        path.join(consumerDirectory, "tsconfig.json"),
      ],
      { cwd: repositoryDirectory },
    );
  } catch (error) {
    if (error && typeof error === "object") {
      const output = [error.stdout, error.stderr]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join("\n");
      if (output !== "") {
        console.error(output);
      }
    }
    throw error;
  }
}

async function runRuntimeFixture(consumerDirectory, fixture) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(consumerDirectory, fixture)],
    { cwd: consumerDirectory },
  );
  process.stdout.write(stdout);
}

export async function verifyConsumer(consumerDirectory) {
  const manifest = JSON.parse(
    await readFile(
      path.join(consumerDirectory, "node_modules/lexical-review/package.json"),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  for (const name of ["react", "react-dom", "@lexical/react"]) {
    assert.equal(manifest.dependencies?.[name], undefined);
    assert.equal(manifest.peerDependencies?.[name], undefined);
  }
  await copyFixtures(consumerDirectory);
  await runTypecheck(consumerDirectory);
  for (const fixture of runtimeFixtures)
    await runRuntimeFixture(consumerDirectory, fixture);
}

export async function verifyPackage() {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "lexical-review-package-contract-"),
  );
  try {
    const consumer = await createConsumer(temporaryDirectory);
    await verifyConsumer(consumer);
    console.log("package contract passed");
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
