import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

test("bundled action fails on interrupted or stalled redirects instead of exiting successfully", async (t) => {
  for (const version of ["latest", "33.0"]) {
    for (const failure of ["interrupted", "stalled"]) {
      await t.test(`${version}: ${failure}`, async (t) => {
        const directory = await mkdtemp(
          path.join(os.tmpdir(), "protoc-redirect-"),
        );
        t.after(() => rm(directory, { recursive: true, force: true }));
        let requests = 0;
        const server = createServer((_request, response) => {
          requests++;
          response.writeHead(302, {
            location: "https://github.com/redirect-target",
          });
          response.write("partial redirect body");
          if (failure === "interrupted")
            setTimeout(() => response.destroy(), 20);
        });
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve),
        );
        t.after(() => {
          server.closeAllConnections();
          return new Promise<void>((resolve) => server.close(() => resolve()));
        });
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const preload = path.join(directory, "redirect.cjs");
        // Keep the real toolkit and streams; replace only the network destination.
        // Shorten socket inactivity timeouts so stalled-download tests do not take minutes.
        await writeFile(
          preload,
          `
const http = require("node:http");
require("node:https").request = (options, callback) => {
  const request = http.request({ ...options, protocol: "http:", hostname: "127.0.0.1", port: ${address.port}, agent: false }, callback);
  const setTimeout = request.setTimeout.bind(request);
  request.setTimeout = (_milliseconds, callback) => setTimeout(100, callback);
  return request;
};
`,
        );
        const env = { ...process.env };
        for (const key of Object.keys(env))
          if (key.startsWith("INPUT_")) delete env[key];
        Object.assign(env, {
          INPUT_VERSION: version,
          "INPUT_RESOLUTION-STRATEGY": "highest",
          RUNNER_TEMP: directory,
          RUNNER_TOOL_CACHE: path.join(directory, "cache"),
          GITHUB_OUTPUT: path.join(directory, "output"),
          GITHUB_ENV: path.join(directory, "env"),
          GITHUB_PATH: path.join(directory, "path"),
        });
        for (const filename of [
          env.GITHUB_OUTPUT,
          env.GITHUB_ENV,
          env.GITHUB_PATH,
        ]) {
          assert.ok(filename);
          await writeFile(filename, "");
        }
        await assert.rejects(
          promisify(execFile)(
            process.execPath,
            ["--require", preload, path.resolve("dist/setup/index.cjs")],
            { env, cwd: directory, timeout: 15_000 },
          ),
          (error: unknown) => {
            const result = error as { code: number; stdout: string };
            assert.equal(result.code, 1);
            assert.match(result.stdout, /::error::/);
            assert.match(
              result.stdout,
              version === "latest"
                ? /Unable to read protobuf releases/
                : /stopped before it finished/,
            );
            return true;
          },
        );
        assert.equal(requests, version === "latest" ? 4 : 1);
        for (const filename of [
          env.GITHUB_OUTPUT,
          env.GITHUB_ENV,
          env.GITHUB_PATH,
        ]) {
          assert.ok(filename);
          assert.equal(await readFile(filename, "utf8"), "");
        }
      });
    }
  }
});

