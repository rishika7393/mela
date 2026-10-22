// Proxies the app's reads and writes to Baserow so the database token
// stays on the server. Served at /api/movies.
//
// Environment variables (Netlify > Site configuration > Environment variables):
//   BASEROW_TOKEN     required  Database token from Baserow (Settings > Database tokens)
//   BASEROW_TABLE_ID  required  Numeric id of your Movies table
//   BASEROW_URL       optional  Only if self-hosting. Defaults to https://api.baserow.io
//   APP_PASSCODE      optional  If set, the app asks for this passcode before loading

export const config = { path: "/api/movies" };

// App field -> Baserow column name. Change the right-hand side if you
// rename columns in Baserow.
const FIELD = {
  year: "Year",
  title: "Movie",
  status: "Status",
  genre: "Genre",
  imdb: "IMDb",
  rt: "Rotten Tomatoes",
  cast: "Cast",
  fact: "Interesting Fact",
  mood: "Mood",
  seen: "Seen",
  seenOn: "Seen On",
  opinion: "Opinion",
  companion: "Companion",
  queue: "Queue",
};

// Only these fields can be changed from the app.
const WRITABLE = ["seen", "seenOn", "opinion", "companion", "queue"];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Single-select fields come back as { id, value, color }.
const val = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v.value : v);
const num = (v) => {
  const n = parseFloat(String(val(v) ?? "").replace("%", ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (val(v) == null ? "" : String(val(v)));
const bool = (v) => v === true || ["true", "1", "yes"].includes(str(v).toLowerCase());

const toMovie = (r) => ({
  id: r.id,
  year: num(r[FIELD.year]),
  title: str(r[FIELD.title]),
  status: str(r[FIELD.status]),
  genre: str(r[FIELD.genre]),
  imdb: num(r[FIELD.imdb]),
  rt: num(r[FIELD.rt]),
  cast: str(r[FIELD.cast]),
  fact: str(r[FIELD.fact]),
  mood: str(r[FIELD.mood]),
  seen: bool(r[FIELD.seen]),
  seenOn: str(r[FIELD.seenOn]),
  opinion: str(r[FIELD.opinion]),
  companion: str(r[FIELD.companion]),
  queue: num(r[FIELD.queue]),
});

const clean = (key, v) => {
  switch (key) {
    case "seen":
      return Boolean(v);
    case "seenOn":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
    case "queue":
      return v === null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));
    default:
      return String(v ?? "").slice(0, 10000);
  }
};

async function upstreamError(res) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body.detail ? JSON.stringify(body.detail) : body.error || "";
  } catch {}
  const message =
    res.status === 401
      ? "Baserow rejected the token. Check BASEROW_TOKEN and that it has read and update access to this table."
      : res.status === 404
      ? "Baserow couldn't find that table. Check BASEROW_TABLE_ID."
      : `Baserow returned ${res.status}${detail ? `: ${detail}` : ""}`;
  return json({ error: "baserow", message }, 502);
}

export default async (req) => {
  const token = process.env.BASEROW_TOKEN;
  const table = process.env.BASEROW_TABLE_ID;
  const base = (process.env.BASEROW_URL || "https://api.baserow.io").replace(/\/$/, "");

  if (!token || !table) {
    return json(
      { error: "not_configured", message: "Set BASEROW_TOKEN and BASEROW_TABLE_ID in Netlify." },
      503
    );
  }

  const passcode = (process.env.APP_PASSCODE || "").trim();
  let sent = req.headers.get("x-app-passcode") || "";
  try { sent = decodeURIComponent(sent); } catch {}
  if (passcode && sent.trim() !== passcode) {
    return json({ error: "passcode", message: "Enter the passcode to continue." }, 401);
  }

  const headers = { Authorization: `Token ${token}`, "Content-Type": "application/json" };

  try {
    if (req.method === "GET") {
      const rows = [];
      let url = `${base}/api/database/rows/table/${table}/?user_field_names=true&size=200`;
      while (url) {
        const res = await fetch(url, { headers });
        if (!res.ok) return upstreamError(res);
        const page = await res.json();
        rows.push(...page.results);
        url = page.next ? page.next.replace(/^http:/, "https:") : null;
      }
      return json({ movies: rows.map(toMovie) });
    }

    if (req.method === "PATCH") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "bad_request", message: "Request body must be JSON." }, 400);
      }
      const updates = Array.isArray(body?.updates) ? body.updates : [];
      if (!updates.length) return json({ error: "bad_request", message: "No updates sent." }, 400);
      if (updates.length > 200)
        return json({ error: "bad_request", message: "Send at most 200 updates at once." }, 400);

      const items = updates.map((u) => {
        const item = { id: Number(u.id) };
        for (const key of WRITABLE) if (key in u) item[FIELD[key]] = clean(key, u[key]);
        return item;
      });

      const res = await fetch(
        `${base}/api/database/rows/table/${table}/batch/?user_field_names=true`,
        { method: "PATCH", headers, body: JSON.stringify({ items }) }
      );
      if (!res.ok) return upstreamError(res);
      const data = await res.json();
      return json({ movies: data.items.map(toMovie) });
    }

    return json({ error: "method_not_allowed", message: "Use GET or PATCH." }, 405);
  } catch (err) {
    return json({ error: "network", message: `Couldn't reach Baserow: ${err.message}` }, 502);
  }
};
