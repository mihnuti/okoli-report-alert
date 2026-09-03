# okoli-report-alert

Standalone scripts that check a Firestore `reports`-style collection for new user reports and
e-mail an alert. No Firebase Blaze plan / Cloud Functions needed. One repo, two apps:

| script | project | collection | e-mail subject |
| --- | --- | --- | --- |
| `check-reports.js` | `okoli-52bf6` | `reports` | `[Okolí] Nové nahlášení – <reason>` (incl. 60-min chat transcript) |
| `check-reports-mihnuti.js` | `mihnuti-398ef` | `nahlaseni` | `[Mihnutí] Nové nahlášení` |

Runs on **GitHub Actions** on a schedule (`.github/workflows/check-reports.yml`, hourly) so it
does not depend on any local machine being on. Both scripts run each tick; the Mihnutí step uses
`if: always()` so one app's failure can't mute the other. Can also be run by hand.

## Secrets (repo → Settings → Secrets and variables → Actions)

| secret | value |
| --- | --- |
| `SERVICE_ACCOUNT_JSON` | entire Firebase service-account key JSON for **okoli-52bf6**, pasted as one value |
| `SERVICE_ACCOUNT_JSON_MIHNUTI` | entire Firebase service-account key JSON for **mihnuti-398ef** |
| `GMAIL_USER` | `sejbalove@gmail.com` |
| `GMAIL_APP_PASSWORD` | 16-char Gmail App Password (Google Account → Security → App passwords), **not** the account password — revocable any time |
| `ALERT_TO_EMAIL` | where alerts go (can equal `GMAIL_USER`) |

Each app also keeps a copy of its script + a local Windows Task Scheduler task as a backup:
`okoli-app/tools/report-alert/` and `mihnuti/nastroje/report-alert/`.

## Run by hand

```
npm install
# either export SERVICE_ACCOUNT_JSON=... plus the GMAIL_* / ALERT_TO_EMAIL vars,
# or drop a service-account.json + .env next to the script (both gitignored)
node check-reports.js          # Okolí
node check-reports-mihnuti.js  # Mihnutí
```

## De-duplication

Each processed report gets `notified: true` written back via the Admin SDK, so re-running (or
overlapping GitHub / local runs) never double-sends.
