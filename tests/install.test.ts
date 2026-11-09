import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, type TestContext, test } from "node:test";
import { HttpClient } from "@actions/http-client";
import { strToU8, zipSync } from "fflate";
import nock from "nock";
import * as semver from "semver";
import { type InstallOptions, install, knownChecksums } from "../src/install";
import { type Release, Releases } from "../src/releases";
import { normalizeVersion } from "../src/versions";

const archive = Buffer.from(
  zipSync({
    "bin/protoc": strToU8("test compiler"),
    "bin/protoc.exe": strToU8("test compiler"),
    "include/google/protobuf/descriptor.proto": strToU8("test descriptor"),
  }),
);
const digest = createHash("sha256").update(archive).digest("hex");
const api = "https://api.github.com";
const base = "/repos/protocolbuffers/protobuf/releases";
const defaults: InstallOptions = {
  request: "80.3",
  platform: process.platform,
  architecture: "x64",
  checksum: digest,
  token: "",
  strategy: "highest",
};
const nativeTarget =
  process.platform === "win32"
    ? "win64"
    : process.platform === "darwin"
      ? "osx-x86_64"
      : "linux-x86_64";
let directory: string;
const original = {
  temp: process.env.RUNNER_TEMP,
  cache: process.env.RUNNER_TOOL_CACHE,
};

beforeEach(async () => {
  nock.disableNetConnect();
  directory = await mkdtemp(path.join(os.tmpdir(), "protoc-install-"));
  process.env.RUNNER_TEMP = path.join(directory, "temp");
  process.env.RUNNER_TOOL_CACHE = path.join(directory, "cache");
  await mkdir(process.env.RUNNER_TEMP);
  await mkdir(process.env.RUNNER_TOOL_CACHE);
});
afterEach(async () => {
  nock.cleanAll();
  nock.enableNetConnect();
  await rm(directory, { recursive: true, force: true });
  if (original.temp === undefined) delete process.env.RUNNER_TEMP;
  else process.env.RUNNER_TEMP = original.temp;
  if (original.cache === undefined) delete process.env.RUNNER_TOOL_CACHE;
  else process.env.RUNNER_TOOL_CACHE = original.cache;
});

function download(version = "80.3", target = nativeTarget, bytes = archive) {
  return nock("https://github.com", { badheaders: ["authorization"] })
    .get(
      `/protocolbuffers/protobuf/releases/download/v${version}/protoc-${version}-${target}.zip`,
    )
    .reply(200, bytes);
}

function release(
  version: string,
  checksum: string | null = `sha256:${digest}`,
): Release {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes("-"),
    assets: [
      { name: `protoc-${version}-${nativeTarget}.zip`, digest: checksum },
    ],
  };
}

test("installs headers and executable, then reuses a verified tool cache without network", async () => {
  download();
  const first = await install(defaults);
  assert.equal(first.version, "80.3");
  assert.equal(first.cacheHit, false);
  assert.equal(await readFile(first.binary, "utf8"), "test compiler");
  assert.equal(
    await readFile(
      path.join(first.include, "google/protobuf/descriptor.proto"),
      "utf8",
    ),
    "test descriptor",
  );
  assert.deepEqual(await install(defaults), { ...first, cacheHit: true });
  assert.deepEqual(await readdir(path.join(directory, "temp")), []);
  // A different checksum must not accept the previously cached installation.
  download();
  await assert.rejects(
    install({ ...defaults, checksum: "0".repeat(64) }),
    /SHA-256 mismatch/,
  );
});

test("rejects corruption before extraction and leaves no tool cache or temporary files", async () => {
  download("80.3", nativeTarget, Buffer.from("not a zip"));
  await assert.rejects(install(defaults), /SHA-256 mismatch/);
  assert.deepEqual(await readdir(path.join(directory, "cache")), []);
  assert.deepEqual(await readdir(path.join(directory, "temp")), []);
});

test("uses an API digest for an unknown pin, and never sends the token to downloads", async () => {
  nock(api, { reqheaders: { authorization: "Bearer test-token" } })
    .get(`${base}/tags/v80.3`)
    .reply(200, release("80.3"));
  download();
  const result = await install({
    ...defaults,
    checksum: "",
    token: "test-token",
  });
  assert.equal(result.version, "80.3");
  assert.equal(result.cacheHit, false);
});

