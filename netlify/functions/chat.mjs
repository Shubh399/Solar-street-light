export const config = { path: "/api/chat" };

const SYSTEM_PROMPT =
  "You are Solar.AI, an assistant for an ESP32 solar smart street-light project. " +
  "Use only the supplied live telemetry and stored history; never invent a measurement, confidence score, or a model result. " +
  "Return ONLY valid JSON with this shape: {\"summary\":\"short assessment\",\"features\":[{\"id\":\"traffic|hysteresis|servo|cloud|motion|battery|soiling|tracking\",\"value\":\"a concise result with real number(s), or Insufficient live data\",\"alert\":\"short alert\",\"level\":\"|warn|danger|muted\"}]}. " +
  "Include exactly these eight ids once each. For motion classification, battery forecasting, soiling, and tracking optimization, identify missing history or measurements as insufficient data when needed. " +
  "These are Groq inferences, not outputs from trained on-device TinyML, autoencoder, or reinforcement models.";

const DEFAULT_MODEL = "openai/gpt-oss-120b";
const MAX_MESSAGE_CHARS = 4000;
const MAX_TELEMETRY_CHARS = 16000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function parseAssessment(content) {
  if (typeof content !== "string") return null;
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const assessment = JSON.parse(cleaned);
    if (!Array.isArray(assessment?.features)) return null;
    const allowed = new Set(["traffic", "hysteresis", "servo", "cloud", "motion", "battery", "soiling", "tracking"]);
    const features = assessment.features.filter(item => item && allowed.has(item.id)).map(item => ({
      id: item.id,
      value: typeof item.value === "string" ? item.value.slice(0, 220) : "Insufficient live data",
      alert: typeof item.alert === "string" ? item.alert.slice(0, 80) : "Needs review",
      level: ["", "warn", "danger", "muted"].includes(item.level) ? item.level : "muted"
    }));
    return features.length === 8 ? { summary: typeof assessment.summary === "string" ? assessment.summary : "Groq assessment completed.", features } : null;
  } catch {
    return null;
  }
}

export default async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405);
  }

  // Reads GROQ_API_KEY from .env (local) or Netlify environment variables (live).
  const apiKey = Netlify.env.get("GROQ_API_KEY");
  if (!apiKey) {
    return json({
      error: "GROQ_API_KEY is not set. Add it to .env for local testing, or to Netlify → Environment variables and redeploy."
    }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "A message is required." }, 400);
  if (message.length > MAX_MESSAGE_CHARS) {
    return json({ error: `Message is too long (maximum ${MAX_MESSAGE_CHARS} characters).` }, 400);
  }

  let telemetry = "{}";
  try {
    telemetry = JSON.stringify(body?.context?.device ?? body?.context ?? {});
  } catch {
    telemetry = "{}";
  }
  if (telemetry.length > MAX_TELEMETRY_CHARS) {
    telemetry = telemetry.slice(0, MAX_TELEMETRY_CHARS) + "…[truncated]";
  }

  const model = Netlify.env.get("GROQ_MODEL") || DEFAULT_MODEL;

  try {
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Question: ${message}\n\nCurrent device telemetry (JSON):\n${telemetry}`
          }
        ],
        temperature: 0.4,
        max_completion_tokens: 1200
      })
    });

    const result = await groqResponse.json().catch(() => ({}));

    if (!groqResponse.ok) {
      const detail = result?.error?.message || `Groq returned HTTP ${groqResponse.status}.`;
      return json({ error: detail }, 502);
    }

    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return json({ error: "Groq returned an empty response." }, 502);
    }
    const assessment = parseAssessment(content);
    if (!assessment) return json({ error: "Groq did not return a complete structured assessment. Please try again." }, 502);
    return json({ reply: assessment.summary, predictions: assessment.features });
  } catch (error) {
    return json({ error: error?.message || "Unable to reach Groq." }, 502);
  }
};
