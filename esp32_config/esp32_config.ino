/**
 * ============================================================================
 * FIRMWARE ESP32 - PANEL IoT DEPANELIZADO (PUERTO DEDICADO 8080)
 * ============================================================================
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ============================================================================
// 1. CONFIGURACIÓN DE RED Y BACKEND
// ============================================================================
const char* WIFI_SSID     = "TP-LINK_4F7E48";   // Tu red Wi-Fi
const char* WIFI_PASSWORD = "03333129";        // Tu contraseña Wi-Fi

const char* SERVER_HOST   = "192.168.1.32";     // Dirección IPv4 local de tu PC
const uint16_t SERVER_PORT = 8080;             // 👈 Puerto dedicado exclusivo para el ESP32

// ============================================================================
// 2. CONFIGURACIÓN DE PINES
// ============================================================================
#define PIN_BUILTIN_LED 2    // LED Azul Integrado
#define PIN_BOOT_BTN    0    // Botón BOOT (GPIO 0)

// ============================================================================
// 3. VARIABLES GLOBALES
// ============================================================================
enum SystemState { DISARMED, ARMED, TRIGGERED };
SystemState currentState = DISARMED;

WebSocketsClient webSocket;
bool isConnected = false;

int bootBtnLastState = HIGH;
unsigned long bootPressStartTime = 0;
bool bootLongPressHandled = false;

const unsigned long SHORT_PRESS_MAX_MS = 1200;
const unsigned long LONG_PRESS_MIN_MS  = 1500;
const unsigned long DEBOUNCE_DELAY     = 50;

unsigned long lastBlinkTime = 0;
bool blinkState = false;
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL = 10000;

void updateHardwareState();
void processTriggeredBlink();
void sendTelemetry(bool buttonPressed = false, bool panicPressed = false);
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);
void handleBootButton();
void handleSerialCommands();

// ============================================================================
// 4. CONTROL DE ACTUADORES
// ============================================================================
void updateHardwareState() {
  switch (currentState) {
    case DISARMED:
      digitalWrite(PIN_BUILTIN_LED, LOW);
      break;
    case ARMED:
      digitalWrite(PIN_BUILTIN_LED, HIGH);
      break;
    case TRIGGERED:
      break;
  }
}

void processTriggeredBlink() {
  if (currentState == TRIGGERED) {
    unsigned long currentMillis = millis();
    if (currentMillis - lastBlinkTime >= 100) {
      lastBlinkTime = currentMillis;
      blinkState = !blinkState;
      digitalWrite(PIN_BUILTIN_LED, blinkState ? HIGH : LOW);
    }
  }
}

// ============================================================================
// 5. TELEMETRÍA Y EVENTOS
// ============================================================================
void sendTelemetry(bool buttonPressed, bool panicPressed) {
  if (!isConnected) return;

  #if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
  #else
    StaticJsonDocument<256> doc;
  #endif

  doc["type"] = "telemetry";
  doc["ipAddress"] = WiFi.localIP().toString();
  doc["wifiRssi"] = WiFi.RSSI();
  doc["uptimeSeconds"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();

  if (buttonPressed) doc["buttonPressed"] = true;
  if (panicPressed) doc["panicPressed"] = true;

  String output;
  serializeJson(doc, output);
  webSocket.sendTXT(output);
  Serial.println("[ESP32 Telemetry] 📤 Evento enviado");
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[ESP32 WS] 🔴 Desconectado del Servidor");
      isConnected = false;
      break;

    case WStype_CONNECTED:
      Serial.printf("[ESP32 WS] 🟢 CONEXIÓN INSTANTÁNEA ESTABLECIDA a: %s\n", payload);
      isConnected = true;
      sendTelemetry(false, false);
      break;

    case WStype_TEXT: {
      char * payloadStr = (char *)payload;
      
      #if ARDUINOJSON_VERSION_MAJOR >= 7
        JsonDocument doc;
      #else
        DynamicJsonDocument doc(512);
      #endif

      DeserializationError error = deserializeJson(doc, payloadStr);
      if (error) return;

      String msgType = doc["type"].as<String>();
      if (msgType == "status_changed") {
        String newStateStr = doc["state"].as<String>();
        Serial.printf("[ESP32 WS] 🔄 Estado Recibido: %s\n", newStateStr.c_str());

        if (newStateStr == "ARMED") {
          currentState = ARMED;
        } else if (newStateStr == "TRIGGERED") {
          currentState = TRIGGERED;
        } else {
          currentState = DISARMED;
        }

        updateHardwareState();
      }
      break;
    }

    default:
      break;
  }
}

void handleBootButton() {
  int bootReading = digitalRead(PIN_BOOT_BTN);

  if (bootReading == LOW && bootBtnLastState == HIGH) {
    bootPressStartTime = millis();
    bootLongPressHandled = false;
  }

  if (bootReading == LOW) {
    unsigned long holdDuration = millis() - bootPressStartTime;
    if (!bootLongPressHandled && holdDuration >= LONG_PRESS_MIN_MS) {
      Serial.println("[ESP32 Hardware] 🚨 PULSACIÓN LARGA -> PÁNICO");
      sendTelemetry(false, true);
      bootLongPressHandled = true;
    }
  }

  if (bootReading == HIGH && bootBtnLastState == LOW) {
    unsigned long holdDuration = millis() - bootPressStartTime;
    if (!bootLongPressHandled && holdDuration >= DEBOUNCE_DELAY && holdDuration < SHORT_PRESS_MAX_MS) {
      Serial.println("[ESP32 Hardware] 🔘 PULSACIÓN CORTA -> Armar/Desarmar");
      sendTelemetry(true, false);
    }
  }

  bootBtnLastState = bootReading;
}

void handleSerialCommands() {
  if (Serial.available() > 0) {
    char ch = Serial.read();
    if (ch == 'b' || ch == 'B') {
      sendTelemetry(true, false);
    } else if (ch == 't' || ch == 'T') {
      sendTelemetry(false, true);
    }
  }
}

// ============================================================================
// 6. SETUP E INICIALIZACIÓN
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIN_BUILTIN_LED, OUTPUT);
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);
  updateHardwareState();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[Wi-Fi] Conectando a ");
  Serial.print(WIFI_SSID);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  // 👈 CLAVE: Desactivar ahorro de energía para garantizar conexión inmediata
  WiFi.setSleep(false);

  Serial.println("\n[Wi-Fi] 🟢 Conectado exitosamente.");
  Serial.print("[Wi-Fi] IP Asignada: ");
  Serial.println(WiFi.localIP());

  // Iniciar cliente WebSocket en la ruta directa del puerto 8080
  webSocket.begin(SERVER_HOST, SERVER_PORT, "/ws/esp32");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(2000);
}

void loop() {
  webSocket.loop();
  handleBootButton();
  handleSerialCommands();
  processTriggeredBlink();

  if (isConnected && (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL)) {
    lastTelemetryTime = millis();
    sendTelemetry(false, false);
  }
}