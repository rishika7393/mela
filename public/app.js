(() => {
  "use strict";

  const MOODS = [
    { name: "Thought-Provoking", color: "#8fb3e0" },
    { name: "Intense", color: "#e68a73" },
    { name: "Somber", color: "#aaa2cc" },
    { name: "Uplifting", color: "#a5d6a0" },
    { name: "Escapist", color: "#e6a3cf" },
  ];
  const moodColor = (m) => (MOODS.find((x) => x.name === m) || {}).color || "var(--muted)";

  const ICON = {
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    search: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    tv: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 5.8v3.4L9.5 7.5z" fill="currentColor"/><path d="M5 14h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    grip: '<svg viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></g></svg>',
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fmtImdb = (v) => (v == null ? "–" : Number(v).toFixed(1));
  // The list stores the ceremony year; films are released the year before.
  const releaseYear = (m) => (m.year ? m.year - 1 : "");
  const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const formatDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  const state = {
    movies: [],
    demo: false,
    view: "all",
    mood: "all",
    seenFilter: "all",
    winnersOnly: false,
    q: "",
    sort: "year-desc",
    openId: null,
  };
  const byId = (id) => state.movies.find((m) => m.id === id);
  const queued = () => state.movies.filter((m) => m.queue != null).sort((a, b) => a.queue - b.queue);

  /* ---------------- API ---------------- */

  const PASS_KEY = "nominated-passcode";
  const getPass = () => { try { return localStorage.getItem(PASS_KEY) || ""; } catch { return ""; } };
  const setPass = (v) => { try { localStorage.setItem(PASS_KEY, v); } catch {} };

  async function request(method, body) {
    const res = await fetch("/api/movies", {
      method,
      headers: { "Content-Type": "application/json", "x-app-passcode": encodeURIComponent(getPass()) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401 && data.error === "passcode") {
      const p = await askPasscode(Boolean(getPass()));
      if (p === null) {
        const err = new Error("A passcode is needed to open this list.");
        err.code = "passcode_cancelled";
        throw err;
      }
      setPass(p);
      return request(method, body);
    }
    if (!res.ok) {
      const err = new Error(data.message || `The server returned ${res.status}.`);
      err.code = data.error || "http";
      throw err;
    }
    return data;
  }

  function askPasscode(wasWrong) {
    const dlg = $("#passDialog");
    $("#passMsg").textContent = wasWrong ? "That passcode didn't work. Try again." : "This list is private.";
    $("#passInput").value = "";
    dlg.returnValue = "";
    dlg.showModal();
    return new Promise((resolve) => {
      dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok" ? $("#passInput").value.trim() : null), { once: true });
    });
  }

  // Optimistic update: change local state, then persist. Undo on failure.
  async function save(changes) {
    changes = changes.filter(Boolean);
    if (!changes.length) return true;
    const before = changes.map((c) => ({ ...byId(c.id) }));
    for (const c of changes) Object.assign(byId(c.id), c);
    render();
    if (state.demo) return true;
    try {
      const data = await request("PATCH", { updates: changes });
      for (const m of data.movies) Object.assign(byId(m.id) || {}, m);
      render();
      return true;
    } catch (err) {
      for (const b of before) Object.assign(byId(b.id), b);
      render();
      toast(`Couldn't save to Baserow: ${err.message} Your change was undone.`, true);
      return false;
    }
  }

  /* ---------------- Actions ---------------- */

  const renumber = (ids) => ids.map((id, i) => ({ id, queue: i + 1 })).filter((c) => byId(c.id).queue !== c.queue);

  async function addToQueue(id) {
    const ids = queued().map((m) => m.id).filter((x) => x !== id);
    ids.push(id);
    if (await save(renumber(ids))) toast(`Added ${byId(id).title} to watch next.`);
  }

  async function removeFromQueue(id, extra = {}) {
    const ids = queued().map((m) => m.id).filter((x) => x !== id);
    return save([{ id, queue: null, ...extra }, ...renumber(ids)]);
  }

  async function toggleQueue(id) {
    const m = byId(id);
    if (m.queue != null) {
      if (await removeFromQueue(id)) toast(`Removed ${m.title} from watch next.`);
    } else {
      await addToQueue(id);
    }
  }

  async function toggleSeen(id) {
    const m = byId(id);
    if (!m.seen) {
      const extra = { seen: true, seenOn: m.seenOn || today() };
      if (m.queue != null) {
        if (await removeFromQueue(id, extra)) toast(`Marked ${m.title} as seen and took it off watch next.`);
      } else if (await save([{ id, ...extra }])) {
        toast(`Marked ${m.title} as seen.`);
      }
    } else if (await save([{ id, seen: false, seenOn: "" }])) {
      toast(`Marked ${m.title} as not seen.`);
    }
  }

  async function moveInQueue(id, delta) {
    const ids = queued().map((m) => m.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await save(renumber(ids));
    const btn = document.querySelector(`#queue li[data-id="${id}"] [data-action="${delta < 0 ? "up" : "down"}"]`);
    if (btn && !btn.disabled) btn.focus();
  }

  /* ---------------- Filtering ---------------- */

  function visibleMovies() {
    const q = state.q.trim().toLowerCase();
    const list = state.movies.filter(
      (m) =>
        (state.mood === "all" || m.mood === state.mood) &&
        (state.seenFilter === "all" || (state.seenFilter === "seen") === m.seen) &&
        (!state.winnersOnly || m.status === "Winner") &&
        (!q || [m.title, m.cast, m.genre, m.companion].join(" ").toLowerCase().includes(q))
    );
    const winnerFirst = (a, b) => (b.status === "Winner") - (a.status === "Winner") || a.title.localeCompare(b.title);
    const sorters = {
      "year-desc": (a, b) => b.year - a.year || winnerFirst(a, b),
      "year-asc": (a, b) => a.year - b.year || winnerFirst(a, b),
      imdb: (a, b) => (b.imdb ?? -1) - (a.imdb ?? -1) || a.title.localeCompare(b.title),
      rt: (a, b) => (b.rt ?? -1) - (a.rt ?? -1) || a.title.localeCompare(b.title),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return list.sort(sorters[state.sort]);
  }

  const isFiltered = () => state.mood !== "all" || state.seenFilter !== "all" || state.winnersOnly || state.q.trim();

  /* ---------------- Rendering ---------------- */

  function render() {
    renderMasthead();
    renderMoods();
    renderList();
    renderQueue();
    renderCompanions();
    syncDetailButtons();
  }

  function renderMasthead() {
    const total = state.movies.length;
    const seen = state.movies.filter((m) => m.seen).length;
    const years = state.movies.map((m) => m.year).filter(Boolean);
    const range = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "";
    $("#progress").innerHTML = total
      ? `You've seen <strong>${seen} of ${total}</strong> Best Picture nominees from the ${range} ceremonies.`
      : "No films yet. Add rows to your Baserow table to get started.";

    const ordered = [...state.movies].sort(
      (a, b) => a.year - b.year || (b.status === "Winner") - (a.status === "Winner") || a.title.localeCompare(b.title)
    );
    let prevYear = null;
    $("#strip").innerHTML = ordered
      .map((m) => {
        const cls = [m.status === "Winner" && "w", m.seen && "s", prevYear !== null && prevYear !== m.year && "new-year"]
          .filter(Boolean)
          .join(" ");
        prevYear = m.year;
        return `<span class="${cls}"></span>`;
      })
      .join("");
    $("#strip").setAttribute(
      "aria-label",
      `Filmstrip of all ${total} nominees by ceremony year, with ${seen} seen. Taller frames are winners.`
    );
  }

  function renderMoods() {
    const counts = Object.fromEntries(MOODS.map((m) => [m.name, 0]));
    for (const m of state.movies) if (m.mood in counts) counts[m.mood]++;
    const chip = (name, label, color, n) =>
      `<button type="button" class="mood-chip" data-mood="${esc(name)}" style="--mood:${color}" aria-pressed="${state.mood === name}">${esc(label)} <span class="n">${n}</span></button>`;
    $("#moods").innerHTML =
      chip("all", "Any mood", "var(--screen)", state.movies.length) +
      MOODS.map((m) => chip(m.name, m.name, m.color, counts[m.name])).join("");
  }

  function filmRow(m, showYear) {
    const winner = m.status === "Winner";
    const meta = [
      showYear && `<span>${m.year} ceremony</span>`,
      `<span>${esc(m.genre)}</span>`,
      m.seen && m.seenOn && `<span>Seen ${esc(formatDate(m.seenOn))}</span>`,
      m.seen && m.companion && `<span>with ${esc(m.companion)}</span>`,
    ].filter(Boolean).join("");
    return `<article class="film${m.seen ? " is-seen" : ""}" data-id="${m.id}">
      <button type="button" class="seen-toggle" data-action="seen" aria-pressed="${m.seen}" aria-label="Seen ${esc(m.title)}">${ICON.check}</button>
      <button type="button" class="film-main" data-action="open" aria-haspopup="dialog">
        <span class="film-title">${esc(m.title)}</span>${winner ? '<span class="winner-mark">Winner</span>' : ""}
        <span class="film-meta">${meta}</span>
      </button>
      <span class="film-tags"><span class="mood-tag" style="--mood:${moodColor(m.mood)}">${esc(m.mood)}</span>
      <span class="scores">
        <span title="IMDb rating">IMDb <b>${fmtImdb(m.imdb)}</b></span>
        <span title="Rotten Tomatoes score">RT <b>${m.rt != null ? m.rt + "%" : "–"}</b></span>
      </span></span>
      <button type="button" class="queue-toggle" data-action="queue" aria-pressed="${m.queue != null}" aria-label="${m.queue != null ? "Remove from" : "Add to"} watch next: ${esc(m.title)}">${m.queue != null ? "On watch next" : "Watch next"}</button>
    </article>`;
  }

  function renderList() {
    const list = visibleMovies();
    const total = state.movies.length;
    $("#resultCount").textContent = isFiltered() ? `Showing ${list.length} of ${total} films` : `${total} films`;

    if (!list.length) {
      $("#list").innerHTML = state.movies.length
        ? `<div class="empty"><h2>No films match</h2><p>Try a different mood or search, or <button type="button" class="linkish" data-action="clear">clear all filters</button>.</p></div>`
        : `<div class="empty"><h2>No films loaded</h2><p>Add rows to your Baserow table, then reload this page.</p></div>`;
      return;
    }

    if (state.sort.startsWith("year")) {
      const groups = new Map();
      for (const m of list) {
        if (!groups.has(m.year)) groups.set(m.year, []);
        groups.get(m.year).push(m);
      }
      $("#list").innerHTML = [...groups]
        .map(([year, films]) => {
          const seen = films.filter((f) => f.seen).length;
          return `<section class="year-group" aria-labelledby="y${year}">
            <h2 class="year" id="y${year}">${year}<small>${seen} of ${films.length} seen</small></h2>
            <div class="films">${films.map((f) => filmRow(f, false)).join("")}</div>
          </section>`;
        })
        .join("");
    } else {
      $("#list").innerHTML = `<div class="films">${list.map((f) => filmRow(f, true)).join("")}</div>`;
    }
  }

  function renderQueue() {
    const q = queued();
    $("#queueCount").textContent = q.length ? `(${q.length})` : "";
    $("#queueHint").hidden = !q.length;
    if (!q.length) {
      $("#queue").innerHTML = `<li class="empty" style="display:block;border:0"><h2>Nothing lined up yet</h2><p>Pick films from <button type="button" class="linkish" data-action="go-all">All films</button> with the Watch next button and they'll show up here in order.</p></li>`;
      return;
    }
    $("#queue").innerHTML = q
      .map(
        (m, i) => `<li draggable="true" data-id="${m.id}">
        <span class="pos" aria-hidden="true">${i + 1}</span>
        <span class="handle" aria-hidden="true">${ICON.grip}</span>
        <button type="button" class="film-main" data-action="open" aria-haspopup="dialog">
          <span class="film-title">${esc(m.title)}</span>${m.status === "Winner" ? '<span class="winner-mark">Winner</span>' : ""}
          <span class="film-meta"><span>${m.year} ceremony</span><span style="color:${moodColor(m.mood)}">${esc(m.mood)}</span><span>IMDb ${fmtImdb(m.imdb)}</span></span>
        </button>
        <div class="queue-actions">
          <button type="button" class="icon-btn" data-action="up" aria-label="Move ${esc(m.title)} up" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
          <button type="button" class="icon-btn" data-action="down" aria-label="Move ${esc(m.title)} down" ${i === q.length - 1 ? "disabled" : ""}>${ICON.down}</button>
          <button type="button" class="queue-toggle" data-action="seen">Mark seen</button>
          <button type="button" class="icon-btn" data-action="queue" aria-label="Remove ${esc(m.title)} from watch next">${ICON.close}</button>
        </div>
      </li>`
      )
      .join("");
  }

  function renderCompanions() {
    const names = [...new Set(state.movies.map((m) => m.companion.trim()).filter(Boolean))].sort();
    $("#companions").innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");
  }

  /* ---------------- Detail drawer ---------------- */

  const dlg = $("#detail");

  function openDetail(id) {
    state.openId = id;
    const m = byId(id);
    const winner = m.status === "Winner";
    const cast = m.cast && m.cast !== "TBD" ? m.cast.split(",").map((s) => s.trim()).filter(Boolean) : [];
    $("#detailBody").innerHTML = `
      <div class="detail-top">
        <p class="d-status${winner ? " won" : ""}">${winner ? "Won Best Picture" : "Nominated for Best Picture"} at the ${m.year} ceremony</p>
        <button type="button" class="icon-btn" data-action="close" aria-label="Close">${ICON.close}</button>
      </div>
      <h2 id="dTitle">${esc(m.title)}</h2>
      <div class="search-links">
        <a class="search-link" href="${google(`${m.title} movie ${releaseYear(m)}`)}" target="_blank" rel="noopener">${ICON.search}<span>Google it</span></a>
        <a class="search-link" href="${google(`${m.title} ${releaseYear(m)} movie is available on which platform`)}" target="_blank" rel="noopener">${ICON.tv}<span>Where to watch</span></a>
      </div>
      <dl class="facts">
        <div><dt>IMDb</dt><dd class="big">${fmtImdb(m.imdb)}</dd></div>
        <div><dt>Rotten Tomatoes</dt><dd class="big">${m.rt != null ? m.rt + "%" : "–"}</dd></div>
        <div><dt>Genre</dt><dd>${esc(m.genre) || "–"}</dd></div>
        <div><dt>Mood</dt><dd style="color:${moodColor(m.mood)}">${esc(m.mood) || "–"}</dd></div>
      </dl>
      <h3>Cast</h3>
      ${cast.length ? `<ul class="cast">${cast.map((c) => `<li><a href="${google(c)}" target="_blank" rel="noopener" aria-label="Search Google for ${esc(c)}">${esc(c)}</a></li>`).join("")}</ul>` : `<p class="fact" style="color:var(--muted)">Cast isn't listed yet. Add it in Baserow.</p>`}
      ${m.fact ? `<h3>Did you know</h3><p class="fact">${esc(m.fact)}</p>` : ""}

      <section class="log" aria-labelledby="logTitle">
        <h3 id="logTitle">Your log</h3>
        <div class="log-buttons">
          <button type="button" class="btn seen-btn" data-action="seen"></button>
          <button type="button" class="btn ghost" data-action="queue"></button>
        </div>
        <label class="field"><span>Date seen</span><input type="date" id="fSeenOn" value="${esc(m.seenOn)}"></label>
        <label class="field"><span>Watched with</span><input type="text" id="fCompanion" list="companions" value="${esc(m.companion)}" placeholder="Who did you see it with?"></label>
        <label class="field"><span>Your take</span><textarea id="fOpinion" placeholder="What did you think?">${esc(m.opinion)}</textarea></label>
        <div class="save-row">
          <button type="button" class="btn" data-action="save-notes">Save notes</button>
          <span class="save-state" id="saveState" aria-live="polite"></span>
        </div>
      </section>`;
    if (!dlg.open) dlg.showModal();
    syncDetailButtons();
    $("#detailBody .icon-btn").focus();
  }

  function syncDetailButtons() {
    if (!state.openId || !dlg.open) return;
    const m = byId(state.openId);
    const seenBtn = dlg.querySelector('.log [data-action="seen"]');
    const qBtn = dlg.querySelector('.log [data-action="queue"]');
    if (!seenBtn) return;
    seenBtn.textContent = m.seen ? "Mark not seen" : "Mark seen";
    seenBtn.classList.toggle("ghost", m.seen);
    qBtn.textContent = m.queue != null ? "Remove from watch next" : "Add to watch next";
    const dateInput = $("#fSeenOn");
    if (dateInput && document.activeElement !== dateInput) dateInput.value = m.seenOn || "";
  }

  function readNotes() {
    return {
      seenOn: $("#fSeenOn").value,
      companion: $("#fCompanion").value.trim(),
      opinion: $("#fOpinion").value,
    };
  }
  function notesDirty() {
    const m = byId(state.openId);
    if (!m || !$("#fOpinion")) return false;
    const n = readNotes();
    return n.seenOn !== (m.seenOn || "") || n.companion !== m.companion || n.opinion !== m.opinion;
  }
  async function saveNotes() {
    const id = state.openId;
    const n = readNotes();
    const change = { id, ...n };
    // Logging a date or companion implies you've seen it.
    if (!byId(id).seen && (n.seenOn || n.companion)) {
      change.seen = true;
      if (!change.seenOn) change.seenOn = today();
      if (byId(id).queue != null) {
        const ok = await removeFromQueue(id, change);
        if (ok) setSaveState("Saved. Marked seen and taken off watch next.");
        return ok;
      }
    }
    const ok = await save([change]);
    if (ok) setSaveState(change.seen ? "Saved and marked seen." : "Saved.");
    return ok;
  }
  function setSaveState(text) {
    const el = $("#saveState");
    if (el) el.textContent = text;
  }

  dlg.addEventListener("click", async (e) => {
    if (e.target === dlg) return dlg.close();
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = state.openId;
    switch (btn.dataset.action) {
      case "close": dlg.close(); break;
      case "seen": await toggleSeen(id); break;
      case "queue": await toggleQueue(id); break;
      case "save-notes": await saveNotes(); break;
    }
  });
  dlg.addEventListener("input", () => setSaveState(""));
  dlg.addEventListener("close", async () => {
    if (notesDirty()) {
      const title = byId(state.openId).title;
      if (await saveNotes()) toast(`Saved your notes on ${title}.`);
    }
    state.openId = null;
  });

  /* ---------------- Events ---------------- */

  $("#moods").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-mood]");
    if (!chip) return;
    state.mood = state.mood === chip.dataset.mood ? "all" : chip.dataset.mood;
    renderMoods();
    renderList();
  });
  $("#seenFilter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seen]");
    if (!b) return;
    state.seenFilter = b.dataset.seen;
    for (const x of $("#seenFilter").children) x.setAttribute("aria-pressed", x === b);
    renderList();
  });
  $("#winners").addEventListener("change", (e) => { state.winnersOnly = e.target.checked; renderList(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });
  $("#search").addEventListener("input", (e) => { state.q = e.target.value; renderList(); });

  function clearFilters() {
    Object.assign(state, { mood: "all", seenFilter: "all", winnersOnly: false, q: "" });
    $("#search").value = "";
    $("#winners").checked = false;
    for (const x of $("#seenFilter").children) x.setAttribute("aria-pressed", x.dataset.seen === "all");
    renderMoods();
    renderList();
  }

  function rowAction(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const host = btn.closest("[data-id]");
    const id = host ? Number(host.dataset.id) : null;
    switch (btn.dataset.action) {
      case "open": openDetail(id); break;
      case "seen": toggleSeen(id); break;
      case "queue": toggleQueue(id); break;
      case "up": moveInQueue(id, -1); break;
      case "down": moveInQueue(id, 1); break;
      case "clear": clearFilters(); break;
      case "go-all": setView("all"); break;
    }
  }
  $("#list").addEventListener("click", rowAction);
  $("#queue").addEventListener("click", rowAction);

  function setView(view) {
    state.view = view;
    for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", t.dataset.view === view);
    $("#view-all").hidden = view !== "all";
    $("#view-queue").hidden = view !== "queue";
  }
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t) setView(t.dataset.view);
  });
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = state.view === "all" ? "queue" : "all";
    setView(next);
    document.querySelector(`.tab[data-view="${next}"]`).focus();
  });

  // Drag to reorder the watch-next list.
  const queueEl = $("#queue");
  queueEl.addEventListener("dragstart", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", li.dataset.id);
  });
  queueEl.addEventListener("dragover", (e) => {
    const dragging = queueEl.querySelector(".dragging");
    const li = e.target.closest("li[data-id]");
    if (!dragging) return;
    e.preventDefault();
    if (!li || li === dragging) return;
    const r = li.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    queueEl.insertBefore(dragging, after ? li.nextSibling : li);
  });
  queueEl.addEventListener("drop", (e) => e.preventDefault());
  queueEl.addEventListener("dragend", () => {
    const dragging = queueEl.querySelector(".dragging");
    if (dragging) dragging.classList.remove("dragging");
    const ids = [...queueEl.querySelectorAll("li[data-id]")].map((li) => Number(li.dataset.id));
    const changes = renumber(ids);
    if (changes.length) save(changes);
  });

  /* ---------------- Toast ---------------- */

  let toastTimer;
  function toast(msg, isError = false) {
    if (state.demo && !isError) msg += " Preview only: not saved to Baserow.";
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("error", isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), isError ? 6000 : 3200);
  }

  /* ---------------- Boot ---------------- */

  function showNotice(text) {
    const n = $("#notice");
    n.textContent = text;
    n.hidden = false;
  }

  async function load() {
    try {
      const data = await request("GET");
      state.movies = data.movies;
    } catch (err) {
      state.demo = true;
      state.movies = (window.DEMO_MOVIES || []).map((m) => ({ ...m }));
      showNotice(
        err.code === "not_configured"
          ? "Preview mode: Baserow isn't connected yet, so changes are kept only until you reload. Add BASEROW_TOKEN and BASEROW_TABLE_ID in Netlify to save them."
          : err.code === "passcode_cancelled"
          ? "Preview mode: you skipped the passcode, so this is the bundled list and changes won't be saved. Reload to try again."
          : err.code === "http"
          ? "Preview mode: the /api/movies function isn't running here (open the site on Netlify or run netlify dev). Changes are kept only until you reload."
          : `Preview mode: couldn't load your list from Baserow (${err.message}). Changes are kept only until you reload.`
      );
    }
    render();
  }

  load();
})();
