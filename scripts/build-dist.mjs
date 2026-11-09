import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

await mkdir("dist/setup", { recursive: true });
const result = await build({
  entryPoints: ["src/setup-protoc.ts"],
  outfile: "dist/setup/index.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node24",
  legalComments: "linked",
  metafile: true,
});
await copyFile("src/protoc.json", "dist/setup/protoc.json");

// Preserve full dependency licenses, not only source comments kept by esbuild.
const packages = new Set(
  Object.keys(result.metafile.inputs).flatMap((input) => {
    const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    return match?.[1] ? [match[1]] : [];
  }),
);
const notices = [];
for (const directory of [...packages].sort()) {
  const pkg = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const licenses = (await readdir(directory))
    .filter((name) => /^(license|notice)(\.|$)/i.test(name))
    .sort();
  if (licenses.length === 0)
    throw new Error(`Missing license for bundled dependency ${pkg.name}`);
  notices.push(
    `${pkg.name}@${pkg.version}\n${"=".repeat(72)}\n${(await Promise.all(licenses.map((name) => readFile(path.join(directory, name), "utf8")))).join("\n")}`,
  );
}
await writeFile(
  "dist/setup/THIRD_PARTY_NOTICES.txt",
  `${notices.join("\n\n").trimEnd()}\n`,
);
