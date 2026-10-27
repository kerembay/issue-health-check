# Issue Health Check — Project Plan

_Updated on 2026-10-27 to reflect the design changes made during the week (see the last section)._

## Goal

Show a 0–100 health score and the missing pieces on every Jira issue, so team members fix gaps before starting work. Project admins choose which checks count and set their limits.

## Scope

- **Must-haves:** R1–R9 from the assignment: issue panel, real Jira data, Done and all-checks-off edge cases, settings page, validation, per-project storage with defaults, loading and error states, unit tests, security.
- **Checks:** Description (min. 30 characters), Assignee, Due date, Recently updated (14 days), Labels (off by default).
- **Out of scope:** stretch goals (JQL search, daily stale scan, dashboard gadget, custom field check). A finished MVP comes first.

## Design

- **Two screens (UI Kit):** `jira:issuePanel` for the score, `jira:projectSettingsPage` for the settings.
- **Resolvers (`src/index.js`):** the screens only call resolvers. Resolvers read the issue with `asUser()` (only the fields the checks need), check `ADMINISTER_PROJECTS` before saving, and read or write settings in Forge KVS.
- **Rules engine (`src/rules.js`):** pure functions with no Forge imports, so they can be unit tested with plain Jest.
- **Storage:** one KVS key per project, `settings-<projectId>`, merged with the defaults on read and written only when an admin saves.
- **Scopes:** `read:jira-work` and `storage:app` only; no external calls.

## Five-day plan

| Day | Goal                                                                                                           | Review gate                          |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | Forge CLI set up, app created from the issue panel template, deployed and installed on the dev site; this plan | App visible on an issue              |
| 2   | Rules engine as pure functions with unit tests for every check, the score and the bands                        | `npm test` passes                    |
| 3   | Resolver reads the issue as the user; panel shows score, band and hints; Done and all-off cases                | Panel works on the dev site          |
| 4   | Settings page, validation (1–500, 1–365), per-project storage, backend admin check                             | Settings saved and used by the panel |
| 5   | Loading and error states, README, lint and formatting, demo and retrospective                                  | Demo                                 |

## Risks

- **New to Forge:** follow the getting-started tutorial on day 1 and ask the mentor early.
- **ADF descriptions:** the description is a rich-text document, not a string; extract text from its text nodes.
- **Permissions:** hiding the settings page is not enough; check admin rights in the resolver.

## Design changes during the week

- **Done detection** uses `statusCategory.key === 'done'` instead of the translated status name, so it works in every site language.
- **Settings storage** moved from two keys (project ID and project key) to a single `settings-<projectId>` key; a project key is resolved to its ID when needed.
- **Validation** lives in one pure function, `validateSettings`, used by both the settings page and the backend.
- **Errors:** resolvers return coded results (`{ ok, data | error }`) instead of throwing, so expected failures do not appear as unhandled errors in `forge logs`, and the UI shows clear messages.
- **UI language:** all user-facing text is English, to match the check names and the README.
