import { access, chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import { parseChecksum, verifyChecksum } from "./checksums";
import checksums from "./known-checksums.json";
import { assetName, getTarget } from "./platform";
import { type Release, Releases } from "./releases";
import {
  isExactVersion,
  normalizeVersion,
  type Strategy,
  selectVersion,
  validateRange,
} from "./versions";

export const knownChecksums: Record<string, Record<string, string>> = checksums;

export interface InstallOptions {
  request: string;
  strategy: Strategy;
  platform: string;
  architecture: string;
  checksum: string;
  token: string;
}

export interface Installation {
  version: string;
  directory: string;
  binary: string;
  include: string;
  cacheHit: boolean;
}

export async function install(options: InstallOptions): Promise<Installation> {
  const target = getTarget(options.platform, options.architecture);
  const suppliedChecksum = options.checksum
    ? parseChecksum(options.checksum)
    : undefined;
  const releases = new Releases(options.token);
  const { version, release } = await resolve(options, releases);
  const asset = assetName(version, target);
  let expected = suppliedChecksum ?? knownChecksums[version]?.[asset];
  let metadata = release;
  if (!expected) {
    metadata ??= await releases.get(`/tags/v${version}`);
    const digest = metadata.assets.find(
      (entry) => entry.name === asset,
    )?.digest;
    if (digest) expected = digest;
  }
  if (metadata?.prerelease || metadata?.draft)
    throw new Error(`Not a stable release: ${version}`);
  if (metadata && !metadata.assets.some((entry) => entry.name === asset)) {
    throw new Error(
      `Release ${version} does not provide ${asset}. Select a supported version or architecture.`,
    );
  }
  if (!expected) {
    throw new Error(
      `No SHA-256 checksum available for ${asset}. Supply the checksum input from a trusted source; unverified downloads are not allowed.`,
    );
  }
  expected = parseChecksum(expected);
  // A checksum-specific namespace cannot reuse a cache created for a different pin.
  const tool = `setup-protoc-${expected}`;
  const cacheVersion = normalizeVersion(version) as string;
  let directory = tc.find(tool, cacheVersion, target);
  const cacheHit = Boolean(directory);
  if (!directory) {
    const temporary = await mkdtemp(
      path.join(process.env.RUNNER_TEMP || os.tmpdir(), "setup-protoc-"),
    );
    try {
      const archive = path.join(temporary, "protoc.zip");
      const tag = metadata?.tag_name ?? `v${version}`;
      const url = `https://github.com/protocolbuffers/protobuf/releases/download/${encodeURIComponent(tag)}/${asset}`;
      core.info(`Downloading ${asset}`);
      await tc.downloadTool(url, archive);
      await verifyChecksum(archive, expected);
      const extracted = await tc.extractZip(
        archive,
        path.join(temporary, "extracted"),
      );
      await validateInstallation(extracted, options.platform);
      if (options.platform !== "win32")
        await chmod(path.join(extracted, "bin", "protoc"), 0o755);
      directory = await tc.cacheDir(extracted, tool, cacheVersion, target);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  await validateInstallation(directory, options.platform);
  return {
    version,
    directory,
    binary: path.join(
      directory,
      "bin",
      options.platform === "win32" ? "protoc.exe" : "protoc",
    ),
    include: path.join(directory, "include"),
    cacheHit,
  };
}

async function validateInstallation(
  directory: string,
  platform: string,
): Promise<void> {
  await access(
    path.join(directory, "bin", platform === "win32" ? "protoc.exe" : "protoc"),
  );
  await access(
    path.join(directory, "include", "google", "protobuf", "descriptor.proto"),
  );
}

async function resolve(
  options: InstallOptions,
  releases: Releases,
): Promise<{ version: string; release?: Release }> {
  const request = options.request;
  if (isExactVersion(request)) return { version: request.replace(/^v/, "") };
  if (request === "latest-known") {
    return {
      version: selectVersion(Object.keys(knownChecksums), "*", "highest"),
    };
  }
  if (request === "latest") {
    const release = await releases.get("/latest");
    if (!isExactVersion(release.tag_name))
      throw new Error(`Unsupported release tag: ${release.tag_name}`);
    return { version: release.tag_name.replace(/^v/, ""), release };
  }
  const range = validateRange(request);
  const candidates = (await releases.list()).filter(
    (release) =>
      !release.draft && !release.prerelease && isExactVersion(release.tag_name),
  );
  const version = selectVersion(
    candidates.map((release) => release.tag_name.replace(/^v/, "")),
    range,
    options.strategy,
  );
  return {
    version,
    release: candidates.find(
      (release) => release.tag_name.replace(/^v/, "") === version,
    ),
  };
}