// These tests use the shipped bundle, real GitHub downloads, and real protoc.
test("bundled action installs, compiles, caches, resolves files/ranges, and rejects bad checksums", {
  timeout: 300_000,
}, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "protoc-action-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ["temp", "cache", "project"])
    await mkdir(path.join(directory, name));
  await cp("dist/setup", path.join(directory, "action"), { recursive: true });
  const bundle = path.join(directory, "action", "index.cjs");
  const smoke = path.resolve("tests/smoke.mjs");
  const project = path.join(directory, "project");
  const action = parse(await readFile("action.yml", "utf8"));
  const defaults = Object.fromEntries(
    Object.entries(action.inputs as Record<string, { default: string }>)
      .filter(([, input]) => !input.default.includes("${{"))
      .map(([name, input]) => [`INPUT_${name.toUpperCase()}`, input.default]),
  );
  await writeFile(
    path.join(project, ".tool-versions"),
    "python 3.13\nprotoc 33.0\n",
  );

  async function run(inputs: Record<string, string> = {}, failure?: RegExp) {
    const files = {
      GITHUB_OUTPUT: path.join(directory, "output"),
      GITHUB_ENV: path.join(directory, "env"),
      GITHUB_PATH: path.join(directory, "path"),
    };
    await Promise.all(
      Object.values(files).map((filename) => writeFile(filename, "")),
    );
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("INPUT_")) delete env[key];
    Object.assign(env, defaults, files, {
      RUNNER_TEMP: path.join(directory, "temp"),
      RUNNER_TOOL_CACHE: path.join(directory, "cache"),
      GITHUB_WORKSPACE: project,
      "INPUT_WORKING-DIRECTORY": project,
      "INPUT_GITHUB-TOKEN":
        process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "",
      ...Object.fromEntries(
        Object.entries(inputs).map(([key, value]) => [
          `INPUT_${key.toUpperCase()}`,
          value,
        ]),
      ),
    });
    const result = spawnSync(process.execPath, [bundle], {
      env,
      cwd: directory,
      encoding: "utf8",
      timeout: 180_000,
    });
    if (failure) {
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, failure);
      return {};
    }
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const outputs = parseCommands(await readFile(files.GITHUB_OUTPUT, "utf8"));
    const exported = parseCommands(await readFile(files.GITHUB_ENV, "utf8"));
    const binaryPath = (await readFile(files.GITHUB_PATH, "utf8")).trim();
    assert.equal(outputs["protoc-path"], exported.PROTOC);
    assert.equal(outputs["protoc-include"], exported.PROTOC_INCLUDE);
    assert.equal(outputs.version, `v${outputs["protoc-version"]}`);
    assert.ok(outputs.path && path.isAbsolute(outputs.path));
    assert.equal(path.join(outputs.path, "bin"), binaryPath);
    assert.equal(path.join(outputs.path, "include"), exported.PROTOC_INCLUDE);
    const cliVersion =
      outputs["protoc-version"] === "21.12"
        ? "3.21.12"
        : outputs["protoc-version"];
    const verification = execFileSync(process.execPath, [smoke], {
      env: {
        ...env,
        ...exported,
        EXPECTED_CLI_VERSION: cliVersion,
        PATH: `${binaryPath}${path.delimiter}${process.env.PATH}`,
      },
      encoding: "utf8",
    });
    console.log(verification.trim());
    if (inputs["add-problem-matchers"] === "false")
      assert.doesNotMatch(result.stdout, /::add-matcher::/);
    else assert.match(result.stdout, /::add-matcher::/);
    return outputs;
  }

  const first = await run();
  assert.equal(first["protoc-version"], "33.0");
  assert.equal(first["cache-hit"], "false");
  assert.equal(
    (
      await run({
        "version-file": ".tool-versions",
        "add-problem-matchers": "false",
      })
    )["cache-hit"],
    "true",
  );
  await run({ version: "33.0", checksum: "0".repeat(64) }, /SHA-256 mismatch/);
  await run({ version: "37.0-rc1" }, /Prerelease versions are not supported/);
  await writeFile(path.join(project, ".protoc-version"), "25.3\n");
  assert.equal((await run())["protoc-version"], "25.3");
  assert.equal(
    (await run({ "version-file": ".tool-versions" }))["protoc-version"],
    "33.0",
  );
  assert.equal(
    (await run({ "version-file": ".protoc-version" }))["protoc-version"],
    "25.3",
  );
  assert.equal(
    (await run({ version: "21.12", "version-file": "missing" }))[
      "protoc-version"
    ],
    "21.12",
  );
  assert.equal(
    (await run({ version: ">=33.0 <33.1", "resolution-strategy": "lowest" }))[
      "protoc-version"
    ],
    "33.0",
  );
  assert.equal((await run({ version: "23.x" }))["protoc-version"], "23.4");
  await run({ version: "latest-known" });
  await run({ version: "latest" });
  await rm(path.join(project, ".protoc-version"));
  await rm(path.join(project, ".tool-versions"));
  await run();
  // Legacy 3.x has no native macOS ARM archive.
  if (process.platform !== "darwin" || process.arch !== "arm64")
    await run({ version: "3.20.3" });
});

function parseCommands(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const [name, delimiter] = (lines[index] ?? "").split("<<");
    if (!name || !delimiter) continue;
    const values: string[] = [];
    while (++index < lines.length && lines[index] !== delimiter)
      values.push(lines[index] as string);
    result[name] = values.join("\n");
  }
  return result;
}
