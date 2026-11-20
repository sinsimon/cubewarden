#!/usr/bin/env node
// Installed package: the bundled dist/cli.js. In a clone without a build: the TypeScript sources directly.
import { existsSync } from "node:fs";

const built = new URL("../dist/cli.js", import.meta.url);
const { run } = await import(existsSync(built) ? built.href : "../src/cli.ts");
process.exitCode = await run(process.argv.slice(2), { cwd: process.cwd(), write: (s) => process.stdout.write(s) });
