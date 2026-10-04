/**
 * ============================================================================
 * FIRMWARE ESP32 - WEBSOCKET NATIVO LIGERO (MODO PLACA USB)
 * ============================================================================
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ============================================================================
// 1. CONFIGURACIÓN DE RED Y SERVIDOR BACKEND
// ============================================================================
const char* WIFI_SSID     = "TP-LINK_4F7E48";          // 👈 Reemplaza por tu red Wi-Fi
const char* WIFI_PASSWORD = "03333129";   // 👈 Reemplaza por tu contraseña Wi-Fi

// IP local de tu PC ejecutando el Backend (ej: 192.168.1.15)
const char* SERVER_HOST   = "192.168.1.32";        // 👈 Reemplaza por la IP de tu PC
const uint16_t SERVER_PORT = 3000;

// ============================================================================
// 2. RECURSOS INTERNOS DE LA PLACA
// ============================================================================
#define PIN_BUILTIN_LED 2

enum SystemState { DISARMED, ARMED, TRIGGERED };
SystemState currentState = DISARMED;

WebSocketsClient webSocket;
bool isConnected = false;

unsigned long lastBlinkTime = 0;
bool blinkState = false;

unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL = 10000;

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
    if (currentMillis - lastBlinkTime >= 150) {
      lastBlinkTime = currentMillis;
      blinkState = !blinkState;
      digitalWrite(PIN_BUILTIN_LED, blinkState ? HIGH : LOW);
    }
  }
}

void sendTelemetry(bool buttonPressed = false) {
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
  if (buttonPressed) {
    doc["buttonPressed"] = true;
  }

  String output;
  serializeJson(doc, output);
  webSocket.sendTXT(output);
  Serial.println("[ESP32 WS] 📤 Mensaje enviado al backend");
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[ESP32 WS] 🔴 Desconectado del Servidor WebSocket");
      isConnected = false;
      break;

    case WStype_CONNECTED:
      Serial.printf("[ESP32 WS] 🟢 Conectado exitosamente a: %s\n", payload);
      Serial.println("[ESP32 Info] 💡 Escribe 'b' en esta consola y presiona Enter para simular el botón.");
      isConnected = true;
      sendTelemetry(false);
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
        Serial.printf("[ESP32 WS] 🔄 Estado recibido: %s\n", newStateStr.c_str());

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

void handleSerialInput() {
  if (Serial.available() > 0) {
    char inputChar = Serial.read();
    if (inputChar == 'b' || inputChar == 'B') {
      Serial.println("[ESP32 Console] 🔘 Botón virtual activado desde teclado.");
      sendTelemetry(true);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=====================================================");
  Serial.println("🚀 Iniciando Panel IoT ESP32 (WebSocket Nativo)...");
  Serial.println("=====================================================");

  pinMode(PIN_BUILTIN_LED, OUTPUT);
  updateHardwareState();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[Wi-Fi] Conectando a ");
  Serial.print(WIFI_SSID);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n[Wi-Fi] 🟢 Conectado exitosamente.");
  Serial.print("[Wi-Fi] IP asignada: ");
  Serial.println(WiFi.localIP());

  // Conexión por WebSocket nativo directo
  webSocket.begin(SERVER_HOST, SERVER_PORT, "/ws/esp32");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop();
  handleSerialInput();
  processTriggeredBlink();

  if (isConnected && (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL)) {
    lastTelemetryTime = millis();
    sendTelemetry(false);
  }
}