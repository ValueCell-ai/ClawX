---
id: windows-signing-release-policy
title: Shared Windows signing release policy
type: ai-coding-rule
appliesTo:
  - windows-code-signing
requiredProfiles:
  - fast
references:
  - harness/reference/windows-code-signing.md
---

- Sign the application, NSIS uninstaller and installer inside electron-builder,
  before blockmaps and update manifests are generated. Do not patch release
  hashes after replacing executables.
- Require SSL.com eSigner credentials, an exact publisher CN and a validated
  tool installation for signed releases. Missing settings or invalid signatures
  stop the build; never silently publish unsigned artifacts.
- Use SHA256 and timestamps. Check the final signed file's trust status,
  publisher identity and timestamp before accepting it.
- Preserve existing valid upstream signatures only for explicitly allowed
  bundled helper paths. Do not treat an unrelated publisher on the application
  or installer as successful signing.
- Do not log credentials, OTP material, signing command lines or raw tool error
  output. Pin and verify the signing tool download.
- Keep publication channels signed, including alpha/beta and manual build
  artifacts. Enable updater publisher checks for signed builds.
- Share implementation between community and enterprise releases, but configure
  credentials independently in their GitHub repositories. Never introduce
  enterprise credentials or private issuer documents into source control.
- Separate offline validation from paid signing and installation acceptance.
  Do not promise that an OV, EV or cloud signature suppresses all SmartScreen
  warnings.
