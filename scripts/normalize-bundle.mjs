import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const bundlePath = resolve("dist/index.js");
const bundle = readFileSync(bundlePath, "utf8")
  .replace(/[ \t]+$/gmu, "")
  .replace(/\n*$/u, "\n");

writeFileSync(bundlePath, bundle);
chmodSync(bundlePath, 0o755);
