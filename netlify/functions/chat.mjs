export default async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "GROQ_API_KEY is not configured in Netlify environment variables." },
      { status: 500 }
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json({ error: "A message is required." }, { status: 400 });
  }
  if (message.length > 4000) {
    return Response.json({ error: "Message is too long (maximum 4,000 characters)." }, { status: 400 });
  }
  let telemetry;
  try {
    telemetry = JSON.stringify(body?.context?.device ?? body?.context ?? {});
  } catch {
    telemetry = "{}";
  }
  if (telemetry.length > 16000) telemetry = telemetry.slice(0, 16000) + "…[truncated]";
  try {
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        // Override this in Netlify with GROQ_MODEL if you want another supported model.
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content: "You are Solar.AI, an assistant for an ESP32 solar smart street-light project. Explain the supplied telemetry, battery readings, lighting automation, solar tracking, MQTT, and troubleshooting. Be clear about uncertainty. Never invent sensor readings or claim that a model ran when no model output was supplied."
          },
          {
            role: "user",
            content: `Question: ${message}

Current device telemetry (JSON):
${telemetry}`
          }
        ],
        temperature: 0.4,
        max_completion_tokens: 1200
      })
    });
    const result = await groqResponse.json().catch(() => ({}));
    if (!groqResponse.ok) {
      const detail = result?.error?.message || `Groq returned HTTP ${groqResponse.status}.`;
      return Response.json({ error: detail }, { status: 502 });
    }
    const reply = result?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return Response.json({ error: "Groq returned an empty response." }, { status: 502 });
    }
    return Response.json({ reply });
  } catch (error) {
    return Response.json(
      { error: error?.message || "Unable to reach Groq." },
      { status: 502 }
    );
  }
};
