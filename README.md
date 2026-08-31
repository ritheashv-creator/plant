# 🌱 Butterscotch — Smart Plant Monitor

A cute, pixel-art dashboard for an ESP32-powered plant monitor. Plain HTML/CSS/JS
on the frontend, [Supabase](https://supabase.com) as the database, no build tools,
no frameworks — just files you can push to GitHub and turn on GitHub Pages.

```
butterscotch-dashboard/
├── index.html          the dashboard page
├── style.css           pixel-plant theme + responsive layout
├── app.js              fetches real data from Supabase, draws charts
├── config.js           <- put your Supabase URL/anon key here
├── supabase/
│   └── schema.sql       run this in Supabase to create the table
├── esp32/
│   ├── esp32_butterscotch.ino
│   └── secrets.example.h
└── README.md            you are here
```

The dashboard never shows fake data. Until your ESP32 sends its first real
reading, it shows an empty state ("waiting for your ESP32").

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → sign in → **New project**.
2. Pick any name/region, set a database password, wait ~2 minutes for it to spin up.
3. In the left sidebar, open **SQL Editor** → **New query**.
4. Paste the contents of `supabase/schema.sql` and click **Run**.
   This creates a `readings` table and locks it down with Row Level Security
   so the public website can only *read* data, never write it.
5. Go to **Project Settings → API**. You'll need two things from this page:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon / public key** — for the website
   - **service_role key** — for the ESP32 only (keep this one secret!)

---

## 2. Set up the website

1. Open `config.js` and fill in:
   ```js
   const SUPABASE_URL = "https://abcdefgh.supabase.co";
   const SUPABASE_ANON_KEY = "your-anon-public-key";
   ```
   The anon key is safe to publish — the RLS policy from `schema.sql` means it
   can only `SELECT` rows, never insert or change anything.
2. That's it — no build step, no npm install. Open `index.html` in a browser
   to preview it locally (it will show the empty state until you have data).

### Publish it with GitHub Pages

1. Create a new **public** GitHub repository (e.g. `butterscotch-dashboard`).
2. Upload everything in this folder to the repo (drag-and-drop on github.com
   works fine, or `git push` if you're comfortable with git).
3. In the repo, go to **Settings → Pages**.
4. Under "Build and deployment", set **Source** to `Deploy from a branch`,
   branch `main`, folder `/ (root)`. Save.
5. Wait a minute, then your dashboard is live at:
   `https://your-username.github.io/butterscotch-dashboard/`
6. Share that link with friends. 🎉

---

## 3. Set up the ESP32

1. In the Arduino IDE, install these libraries (Tools → Manage Libraries):
   - **BH1750** by Christopher Laws (lux sensor)
   - **ArduinoJson** by Benoit Blanchon
   - Make sure you have the **esp32** board package installed too.
2. Open `esp32/esp32_butterscotch.ino`.
3. Copy `esp32/secrets.example.h` to `esp32/secrets.h` (same folder) and fill in:
   ```cpp
   #define WIFI_SSID       "your-wifi-name"
   #define WIFI_PASSWORD   "your-wifi-password"
   #define SUPABASE_URL    "https://abcdefgh.supabase.co"
   #define SUPABASE_KEY    "your-service-role-key"   // NOT the anon key
   ```
   Use the **service_role** key here, not the anon key — it's the only key
   allowed to insert rows, and it must never appear in `config.js` or in a
   public repo. If you keep your ESP32 code on GitHub too, make sure
   `secrets.h` is in your `.gitignore` (a starter one is not included here —
   add `secrets.h` to it, or just don't upload that file).
4. Wire up your sensors:
   - Capacitive soil moisture sensor → analog pin (`SOIL_PIN`, default GPIO34)
   - BH1750 lux sensor → I2C (SDA/SCL)
5. Calibrate `SOIL_DRY_RAW` and `SOIL_WET_RAW` at the top of the `.ino` file:
   power the sensor, print `analogRead(SOIL_PIN)` in air (dry) and in a cup
   of water (wet), and use those two numbers.
6. Upload the sketch. Open Serial Monitor at 115200 baud — you should see
   Wi-Fi connect and, every 5 minutes, `Supabase upload status: 201`.
7. Refresh your GitHub Pages dashboard — your real reading should appear
   within a few seconds (it also updates live via Supabase Realtime).

### What the ESP32 sends

Every upload is one row with these fields, matching the table schema:

| Field                      | Meaning                                   |
|-----------------------------|--------------------------------------------|
| `soil_moisture`             | % moisture, 0–100                         |
| `emotion`                   | "Happy" / "Thriving" / "Thirsty" / "Sad" / "Neutral" |
| `light_lux`                 | current light level in lux                |
| `useful_light_hours_today`  | hours today above a "useful light" threshold |
| `avg_light_hours_per_day`   | rolling 7-day average of the above         |
| `avg_lux`                   | average lux since midnight                 |
| `device_time`               | the ESP32's own NTP-synced timestamp       |
| `created_at`                | set automatically by Supabase              |

The emotion rule and the "useful light" lux threshold are simple `if`
statements near the top of the `.ino` file — tweak them for your own plant.

---

## 4. Customizing

- **Update frequency**: change `UPLOAD_INTERVAL_MS` in the `.ino` file and
  `POLL_INTERVAL_MS` in `config.js` to match.
- **Colors/fonts**: all in `style.css`, under `:root` at the top.
- **Plant sprite**: the pixel-art plant lives as plain `<rect>` shapes inside
  the SVG in `index.html` (`#plantSprite`) — four leaf/face variants
  (happy, thriving, thirsty, sad) are swapped by `app.js` based on the
  `emotion` text your ESP32 sends.
- **History chart length**: `HISTORY_LIMIT` in `config.js`.
- **Offline indicator**: `STALE_MINUTES` in `config.js` controls how long
  before the dashboard shows Butterscotch as offline.

---

## Troubleshooting

- **Dashboard stuck on "Connecting…" / empty state forever**: open the
  browser console (F12) and check for errors — usually a wrong
  `SUPABASE_URL` or `SUPABASE_ANON_KEY` in `config.js`.
- **ESP32 upload status is 401/403**: check you used the `service_role` key
  (not `anon`) in `secrets.h`, and that it's pasted in full.
- **ESP32 upload status is 400**: check the Serial Monitor output — Supabase
  will print the reason (often a column name mismatch with `schema.sql`).
- **Charts are empty but stats show data**: the charts need at least 2 rows
  in the table to draw a line — give it a couple of upload cycles.
