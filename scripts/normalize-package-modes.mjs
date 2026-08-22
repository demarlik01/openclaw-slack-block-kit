import { chmod, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

const packageRoots = [
  "dist",
  "docs",
  "LICENSE",
  "README.md",
  "README.ko.md",
  "openclaw.plugin.json",
  "package.json",
];

async function normalize(path) {
  const stats = await lstat(path);

  if (stats.isSymbolicLink()) {
    return;
  }

  if (stats.isDirectory()) {
    await chmod(path, 0o755);
    const entries = await readdir(path);
    await Promise.all(entries.map((entry) => normalize(join(path, entry))));
    return;
  }

  if (stats.isFile()) {
    await chmod(path, 0o644);
  }
}

await Promise.all(packageRoots.map(normalize));
