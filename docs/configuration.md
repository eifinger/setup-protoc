# Platforms and configuration

## Supported targets

| OS      | `architecture` | Upstream archive suffix | Workflow coverage                                |
| ------- | -------------- | ----------------------- | ------------------------------------------------ |
| Linux   | `x64`          | `linux-x86_64`          | Ubuntu x64                                       |
| Linux   | `arm64`        | `linux-aarch_64`        | Ubuntu ARM64                                     |
| Linux   | `ia32`         | `linux-x86_32`          | Archive selection tests only                     |
| Linux   | `ppc64`        | `linux-ppcle_64`        | Archive selection tests only; little-endian only |
| Linux   | `s390x`        | `linux-s390_64`         | Archive selection tests only                     |
| macOS   | `x64`          | `osx-x86_64`            | Intel macOS                                      |
| macOS   | `arm64`        | `osx-aarch_64`          | Apple silicon macOS                              |
| Windows | `x64`          | `win64`                 | Windows x64                                      |
| Windows | `ia32`         | `win32`                 | Windows x64 running a 32-bit compiler            |
| Windows | `arm64`        | `win64`                 | Windows ARM64 using x64 emulation                |

The default is the architecture of the action's Node runtime. Protobuf does not
publish Windows ARM64 binaries; Windows ARM64 uses the upstream x64 executable.
An explicit architecture selects a binary; it does not install an emulator or
make protoc a cross-compiler. Unsupported OS/architecture pairs fail early.
Older releases may not provide all targets; for example, `3.20.3` has no native
macOS ARM64 archive. There is no automatic macOS fallback to Rosetta.

```yaml
- uses: eifinger/setup-protoc@1d3443f7c29b07b22fd3917a5600fca9c96b6d5a # v1.0.0
  with:
    version: "33.0"
    architecture: x64
```

Self-hosted runners must support Node.js 24 actions (runner v2.327.1 or newer),
have a writable runner tool cache and temporary directory, and have `unzip` on
Linux/macOS or PowerShell on Windows. Upstream Linux binaries require a compatible
glibc environment; Alpine/musl is not supported. No administrator access is needed.

## Checksum verification

Every ZIP is verified with SHA-256 **before extraction**. The checksum source is:

1. The explicit `checksum` input, if supplied.
2. The checksum bundled in this action for that exact release asset.
3. The `sha256:` digest in the GitHub release asset metadata.

If no trusted checksum is available, installation fails. This can occur with older
releases that have no GitHub digest and are not in the bundled table. Supply a
checksum from a trusted source or request an addition to the table. A missing or
mismatched checksum never falls back to an unverified download.

```yaml
- uses: eifinger/setup-protoc@1d3443f7c29b07b22fd3917a5600fca9c96b6d5a # v1.0.0
  with:
    version: "33.0"
    architecture: x64
    # SHA-256 of protoc-33.0-linux-x86_64.zip; Linux x64 only.
    checksum: d99c011b799e9e412064244f0be417e5d76c9b6ace13a2ac735330fa7d57ad8f
```

Checksums differ by platform and architecture. Use a matrix-specific checksum for
a multi-platform workflow. Uppercase hex and the `sha256:` prefix are accepted.
Checksums detect changed downloads; they are not signatures or independent proof
of publisher identity. GitHub digests share the release's trust boundary.

Known checksums live in [`src/known-checksums.json`](../src/known-checksums.json).
The table covers stable releases from `21.0` onward and selected legacy releases.
The updater scans all modern stable releases, including backports. It uses
official GitHub digests where available and hashes official downloads for older
releases. Updates are proposed as pull requests, not silently accepted in the
running action. Existing recorded checksums are never replaced automatically
when a different digest appears.

## Tool caching

The action uses the GitHub Actions runner tool cache. Its cache identity includes
the release version, OS/architecture target, and expected archive checksum. A
changed explicit checksum cannot reuse an installation verified against a
different checksum. The entire archive is cached, including `include/`.

Repeated steps in a job reuse it. Persistent self-hosted runners can reuse it
across jobs. Standard GitHub-hosted runners start fresh, so this action does not
persist installations between jobs with `actions/cache`. Protoc has no dependency
cache to save, and the release ZIPs are small.

A cache hit trusts files installed by this action on that runner. It does not
rehash extracted files. Do not share a writable self-hosted runner tool cache
between mutually untrusted workloads. Remove a damaged cache entry to download
it again; the action reports the cache path in debug logs.

## Network and authentication

Version ranges and `latest` use `api.github.com`. Exact known versions and
`latest-known` avoid version lookup API calls. Downloads come only from official
`github.com/protocolbuffers/protobuf/releases` URLs and their redirects. The
token is sent to the GitHub.com API, not to public asset downloads.

On GitHub.com, `github-token` defaults to `${{ github.token }}` to avoid most
anonymous API rate limits. On GitHub Enterprise Server, it defaults to empty;
provide a GitHub.com token if API authentication is needed. A server-local token
cannot authenticate to GitHub.com. No write permissions are needed.
`repo-token` remains an alias for migration and takes precedence.
The action uses the Actions HTTP toolkit's proxy support. API redirects are
rejected; archive downloads still follow redirects to GitHub's asset storage.

GitHub API requests allow up to three retries after the first attempt for
temporary network failures, interrupted responses, socket timeouts, HTTP 408/5xx responses, and rate
limits (429, or 403 with a rate-limit message or headers). Other errors, including
authentication failures and missing releases, fail without retries. Normal retry
delays are 1, 2, and 4 seconds. `Retry-After` and `x-ratelimit-reset` headers can
increase the delay. A rate limit without a valid retry time waits 60 seconds
only if it is the first failed attempt. After an earlier failure, its required
delay exceeds the 60-second limit and the action fails instead of retrying early.
Any required delay above 60 seconds stops the action; run it again later.
Each API response body must finish within 30 seconds after headers arrive;
otherwise the connection is closed and the request uses the same retry limit.
Retry headers still apply when the response body is interrupted or times out.

ZIP downloads use the toolkit's separate retry policy: three total attempts,
with 10–20-second delays, for network errors and HTTP 408/429/5xx responses.
Checksum mismatches are not retried.

## Problem matchers and debugging

Protoc diagnostics with `file:line:column: message` or
`file:line:column: warning: message` are registered as workflow annotations.
Set `add-problem-matchers: false` to disable this. Run protoc from the repository
root when using relative source paths so annotations identify the correct files.

Enable the repository secret `ACTIONS_STEP_DEBUG=true` for tool-cache and HTTP
debug messages. For a 403 or API rate-limit error, check `github-token`. For a
missing asset, choose a release that supports the selected architecture. For a
checksum mismatch, inspect the release and checksum; do not bypass verification.

The action installs only protoc and its bundled includes. It does not install
plugins such as `protoc-gen-go`, language runtimes, or project dependencies.
