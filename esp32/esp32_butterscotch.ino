/* ============================================================
   Butterscotch — Smart Plant Monitor
   ESP32 firmware: reads sensors, works out a plant "mood",
   and uploads a reading to Supabase over Wi-Fi.

   Libraries needed (install via Arduino Library Manager):
     - BH1750               by Christopher Laws   (I2C lux sensor)
     - ArduinoJson           by Benoit Blanchon
     (WiFi.h, HTTPClient.h, Preferences.h, time.h are built in
      with the ESP32 board package)

   Wiring (adjust to your board):
     - Capacitive soil moisture sensor -> analog pin SOIL_PIN
     - BH1750 lux sensor -> I2C (SDA/SCL default pins)
     - Your TFT display -> wired/driven separately (not shown here)

   IMPORTANT — secrets:
     Create a file called secrets.h next to this .ino file
     (same folder) with your real values, and do NOT commit it
     to a public GitHub repo. A secrets.example.h is provided —
     copy it to secrets.h and fill it in.
   ============================================================ */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <BH1750.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>

#include "secrets.h"
// secrets.h must define:
//   #define WIFI_SSID       "your-wifi-name"
//   #define WIFI_PASSWORD   "your-wifi-password"
//   #define SUPABASE_URL    "https://YOUR-PROJECT-REF.supabase.co"
//   #define SUPABASE_KEY    "YOUR-SERVICE-ROLE-KEY"   <-- keep secret!

// ---------------- User-adjustable settings ----------------
const int   SOIL_PIN            = 34;     // analog pin for soil moisture sensor
const int   SOIL_DRY_RAW        = 3000;   // raw analogRead() value in dry air  -> calibrate!
const int   SOIL_WET_RAW        = 1200;   // raw analogRead() value in water    -> calibrate!

const float USEFUL_LUX_THRESHOLD = 1000;  // lux above this counts as "useful" light
const unsigned long UPLOAD_INTERVAL_MS = 5UL * 60UL * 1000UL; // upload every 5 minutes
const unsigned long SENSOR_SAMPLE_MS   = 30UL * 1000UL;       // sample sensors every 30s

const char* NTP_SERVER   = "pool.ntp.org";
const long  GMT_OFFSET_S = 0;       // set to your timezone offset in seconds
const int   DST_OFFSET_S = 0;

// ------------------------------------------------------------

BH1750 lightMeter;
Preferences prefs;

unsigned long lastSampleMs = 0;
unsigned long lastUploadMs = 0;

float luxSum = 0;
unsigned long luxSampleCount = 0;
unsigned long usefulLightSeconds = 0;   // accumulated today
int currentDay = -1;                    // day-of-year, used to detect midnight rollover

// ---- Wi-Fi ----------------------------------------------------------------
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection failed — will retry later.");
  }
}

