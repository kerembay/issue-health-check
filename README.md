# Issue Health Check

An [Atlassian Forge](https://developer.atlassian.com/platform/forge/) app for Jira Cloud that scores the "health" of each issue directly on the issue view. It shows a score from 0 to 100, a status band, and a pass/fail list of checks with a short hint for each failed check. Project admins can choose which checks are active and tune their thresholds from the project settings.

## Why this exists

Issues that have no description, no assignee, no due date, or that have not been touched for weeks are hard to plan around. Instead of asking the team to remember these conventions, the app checks them automatically and tells the person looking at the issue what is missing.

## Features

- **Issue panel** that shows the health score, a colored band (`Healthy`, `Need attention`, `At risk`), and one line per active check.
- **Five configurable checks**: description length, assignee, due date, recently updated, and labels.
- **Per-project settings page** under _Project settings → Health Check Settings_, so each project can have its own rules.
- **Admin-only saving**: the settings can only be saved by users who have the `ADMINISTER_PROJECTS` permission in that project.
- **Sensible edge cases**: completed issues are skipped, and if every check is turned off the panel says so instead of showing a meaningless score.

## How scoring works

Only the checks that are enabled count. The score is the percentage of enabled checks that pass, rounded to the nearest integer:

```
score = round(passed checks / enabled checks * 100)
```

| Score    | Band           |
| -------- | -------------- |
| 80 – 100 | Healthy        |
| 50 – 79  | Need attention |
| 0 – 49   | At risk        |

### Checks

| Check            | Passes when                                                                                                                                                                                                                                              | Default |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Description      | The description text has at least _N_ characters (default 30). The Atlassian Document Format (ADF) description is flattened to plain text before counting. Repeated whitespace counts as a single space, and leading and trailing whitespace is ignored. | On      |
| Assignee         | The issue has an assignee.                                                                                                                                                                                                                               | On      |
| Due date         | A due date is set and it is today or later.                                                                                                                                                                                                              | On      |
| Recently updated | The issue was updated within the last _N_ days (default 14).                                                                                                                                                                                             | On      |
| Labels           | The issue has at least one label.                                                                                                                                                                                                                        | Off     |

### Special cases

- If the issue's status category key is `done`, no score is calculated and the panel shows a "Done" message. The language-independent `statusCategory.key` is used instead of the translated category name, so this works on sites in any language.
- If all checks are disabled in the project settings, the panel shows that no checks are enabled.

## Configuration

Open a project in Jira and go to **Project settings → Health Check Settings**. You can:

- turn each check on or off,
- set the minimum description length (an integer from 1 to 500),
- set the stale limit in days for the "recently updated" check (an integer from 1 to 365).

Empty or out-of-range values are rejected before anything is saved. The settings page and the `saveSettings` resolver both run the same `validateSettings` function from `src/rules.js`, and the resolver stores only known fields. Settings are stored per project in Forge Key-Value Storage under a single key, `settings-<projectId>`. The numeric project ID is used rather than the project key because the key can change when a project is renamed. If the Forge context only provides a project key, the resolver looks up the ID with `GET /rest/api/3/project/{key}` (as the current user) and fails instead of falling back to defaults when the lookup fails. Projects that have never saved settings use the defaults.

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

### Error handling

Every resolver returns the same shape: `{ ok: true, data }` on success or `{ ok: false, error: { code, details? } }` on failure. The codes are defined in `src/errors.js` and turned into user-friendly messages by `src/frontend/errorMessages.js`.

| Code                                     | When                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `NO_PERMISSION`                          | Jira answered 401 or 403                                                           |
| `NOT_FOUND`                              | Jira answered 404 (the issue or project does not exist, or the user cannot see it) |
| `JIRA_ERROR`                             | Any other Jira error status                                                        |
| `NOT_PROJECT_ADMIN`                      | A non-admin tried to save settings                                                 |
| `INVALID_SETTINGS`                       | The payload failed `validateSettings` (`details` lists the problems)               |
| `NO_ISSUE_CONTEXT`, `NO_PROJECT_CONTEXT` | The module context has no issue or project                                         |
| `UNEXPECTED`                             | Anything else, such as a storage or network failure                                |

Expected failures are normal results, not exceptions, so they do not show up as unhandled errors in `forge logs`. Unexpected errors are caught as well and logged with only the resolver name and the error type, never issue content, names or e-mail addresses. The issue panel shows a spinner while loading and a clear message when data cannot be loaded. The settings page does not show the form at all if the settings fail to load, so an admin cannot accidentally overwrite saved settings with defaults.

## Project structure

```
.
├── manifest.yml            # Forge modules, resources, runtime and permissions
├── package.json
├── babel.config.json       # Lets Jest understand ES modules
├── jest.global-setup.js    # Runs Jest in UTC, like the Forge runtime
├── .eslintrc
├── .prettierrc
├── .prettierignore
├── static
│   └── icons
│       └── health-check.svg  # Issue panel icon, bundled with the app
└── src
    ├── index.js            # Resolver: getIssueHealth, getSettings, saveSettings
    ├── errors.js           # Error codes shared by the resolver and the UI
    ├── rules.js            # Default settings, validateSettings and the scoring logic
    ├── rules.test.js       # Jest tests for the rules engine
    ├── index.test.js       # Jest tests for the resolver (Forge modules mocked)
    └── frontend
        ├── index.jsx       # Issue panel UI (UI Kit)
        ├── settings.jsx    # Project settings page UI (UI Kit)
        ├── errorMessages.js      # Error code -> user-friendly message
        └── errorMessages.test.js # Every error code has a message
```

## Tech stack

- Atlassian Forge, runtime `nodejs24.x`
- Forge UI Kit (`@forge/react`) with native rendering
- `@forge/resolver`, `@forge/bridge`, `@forge/api`, `@forge/kvs`
- Jest for tests, ESLint for linting, Prettier for formatting

## Permissions

The app requests only two scopes, declared in `manifest.yml`:

| Scope            | Used for                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read:jira-work` | All Jira REST calls, made as the current user: reading the issue fields needed for the checks (`GET /rest/api/3/issue/{id}`), checking that the caller is a project admin before saving settings (`GET /rest/api/3/mypermissions`), and looking up a project ID when the context only has a project key (`GET /rest/api/3/project/{key}`). |
| `storage:app`    | Reading and writing per-project settings in Forge Key-Value Storage.                                                                                                                                                                                                                                                                       |

The app has no write scope for Jira, no `asApp()` calls and no external egress, so all data stays on Atlassian's platform.

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

1. Open any issue in a project where the app is installed. Add the **Issue Health Check** panel from the issue's apps menu; it shows the score.
2. Open **Project settings → Health Check Settings** to change which checks are active.

## Development

```bash
npm test          # run the Jest tests
npm run lint      # eslint src --ext .js,.jsx + Prettier check (fails on any problem)
npm run lint:fix  # ESLint auto-fix + Prettier write
npm run format    # format all files with Prettier
```

- `src/rules.test.js` tests each check on its own (description length limit and whitespace, assignee, due date in Jira's `YYYY-MM-DD` format for past, today and future, the stale limit boundary, labels), the score rounding and band boundaries (80 and 50), both edge cases (key-based Done detection, all checks off), that `DEFAULT_SETTINGS` matches the checks table, `validateSettings` and ADF text extraction. Date tests use a fixed clock.
- `src/index.test.js` tests the resolvers with mocked Forge modules: the single `settings-<projectId>` KVS key, project key to ID lookup, the admin check, validation, and the error codes returned for each Jira status.
- `src/frontend/errorMessages.test.js` checks that every error code has a message.

Jest runs in UTC (see `jest.global-setup.js`) because Forge functions run in UTC and the date checks use the server time zone. Run `npx jest --coverage` to see coverage.

To see runtime errors from a deployed app, use `forge logs -e development`.

## Decisions

- **Logic in the resolver, rules as pure functions.** The UI only calls resolvers. The resolver does the Jira calls, permission check and storage, and `src/rules.js` has no Forge imports so it can be unit tested with plain Jest.
- **`asUser()` everywhere.** Every Jira call runs as the current user, so people only see what Jira already lets them see. There is no `asApp()` because every request has a user.
- **Backend admin check.** Jira only shows the settings page to project admins, but a resolver can be invoked directly, so `saveSettings` checks `ADMINISTER_PROJECTS` itself.
- **Validation on both sides, one rule set.** The settings page runs `validateSettings` for quick feedback and the backend runs the same function again, so the limits can never drift apart.
- **English UI.** All user-facing text is in English to match the check names, bands and this README.
- **Done issues skip storage.** The resolver returns `isDone` before reading settings, since Done issues never get a score.
- **One storage key per project, by ID.** `settings-<projectId>` is used because project keys can change. Saved settings are merged with the defaults on read, so settings added later get a value for old projects.
- **Done detection by status category key.** `statusCategory.key === 'done'` works on sites in every language, unlike the translated category name.
- **Coded results instead of exceptions.** See [Error handling](#error-handling).
- **Bundled icon.** The issue panel icon is a file in the app (`static/icons/health-check.svg`), not an external URL, so the app makes no calls outside Atlassian.

## Notes and limitations

- Dates are evaluated in the Forge runtime's time zone, which is UTC. The due date check passes until the end of the due date in UTC, and the "recently updated" check counts whole days since the last update. Users far from UTC may see a due date flip a few hours before or after their local midnight.
- The panel calculates the score when it loads. After editing an issue, reload the page to see the new result.
- Checks are fixed to the five listed above. Adding a new check means adding a setting to `DEFAULT_SETTINGS`, a branch in `evaluateIssueHealth`, and a control on the settings page.

## License

MIT
