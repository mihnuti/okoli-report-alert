# okoli-report-alert

Standalone script that checks the `reports` Firestore collection (project `okoli-52bf6`) for
new user reports from the Okolí app and e-mails an alert (including a 60-minute chat transcript).
No Firebase Blaze plan / Cloud Functions needed.

Runs on **GitHub Actions** on a schedule (`.github/workflows/check-reports.yml`, hourly) so it
does not depend on any local machine being on. Can also be run by hand.

## Secrets (repo → Settings → Secrets and variables → Actions)

| secret | value |
| --- | --- |
| `SERVICE_ACCOUNT_JSON` | the entire Firebase service-account key JSON, pasted as one value (Firebase Console → Project settings → Service accounts → Generate new private key) |
| `GMAIL_USER` | `sejbalove@gmail.com` |
| `GMAIL_APP_PASSWORD` | 16-char Gmail App Password (Google Account → Security → 2-Step Verification → App passwords), **not** the account password — revocable any time |
| `ALERT_TO_EMAIL` | where alerts go (can equal `GMAIL_USER`) |

## Run by hand

```
npm install
# either export SERVICE_ACCOUNT_JSON=... plus the GMAIL_* / ALERT_TO_EMAIL vars,
# or drop a service-account.json + .env next to the script (both gitignored)
node check-reports.js
```

## De-duplication

Each processed report gets `notified: true` written back via the Admin SDK, so re-running (or
overlapping GitHub / local runs) never double-sends.