test("fails closed when a release has no digest or lacks the requested architecture", async () => {
  nock(api).get(`${base}/tags/v80.3`).reply(200, release("80.3", null));
  await assert.rejects(
    install({ ...defaults, checksum: "" }),
    /No SHA-256 checksum/,
  );
  nock(api)
    .get(`${base}/tags/v80.3`)
    .reply(200, { ...release("80.3"), assets: [] });
  await assert.rejects(
    install({ ...defaults, checksum: "" }),
    /does not provide/,
  );
  assert.deepEqual(await readdir(path.join(directory, "cache")), []);
});

test("bundled checksums take precedence over a different API digest", async () => {
  nock(api).get(`${base}/latest`).reply(200, release("33.0"));
  download("33.0");
  await assert.rejects(
    install({ ...defaults, request: "latest", checksum: "" }),
    /SHA-256 mismatch/,
  );
  download("33.0");
  assert.equal(
    (await install({ ...defaults, request: "33.0" })).version,
    "33.0",
  );
});

test("latest-known resolves without the GitHub API", async () => {
  // The asset must match a stable version; no API requests are allowed here.
  nock("https://github.com")
    .get(/\/releases\/download\/v[\d.]+\/protoc-[\d.]+-[^/]+\.zip/)
    .reply(200, archive);
  const result = await install({ ...defaults, request: "latest-known" });
  assert.match(result.version, /^\d+\.\d+(?:\.\d+)?$/);
  for (const version of Object.keys(knownChecksums)) {
    assert.ok(
      semver.gte(
        normalizeVersion(result.version) as string,
        normalizeVersion(version) as string,
      ),
    );
  }
});

test("range resolution examines all pages, excludes drafts/prereleases, and selects lowest", async () => {
  const first = Array.from({ length: 100 }, () => release("80.9"));
  const last = [
    release("80.2"),
    release("80.10"),
    release("81.0-rc1"),
    { ...release("80.11"), prerelease: true },
    { ...release("80.1"), draft: true },
  ];
  for (const [strategy, expected] of [
    ["highest", "80.10"],
    ["lowest", "80.2"],
  ] as const) {
    nock(api).get(`${base}?per_page=100&page=1`).reply(200, first);
    nock(api).get(`${base}?per_page=100&page=2`).reply(200, last);
    download(expected);
    assert.equal(
      (await install({ ...defaults, request: "80.x", strategy })).version,
      expected,
    );
  }
});

test("prerelease pins fail before network access, and API prereleases are rejected", async () => {
  for (const request of ["37.0-rc1", "v37.0-rc1", "3.20.0-rc-1"]) {
    await assert.rejects(
      install({ ...defaults, request }),
      /Prerelease versions are not supported/,
    );
  }
  nock(api)
    .get(`${base}/tags/v80.3`)
    .reply(200, {
      ...release("80.3"),
      prerelease: true,
    });
  await assert.rejects(
    install({ ...defaults, checksum: "" }),
    /Not a stable release/,
  );
});

test("platform mappings select the official archive and keep architectures separate", async () => {
  const cases = [
    ["linux", "x64", "linux-x86_64"],
    ["linux", "arm64", "linux-aarch_64"],
    ["linux", "ia32", "linux-x86_32"],
    ["linux", "ppc64", "linux-ppcle_64"],
    ["linux", "s390x", "linux-s390_64"],
    ["darwin", "x64", "osx-x86_64"],
    ["darwin", "arm64", "osx-aarch_64"],
    ["win32", "ia32", "win32"],
    ["win32", "arm64", "win64"],
  ];
  for (const [platform, architecture, target] of cases) {
    assert.ok(platform && architecture && target);
    download("80.3", target);
    const result = await install({ ...defaults, platform, architecture });
    assert.equal(result.cacheHit, false);
    assert.equal(
      path.basename(result.binary),
      platform === "win32" ? "protoc.exe" : "protoc",
    );
  }
  assert.equal(
    (await install({ ...defaults, platform: "win32", architecture: "x64" }))
      .cacheHit,
    true,
  );
  await assert.rejects(
    install({ ...defaults, platform: "freebsd" }),
    /Unsupported platform/,
  );
  await assert.rejects(
    install({ ...defaults, architecture: "riscv64" }),
    /Unsupported platform/,
  );
  await assert.rejects(
    install({ ...defaults, architecture: "toString" }),
    /Unsupported platform/,
  );
});

test("invalid inputs and API failures return actionable errors", async () => {
  await assert.rejects(
    install({ ...defaults, checksum: "oops" }),
    /64 hexadecimal/,
  );
  await assert.rejects(
    install({ ...defaults, request: "../../evil" }),
    /Invalid protoc/,
  );
  nock(api).get(`${base}/tags/v80.3`).reply(404, { message: "Not Found" });
  await assert.rejects(install({ ...defaults, checksum: "" }), /github-token/);
  nock(api).get(`${base}/latest`).reply(403, { message: "Forbidden" });
  await assert.rejects(new Releases("").get("/latest"), /Forbidden/);
});

