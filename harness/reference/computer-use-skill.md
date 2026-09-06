# Computer-Use Skill Research and Integration

## Sources Reviewed

Public guides retrieved on 2026-09-06; no prior competitor links were available in
the task context. These are actual vendor guides, not evidence that a particular
competitor skill has measured success. The skill text is an original ClawX-specific
synthesis, not copied vendor instructions or a redistributed competitor skill.

- Anthropic: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
  Describes screenshot observation, input actions, image coordinates, and result/error
  handling. Its current toolset supports operations and batching that ClawX does not;
  neither its schema nor its zoom/batch examples were imported.
- OpenAI: https://developers.openai.com/api/docs/guides/tools-computer-use/
  Describes the screenshot/action feedback loop, resolution mapping, untrusted screen
  content, confirmation, and human handoff. Consulted through public extraction and
  Context7. Applied the principles, not its API envelopes or code-execution examples.
- Cua: https://cua.ai/docs/concepts/what-is-computer-use
  Explains observation, grounding, action, and verification across UI surfaces.
  ClawX's tool exposes screenshots, not the guide's broader accessibility/API surfaces.
  An initial guessed URL `/docs/cua/guide/computer-use` returned 404 and was not used.

## Local Contract

The authority for arguments and failures is
`resources/openclaw-plugins/clawx-cua-computer/computer-tool.mjs` and its
`mcp-client.mjs`, not the public guides. The skill uses the declared snake_case
fields, required coordinates, primary-display screenshot pixels, limited key parser,
and separate input-success/capture-failure result. It never recommends replay on
unknown completion. Default-off lifecycle remains documented in
`harness/reference/computer-use.md`.

The skill's scope is explicit desktop UI work or `/computer-use`, not unrelated
tasks. It is guidance, not permission, a security boundary, or an exclusive tool
gate. Enabling the skill and enabling the driver are independent decisions.

## Distribution

`resources/skills/computer-use/SKILL.md` is first-party, checked-in English model
guidance. No helper scripts, external manifest entry, runtime download, or new UI
strings are needed. The existing installer runs at startup and copies from
`getResourcesDir()/skills/computer-use` into `~/.openclaw/skills/computer-use`.
Local skill listing and quick-access discovery already scan this managed root.

In development `getResourcesDir()` resolves repository resources; electron-builder's
existing `resources/ -> resources/` extraResources mapping includes the full skill
outside ASAR in packaged builds. Third-party preparation skip flags and cached
preinstalled locks do not affect it. Existing same-name directories are never
merged or upgraded, including user-managed content; users retain their own version.
This conservative install policy also means an interrupted copy may need manual
repair, and deleting the directory causes reinstall at next startup.

The skill-creator initializer was run in the approved OS temporary directory.
Its example assets were not imported. The final checked-in folder is validated
and packaged with skill-creator's package script into that same temporary directory;
the generated `.skill` archive is a validation artifact, not ClawX's install format.

## Validation Boundaries

Unit tests copy the real resources into a packaged-layout fixture, run the real
installer and both discovery functions, check idempotence/user-content preservation,
and assert no configuration mutations. Electron E2E verifies real startup install,
picker discovery and explicit selection without sending a task or using desktop input.
Invocation examples are checked against the bundled plugin's real action mapper.
These tests do not establish model obedience or desktop-task success rates, and do
not replace a signed macOS/Windows release installation test.
