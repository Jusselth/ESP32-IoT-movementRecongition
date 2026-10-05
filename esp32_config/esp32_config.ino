/**
 * ============================================================================
 * FIRMWARE ESP32 - PROTAGONISTA IoT AVANZADO CON SOPORTE DE CÁMARA Y BUZZER
 * ============================================================================
 * Protocolo: WebSocket Nativo Directo (/ws/esp32)
 * Soporte: Botones físicos, Buzzer tonal, LED de estado y ESP32-CAM opcional.
 * ============================================================================
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ============================================================================
// 1. CONFIGURACIÓN DE RED Y BACKEND
// ============================================================================
const char* WIFI_SSID     = "TP-LINK_4F7E48";          // 👈 Reemplaza por tu red Wi-Fi
const char* WIFI_PASSWORD = "03333129";   // 👈 Reemplaza por tu contraseña Wi-Fi

// IP local de tu PC ejecutando el Backend (ej: 192.168.1.15)
const char* SERVER_HOST   = "192.168.1.32";        // 👈 Reemplaza por la IP de tu PC
const uint16_t SERVER_PORT = 3000;

// ============================================================================
// 2. CONFIGURACIÓN DE PINES Y HARDWARE
// ============================================================================
#define PIN_BUILTIN_LED 2    // LED Azul Integrado en la placa ESP32
#define PIN_BUZZER      21   // Pin listo para conectar un Buzzer Pasivo/Activo
#define PIN_BTN_ARM     4    // Pin listo para Botón Físico Armar/Desarmar (INPUT_PULLUP)
#define PIN_BTN_PANIC   13   // Pin listo para Botón Físico de Pánico (INPUT_PULLUP)

// Activar solo si se usa una placa ESP32-CAM (AI-Thinker OV2640)
#define ENABLE_ESP32_CAM false

#if ENABLE_ESP32_CAM
  #include "esp_camera.h"
  #define PWDN_GPIO_NUM    32
  #define RESET_GPIO_NUM   -1
  #define XCLK_GPIO_NUM     0
  #define SIOD_GPIO_NUM    26
  #define SIOC_GPIO_NUM    27
  #define Y9_GPIO_NUM      35
  #define Y8_GPIO_NUM      34
  #define Y7_GPIO_NUM      39
  #define Y6_GPIO_NUM      36
  #define Y5_GPIO_NUM      21
  #define Y4_GPIO_NUM      19
  #define Y3_GPIO_NUM      18
  #define Y2_GPIO_NUM       5
  #define VSYNC_GPIO_NUM   25
  #define HREF_GPIO_NUM    23
  #define PCLK_GPIO_NUM    22
#endif

// ============================================================================
// 3. VARIABLES GLOBALES Y CONTROL DE ESTADOS
// ============================================================================
enum SystemState { DISARMED, ARMED, TRIGGERED };
SystemState currentState = DISARMED;

WebSocketsClient webSocket;
bool isConnected = false;

// Control de Anti-rebote para Botones Físicos (Debounce)
int lastArmBtnState = HIGH;
int lastPanicBtnState = HIGH;
unsigned long lastDebounceTimeArm = 0;
unsigned long lastDebounceTimePanic = 0;
const unsigned long DEBOUNCE_DELAY = 50;

// Temporizadores no bloqueantes
unsigned long lastBlinkTime = 0;
bool blinkState = false;
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL = 10000;

// Declaraciones previas
void updateHardwareState(SystemState previousState);
void processTriggeredBlink();
void playToneSound(String type);
void sendTelemetry(bool buttonPressed = false, bool panicPressed = false);
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length);
void handlePhysicalButtons();
void handleSerialCommands();

// ============================================================================
// 4. EFECTOS AUDITIVOS CON BUZZER
// ============================================================================
void playToneSound(String type) {
  if (type == "ARM") {
    // Tono de Armado: Bip-Bip agudo
    tone(PIN_BUZZER, 1000, 100);
    delay(120);
    tone(PIN_BUZZER, 1500, 150);
  } else if (type == "DISARM") {
    // Tono de Desarmado: Bip grave descendente
    tone(PIN_BUZZER, 800, 200);
    delay(220);
    tone(PIN_BUZZER, 400, 300);
  } else if (type == "PANIC") {
    // Tono de Pánico de emergencia
    tone(PIN_BUZZER, 2000, 400);
  }
}

// ============================================================================
// 5. CONTROL DE ACTUADORES Y LEDS
// ============================================================================
void updateHardwareState(SystemState previousState) {
  switch (currentState) {
    case DISARMED:
      digitalWrite(PIN_BUILTIN_LED, LOW);
      noTone(PIN_BUZZER);
      if (previousState != DISARMED) playToneSound("DISARM");
      break;

    case ARMED:
      digitalWrite(PIN_BUILTIN_LED, HIGH);
      noTone(PIN_BUZZER);
      if (previousState != ARMED) playToneSound("ARM");
      break;

    case TRIGGERED:
      if (previousState != TRIGGERED) playToneSound("PANIC");
      break;
  }
}

void processTriggeredBlink() {
  if (currentState == TRIGGERED) {
    unsigned long currentMillis = millis();
    if (currentMillis - lastBlinkTime >= 100) { // Parpadeo estroboscópico (100ms)
      lastBlinkTime = currentMillis;
      blinkState = !blinkState;

      digitalWrite(PIN_BUILTIN_LED, blinkState ? HIGH : LOW);
      
      // Sonido de sirena intermitente
      if (blinkState) {
        tone(PIN_BUZZER, 1800);
      } else {
        tone(PIN_BUZZER, 1200);
      }
    }
  }
}

// ============================================================================
// 6. ENVÍO DE TELEMETRÍA Y EVENTOS AL BACKEND
// ============================================================================
void sendTelemetry(bool buttonPressed, bool panicPressed) {
  if (!isConnected) return;

  #if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
  #else
    StaticJsonDocument<300> doc;
  #endif

  doc["type"] = "telemetry";
  doc["ipAddress"] = WiFi.localIP().toString();
  doc["wifiRssi"] = WiFi.RSSI();
  doc["uptimeSeconds"] = millis() / 1000;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["cameraConfigured"] = ENABLE_ESP32_CAM;

  if (buttonPressed) {
    doc["buttonPressed"] = true;
  }

  if (panicPressed) {
    doc["panicPressed"] = true;
  }

  String output;
  serializeJson(doc, output);
  webSocket.sendTXT(output);
  Serial.println("[ESP32 Telemetry] 📤 Telemetría enviada al servidor");
}

// ============================================================================
// 7. EVENTOS DEL WEBSOCKET NATIVO
// ============================================================================
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[ESP32 WS] 🔴 Desconectado del Servidor WebSocket");
      isConnected = false;
      break;

    case WStype_CONNECTED:
      Serial.printf("[ESP32 WS] 🟢 Conectado exitosamente a: %s\n", payload);
      Serial.println("\n-----------------------------------------------------");
      Serial.println("💻 COMANDOS DISPONIBLES EN CONSOLA:");
      Serial.println("  'b' -> Simular Botón Armar/Desarmar");
      Serial.println("  't' -> Simular Botón de Pánico / Sensor de Movimiento");
      Serial.println("  's' -> Mostrar Diagnóstico Completo del Hardware");
      Serial.println("-----------------------------------------------------\n");
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
        SystemState previous = currentState;

        Serial.printf("[ESP32 WS] 🔄 Cambio de Estado Recibido: %s\n", newStateStr.c_str());

        if (newStateStr == "ARMED") {
          currentState = ARMED;
        } else if (newStateStr == "TRIGGERED") {
          currentState = TRIGGERED;
        } else {
          currentState = DISARMED;
        }

        updateHardwareState(previous);
      }
      break;
    }

    default:
      break;
  }
}

// ============================================================================
// 8. LECTURA Y MANEJO DE BOTONES FÍSICOS
// ============================================================================
void handlePhysicalButtons() {
  // 1. Botón Armar/Desarmar (GPIO 4)
  int armReading = digitalRead(PIN_BTN_ARM);
  if (armReading != lastArmBtnState) {
    lastDebounceTimeArm = millis();
  }
  if ((millis() - lastDebounceTimeArm) > DEBOUNCE_DELAY) {
    static int armBtnState = HIGH;
    if (armReading != armBtnState) {
      armBtnState = armReading;
      if (armBtnState == LOW) { // Pulsado a GND
        Serial.println("[ESP32 Hardware] 🔘 Botón físico (GPIO 4) presionado.");
        sendTelemetry(true, false);
      }
    }
  }
  lastArmBtnState = armReading;

  // 2. Botón de Pánico / Emergencia (GPIO 13)
  int panicReading = digitalRead(PIN_BTN_PANIC);
  if (panicReading != lastPanicBtnState) {
    lastDebounceTimePanic = millis();
  }
  if ((millis() - lastDebounceTimePanic) > DEBOUNCE_DELAY) {
    static int panicBtnState = HIGH;
    if (panicReading != panicBtnState) {
      panicBtnState = panicReading;
      if (panicBtnState == LOW) { // Pulsado a GND
        Serial.println("[ESP32 Hardware] 🚨 Botón de Pánico (GPIO 13) presionado.");
        sendTelemetry(false, true);
      }
    }
  }
  lastPanicBtnState = panicReading;
}

// ============================================================================
// 9. COMANDOS DE PRUEBA POR MONITOR SERIE
// ============================================================================
void handleSerialCommands() {
  if (Serial.available() > 0) {
    char ch = Serial.read();

    if (ch == 'b' || ch == 'B') {
      Serial.println("[ESP32 Console] 🔘 Comando 'b': Conmutar Armado/Desarmado");
      sendTelemetry(true, false);
    } else if (ch == 't' || ch == 'T') {
      Serial.println("[ESP32 Console] 🚨 Comando 't': Disparar Alerta / Pánico");
      sendTelemetry(false, true);
    } else if (ch == 's' || ch == 'S') {
      Serial.println("\n📊 --- DIAGNÓSTICO DEL SISTEMA ESP32 ---");
      Serial.printf("  • Estado Actual: %s\n", currentState == ARMED ? "ARMED" : currentState == TRIGGERED ? "TRIGGERED" : "DISARMED");
      Serial.printf("  • IP Asignada: %s\n", WiFi.localIP().toString().c_str());
      Serial.printf("  • Nivel Señal Wi-Fi: %d dBm\n", WiFi.RSSI());
      Serial.printf("  • RAM Libre: %u Bytes\n", ESP.getFreeHeap());
      Serial.printf("  • Conexión WebSocket: %s\n", isConnected ? "🟢 CONECTADO" : "🔴 DESCONECTADO");
      Serial.printf("  • Módulo ESP32-CAM: %s\n", ENABLE_ESP32_CAM ? "ACTIVADO" : "DESACTIVADO");
      Serial.println("-----------------------------------------\n");
    }
  }
}

// ============================================================================
// 10. SETUP E INICIALIZACIÓN
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=====================================================");
  Serial.println("🚀 Panel IoT ESP32 Avanzado Iniciando...");
  Serial.println("=====================================================");

  // Configuración de Pines de Salida y Entrada
  pinMode(PIN_BUILTIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BTN_ARM, INPUT_PULLUP);
  pinMode(PIN_BTN_PANIC, INPUT_PULLUP);

  updateHardwareState(DISARMED);

  // Conexión Wi-Fi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[Wi-Fi] Conectando a ");
  Serial.print(WIFI_SSID);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n[Wi-Fi] 🟢 Conectado exitosamente.");
  Serial.print("[Wi-Fi] IP Asignada: ");
  Serial.println(WiFi.localIP());

  // Iniciar cliente WebSocket
  webSocket.begin(SERVER_HOST, SERVER_PORT, "/ws/esp32");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

// ============================================================================
// 11. BUCLE PRINCIPAL
// ============================================================================
void loop() {
  webSocket.loop();
  handlePhysicalButtons();
  handleSerialCommands();
  processTriggeredBlink();

  if (isConnected && (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL)) {
    lastTelemetryTime = millis();
    sendTelemetry(false, false);
  }
}