// Advance retry timers without sleeping, while letting intercepted HTTP I/O run.
async function withRetryClock<T>(t: TestContext, operation: () => Promise<T>) {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: 1_800_000_000_000,
  });
  let settled = false;
  const result = operation();
  void result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  try {
    for (let ticks = 0; !settled && ticks < 100_000; ticks++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      t.mock.timers.tick(10);
    }
    assert.ok(settled, "API request did not settle within the retry budget");
    return await result;
  } finally {
    t.mock.timers.reset();
  }
}

test("release API recovers from temporary HTTP and network failures", async (t) => {
  for (const failure of [
    500,
    502,
    503,
    504,
    408,
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
    "Request timeout: /latest",
  ]) {
    await t.test(String(failure), async (t) => {
      const scope = nock(api).get(`${base}/latest`);
      if (typeof failure === "number")
        scope.reply(failure, "Temporary failure");
      else
        scope.replyWithError(
          Object.assign(new Error(failure), { code: failure }),
        );
      const success = nock(api)
        .get(`${base}/latest`)
        .reply(200, release("80.3"));
      assert.deepEqual(
        await withRetryClock(t, () => new Releases("").get("/latest")),
        release("80.3"),
      );
      assert.ok(success.isDone());
    });
  }
});

test("release API retries interrupted and stalled response bodies with a bounded budget", async (t) => {
  const epoch = 1_800_000_000;
  // Earliest retry offsets from the fixed epoch: interrupted, then stalled.
  const cases: [number, Record<string, string>, [number, number], boolean][] = [
    [200, {}, [2_000, 31_000], true],
    [200, {}, [0, 0], false],
    [429, { "retry-after": "5" }, [6_000, 35_000], true],
    [
      403,
      {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(epoch + 45),
      },
      [45_000, 45_000],
      true,
    ],
    [503, { "retry-after": "61" }, [0, 0], false],
  ];
  for (const failure of ["interrupted", "stalled", "none"] as const) {
    for (const [status, headers, minimum, recover] of failure === "none"
      ? cases.slice(0, 1)
      : cases) {
      const tooLong = status !== 200 && !recover;
      await t.test(
        `${failure}, ${status} ${JSON.stringify(headers)}, ${recover ? "recovery" : tooLong ? "long wait" : "exhaustion"}`,
        async (t) => {
          nock.enableNetConnect("127.0.0.1");
          let attempts = 0;
          let headersReceived = 0;
          const requestTimes: number[] = [];
          const closedResponses: Promise<void>[] = [];
          const expected = release("80.3");
          const json = JSON.stringify(expected);
          const server = createServer((_request, response) => {
            attempts++;
            requestTimes.push(Date.now());
            closedResponses.push(
              new Promise<void>((resolve) => response.once("close", resolve)),
            );
            response.writeHead(attempts === 1 ? status : 200, {
              "content-type": "application/json",
              ...(attempts === 1 ? headers : {}),
            });
            response.write(json.slice(0, 12));
            if (failure === "none" || ((recover || tooLong) && attempts > 1)) {
              setTimeout(() => response.end(json.slice(12)), 1_000);
            } else if (failure === "interrupted") {
              setTimeout(() => response.destroy(), 1_000);
            }
            // A stalled response sends headers and partial JSON, but never ends.
          });
          await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
          );
          t.after(() => {
            server.closeAllConnections();
            return new Promise<void>((resolve) =>
              server.close(() => resolve()),
            );
          });
          const address = server.address();
          assert.ok(address && typeof address !== "string");
          const get = HttpClient.prototype.get;
          // Route the toolkit to a real local server; do not mock response streams.
          t.mock.method(
            HttpClient.prototype,
            "get",
            async function (this: HttpClient) {
              const response = await get.call(
                this,
                `http://127.0.0.1:${address.port}/latest`,
              );
              headersReceived++;
              return response;
            },
          );
          await withRetryClock(t, async () => {
            if (recover) {
              assert.deepEqual(await new Releases("").get("/latest"), expected);
            } else {
              await assert.rejects(
                new Releases("").get("/latest"),
                tooLong
                  ? /exceeds 60 seconds/
                  : failure === "stalled"
                    ? /response body timed out/i
                    : /aborted|premature close/i,
              );
            }
            // Timing out must close the socket, not leave a pending body behind.
            await Promise.all(closedResponses);
          });
          assert.equal(
            attempts,
            failure === "none" || tooLong ? 1 : recover ? 2 : 4,
          );
          assert.equal(
            headersReceived,
            attempts,
            "failures must occur after response headers",
          );
          if (failure !== "none" && recover) {
            assert.ok(
              (requestTimes[1] ?? 0) >=
                epoch * 1_000 + minimum[failure === "interrupted" ? 0 : 1],
              "body failures must not bypass retry deadlines",
            );
          }
          if (failure === "stalled") {
            for (let index = 1; index < requestTimes.length; index++) {
              assert.ok(
                (requestTimes[index] ?? 0) - (requestTimes[index - 1] ?? 0) >=
                  30_000,
              );
            }
          }
        },
      );
    }
  }
});

