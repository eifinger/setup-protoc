import { readFile } from "node:fs/promises";
import path from "node:path";
import * as semver from "semver";

// Protobuf changed from 3.x.y to x.y release tags in v21.0.
export function normalizeVersion(version: string): string | undefined {
  const bare = version.replace(/^v/, "");
  const expanded = bare.replace(/^(\d+\.\d+)(?=-|$)/, "$1.0");
  return semver.valid(expanded) ?? undefined;
}

export function isExactVersion(version: string): boolean {
  return (
    /^v?\d+\.\d+(?:\.\d+)?$/.test(version) &&
    normalizeVersion(version) !== undefined
  );
}

export function parseVersionFile(
  contents: string,
  filename: string,
): string | undefined {
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.split("#")[0]?.trim() ?? "")
    .filter(Boolean);
  if (path.basename(filename) === ".tool-versions") {
    const entries = lines
      .map((line) => line.split(/\s+/))
      .filter(([tool]) => tool === "protoc" || tool === "protobuf");
    if (entries.length === 0) return undefined;
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      entry?.length !== 2 ||
      !isExactVersion(entry[1] ?? "")
    ) {
      throw new Error(
        `${filename}: specify one released protoc or protobuf version; fallback versions, system, ref: and path: are not supported.`,
      );
    }
    return entry[1];
  }
  if (lines.length !== 1)
    throw new Error(`${filename}: expected one version or range.`);
  return lines[0];
}

export async function versionRequest(
  version: string,
  versionFile: string,
  directory: string,
): Promise<string> {
  if (version) return version;
  if (versionFile) {
    const filename = path.resolve(directory, versionFile);
    const request = parseVersionFile(
      await readFile(filename, "utf8"),
      filename,
    );
    if (!request)
      throw new Error(`${filename}: no protoc or protobuf version found.`);
    return request;
  }
  for (const name of [".protoc-version", ".tool-versions"]) {
    const filename = path.resolve(directory, name);
    let contents: string;
    try {
      contents = await readFile(filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const request = parseVersionFile(contents, filename);
    if (request) return request;
  }
  return "latest";
}

export type Strategy = "highest" | "lowest";

export function validateRange(request: string): string {
  const exact = normalizeVersion(request);
  if (exact && semver.prerelease(exact) !== null)
    throw new Error(
      "Prerelease versions are not supported. Select a stable release.",
    );
  // Exact two-component pins are handled before semver interprets them as ranges.
  const range = semver.validRange(request.replaceAll(",", " "));
  if (range === null)
    throw new Error(`Invalid protoc version or range: ${request}`);
  return range;
}

export function selectVersion(
  versions: string[],
  range: string,
  strategy: Strategy,
): string {
  const matches = versions
    .filter((version) => {
      const normalized = normalizeVersion(version);
      return (
        normalized !== undefined &&
        semver.prerelease(normalized) === null &&
        semver.satisfies(normalized, range)
      );
    })
    .sort((a, b) =>
      semver.compare(
        normalizeVersion(a) as string,
        normalizeVersion(b) as string,
      ),
    );
  const selected = strategy === "lowest" ? matches[0] : matches.at(-1);
  if (!selected) throw new Error(`No protoc release matches ${range}.`);
  return selected;
}
