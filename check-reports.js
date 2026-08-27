// Standalone script — NOT part of the Android app. Checks the okoli-52bf6 Firestore `reports`
// collection for reports not yet e-mailed, sends one alert e-mail per new report, then marks each
// as notified. Meant to run periodically via Windows Task Scheduler (see README.md).
//
// Uses the Firebase Admin SDK, which authenticates via a service-account key and bypasses
// Firestore security rules entirely — that's expected and required here: the app's own rules say
// `allow read: if false` on `reports` (nobody using the app can read them back), but this script
// isn't the app, it's the developer's own tooling running with elevated credentials.
const path = require('path');
// Explicit path (not just require('dotenv').config()) so this finds .env next to the script
// regardless of the process's working directory — matters for Task Scheduler, which doesn't
// necessarily start in this folder.
require('dotenv').config({ path: path.join(__dirname, '.env') });
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

const REASON_LABELS = {
  harassment: 'Obtěžování nebo nevhodné chování',
  child_safety: 'Podezření na zneužívání / ohrožení dítěte',
  spam: 'Spam nebo zneužití appky',
  other: 'Jiné',
};

async function main() {
  // Service account: prefer SERVICE_ACCOUNT_JSON (the whole key as a single env var — how CI
  // supplies it, so no key file is ever committed), fall back to a local file for hand runs.
  let serviceAccount;
  if (process.env.SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
  } else {
    const serviceAccountPath = path.resolve(__dirname, process.env.SERVICE_ACCOUNT_PATH || './service-account.json');
    serviceAccount = require(serviceAccountPath);
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  const db = admin.firestore();

  // Fetch the whole collection and filter in memory rather than `.where('notified', '!=', true)`
  // — Firestore's inequality operators skip any document missing the field entirely, and a
  // freshly submitted report never has `notified` set (only this script sets it, after sending),
  // so that filter would silently never match anything. Fine at this collection's expected size.
  const allDocs = (await db.collection('reports').get()).docs;
  const unnotified = allDocs.filter((doc) => doc.data().notified !== true);

  if (unnotified.length === 0) {
    console.log(`[${new Date().toISOString()}] No new reports.`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  console.log(`[${new Date().toISOString()}] ${unnotified.length} new report(s) found.`);

  for (const doc of unnotified) {
    const report = doc.data();
    const reasonLabel = REASON_LABELS[report.reason] || report.reason || '(neuvedeno)';
    const when = report.timestamp?.toDate?.().toISOString() || '(neznámý čas)';
    // `transcript` is a best-effort snapshot taken client-side at report time (see
    // ReportRepository.fetchRecentTranscript) — older reports predating that field, or ones where
    // the fetch itself failed, won't have it.
    const transcript = Array.isArray(report.transcript) && report.transcript.length > 0
      ? report.transcript.join('\n')
      : '(žádný přepis konverzace — chat byl prázdný nebo se ho nepodařilo načíst)';
    const body = [
      `Nová nahlášení v appce Okolí`,
      ``,
      `Důvod: ${reasonLabel}`,
      `Upřesnění: ${report.details?.trim() ? report.details : '(žádné)'}`,
      ``,
      `Nahlášený uživatel: ${report.reportedNickname} (uid: ${report.reportedUid})`,
      `Nahlásil: uid ${report.reporterUid}`,
      `Lokace (geohash7): ${report.locationId}`,
      `Ping id: ${report.pingId}`,
      `Čas nahlášení: ${when}`,
      ``,
      `--- Přepis konverzace (posledních 60 min v dané lokaci) ---`,
      transcript,
      `--- konec přepisu ---`,
      ``,
      `Firestore doc: reports/${doc.id}`,
      `https://console.firebase.google.com/project/okoli-52bf6/firestore/data/~2Freports~2F${doc.id}`,
    ].join('\n');

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.ALERT_TO_EMAIL,
      subject: `[Okolí] Nové nahlášení – ${reasonLabel}`,
      text: body,
    });

    await doc.ref.update({ notified: true, notifiedAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`[${new Date().toISOString()}] Alerted + marked notified: reports/${doc.id}`);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] check-reports failed:`, err);
  process.exitCode = 1;
});