// ---- Sensors ---------------------------------------------------------------
float readSoilMoisturePercent() {
  int raw = analogRead(SOIL_PIN);
  float pct = (float)(SOIL_DRY_RAW - raw) / (float)(SOIL_DRY_RAW - SOIL_WET_RAW) * 100.0;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

// ---- Daily bookkeeping (persisted across reboots with Preferences) --------
void loadDailyState() {
  prefs.begin("butterscotch", false);
  usefulLightSeconds = prefs.getULong("usefulSec", 0);
  luxSum = prefs.getFloat("luxSum", 0);
  luxSampleCount = prefs.getULong("luxCount", 0);
  currentDay = prefs.getInt("day", -1);
}

void saveDailyState() {
  prefs.putULong("usefulSec", usefulLightSeconds);
  prefs.putFloat("luxSum", luxSum);
  prefs.putULong("luxCount", luxSampleCount);
  prefs.putInt("day", currentDay);
}

// Keeps a simple rolling history of the last 7 days' useful-light hours
// so we can report an average light-hours/day figure.
void rollOverIfNewDay(int todayYday) {
  if (currentDay == -1) {
    currentDay = todayYday;
    return;
  }
  if (todayYday != currentDay) {
    float finishedDayHours = usefulLightSeconds / 3600.0;

    // shift a 7-slot ring buffer stored in Preferences
    float history[7];
    for (int i = 0; i < 6; i++) {
      char key[8];
      snprintf(key, sizeof(key), "h%d", i + 1);
      history[i] = prefs.getFloat(key, finishedDayHours);
    }
    for (int i = 6; i > 0; i--) {
      char key[8];
      snprintf(key, sizeof(key), "h%d", i + 1);
      prefs.putFloat(key, history[i - 1]);
    }
    prefs.putFloat("h1", finishedDayHours);

    // reset today's counters
    usefulLightSeconds = 0;
    luxSum = 0;
    luxSampleCount = 0;
    currentDay = todayYday;
    saveDailyState();
  }
}

float getAverageLightHoursPerDay() {
  float total = 0;
  int count = 0;
  for (int i = 1; i <= 7; i++) {
    char key[8];
    snprintf(key, sizeof(key), "h%d", i);
    if (prefs.isKey(key)) {
      total += prefs.getFloat(key, 0);
      count++;
    }
  }
  if (count == 0) return usefulLightSeconds / 3600.0; // fall back to today only
  return total / count;
}

// ---- Plant "emotion" logic --------------------------------------------------
// Simple, tweakable rules — adjust thresholds for your own plant species.
String workOutEmotion(float moisturePct, float lux, float todayHours) {
  if (moisturePct < 20) return "Sad";
  if (moisturePct < 35) return "Thirsty";
  if (moisturePct >= 35 && moisturePct <= 70 && todayHours >= 4) return "Thriving";
  if (moisturePct >= 35 && moisturePct <= 70) return "Happy";
  return "Neutral";
}

// ---- Upload to Supabase ------------------------------------------------------
bool uploadReading(float moisturePct, const String& emotion, float lux,
                    float todayHours, float avgHoursPerDay, float avgLux) {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    if (WiFi.status() != WL_CONNECTED) return false;
  }

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/readings";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<512> doc;
  doc["soil_moisture"] = moisturePct;
  doc["emotion"] = emotion;
  doc["light_lux"] = lux;
  doc["useful_light_hours_today"] = todayHours;
  doc["avg_light_hours_per_day"] = avgHoursPerDay;
  doc["avg_lux"] = avgLux;

  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    doc["device_time"] = buf;
  }

  String body;
  serializeJson(doc, body);

  int statusCode = http.POST(body);
  Serial.print("Supabase upload status: ");
  Serial.println(statusCode);
  if (statusCode >= 400) {
    Serial.println(http.getString());
  }
  http.end();
  return statusCode >= 200 && statusCode < 300;
}

// ---- Setup / loop -------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);

  connectWiFi();
  configTime(GMT_OFFSET_S, DST_OFFSET_S, NTP_SERVER);

  Wire.begin();
  lightMeter.begin();

  analogReadResolution(12); // 0-4095 on ESP32

  loadDailyState();
}

void loop() {
  unsigned long now = millis();

  struct tm timeinfo;
  bool haveTime = getLocalTime(&timeinfo);
  if (haveTime) rollOverIfNewDay(timeinfo.tm_yday);

  // ---- sample sensors every SENSOR_SAMPLE_MS ----
  if (now - lastSampleMs >= SENSOR_SAMPLE_MS) {
    float lux = lightMeter.readLightLevel();
    if (lux >= 0) {
      luxSum += lux;
      luxSampleCount++;
      if (lux >= USEFUL_LUX_THRESHOLD) {
        usefulLightSeconds += (SENSOR_SAMPLE_MS / 1000);
      }
    }
    saveDailyState();
    lastSampleMs = now;
  }

  // ---- upload every UPLOAD_INTERVAL_MS ----
  if (now - lastUploadMs >= UPLOAD_INTERVAL_MS) {
    float moisturePct = readSoilMoisturePercent();
    float lux = lightMeter.readLightLevel();
    float todayHours = usefulLightSeconds / 3600.0;
    float avgLux = luxSampleCount > 0 ? (luxSum / luxSampleCount) : 0;
    float avgHoursPerDay = getAverageLightHoursPerDay();
    String emotion = workOutEmotion(moisturePct, lux, todayHours);

    // TODO: also update your TFT display here with the same values,
    // so the on-device screen and the website always agree.

    uploadReading(moisturePct, emotion, lux, todayHours, avgHoursPerDay, avgLux);
    lastUploadMs = now;
  }

  delay(200);
}
