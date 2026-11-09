import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { data, Evaluator, Lexer, Parser } from "@actions/expressions";
import { parse } from "yaml";
import { parseChecksum, verifyChecksum } from "../src/checksums";
import matchers from "../src/protoc.json";

test("every public action input and output is documented", async () => {
  const action = parse(await readFile("action.yml", "utf8"));
  const readme = await readFile("README.md", "utf8");
  for (const name of [
    ...Object.keys(action.inputs),
    ...Object.keys(action.outputs),
  ]) {
    assert.ok(readme.includes(`\`${name}\``), `${name} is missing from README`);
  }
});

test("the default API token is used on GitHub.com but not GitHub Enterprise Server", async () => {
  const action = parse(await readFile("action.yml", "utf8"));
  const expression = action.inputs["github-token"].default.slice(3, -2);
  const { tokens } = new Lexer(expression).lex();
  const parsed = new Parser(tokens, ["github"], []).parse();
  for (const [server, expected] of [
    ["https://github.com", "runner-token"],
    ["https://github.example.com", ""],
  ]) {
    assert.ok(server);
    const github = new data.Dictionary(
      { key: "server_url", value: new data.StringData(server) },
      { key: "token", value: new data.StringData("runner-token") },
    );
    const context = new data.Dictionary({ key: "github", value: github });
    assert.equal(
      new Evaluator(parsed, context).evaluate().coerceString(),
      expected,
    );
  }
});

test("problem matcher identifies errors, warnings, Windows paths, and filenames with spaces", () => {
  const pattern = matchers.problemMatcher[0]?.pattern[0];
  assert.ok(pattern);
  for (const [line, file, severity, message] of [
    [
      'proto/test.proto:7:12: Expected ";".',
      "proto/test.proto",
      undefined,
      'Expected ";".',
    ],
    [
      "proto/with spaces.proto:7:12: warning: Import is unused.",
      "proto/with spaces.proto",
      "warning",
      "Import is unused.",
    ],
    [
      "C:\\repo\\test.proto:7:12: Missing field number.",
      "C:\\repo\\test.proto",
      undefined,
      "Missing field number.",
    ],
  ]) {
    assert.ok(line);
    const match = new RegExp(pattern.regexp).exec(line);
    assert.ok(match);
    assert.equal(match[pattern.file], file);
    assert.equal(match[pattern.line], "7");
    assert.equal(match[pattern.column], "12");
    assert.equal(match[pattern.severity], severity);
    assert.equal(match[pattern.message], message);
  }
  assert.equal(new RegExp(pattern.regexp).exec("libprotoc 33.0"), null);
});

test("checksums accept SHA-256 prefixes and case but reject changed bytes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "protoc-hash-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "archive");
  // Published SHA-256 test vector for the bytes 'abc'.
  const checksum =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  await writeFile(filename, "abc");
  assert.equal(parseChecksum(`SHA256:${checksum.toUpperCase()}`), checksum);
  await verifyChecksum(filename, `sha256:${checksum.toUpperCase()}`);
  await writeFile(filename, "abd");
  await assert.rejects(verifyChecksum(filename, checksum), /SHA-256 mismatch/);
  for (const value of [
    "",
    "a".repeat(63),
    "a".repeat(65),
    "g".repeat(64),
    `sha512:${checksum}`,
  ]) {
    assert.throws(() => parseChecksum(value), /64 hexadecimal/);
  }
});
