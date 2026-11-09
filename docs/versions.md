# Version selection

## Precedence

The first applicable source wins:

1. A non-empty `version` input. `version-file` is not read in this case.
2. An explicit `version-file`, resolved relative to `working-directory`.
3. `.protoc-version` in `working-directory`.
4. The `protoc` or `protobuf` entry in `.tool-versions` in that directory.
5. The latest stable protobuf release on GitHub.

There is no parent-directory search. Missing automatically discovered files and
`.tool-versions` files without a protoc entry are skipped. An explicitly selected
file must exist and contain a version. Empty or invalid selected files fail;
they do not silently install a different version.

## Pins and ranges

Quote versions in YAML so values such as `33.0` remain strings.

| Request           | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `33.0` or `v33.0` | Exactly release `v33.0`.                                                      |
| `3.20.3`          | Exactly the legacy release `v3.20.3`.                                         |
| `33` or `33.x`    | Highest stable release in the 33 series.                                      |
| `>=25.3 <34`      | Highest stable release in the interval. Commas can replace spaces.            |
| `latest`          | GitHub's latest stable release; ignores version files.                        |
| `latest-known`    | Highest stable version in the bundled checksum table; no version API request. |

Ranges use [node-semver](https://github.com/npm/node-semver). Modern two-component
release versions are compared as three components: `33.2` becomes `33.2.0` for
comparison only. Exact two-component inputs remain exact pins, not ranges. The
download name and `protoc-version` output retain the upstream release version.

Some release and executable versions differ. For example, release `21.12` prints
`libprotoc 3.21.12`. Use the release version in action inputs. The action does not
translate protobuf language-package versions into compiler release versions.

```yaml
- uses: eifinger/setup-protoc@<commit-sha>
  with:
    version: ">=33.0 <34"
    resolution-strategy: lowest
```

`lowest` changes range resolution only. `latest` and `latest-known` always select
the newest release in their respective sources. Ranges use all pages of the
upstream releases API, not only the most recent releases or cached installations.
If the selected release has no binary for your platform, installation fails.

Only stable compiler releases are supported. Prerelease pins are rejected;
drafts and prereleases are excluded from version selection.

## Plain version files

`.protoc-version` contains one stable version or range:

```text
33.0
```

Blank lines, `#` comments, surrounding whitespace, and Windows line endings are
accepted. The action discovers `.protoc-version` automatically. Use `version-file`
to select a differently named plain file:

```yaml
- uses: eifinger/setup-protoc@<commit-sha>
  with:
    working-directory: tools
    version-file: protoc-version.txt
```

## .tool-versions

```text
python 3.13
protoc 33.0
```

`protobuf 33.0` is also accepted for asdf plugins that use that name. Only one
`protoc` or `protobuf` entry with one exact released version is allowed. Other
tools are ignored. Comments and tabs are accepted. Duplicate entries, fallback
versions, `system`, `ref:`, paths, and version ranges fail with an error.

```yaml
- uses: eifinger/setup-protoc@<commit-sha>
  with:
    version-file: .tool-versions
```

## Reproducibility

Pin an action commit SHA and an exact protoc version. Optionally pin the ZIP's
SHA-256 as well. Ranges and `latest` can change when upstream publishes releases.
`latest-known` changes when you update the action to a commit with newer bundled
checksums. A warm tool cache never substitutes an older version for a request.
