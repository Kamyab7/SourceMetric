# Releases

Merge reviewed changes into `master`, then tag the commit you want to release:

```bash
git switch master
git pull --ff-only
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

The Release workflow validates the version and checks that the commit belongs to `master`. It runs the full CI suite, then publishes a GitHub Release with generated notes. Publishing uses GitHub's built-in token; no additional secrets are needed. It does not deploy to Cloudflare.

Use `vMAJOR.MINOR.PATCH` for stable releases, or `vMAJOR.MINOR.PATCH-alpha.N`, `-beta.N`, or `-rc.N` for prereleases. Prereleases are marked accordingly and never marked as latest. Do not move published tags; release fixes under a new version. Restrict creation, updates, and deletion of `v*` tags to maintainers using a GitHub repository ruleset.

If checks fail, fix the problem and tag the corrected commit with a new version. If publishing alone fails, rerun the failed job after resolving the error.

## Dashboard version

The dashboard footer shows the version embedded at build time. A clean checkout of a release tag displays that tag, such as `v0.1.0`. Other builds show `dev-<commit>` with `-dirty` when tracked files have changed. Builds without Git metadata show `development`.

To deploy a particular release:

```bash
git fetch origin --tags
git switch --detach v0.1.0
pnpm install --frozen-lockfile
pnpm deploy
```

This builds the selected version into your dashboard. Keep your checkout clean when deploying a release so it displays the release tag.
