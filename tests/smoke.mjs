import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const binary = process.env.PROTOC;
const include = process.env.PROTOC_INCLUDE;
assert.ok(binary && include, "PROTOC and PROTOC_INCLUDE must be exported");
const version = execFileSync(binary, ["--version"], {
  encoding: "utf8",
}).trim();
assert.match(version, /^libprotoc \d+\./);
assert.equal(
  execFileSync("protoc", ["--version"], { encoding: "utf8" }).trim(),
  version,
  "PATH must select the installed compiler",
);
if (process.env.EXPECTED_CLI_VERSION)
  assert.equal(version, `libprotoc ${process.env.EXPECTED_CLI_VERSION}`);
const temporary = mkdtempSync(path.join(os.tmpdir(), "protoc-smoke-"));
try {
  const fixtures = fileURLToPath(new URL("fixtures/", import.meta.url));
  const descriptor = path.join(temporary, "smoke.pb");
  execFileSync(binary, [
    `--proto_path=${fixtures}`,
    `--proto_path=${include}`,
    `--descriptor_set_out=${descriptor}`,
    "--include_imports",
    "smoke.proto",
  ]);
  const decoded = execFileSync(
    binary,
    [
      `--proto_path=${include}`,
      "--decode=google.protobuf.FileDescriptorSet",
      "google/protobuf/descriptor.proto",
    ],
    { input: readFileSync(descriptor), encoding: "utf8" },
  );
  assert.match(decoded, /name: "smoke.proto"/);
  assert.match(decoded, /name: "Greeting"/);
  assert.match(decoded, /name: "google\/protobuf\/timestamp.proto"/);
  assert.match(decoded, /type_name: "\.google.protobuf.Timestamp"/);
  console.log(
    `${version}: PATH, executable, bundled headers, compilation, and descriptor decoding passed`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
