import { getStore } from "@netlify/blobs";

const STORE_NAME = "solar-ai-history";
const MAX_TELEMETRY_BATCH = 250;
const MAX_PREDICTION_BATCH = 100;

function store() { return getStore(STORE_NAME); }

function safePart(value, fallback) {
  const cleaned = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(0, 100) || fallback;
}

function recordKey(type, record, index) {
  const timestamp = new Date(record?.savedAt || Date.now()).toISOString();
  const device = safePart(record?.device?.device || record?.deviceId, "device01");
  return `${type}/${device}/${safePart(`${timestamp}-${index}`, String(index))}`;
}

function validRecord(record) { return record && typeof record === "object" && !Array.isArray(record); }

export async function saveHistory({ telemetry = [], predictions = [] }) {
  const validTelemetry = telemetry.filter(validRecord).slice(0, MAX_TELEMETRY_BATCH);
  const validPredictions = predictions.filter(validRecord).slice(0, MAX_PREDICTION_BATCH);
  const entries = [
    ...validTelemetry.map((record, index) => ({ type: "telemetry", record, index })),
    ...validPredictions.map((record, index) => ({ type: "predictions", record, index }))
  ];
  const historyStore = store();
  await Promise.all(entries.map(({ type, record, index }) => historyStore.setJSON(recordKey(type, record, index), record)));
  return { telemetry: validTelemetry.length, predictions: validPredictions.length };
}

async function loadNewest(type, limit) {
  const historyStore = store();
  const { blobs } = await historyStore.list({ prefix: `${type}/` });
  const newest = blobs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, limit);
  const records = await Promise.all(newest.map(blob => historyStore.get(blob.key, { type: "json" })));
  return records.filter(validRecord).sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
}

export async function loadRecentHistory({ telemetryLimit = 48, predictionLimit = 12 } = {}) {
  const [telemetryHistory, predictionHistory] = await Promise.all([
    loadNewest("telemetry", telemetryLimit), loadNewest("predictions", predictionLimit)
  ]);
  return { telemetryHistory, predictionHistory };
}
