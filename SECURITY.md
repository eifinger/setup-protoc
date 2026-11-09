# Security

Report suspected vulnerabilities privately through
[GitHub's vulnerability reporting page](https://github.com/eifinger/setup-protoc/security/advisories/new).
If private reporting is unavailable, contact the repository owner privately;
do not include exploit details in a public issue.

Include the action commit, runner OS and architecture, protoc version, relevant
logs with secrets removed, and reproduction steps. Never include tokens.

The action downloads only official protobuf release assets and verifies SHA-256
before extraction. Checksums are not publisher signatures. A self-hosted runner's
tool cache is trusted local state: do not share it across untrusted jobs. See
[configuration](docs/configuration.md) for checksum sources and cache boundaries.
