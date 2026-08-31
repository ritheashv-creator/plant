// Copy this file to "secrets.h" (same folder) and fill in your real values.
// Never commit the real secrets.h to a public GitHub repo.

#define WIFI_SSID       "your-wifi-name"
#define WIFI_PASSWORD   "your-wifi-password"

// Supabase project URL, e.g. https://abcdefgh.supabase.co
#define SUPABASE_URL    "https://YOUR-PROJECT-REF.supabase.co"

// Use the SERVICE ROLE key here (Project Settings -> API -> service_role).
// This key bypasses Row Level Security so the ESP32 can insert rows.
// Keep it only on the device — never put it in the website's config.js
// and never commit it to a public repo.
#define SUPABASE_KEY    "YOUR-SERVICE-ROLE-KEY"
