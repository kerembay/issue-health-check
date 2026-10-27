# Issue Health Check

A [Atlassian Forge](https://developer.atlassian.com/platform/forge/) app for Jira Cloud that scores the "health" of each issue directly on the issue view. It shows a score from 0 to 100, a status band, and a pass/fail list of checks with a short hint for each failed check. Project admins can choose which checks are active and tune their thresholds from the project settings.

## Why this exists

Issues that have no description, no assignee, no due date, or that have not been touched for weeks are hard to plan around. Instead of asking the team to remember these conventions, the app checks them automatically and tells the person looking at the issue what is missing.

## Features

- **Issue panel** that shows the health score, a colored band (`Healthy`, `Need attention`, `At risk`), and one line per active check.
- **Five configurable checks**: description length, assignee, due date, recently updated, and labels.
- **Per-project settings page** under *Project settings → Health Check Settings*, so each project can have its own rules.
- **Admin-only saving**: the settings can only be saved by users who have the `ADMINISTER_PROJECTS` permission in that project.
- **Sensible edge cases**: completed issues are skipped, and if every check is turned off the panel says so instead of showing a meaningless score.

## How scoring works

Only the checks that are enabled count. The score is the percentage of enabled checks that pass, rounded to the nearest integer:

```
score = round(passed checks / enabled checks * 100)
```

| Score | Band |
| --- | --- |
| 80 – 100 | Healthy |
| 50 – 79 | Need attention |
| 0 – 49 | At risk |

### Checks

| Check | Passes when | Default |
| --- | --- | --- |
| Description | The description text has at least *N* characters (default 30). The Atlassian Document Format (ADF) description is flattened to plain text before counting. | On |
| Assignee | The issue has an assignee. | On |
| Due date | A due date is set and it is today or later. | On |
| Recently updated | The issue was updated within the last *N* days (default 14). | On |
| Labels | The issue has at least one label. | Off |

### Special cases

- If the issue's status category key is `done`, no score is calculated and the panel shows a "Done" message. The language-independent `statusCategory.key` is used instead of the translated category name, so this works on sites in any language.
- If all checks are disabled in the project settings, the panel shows that no checks are enabled.

## Configuration

Open a project in Jira and go to **Project settings → Health Check Settings**. You can:

- turn each check on or off,
- set the minimum description length (an integer from 1 to 500),
- set the stale limit in days for the "recently updated" check (an integer from 1 to 365).

Values outside these ranges are rejected by the settings page before saving, and again on the server by `validateSettings` in `src/rules.js` (the `saveSettings` resolver refuses invalid payloads and stores only known fields). Settings are stored per project in Forge Key-Value Storage under a single key, `settings-<projectId>`. The numeric project ID is used rather than the project key because the key can change when a project is renamed. If the Forge context only provides a project key, the resolver looks up the ID with `GET /rest/api/3/project/{key}` (as the current user) and fails instead of falling back to defaults when the lookup fails. Projects that have never saved settings use the defaults.

## Architecture

```
Jira issue view ──► issue panel (src/frontend/index.jsx)
                         │ invoke('getIssueHealth')
                         ▼
                   resolver (src/index.js) ──► Jira REST API (as the current user)
                         │                      GET /rest/api/3/issue/{id}
                         │ reads settings
                         ▼
                   Forge KVS (settings-<projectId>)
                         │
                         ▼
                   rules engine (src/rules.js) ──► score, band, results

Project settings ──► settings page (src/frontend/settings.jsx)
                         │ invoke('getSettings' / 'saveSettings')
                         ▼
                   resolver ──► permission check, then Forge KVS
```

- The rules engine in `src/rules.js` is a set of plain functions with no Forge dependencies, which keeps it easy to unit test.
- Requests to Jira are made with `api.asUser()`, so they run with the permissions of the person viewing the issue.
- Before saving settings, the resolver calls `/rest/api/3/mypermissions` and rejects the request unless the user has `ADMINISTER_PROJECTS` for that project.

## Project structure

```
.
├── manifest.yml            # Forge modules, resources, runtime and permissions
├── package.json
├── babel.config.json       # Lets Jest understand ES modules
├── .eslintrc
└── src
    ├── index.js            # Resolver: getIssueHealth, getSettings, saveSettings
    ├── rules.js            # Default settings and the health scoring logic
    ├── rules.test.js       # Jest tests for the rules engine
    ├── index.test.js       # Jest tests for the resolver (Forge modules mocked)
    └── frontend
        ├── index.jsx       # Issue panel UI (UI Kit)
        └── settings.jsx    # Project settings page UI (UI Kit)
```

## Tech stack

- Atlassian Forge, runtime `nodejs24.x`
- Forge UI Kit (`@forge/react`) with native rendering
- `@forge/resolver`, `@forge/bridge`, `@forge/api`, `@forge/kvs`
- Jest for tests, ESLint for linting

## Permissions

The app requests only two scopes, declared in `manifest.yml`:

| Scope | Used for |
| --- | --- |
| `read:jira-work` | Reading the issue fields needed for the checks |
| `storage:app` | Reading and writing per-project settings in Forge storage |

## Getting started

### Prerequisites

- Node.js and npm
- The [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/) (`npm install -g @forge/cli`)
- An Atlassian account and a Jira Cloud site where you can install development apps

### Install and run

```bash
# 1. Install dependencies
npm install

# 2. Log in to Forge
forge login

# 3. Register your own copy of the app (only if you cloned this repo
#    and the app id in manifest.yml is not yours)
forge register

# 4. Check the manifest
forge lint

# 5. Deploy to the development environment
forge deploy -e development

# 6. Install it on your Jira site
forge install -e development --site <your-site>.atlassian.net --product jira
```

After changing scopes in `manifest.yml`, deploy again and run `forge install --upgrade` so the new permissions take effect.

For live development, run `forge tunnel`. Code changes are hot reloaded, but changes to `manifest.yml` need a redeploy and a tunnel restart.

### Using the app

1. Open any issue in a project where the app is installed. The **issue-health-check** panel shows the score.
2. Open **Project settings → Health Check Settings** to change which checks are active.

## Development

```bash
npm test          # run the Jest tests
npm run lint      # lint the source files
npm run lint:fix  # lint and auto-fix
```

The tests in `src/rules.test.js` cover the done-status case, the all-checks-disabled case, a fully healthy issue (100, `Healthy`), and an issue that fails most checks (25, `At risk`).

To see runtime errors from a deployed app, use `forge logs -e development`.

## Notes and limitations

- The user interface text is currently in Turkish, while the check messages returned by the rules engine are in English.
- The "recently updated" check compares against the current time in whole days, and the due date check compares against the start of today.
- Checks are fixed to the five listed above. Adding a new check means adding a setting to `DEFAULT_SETTINGS`, a branch in `evaluateIssueHealth`, and a control on the settings page.

## License

MIT
