// ============================================================
// Butterscotch dashboard configuration
// ------------------------------------------------------------
// Fill in your own Supabase project values below.
// Both values are safe to publish in a public GitHub repo:
// the "anon" key can only do what your Row Level Security (RLS)
// policies allow — see supabase/schema.sql. It should only be
// able to READ data, never insert/update/delete.
// ============================================================

const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

// Name of the table your ESP32 writes readings into.
const TABLE_NAME = "readings";

// How often (ms) the dashboard polls Supabase for a fresh reading.
const POLL_INTERVAL_MS = 30000; // 30 seconds

// How many past readings to load for the history charts.
const HISTORY_LIMIT = 100;

// If the newest reading is older than this many minutes, the
// dashboard shows Butterscotch as "offline" instead of guessing.
const STALE_MINUTES = 15;
