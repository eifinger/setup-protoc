# Migrating from arduino/setup-protoc

Change the action name and keep your existing version inputs:

```yaml
- uses: eifinger/setup-protoc@<commit-sha>
  with:
    version: "23.x"
    repo-token: ${{ secrets.GITHUB_TOKEN }}
```

`version` and `repo-token` are supported. New workflows
can use `github-token`, which defaults to `${{ github.token }}` on GitHub.com
and empty on GitHub Enterprise Server. When both token inputs are supplied,
`repo-token` wins so the legacy input is not hidden by the new default.

Check these differences:

- **Default version:** `.protoc-version`, then `.tool-versions`, then the latest
  stable release. Arduino's `26.x` default is not used. Set `version: latest`
  to ignore files.
- **Prereleases:** not supported. Remove the `include-pre-releases` input and
  select a stable compiler release.
- **Verification:** every ZIP needs a SHA-256 checksum. Some older releases need
  an explicit checksum if neither the bundled table nor GitHub provides one.
- **Runtime:** this is a Node.js 24 action. Update older self-hosted runners.
- **Architecture:** the runner architecture is used by default. Native Linux and
  macOS ARM64 assets are used where available; Windows ARM64 uses x64 emulation.
- **Version format:** modern `23.2` and legacy `3.20.3` release pins are supported.
  Two-component pins are exact; use `23.x` for a series.

The `version` output retains Arduino's `v` prefix. The `path` output is the
installation directory containing `bin` and `include`, not the executable path.
Use `protoc-version` for the release without `v`, and `protoc-path` for the
executable path.

The installed executable remains `protoc` on `PATH`. The complete include tree
is retained. See [configuration](configuration.md) for platform requirements and
[version selection](versions.md) for file formats and range behavior.
