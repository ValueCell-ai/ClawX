---
id: managed-computer-use-skill
title: Authoritative bundled computer-use Skill
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make the computer-use installation fully ClawX-managed and replace any differing same-name content with the current bundled directory without maintaining historical hashes.
touchedAreas:
  - electron/**
  - resources/**
  - scripts/**
  - tests/**
  - harness/**
  - shared/**
  - src/**
  - .github/workflows/check.yml
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - electron-builder.yml
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Startup makes the installed computer-use directory match the current bundle regardless of previous version or local edits.
  - Matching content is left untouched; custom Skills with other names and enablement preferences remain unchanged.
  - A failed staged copy or publication preserves the previous installation where possible and can be retried.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - local-computer-use
  - renderer-main-boundary
  - docs-sync
requiredTests:
  - tests/unit/builtin-computer-use-skill.test.ts
  - tests/unit/cua-cli-contract.test.ts
  - tests/e2e/computer-use-skill.spec.ts
acceptance:
  - Remove all three hardcoded installation hashes, old-version detection, and historical bundle test fixtures.
  - Compare current source and destination content dynamically, including filenames, so edits, missing files and extra files trigger replacement.
  - Stage the full bundle outside discovery before replacing an existing target; retain publication rollback and cleanup.
  - Replace a target symlink itself rather than following it or deleting its external referent.
  - Fresh installs use the same staged publication so interrupted copies do not leave a partial discoverable Skill.
  - No user-content preservation exception applies inside computer-use; other Skill directories and preferences remain untouched.
  - Preserve tagged upstream document bytes, provenance/license checks and the /computer-use name.
  - Document that custom variants must use another name because edits to computer-use are overwritten.
docs:
  required: true
---

# Managed Computer Use Skill

The user explicitly owns the entire `computer-use` installation and requests that
same-name edits be overwritten. This supersedes earlier known-pristine-version
migration policies, not the upstream license/provenance verification. No runtime
download, general Skill updater or historical hash registry is needed. Existing
other-name Skills are outside this change. Broad paths include inherited branch
scope; implementation is confined to installation, tests and documentation.
