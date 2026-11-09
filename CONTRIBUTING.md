# Contributing

Use Node.js 24 (see `.nvmrc`) and npm. Install and check the project with:

```sh
npm ci
npm run all
npm run test:integration
```

`npm run all` type-checks, checks formatting/lint, runs offline tests, and rebuilds
the distributable. Use `npm run format` to fix formatting. Integration tests need
access to GitHub releases and execute real downloaded compilers. Set `GH_TOKEN`
to a GitHub.com token when you need a higher API rate limit.

Commit `dist/` with source changes. Consumers run the bundle directly, without
installing npm dependencies. CI rejects stale bundles. The build also collects
the full licenses of bundled dependencies into `dist/setup/THIRD_PARTY_NOTICES.txt`.

## Tests

Offline tests cover version selection, file precedence, all archive mappings,
API pagination and failures, checksum precedence, corrupted downloads, cache
isolation, and cleanup. They mock HTTP responses, not filesystem extraction or
the tool cache. Live integration tests use the shipped bundle and compile a
schema that imports Google's bundled timestamp type, then decode the descriptor.

The workflow exercises real action steps on Linux and macOS x64/ARM64, Windows
x64/ARM64, and Windows with the ia32 compiler. Configure the stable
`all-tests-passed` job as a required check. Test behavior through the public
inputs/outputs or installer contract; do not add tests for private call order.

## Known checksums

Update all stable releases from `21.0` onward, including backports:

```sh
npm run update-known-checksums
npm run all
```

Existing legacy entries are preserved. To add older versions or update selected
releases only, pass exact release versions:

```sh
npm run update-known-checksums -- 25.3 21.12 3.20.3
npm run all
```

The script uses GitHub asset digests where available, otherwise hashes downloads
from the official release. It preserves existing entries and fails if a published
digest changes. Review the source and hashes before merging. The scheduled
workflow proposes updates using a pull request. Enable **Allow GitHub Actions to
create and approve pull requests** in repository settings for this workflow.
Pull requests created with `GITHUB_TOKEN` do not automatically trigger other
workflows; run Test manually on the update branch before merging them.

## Releases

Action releases use semantic versioning independently of protoc versions.

1. Label pull requests before merging. `major` or `breaking-change` selects a
   major bump; `minor`, `new-feature`, or `enhancement` selects a minor bump;
   `patch` or `bugfix` selects a patch bump. The default is patch.
2. Merge the source, documentation, lockfile, checksums, and rebuilt `dist/`
   after the required checks pass. Release Drafter updates the draft on pushes
   to `main`; it can also be run manually after changing labels.
3. Review the draft in GitHub's **Releases** page. When it is ready, publish it
   there. GitHub creates the version tag, such as `v1.2.3`.
4. Publishing a stable release starts **Update docs**. It resolves the release
   tag to its full commit SHA and opens a pull request to update action references
   in all tracked Markdown files, with the release version in a comment.

Release notes use the categories and labels in `.github/release-drafter.yml`,
including `maintenance`, `ci`, `documentation`, and `dependencies`. No workflow
publishes the draft or creates a version tag for you.

There are no moving major or minor aliases. Documentation and consumers use full
commit SHAs; the comment identifies the corresponding release. Before the first
release, `<commit-sha>` marks the pin to replace. The documentation updater
replaces that placeholder as well as existing SHA pins. Prereleases do not update
the documentation automatically. To rerun an update, dispatch **Update docs**
with the stable release tag. The workflow opens a pull request rather than
pushing to `main`, and needs the same pull-request permission described above.

Configure GitHub Marketplace publication separately if desired.
