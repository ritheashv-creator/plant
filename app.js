// ============================================================
// Butterscotch dashboard logic
// No fake/demo data anywhere — every value on screen comes
// straight from your Supabase "readings" table, which your
// ESP32 writes to. Until the first real row exists, the
// dashboard shows an empty state instead of made-up numbers.
// ============================================================

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let moistureChart = null;
let lightChart = null;

// ---- DOM references ----------------------------------------------------
const el = {
  connectionDot: document.getElementById("connectionDot"),
  connectionText: document.getElementById("connectionText"),
  emptyState: document.getElementById("emptyState"),
  statsGrid: document.querySelector(".stats-grid"),
  hero: document.querySelector(".hero"),
  moodBubble: document.getElementById("moodBubble"),
  emotionLabel: document.getElementById("emotionLabel"),
  lastUpdated: document.getElementById("lastUpdated"),
  statMoisture: document.getElementById("statMoisture"),
  statEmotion: document.getElementById("statEmotion"),
  statLux: document.getElementById("statLux"),
  statTodayHours: document.getElementById("statTodayHours"),
  statAvgHours: document.getElementById("statAvgHours"),
  statAvgLux: document.getElementById("statAvgLux"),
  soilBlock: document.getElementById("soilBlock"),
  refreshBtn: document.getElementById("refreshBtn"),
};

// ---- Emotion → sprite / copy mapping -----------------------------------
const EMOTION_STATES = ["happy", "thriving", "thirsty", "sad", "neutral"];

const MOOD_COPY = {
  happy: "Feeling great! 🌿",
  thriving: "Thriving today! ✨",
  thirsty: "Could use some water 💧",
  sad: "Not feeling well 😢",
  neutral: "Just chilling 🌱",
};

function classifyEmotion(raw) {
  if (!raw) return "neutral";
  const text = raw.toString().toLowerCase();

  if (/(thrive|excellent|great|flourish)/.test(text)) return "thriving";
  if (/(happy|good|healthy|content)/.test(text)) return "happy";
  if (/(thirsty|dry|low.?moist|needs? water)/.test(text)) return "thirsty";
  if (/(sad|wilt|critical|distress|dying|bad)/.test(text)) return "sad";
  return "neutral";
}

function applySprite(state) {
  document.querySelectorAll(".leaf-set").forEach((n) => n.classList.remove("active"));
  document.querySelectorAll(".face-set").forEach((n) => n.classList.remove("active"));

  const leafId = state === "thriving" ? "leaves-thriving"
    : state === "thirsty" ? "leaves-thirsty"
    : state === "sad" ? "leaves-sad"
    : "leaves-happy"; // "happy" and "neutral" share the upright leaves

  document.getElementById(leafId).classList.add("active");
  document.getElementById(`face-${state}`).classList.add("active");

  el.moodBubble.textContent = MOOD_COPY[state] || MOOD_COPY.neutral;
}

// ---- Formatting helpers --------------------------------------------------
function formatNumber(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(decimals).replace(/\.0$/, "");
}

function formatDateTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function minutesSince(isoString) {
  if (!isoString) return Infinity;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return Infinity;
  return (Date.now() - then) / 60000;
}

