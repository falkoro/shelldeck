#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const required = ["version", "target", "arch", "artifact", "signature", "url", "out"];

for (const key of required) {
  if (!args[key]) {
    console.error(`Missing --${key}`);
    process.exit(1);
  }
}

const signature = (await readFile(args.signature, "utf8")).trim();
const manifest = {
  version: args.version,
  notes: args.notes ?? "ShellDeck desktop release.",
  pub_date: new Date().toISOString(),
  platforms: {
    [`${args.target}-${args.arch}`]: {
      signature,
      url: args.url
    }
  }
};

await mkdir(path.dirname(args.out), { recursive: true });
await writeFile(args.out, `${JSON.stringify(manifest, null, 2)}\n`);

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;

    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}
