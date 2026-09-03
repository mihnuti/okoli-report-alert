// Samostatný skript — NENÍ součástí Android appky. Prochází Firestore kolekci `nahlaseni`
// projektu mihnuti-398ef, pošle jeden e-mail za každé dosud neoznámené nahlášení a označí ho
// `notified: true`. Běhá periodicky přes GitHub Actions (repo mihnuti/okoli-report-alert,
// společné s Okolím) a jako záloha přes Windows Task Scheduler (viz README.md).
//
// Používá Firebase Admin SDK — autentizuje se service-account klíčem a obchází Firestore
// pravidla úplně. To je tady záměr: appka do `nahlaseni` jen zapisuje (`allow read: if false`),
// číst je smí jen správce přes konzoli nebo tohle vývojářské tooling s elevovanými právy.
const path = require('path');
// Explicitní cesta (ne jen require('dotenv').config()) aby to našlo .env vedle skriptu bez
// ohledu na pracovní adresář — kvůli Task Scheduleru, který nemusí startovat v této složce.
require('dotenv').config({ path: path.join(__dirname, '.env') });
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

const PROJECT_ID = 'mihnuti-398ef';
const KOLEKCE = 'nahlaseni';

async function main() {
  // Service account: přednostně SERVICE_ACCOUNT_JSON (celý klíč jako jedna env proměnná — tak
  // ho dodává CI, aby se žádný soubor s klíčem necommitoval), jinak lokální soubor pro ruční běh.
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

  // Načteme celou kolekci a filtrujeme v paměti místo `.where('notified', '!=', true)` —
  // Firestore nerovnostní operátory přeskočí dokument, kterému pole úplně chybí, a čerstvé
  // nahlášení `notified` nemá (nastaví ho jen tenhle skript po odeslání), takže by ten filtr
  // nikdy nic nenašel. Při očekávané velikosti kolekce v pohodě.
  const allDocs = (await db.collection(KOLEKCE).get()).docs;
  const unnotified = allDocs.filter((doc) => doc.data().notified !== true);

  if (unnotified.length === 0) {
    console.log(`[${new Date().toISOString()}] Žádná nová nahlášení.`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  console.log(`[${new Date().toISOString()}] ${unnotified.length} nové/ých nahlášení.`);

  for (const doc of unnotified) {
    const n = doc.data();
    const duvod = typeof n.duvod === 'string' && n.duvod.trim() ? n.duvod.trim() : '(žádný uveden)';
    // `casMs` je uložený jako číslo (System.currentTimeMillis()), ne Firestore Timestamp.
    const kdy = Number.isFinite(n.casMs) ? new Date(n.casMs).toISOString() : '(neznámý čas)';

    // Track record nahlašujícího. Uid, které podalo hodně hlášení, zvlášť na hodně různých
    // cílů, je spíš serial / falešný reportér — posuzuj podle toho a nikdy nejednej podle
    // jednoho neověřeného. Počítáno za celou dobu z celé kolekce, včetně tohohle hlášení.
    const odTohotoReportera = allDocs.filter((d) => d.data().nahlasilAutorId === n.nahlasilAutorId);
    const ruznychCilu = new Set(odTohotoReportera.map((d) => d.data().nahlasenAutorId)).size;
    const reporterFlag = odTohotoReportera.length >= 5
      ? '  !! hodně hlášení od jednoho uid — prověř, jestli to není serial / falešný reportér'
      : null;

    const body = [
      `Nové nahlášení v appce Mihnutí`,
      ``,
      `Důvod: ${duvod}`,
      ``,
      `Nahlášený autor (uid): ${n.nahlasenAutorId}`,
      `Nahlásil (uid): ${n.nahlasilAutorId}`,
      `Historie reportéra: ${odTohotoReportera.length} hlášení celkem, na ${ruznychCilu} různých autorů`,
      reporterFlag,
      `Čas nahlášení: ${kdy}`,
      ``,
      `Appka nemá tlačítko na vzdálené smazání/blokování cizího vzkazu — nahlášení posuzuje a`,
      `řeší ručně správce přes Firebase konzoli.`,
      ``,
      `Firestore doc: ${KOLEKCE}/${doc.id}`,
      `https://console.firebase.google.com/project/${PROJECT_ID}/firestore/data/~2F${KOLEKCE}~2F${doc.id}`,
    ].filter((line) => line !== null).join('\n');

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.ALERT_TO_EMAIL,
      subject: `[Mihnutí] Nové nahlášení`,
      text: body,
    });

    await doc.ref.update({ notified: true, notifiedAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log(`[${new Date().toISOString()}] Odesláno + označeno notified: ${KOLEKCE}/${doc.id}`);
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] check-reports selhalo:`, err);
  process.exitCode = 1;
});