// ---- Rendering ------------------------------------------------------------
function renderLatest(row) {
  if (!row) {
    el.emptyState.hidden = false;
    el.hero.style.display = "none";
    el.statsGrid.style.display = "none";
    setConnection("offline", "No data yet");
    return;
  }

  el.emptyState.hidden = true;
  el.hero.style.display = "";
  el.statsGrid.style.display = "";

  const state = classifyEmotion(row.emotion);
  applySprite(state);

  el.emotionLabel.innerHTML = `😊 Status: <strong>${row.emotion ?? "Unknown"}</strong>`;
  el.lastUpdated.textContent = `🕒 Last updated: ${formatDateTime(row.created_at)}`;

  el.statMoisture.textContent = row.soil_moisture !== null && row.soil_moisture !== undefined
    ? `${formatNumber(row.soil_moisture, 0)}%` : "--%";
  el.statEmotion.textContent = row.emotion ?? "--";
  el.statLux.textContent = row.light_lux !== null && row.light_lux !== undefined
    ? `${formatNumber(row.light_lux, 0)} lux` : "-- lux";
  el.statTodayHours.textContent = row.useful_light_hours_today !== null && row.useful_light_hours_today !== undefined
    ? `${formatNumber(row.useful_light_hours_today, 1)} h` : "-- h";
  el.statAvgHours.textContent = row.avg_light_hours_per_day !== null && row.avg_light_hours_per_day !== undefined
    ? `${formatNumber(row.avg_light_hours_per_day, 1)} h` : "-- h";
  el.statAvgLux.textContent = row.avg_lux !== null && row.avg_lux !== undefined
    ? `${formatNumber(row.avg_lux, 0)} lux` : "-- lux";

  // Soil block gets darker/lighter with real moisture data — a small
  // extra pixel-art touch tied to the actual sensor reading.
  if (row.soil_moisture !== null && row.soil_moisture !== undefined) {
    const pct = Math.max(0, Math.min(100, Number(row.soil_moisture)));
    // dry (tan #A9865A) -> wet (dark #2E1F14)
    const dry = [169, 134, 90];
    const wet = [46, 31, 20];
    const mix = dry.map((c, i) => Math.round(c + (wet[i] - c) * (pct / 100)));
    el.soilBlock.setAttribute("fill", `rgb(${mix[0]},${mix[1]},${mix[2]})`);
  }

  // Online/offline indicator based on how fresh the newest row is.
  if (minutesSince(row.created_at) <= STALE_MINUTES) {
    setConnection("online", "Live");
  } else {
    setConnection("offline", `Last seen ${formatDateTime(row.created_at)}`);
  }
}

function setConnection(status, label) {
  el.connectionDot.classList.remove("online", "offline");
  el.connectionDot.classList.add(status);
  el.connectionText.textContent = label;
}

function renderCharts(rows) {
  const labels = rows.map((r) => {
    const d = new Date(r.created_at);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  });
  const moistureData = rows.map((r) => r.soil_moisture);
  const luxData = rows.map((r) => r.light_lux);

  // Plain category axis — no extra date-adapter library required.
  const timeAxisOptions = {
    ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
  };

  if (moistureChart) moistureChart.destroy();
  moistureChart = new Chart(document.getElementById("moistureChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Soil moisture (%)",
        data: moistureData,
        borderColor: "#6FB1E0",
        backgroundColor: "rgba(111,177,224,0.15)",
        fill: true,
        tension: 0.25,
        pointRadius: 2,
      }],
    },
    options: {
      responsive: true,
      scales: {
        x: timeAxisOptions,
        y: { suggestedMin: 0, suggestedMax: 100, title: { display: true, text: "%" } },
      },
      plugins: { legend: { display: false } },
    },
  });

  if (lightChart) lightChart.destroy();
  lightChart = new Chart(document.getElementById("lightChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Light (lux)",
        data: luxData,
        borderColor: "#E3A63E",
        backgroundColor: "rgba(227,166,62,0.18)",
        fill: true,
        tension: 0.25,
        pointRadius: 2,
      }],
    },
    options: {
      responsive: true,
      scales: {
        x: timeAxisOptions,
        y: { suggestedMin: 0, title: { display: true, text: "lux" } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

// ---- Data fetching ----------------------------------------------------
async function fetchLatestReading() {
  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error fetching latest reading:", error);
    setConnection("offline", "Connection error");
    return null;
  }
  return data && data.length ? data[0] : null;
}

async function fetchHistory() {
  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select("created_at, soil_moisture, light_lux")
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    console.error("Error fetching history:", error);
    return [];
  }
  return (data || []).reverse(); // chronological order for charts
}

async function refreshDashboard() {
  const [latest, history] = await Promise.all([fetchLatestReading(), fetchHistory()]);
  renderLatest(latest);
  if (history.length) renderCharts(history);
}

// ---- Realtime updates (optional but nice: instant refresh on new row) --
function subscribeToRealtime() {
  supabaseClient
    .channel("readings-changes")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: TABLE_NAME },
      () => refreshDashboard()
    )
    .subscribe();
}

// ---- Init ----------------------------------------------------------------
el.refreshBtn.addEventListener("click", refreshDashboard);

refreshDashboard();
setInterval(refreshDashboard, POLL_INTERVAL_MS);
subscribeToRealtime();
