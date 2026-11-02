# Repository Guidelines

## Security and privacy

- Access only the files and credentials needed for the task. Use configured authentication without printing or copying secret values into chat, repository files, or external services.
- Share only the evidence needed for the authorized task. Permission to publish findings does not authorize disclosure of credentials, private environment details, or unrelated local data.
- Before committing or sending content to an external service, inspect the complete payload, including commands, logs, stack traces, screenshots, and attachments. Remove secrets and private metadata while preserving the evidence needed to reproduce the result.
- Make shared references portable: use repository URLs with exact tags/commits and repository-relative file paths. Describe local setup with generic relative paths or placeholders such as `<checkout>` and `<worktree>`; relative paths must also omit private directory names. Keep machine-specific absolute paths in local commands and chat where needed for navigation or permission requests.

## Lexical work

For Lexical source inspection, API questions, implementation, debugging, upgrades, peer-range changes, compatibility baselines, or package semver decisions, use `.agents/skills/lexical-compatibility/SKILL.md`.

## Web Editor Revisions source inspection

- Use the sibling checkout at `../web-editor-revisions` first when it exists.
- Resolve pinned versions from its local Git history with `git show <commit>:<path>` instead of assuming the checked-out branch is authoritative.
- Use GitHub or other network access only when the required ref is unavailable locally or current remote state is itself the subject of the investigation.
- Treat changes in the sibling working tree as user-owned; do not modify, stash, discard, or commit them without explicit authorization.

## Sandbox and pnpm

- If a `pnpm` command returns `unable to open database file`, treat it as a likely sandbox or filesystem-permission failure when the pnpm store is outside the workspace, not as a repository or lockfile failure.
- Retry the original `pnpm` command using the agent's available approval or elevated-access mechanism so pnpm can access its existing external store.
- If approval is unavailable or denied, stop and ask the user to approve the required access or run the command outside the sandbox.
- Preserve the existing pnpm store and database; do not delete them or change their ownership or permissions with `sudo`.

## Architecture and tests

- Keep the package API framework-independent and safe to import without DOM globals.

## Commits and pull requests

Use lowercase Conventional Commit-style subjects, such as `fix(test): prevent duplicate Vitest discovery`. Pull requests should explain the change, list validation commands, link a related issue when applicable, and include a screenshot or reproduction steps for visible editor changes. Update `pnpm-lock.yaml` whenever dependency manifests change.

## Repository workflows

### Issue tracker

For reading or changing issues, specs, and issue relationships, follow `docs/agents/issue-tracker.md`.

### Triage labels

For issue triage or label changes, follow `docs/agents/triage-labels.md`.

### Domain docs

Before exploring or changing code, read root `GLOSSARY.md` and the ADRs that touch the area. Follow `docs/agents/domain.md`.
