// Netlify function: keeps your Gemini key on the server.
const SYS = (mode, level, subject) => mode === "quick"
  ? `You are StudyPal, an expert in Maths, Physics, Chemistry, Computer Science and AI/ML. Student level: ${level}. Subject hint: ${subject}. Solve the problem directly and finish in 4-5 short lines maximum: no step-by-step walkthrough, no headings. Give the key working in one line if needed, then clearly state the final answer (with units). Write maths in plain readable text/Unicode, never LaTeX. Code only in a short fenced block if required.`
  : `You are StudyPal, an expert tutor for Maths, Physics, Chemistry, Computer Science and AI/ML.
Student level: ${level}. Subject hint: ${subject}.
For a problem, answer in this structure:
## Understanding the problem (what is given, what is asked, which concept applies)
## Step 1 — <short title> ... Step n: for each step say what we do, WHY we do it, and show the calculation or code.
## Final answer (clearly stated, with units where relevant)
## Quick check (verify or sanity-test the result)
## Key idea to remember (1-2 lines)
Match depth to the level: Beginner = tiny steps, plain words, define terms, analogies; High school = standard textbook steps; Undergraduate = derivations and theory links; Advanced = rigorous and concise.
Write maths in plain readable text/Unicode (x², √, ∫, ∑, →, ×), never LaTeX. Put code in fenced code blocks. If a photo or PDF is unclear, say what you could not read and ask. For follow-up questions be brief and focused. If the question is not study-related, gently steer back.`;

const reply = (code, obj) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "POST only" });
  const need = process.env.ACCESS_CODE;
  if (need && event.headers["x-access-code"] !== need) return reply(401, { error: "Access code needed" });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return reply(500, { error: "GEMINI_API_KEY is not set in Netlify environment variables." });

  let b;
  try { b = JSON.parse(event.body); } catch { return reply(400, { error: "Bad request" }); }

  const mode = b.mode === "quick" ? "quick" : "steps";
  const model = mode === "quick"
    ? (process.env.GEMINI_MODEL_QUICK || process.env.GEMINI_MODEL || "gemini-3.1-flash-lite")
    : (process.env.GEMINI_MODEL_STEPS || process.env.GEMINI_MODEL || "gemini-3-flash-preview");

  const contents = (Array.isArray(b.history) ? b.history : []).slice(-8).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "").slice(0, 8000) }]
  }));
  const parts = [{ text: String(b.text || "").slice(0, 12000) }];
  for (const f of (Array.isArray(b.files) ? b.files : []).slice(0, 4)) {
    parts.push({ inline_data: { mime_type: f.mime, data: f.data } });
  }
  contents.push({ role: "user", parts });

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYS(mode, String(b.level || "High school").slice(0, 120), String(b.subject || "Auto").slice(0, 30)) }] },
        contents,
        generationConfig: { temperature: 0.3 }
      })
    });
    const j = await r.json();
    if (!r.ok) return reply(502, { error: (j.error && j.error.message) || "Gemini error " + r.status });
    const text = (((j.candidates || [])[0] || {}).content || {}).parts;
    const out = (text || []).map(p => p.text || "").join("").trim();
    if (!out) return reply(502, { error: "Gemini returned no answer (it may have been blocked). Try rephrasing." });
    return reply(200, { text: out });
  } catch (e) {
    return reply(502, { error: "Could not reach Gemini: " + e.message });
  }
};
