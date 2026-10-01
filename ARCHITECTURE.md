# ARCHITECTURE.md - Sistema de Detección de Intrusos IoT (Ruta C)

## 1. Visión General del Sistema
Este documento define la arquitectura técnica, contratos de API, protocolo de comunicación en tiempo real y el comportamiento de los nodos para el **Sistema de Detección de Intrusos IoT**. 

El proyecto adopta la **Ruta C (Cámara en Dispositivo Móvil + ESP32 como Panel Físico)**, utilizando un **Backend Centralizado en Node.js/Express.js con Socket.IO** para orquestar la comunicación, persistencia del estado, gestión de franjas horarias y el despacho automático de correos de alerta con evidencia fotográfica.

---

## 2. Topología de Red y Flujo de Datos

```
+-----------------------------------------------------------------------------------+
|                                 RED LOCAL WI-FI                                  |
|                                                                                   |
|  +-----------------------+                    +--------------------------------+  |
|  |     ESP32 Panel       |                    |    App Móvil (React Native)    |  |
|  |  (Botón/Buzzer/LEDs)  |                    | (Cámara + Foreground Service)  |  |
|  +-----------+-----------+                    +---------------+----------------+  |
|              |                                                |                   |
|              | HTTP/WebSocket                                 | HTTP/WebSocket    |
|              v                                                v                   |
|  +-----------------------------------------------------------------------------+  |
|  |                       Backend Central (Node.js/Express)                     |  |
|  +-------------------------------------+---------------------------------------+  |
+----------------------------------------|------------------------------------------+
                                         |
                                         | HTTPS (SMTP / API REST)
                                         v
                          +------------------------------+
                          |   Servicio de Correo Email   |
                          |      (Resend / Nodemailer)   |
                          +------------------------------+
```

---

## 3. Especificación de Componentes

### 3.1 Backend Central (Node.js + Express + Socket.IO)
* **Función:** Es la autoridad central de estado del sistema.
* **Responsabilidades:**
  * Mantener el estado actual del sistema (`DISARMED`, `ARMED`, `TRIGGERED`).
  * Almacenar y validar la configuración de franjas horarias de vigilancia.
  * Emitir eventos WebSocket bidireccionales en tiempo real a la App y al ESP32.
  * Recibir imágenes/evidencia fotográfica de la app móvil cuando se detecta una intrusión.
  * Formatear y despachar correos electrónicos de alerta críticos mediante un servicio SMTP/API REST.

### 3.2 Aplicación Móvil (React Native + Expo Dev Build)
* **Función:** Interfaz de usuario principal, motor de captura de video/foto y servicio de segundo plano.
* **Responsabilidades:**
  * Proveer una UI fluida para consultar estado, armar/desarmar y configurar horarios.
  * Integrar la cámara (`expo-camera` o `react-native-vision-camera`) para capturar fotogramas/evidencia.
  * Ejecutar un **Foreground Service en Android** con notificación persistente para mantener la conexión WebSocket activa permanentemente sin que el SO mate el proceso.
  * Transmitir la imagen codificada en Base64/Multipart al backend al dispararse una alarma.

### 3.3 Microcontrolador ESP32 (Panel de Control e Interacción Física)
* **Función:** Interfaz física de control y alerta sonora/visual local.
* **Hardware Requerido:**
  * LED Verde (Estado: Desarmado)
  * LED Rojo (Estado: Armado / Alerta titilando)
  * Buzzer / Sirena pasiva (Alarma sonora)
  * Botón físico (Conmutador Armar/Desarmar con Anti-bounce)
* **Responsabilidades:**
  * Conectarse a la red Wi-Fi y entablar conexión con el Backend via WebSocket o HTTP Long-Polling.
  * Sincronizar su estado físico (LEDs) según el estado global retornado por el servidor.
  * Permitir armar/desarmar manualmente mediante el botón físico.

---

## 4. Máquina de Estados del Sistema

```
                  +-----------------------------------+
                  |                                   |
                  v                                   |
            +-----------+     Evento: ARM             |
            | DISARMED  | --------------------+       |
            +-----------+                     |       |
                  ^                           v       | Evento: DISARM
                  |                     +-----------+ |
   Evento: DISARM |                     |   ARMED   | |
                  |                     +-----+-----+ |
                  |                           |       |
                  |     Detección de          |       |
                  |     Intrusión en Horario  |       |
                  |                           v       |
                  |                     +-----------+ |
                  +-------------------- | TRIGGERED |-+
                                        +-----------+
```

1. **`DISARMED` (Desarmado):** El sistema no reacciona a eventos de movimiento. La cámara puede estar en reposo. LED Verde encendido en ESP32.
2. **`ARMED` (Armado):** El sistema supervisa activamente. Si la app móvil detecta movimiento o el horario programado se activa, se prepara para el disparo. LED Rojo encendido en ESP32.
3. **`TRIGGERED` (Alerta Disparada):** Intrusión confirmada dentro de franja activa. El backend envía el correo con foto, el ESP32 activa la sirena sonora y el LED rojo titila.

---

## 5. Endpoints de la API REST (Backend)

| Método | Ruta | Descripción | Payload Request | Respuesta Éxito (200) |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/status` | Consulta el estado actual | N/A | `{ success: true, data: SystemStatus }` |
| `POST` | `/api/status` | Cambia estado (Armar/Desarmar) | `{ state: "ARMED" \| "DISARMED" }` | `{ success: true, data: SystemStatus }` |
| `GET` | `/api/schedule` | Obtiene horarios de vigilancia | N/A | `{ success: true, data: ScheduleConfig }` |
| `POST` | `/api/schedule`| Actualiza franja horaria | `{ schedule: ScheduleConfig }` | `{ success: true, data: ScheduleConfig }` |
| `POST` | `/api/alert` | Reporta intrusión + Foto | `{ triggerType: string, imageBase64: string }` | `{ success: true, alertId: string }` |
| `GET` | `/api/logs` | Historial de alertas | N/A | `{ success: true, data: IntrusionLog[] }` |

---

## 6. Eventos de WebSocket (Socket.IO)

### Servidor -> Clientes (Broadcast)
* `system:status_changed`: Notifica a todos los clientes (Móvil y ESP32) que el estado cambió (`DISARMED` $\rightarrow$ `ARMED` $\rightarrow$ `TRIGGERED`).
* `system:schedule_updated`: Envía la nueva configuración de horarios.
* `alert:triggered`: Notifica el disparo inmediato de una alarma en tiempo real.

### Clientes -> Servidor
* `client:set_status`: Solicita cambio de estado desde la App o el ESP32.
* `esp32:telemetry`: El ESP32 reporta su estado de conexión, IP y nivel de señal RSSI.
* `mobile:heartbeat`: La app reporta que el Foreground Service continúa vivo.

---

## 7. Manejo de Resiliencia y Reconexión
1. **Pérdida de Wi-Fi en ESP32:** El firmware debe reintentar la conexión Wi-Fi cada 5 segundos de forma no bloqueante (`millis()`, no `delay()`).
2. **Caída del Backend:** La app móvil y el ESP32 deben implementar lógica de reconexión exponencial para los sockets.
3. **Móvil minimizado:** Android destruirá sockets si la app no utiliza un `Foreground Service` con canal de alta prioridad.