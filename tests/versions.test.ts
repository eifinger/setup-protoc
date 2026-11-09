import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  isExactVersion,
  normalizeVersion,
  parseVersionFile,
  selectVersion,
  validateRange,
  versionRequest,
} from "../src/versions";

test("modern and legacy release versions retain their meaning", () => {
  assert.equal(normalizeVersion("v33.2"), "33.2.0");
  assert.equal(normalizeVersion("3.20.3"), "3.20.3");
  assert.equal(normalizeVersion("34.0-rc1"), "34.0.0-rc1");
  assert.equal(isExactVersion("33.2"), true);
  assert.equal(isExactVersion("33.x"), false);
  assert.equal(isExactVersion("33"), false);
  assert.equal(isExactVersion("34.0-rc1"), false);
  assert.equal(isExactVersion("../../33.2"), false);
});

test("ranges sort numerically, respect bounds, and select lowest or highest", () => {
  const versions = [
    "33.9",
    "3.20.3",
    "34.0-rc1",
    "33.10",
    "33.0",
    "32.9",
    "34.0",
    "junk",
  ];
  assert.equal(selectVersion(versions, "33.x", "highest"), "33.10");
  assert.equal(
    selectVersion(versions, validateRange(">=33.1, <34"), "lowest"),
    "33.9",
  );
  assert.equal(selectVersion(versions, "3.20.x", "highest"), "3.20.3");
  assert.equal(selectVersion(versions, "^33.0", "lowest"), "33.0");
  assert.equal(selectVersion(versions, "*", "highest"), "34.0");
  assert.throws(
    () => selectVersion(versions, ">=99", "highest"),
    /No protoc release/,
  );
  assert.throws(() => validateRange("system"), /Invalid protoc/);
});

test("only stable versions are selected, even with prerelease range bounds", () => {
  const versions = ["33.2", "34.0-rc1", "34.0-rc2"];
  assert.equal(selectVersion(versions, "*", "highest"), "33.2");
  assert.throws(
    () => selectVersion(versions, ">=34.0.0-rc1 <35", "highest"),
    /No protoc release/,
  );
});

test("version files support comments, CRLF, and protoc or protobuf tool entries", () => {
  assert.equal(
    parseVersionFile("# pin\r\nv33.0 # stable\r\n", ".protoc-version"),
    "v33.0",
  );
  assert.equal(parseVersionFile(" >=33, <34\n", "versions.txt"), ">=33, <34");
  assert.equal(
    parseVersionFile("python 3.13\r\nprotoc\t33.0 # pin\r\n", ".tool-versions"),
    "33.0",
  );
  assert.equal(
    parseVersionFile("protobuf 3.20.3\n", ".tool-versions"),
    "3.20.3",
  );
  assert.equal(parseVersionFile("python 3.13\n", ".tool-versions"), undefined);
  for (const entry of [
    "protoc",
    "protoc system",
    "protoc path:/tmp/x",
    "protoc ref:main",
    "protoc 34.0-rc1",
    "protoc 33.0 32.0",
    "protoc 33.0\nprotobuf 32.0",
    "protoc 33.0\nprotoc 33.0",
  ]) {
    assert.throws(
      () => parseVersionFile(entry, ".tool-versions"),
      /specify one released/,
    );
  }
  for (const contents of ["", "# empty", "33.0\n32.0"]) {
    assert.throws(
      () => parseVersionFile(contents, ".protoc-version"),
      /expected one/,
    );
  }
});

test("file discovery and explicit inputs have deterministic precedence", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "protoc-versions-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(await versionRequest("", "", directory), "latest");
  await writeFile(path.join(directory, ".tool-versions"), "python 3.13");
  assert.equal(await versionRequest("", "", directory), "latest");
  await assert.rejects(
    versionRequest("", ".tool-versions", directory),
    /no protoc/,
  );
  await writeFile(path.join(directory, ".tool-versions"), "protoc 25.3");
  assert.equal(await versionRequest("", "", directory), "25.3");
  await writeFile(path.join(directory, ".protoc-version"), "33.0");
  assert.equal(await versionRequest("", "", directory), "33.0");
  assert.equal(await versionRequest("", ".protoc-version", directory), "33.0");
  assert.equal(await versionRequest("", ".tool-versions", directory), "25.3");
  assert.equal(
    await versionRequest("21.12", "missing.txt", directory),
    "21.12",
  );
  await assert.rejects(versionRequest("", "missing.txt", directory), /ENOENT/);
  await writeFile(path.join(directory, ".protoc-version"), "");
  await assert.rejects(versionRequest("", "", directory), /expected one/);
  await assert.rejects(
    versionRequest("", ".protoc-version", directory),
    /expected one/,
  );
});