test("release API rejects redirects without following them", async () => {
  nock(api)
    .get(`${base}/latest`)
    .reply(302, "Moved", { location: `${api}/redirect-target` });
  const target = nock(api).get("/redirect-target").reply(200, release("80.3"));
  await assert.rejects(new Releases("").get("/latest"), /HTTP 302/);
  assert.equal(target.isDone(), false);
});

test("release API limits attempts and does not retry permanent failures", async (t) => {
  for (const [status, expectedAttempts] of [
    [503, 4],
    [401, 1],
    [403, 1],
    [404, 1],
    [422, 1],
  ]) {
    await t.test(String(status), async (t) => {
      const times: number[] = [];
      const scope = nock(api)
        .persist()
        .get(`${base}/latest`)
        .reply(() => {
          times.push(Date.now());
          return [status, { message: "Rejected" }];
        });
      await withRetryClock(t, () =>
        assert.rejects(new Releases("").get("/latest"), /github-token/),
      );
      assert.equal(times.length, expectedAttempts);
      if (status === 503) {
        for (const [index, minimum] of [
          [1, 1_000],
          [2, 2_000],
          [3, 4_000],
        ] as const) {
          assert.ok((times[index] ?? 0) - (times[index - 1] ?? 0) >= minimum);
        }
      }
      scope.persist(false);
      nock.cleanAll();
    });
  }

  await t.test(
    "repeated secondary limits stop rather than retry early",
    async (t) => {
      const limited = nock(api)
        .get(`${base}/latest`)
        .twice()
        .reply(403, { message: "Secondary rate limit exceeded" });
      await withRetryClock(t, () =>
        assert.rejects(new Releases("").get("/latest"), /exceeds 60 seconds/),
      );
      assert.ok(limited.isDone());
    },
  );
});

test("release API observes rate-limit deadlines and rejects long waits", async (t) => {
  const epoch = 1_800_000_000;
  const cases: [number, Record<string, string>, number, boolean][] = [
    [429, { "retry-after": "3" }, 3_000, true],
    [503, { "retry-after": "5" }, 5_000, true],
    [
      403,
      { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(epoch + 7) },
      7_000,
      true,
    ],
    [
      429,
      { "retry-after": new Date((epoch + 9) * 1_000).toUTCString() },
      9_000,
      true,
    ],
    [
      403,
      {
        "retry-after": "2",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(epoch + 8),
      },
      8_000,
      true,
    ],
    [403, {}, 60_000, true],
    [429, { "retry-after": "invalid" }, 60_000, true],
    [429, { "retry-after": "60" }, 60_000, true],
    [429, { "retry-after": "61" }, 0, false],
    [
      403,
      {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(epoch + 3_600),
      },
      0,
      false,
    ],
  ];
  for (const [status, headers, minimum, recover] of cases) {
    await t.test(`${status} ${JSON.stringify(headers)}`, async (t) => {
      let nextAt = 0;
      nock(api)
        .get(`${base}/latest`)
        .reply(status, { message: "API rate limit exceeded" }, headers);
      const success = nock(api)
        .get(`${base}/latest`)
        .reply(() => {
          nextAt = Date.now();
          return [200, release("80.3")];
        });
      await withRetryClock(t, async () => {
        if (recover) {
          assert.deepEqual(
            await new Releases("").get("/latest"),
            release("80.3"),
          );
          assert.ok(nextAt >= epoch * 1_000 + minimum);
        } else {
          await assert.rejects(
            new Releases("").get("/latest"),
            /exceeds 60 seconds/,
          );
          assert.equal(success.isDone(), false);
        }
      });
      nock.cleanAll();
    });
  }
});
