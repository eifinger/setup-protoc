import path from "node:path";
import * as core from "@actions/core";
import { install } from "./install";
import { versionRequest } from "./versions";

async function run(): Promise<void> {
  const token = core.getInput("repo-token") || core.getInput("github-token");
  if (token) core.setSecret(token);
  const strategy = core.getInput("resolution-strategy");
  if (strategy !== "highest" && strategy !== "lowest")
    throw new Error("resolution-strategy must be highest or lowest.");
  const request = await versionRequest(
    core.getInput("version"),
    core.getInput("version-file"),
    core.getInput("working-directory") ||
      process.env.GITHUB_WORKSPACE ||
      process.cwd(),
  );
  const installation = await install({
    request,
    strategy,
    architecture: core.getInput("architecture") || process.arch,
    platform: process.platform,
    checksum: core.getInput("checksum"),
    token,
  });
  core.addPath(path.dirname(installation.binary));
  core.exportVariable("PROTOC", installation.binary);
  core.exportVariable("PROTOC_INCLUDE", installation.include);
  core.setOutput("protoc-version", installation.version);
  core.setOutput("protoc-path", installation.binary);
  core.setOutput("protoc-include", installation.include);
  core.setOutput("cache-hit", installation.cacheHit);
  core.setOutput("version", `v${installation.version}`);
  core.setOutput("path", installation.directory);
  if (core.getBooleanInput("add-problem-matchers")) {
    core.info(`::add-matcher::${path.join(__dirname, "protoc.json")}`);
  }
  core.info(
    `Installed protoc ${installation.version}${installation.cacheHit ? " (tool cache hit)" : ""}`,
  );
}

// A pending toolkit download promise alone does not keep Node running.
const failIncomplete = () =>
  core.setFailed(
    "setup-protoc stopped before it finished. A request or download did not complete.",
  );
process.once("beforeExit", failIncomplete);
run()
  .catch((error: unknown) =>
    core.setFailed(error instanceof Error ? error.message : String(error)),
  )
  .finally(() => process.removeListener("beforeExit", failIncomplete));
