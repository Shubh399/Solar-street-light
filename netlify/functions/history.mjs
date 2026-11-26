import { saveHistory } from "../lib/history.mjs";

export const config = { path: "/api/history" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export default async request => {
  if (request.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Request body must be valid JSON." }, 400); }
  const telemetry = Array.isArray(body?.telemetry) ? body.telemetry : [];
  const predictions = Array.isArray(body?.predictions) ? body.predictions : [];
  if (!telemetry.length && !predictions.length) return json({ error: "Provide telemetry or predictions to store." }, 400);
  try { return json({ saved: await saveHistory({ telemetry, predictions }), storage: "permanent" }, 201); }
  catch (error) { return json({ error: error?.message || "Unable to store history." }, 500); }
};
