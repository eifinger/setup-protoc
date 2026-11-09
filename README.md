# setup-protoc

Install the [Protocol Buffers compiler](https://protobuf.dev/) in GitHub Actions.

- Linux, macOS, and Windows, including ARM64 runners.
- Stable versions, version ranges, and version files.
- SHA-256 verification for every download, with bundled known checksums.
- Runner tool caching, bundled Google `.proto` files, and problem matchers.
- A self-contained Node.js 24 action; no npm install needed in your workflow.

## Usage

```yaml
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: eifinger/setup-protoc@<commit-sha>
    with:
      version: "33.0"
  - run: protoc --version
```

Always pin the action to a full 40-character commit SHA, not a tag or branch.
Use the commit of the release you reviewed. The `version`
input selects **protoc**, not the action version.

Without `version` or `version-file`, the action reads `.protoc-version`, then
`.tool-versions`, then installs the latest stable release if neither selects a version.
Run checkout first if you use version files.
Use `version: latest` to ignore files, or `version: latest-known` for the newest
stable release in the action's bundled checksum table.

## Inputs

| Input                  | Default                                        | Description                                                                            |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `version`              | Automatic                                      | Release such as `33.0` or `3.20.3`, range such as `33.x`, `latest`, or `latest-known`. |
| `version-file`         | Automatic                                      | Path to a plain version file or `.tool-versions`, relative to `working-directory`.     |
| `working-directory`    | `${{ github.workspace }}`                      | Directory used for version-file discovery.                                             |
| `resolution-strategy`  | `highest`                                      | `highest` or `lowest` matching release for ranges.                                     |
| `architecture`         | Runner architecture                            | `x64`, `arm64`, `ia32`, `ppc64`, or `s390x`; availability depends on OS and release.   |
| `checksum`             | Automatic                                      | SHA-256 of the release ZIP, optionally prefixed by `sha256:`.                          |
| `github-token`         | GitHub.com: `${{ github.token }}`; GHES: empty | Token for the GitHub.com releases API.                                                 |
| `repo-token`           | Empty                                          | Compatibility alias; overrides `github-token` if supplied.                             |
| `add-problem-matchers` | `true`                                         | Annotate protoc errors and warnings in workflow logs.                                  |

## Outputs and environment

| Output           | Description                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `protoc-version` | Installed release version, without `v`.                                                    |
| `protoc-path`    | Absolute path to the compiler executable.                                                  |
| `protoc-include` | Absolute path to the bundled `include` directory.                                          |
| `cache-hit`      | `true` if the installation came from the runner tool cache; otherwise `false`.             |
| `version`        | Installed release version with `v`, such as `v33.0`; Arduino-compatible output.            |
| `path`           | Absolute installation directory containing `bin` and `include`; Arduino-compatible output. |

The action adds protoc to `PATH`. It also exports `PROTOC` (the executable path)
and `PROTOC_INCLUDE` (the include directory) for later steps.

```yaml
- uses: eifinger/setup-protoc@<commit-sha>
  id: protoc
  with:
    version-file: .tool-versions
- name: Compile a descriptor set, including Google types
  shell: bash
  run: |
    "$PROTOC" --proto_path=proto --proto_path="$PROTOC_INCLUDE" \
      --descriptor_set_out=messages.pb --include_imports proto/messages.proto
```

## Documentation

- [Version selection and version files](docs/versions.md)
- [Platforms, checksums, caching, and troubleshooting](docs/configuration.md)
- [Migrating from arduino/setup-protoc](docs/migration.md)
- [Contributing and releases](CONTRIBUTING.md)
- [Security](SECURITY.md)
