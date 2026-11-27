import { neon } from "@neondatabase/serverless";

const MAX_TELEMETRY_BATCH = 250;
const MAX_PREDICTION_BATCH = 100;

let schemaReadyPromise = null;

function getEnv(name) {
  if (typeof Netlify !== "undefined" && Netlify?.env?.get) {
    const val = Netlify.env.get(name);
    if (val) return val;
  }
  return process.env[name];
}

function getSql() {
  const databaseUrl = getEnv("DATABASE_URL");
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured in environment variables.");
  }
  return neon(databaseUrl);
}

async function ensureSchema(sql) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS telemetry_records (
          id BIGSERIAL PRIMARY KEY,
          device_id TEXT NOT NULL DEFAULT 'device01',
          saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          payload JSONB NOT NULL
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_telemetry_device_saved
        ON telemetry_records (device_id, saved_at DESC, id DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS prediction_records (
          id BIGSERIAL PRIMARY KEY,
          device_id TEXT NOT NULL DEFAULT 'device01',
          saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          question TEXT NOT NULL,
          reply TEXT NOT NULL,
          predictions JSONB,
          payload JSONB
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_prediction_saved
        ON prediction_records (saved_at DESC, id DESC)
      `;
    })().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  await schemaReadyPromise;
}

function validRecord(record) {
  return record && typeof record === "object" && !Array.isArray(record);
}

function toIsoTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function extractDeviceId(record) {
  const raw = record?.device?.device || record?.deviceId || record?.device_id || "device01";
  return String(raw).slice(0, 100) || "device01";
}

export async function getHistoryCounts() {
  const sql = getSql();
  await ensureSchema(sql);
  const [telemetryCount] = await sql`SELECT COUNT(*)::int AS count FROM telemetry_records`;
  const [predictionCount] = await sql`SELECT COUNT(*)::int AS count FROM prediction_records`;
  return {
    telemetry: telemetryCount?.count ?? 0,
    predictions: predictionCount?.count ?? 0,
    total: (telemetryCount?.count ?? 0) + (predictionCount?.count ?? 0)
  };
}

export async function saveHistory({ telemetry = [], predictions = [] }) {
  const sql = getSql();
  await ensureSchema(sql);

  const validTelemetry = telemetry.filter(validRecord).slice(0, MAX_TELEMETRY_BATCH);
  const validPredictions = predictions.filter(validRecord).slice(0, MAX_PREDICTION_BATCH);

  for (const record of validTelemetry) {
    const deviceId = extractDeviceId(record);
    const savedAt = toIsoTimestamp(record.savedAt);
    const payload = JSON.stringify(record.device ?? record);
    await sql`
      INSERT INTO telemetry_records (device_id, saved_at, payload)
      VALUES (${deviceId}, ${savedAt}::timestamptz, ${payload}::jsonb)
    `;
  }

  for (const record of validPredictions) {
    const deviceId = extractDeviceId(record);
    const savedAt = toIsoTimestamp(record.savedAt);
    const question = typeof record.question === "string" ? record.question : "";
    const reply = typeof record.reply === "string" ? record.reply : "";
    const predictionsJson = record.predictions ? JSON.stringify(record.predictions) : null;
    const payloadJson = JSON.stringify(record);
    await sql`
      INSERT INTO prediction_records (device_id, saved_at, question, reply, predictions, payload)
      VALUES (
        ${deviceId},
        ${savedAt}::timestamptz,
        ${question},
        ${reply},
        ${predictionsJson}::jsonb,
        ${payloadJson}::jsonb
      )
    `;
  }

  return { telemetry: validTelemetry.length, predictions: validPredictions.length };
}

export async function loadRecentHistory({ telemetryLimit = 48, predictionLimit = 12 } = {}) {
  const sql = getSql();
  await ensureSchema(sql);

  const safeTelLimit = Math.max(1, Math.min(250, Number(telemetryLimit) || 48));
  const safePredLimit = Math.max(1, Math.min(100, Number(predictionLimit) || 12));

  const [telemetryRows, predictionRows, counts] = await Promise.all([
    sql`
      SELECT saved_at, payload
      FROM telemetry_records
      ORDER BY saved_at DESC, id DESC
      LIMIT ${safeTelLimit}
    `,
    sql`
      SELECT saved_at, question, reply, predictions
      FROM prediction_records
      ORDER BY saved_at DESC, id DESC
      LIMIT ${safePredLimit}
    `,
    getHistoryCounts()
  ]);

  const telemetryHistory = telemetryRows
    .reverse()
    .map((row) => ({
      savedAt: new Date(row.saved_at).toISOString(),
      device: row.payload?.device ?? row.payload
    }));

  const predictionHistory = predictionRows
    .reverse()
    .map((row) => ({
      savedAt: new Date(row.saved_at).toISOString(),
      question: row.question,
      reply: row.reply,
      predictions: row.predictions || undefined
    }));

  return { telemetryHistory, predictionHistory, counts };
}
