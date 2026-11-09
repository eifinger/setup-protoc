import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tc from "@actions/tool-cache";
import * as semver from "semver";
import { hashFile, parseChecksum } from "../src/checksums";
import { Releases } from "../src/releases";
import { isExactVersion, normalizeVersion } from "../src/versions";

const filename = "src/known-checksums.json";
const known: Record<string, Record<string, string>> = JSON.parse(
  await readFile(filename, "utf8"),
);
const releases = new Releases(
  process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "",
);
const versions = process.argv.slice(2);
const selected = versions.length
  ? await Promise.all(
      versions.map((version) => {
        if (!isExactVersion(version))
          throw new Error(`Expected an exact version: ${version}`);
        return releases.get(`/tags/v${version.replace(/^v/, "")}`);
      }),
    )
  : (await releases.list()).filter((release) => {
      const version = normalizeVersion(release.tag_name);
      return (
        !release.draft &&
        !release.prerelease &&
        version !== undefined &&
        semver.gte(version, "21.0.0")
      );
    });
const temporary = await mkdtemp(path.join(os.tmpdir(), "protoc-checksums-"));
try {
  for (const release of selected) {
    if (
      release.draft ||
      release.prerelease ||
      !isExactVersion(release.tag_name)
    )
      throw new Error(`Not a stable release: ${release.tag_name}`);
    const version = release.tag_name.replace(/^v/, "");
    const entries = known[version] ?? {};
    for (const asset of release.assets.filter(
      (asset) =>
        asset.name.startsWith(`protoc-${version}-`) &&
        asset.name.endsWith(".zip"),
    )) {
      let digest = asset.digest ? parseChecksum(asset.digest) : undefined;
      if (!digest && entries[asset.name]) continue;
      if (!digest) {
        const archive = path.join(temporary, asset.name);
        await tc.downloadTool(
          `https://github.com/protocolbuffers/protobuf/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`,
          archive,
        );
        digest = await hashFile(archive);
        await rm(archive);
      }
      if (entries[asset.name] && entries[asset.name] !== digest)
        throw new Error(
          `Published checksum changed for ${asset.name}; manual investigation required.`,
        );
      entries[asset.name] = digest;
    }
    if (Object.keys(entries).length === 0)
      throw new Error(`No protoc archives in ${release.tag_name}`);
    known[version] = Object.fromEntries(
      Object.entries(entries).sort(([a], [b]) => a.localeCompare(b, "en")),
    );
  }
  const sorted = Object.fromEntries(
    Object.entries(known).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
  await writeFile(filename, `${JSON.stringify(sorted, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
