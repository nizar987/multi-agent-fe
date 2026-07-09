/**
 * Temporary script — query Stock Ledger Entry from WMS Prod (MariaDB).
 * Run via: node scripts/query-wms.mjs
 *
 * Password is read from secrets.json plainB64 slot (conn:14).
 * If encrypted, you must supply DB_PASSWORD env var instead.
 */
import { createConnection } from "mysql2/promise";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SECRETS_PATH = join(
  homedir(),
  "Library/Application Support/agent-platform-desktop/data/secrets.json"
);

function getPassword() {
  // Allow override via env
  if (process.env.DB_PASSWORD) return process.env.DB_PASSWORD;
  try {
    const secrets = JSON.parse(readFileSync(SECRETS_PATH, "utf8"));
    const slot = secrets["conn:14"];
    if (slot?.scheme === "plainB64") {
      return Buffer.from(slot.enc, "base64").toString("utf8");
    }
  } catch {}
  return null;
}

const password = getPassword();
if (!password) {
  console.error(
    "❌ Could not read password. Set DB_PASSWORD env var:\n" +
    "   DB_PASSWORD='yourpassword' node scripts/query-wms.mjs"
  );
  process.exit(1);
}

const conn = await createConnection({
  host: "praktis-prod-maria.cmui5apn4ceo.ap-southeast-3.rds.amazonaws.com",
  port: 3306,
  user: "p_nizar_dev",
  password,
  database: "_1f57fe9c2a5b9083",
  ssl: false,
  connectTimeout: 15_000,
});

try {
  const [rows] = await conn.query(
    `SELECT
      sle.name,
      sle.posting_date,
      sle.posting_time,
      sle.voucher_type,
      sle.voucher_no,
      sle.item_code,
      sle.item_name,
      sle.warehouse,
      sle.actual_qty,
      sle.qty_after_transaction,
      sle.incoming_rate,
      sle.valuation_rate,
      sle.stock_value,
      sle.stock_value_difference,
      sle.company
    FROM \`tabStock Ledger Entry\` sle
    WHERE
      sle.posting_date = '2026-07-06'
      AND sle.voucher_type = 'Delivery Note'
      AND sle.is_cancelled = 0
    ORDER BY sle.posting_time, sle.creation
    LIMIT 100`
  );

  if (!rows.length) {
    console.log("⚠️  No records found for 2026-07-06 with voucher_type = 'Delivery Note'.");
    console.log("\nChecking distinct voucher_types on that date...");
    const [vt] = await conn.query(
      `SELECT DISTINCT voucher_type, COUNT(*) as cnt
       FROM \`tabStock Ledger Entry\`
       WHERE posting_date = '2026-07-06' AND is_cancelled = 0
       GROUP BY voucher_type
       ORDER BY cnt DESC`
    );
    console.table(vt);
  } else {
    console.log(`✅ Found ${rows.length} rows:\n`);
    console.table(rows);
  }
} finally {
  await conn.end();
}
