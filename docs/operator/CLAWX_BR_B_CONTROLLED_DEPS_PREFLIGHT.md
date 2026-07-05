# CLAWX BR-B Controlled Dependencies Preflight

## Purpose
This preflight records the dependency-chain constraints for the isolated Phase 1 environment work on the LAH fork. It is intentionally limited to static review and local environment preparation. It does not install packages, download binaries, or launch ClawX, Electron, OpenClaw, or Gateway.

## Package Manager
- Package manager: `pnpm`
- Pinned version: `pnpm@10.33.4+sha512.1c67b3b359b2d408119ba1ed289f34b8fc3c6873412bec6fd264fbdc82489e510fcbecb9ce9d22dae7f3b76269d8441046014bdca53b9979cd7a561ad631b800`

## Lifecycle and Install-Chain Risk
The repository already exposes lifecycle and dependency-chain entry points that can mutate the workspace or download assets:

- `postinstall`: `node scripts/patch-browser-hint.mjs`
- `init`: `pnpm install && pnpm run uv:download && pnpm run agent-browser:download`
- `predev`: bridge generation plus preinstalled-skills preparation
- `build`, `package`, `release`, and `package:win` transitively call bundle, builder, or download helpers

The download-related scripts are especially relevant:

- `uv:download*`
- `agent-browser:download*`
- `node:download:win`
- `prep:win-binaries`

These are not appropriate for BR-B because they can fetch binaries or mutate the dependency surface.

## Forbidden Scripts For This BR
The following scripts remain off-limits for BR-B:

- `pnpm run init`
- `pnpm install`
- `npm install`
- `pnpm run release`
- `pnpm run package`
- `pnpm run package:win`
- `pnpm run package:linux`
- `pnpm run package:mac`
- `pnpm run package:mac:local`
- any `uv:download*`
- any `agent-browser:download*`
- `node:download:win`
- `prep:win-binaries`

## Why Normal Install Remains Gated
Normal dependency installation is still gated because:

- `postinstall` can mutate files during installation.
- the repo includes binaries and packaged components that may be downloaded or rebuilt.
- dependency resolution can change the lockfile or native artifacts.
- BR-B is only about isolated environment prep, not dependency acquisition.

## Why `pnpm run init` Stays Forbidden
`pnpm run init` explicitly chains install plus downloads. It would violate this BR's isolation goal and could touch external resources or create non-deterministic state.

## Future Candidate
If an approval-gated install is ever needed later, the safest candidate to evaluate first is:

- `pnpm install --ignore-scripts`

That is only a future candidate for review. BR-B does not run it.

## Approval Gate
Any install, download, or lifecycle execution beyond static inspection must be approved separately before it happens.

## Rollback Plan
- Remove the isolated runtime tree under `/home/deploy/lah-stack-runtime/clawx-phase1`.
- Revert the BR-B branch commit if the preflight docs or script must be removed.
- Leave production OpenClaw and `/home/deploy/.openclaw` untouched.

## This BR Does Not Run Install
BR-B only prepares documentation and the isolated environment layout. It does not install dependencies, does not fetch binaries, and does not execute runtime code.
