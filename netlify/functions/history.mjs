import { getHistoryCounts, loadRecentHistory, saveHistory } from "../lib/history.mjs";

export const config = { path: "/api/history" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export default async (request) => {
  if (request.method === "GET") {
    try {
      const url = new URL(request.url);
      const telemetryLimit = Number(url.searchParams.get("telemetryLimit")) || 48;
      const predictionLimit = Number(url.searchParams.get("predictionLimit")) || 12;
      const data = await loadRecentHistory({ telemetryLimit, predictionLimit });
      return json({ ...data, storage: "postgresql" }, 200);
    } catch (error) {
      return json({ error: error?.message || "Unable to load history from PostgreSQL." }, 500);
    }
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed. Use GET or POST." }, 405);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Request body must be valid JSON." }, 400); }

  const telemetry = Array.isArray(body?.telemetry) ? body.telemetry : [];
  const predictions = Array.isArray(body?.predictions) ? body.predictions : [];
  if (!telemetry.length && !predictions.length) {
    return json({ error: "Provide telemetry or predictions to store." }, 400);
  }

  try {
    const saved = await saveHistory({ telemetry, predictions });
    const counts = await getHistoryCounts();
    return json({ saved, counts, storage: "postgresql" }, 201);
  } catch (error) {
    return json({ error: error?.message || "Unable to store history in PostgreSQL." }, 500);
  }
};
