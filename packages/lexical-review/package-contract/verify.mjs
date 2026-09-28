import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyStagedPackage } from "./consumer.mjs";

const packageContractDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(packageContractDirectory, "..");

const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "lexical-review-package-contract-"),
);

try {
  const stagedPackageDirectory = path.join(temporaryDirectory, "package");
  await mkdir(stagedPackageDirectory, { recursive: true });
  await cp(
    path.join(packageDirectory, "package.json"),
    path.join(stagedPackageDirectory, "package.json"),
  );
  await cp(
    path.join(packageDirectory, "dist"),
    path.join(stagedPackageDirectory, "dist"),
    {
      recursive: true,
    },
  );
  await verifyStagedPackage(stagedPackageDirectory);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
