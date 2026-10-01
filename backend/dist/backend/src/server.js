"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.server = exports.app = void 0;
exports.checkIsWithinSchedule = checkIsWithinSchedule;
exports.getSystemStatus = getSystemStatus;
exports.updateSystemState = updateSystemState;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const config_1 = require("./config");
const email_1 = require("./services/email");
// ============================================================================
// 1. ESTADO GLOBAL EN MEMORIA
// ============================================================================
let currentSystemState = 'DISARMED';
let lastUpdatedStateTime = new Date().toISOString();
let lastUpdatedStateBy = 'INITIALIZATION';
let scheduleConfig = {
    enabled: false,
    startTime: '22:00',
    endTime: '06:00',
    activeDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
};
const intrusionLogs = [];
// ============================================================================
// 2. FUNCIONES AUXILIARES DE LÓGICA Y HORARIOS
// ============================================================================
const DAYS_MAP = {
    0: 'SUNDAY',
    1: 'MONDAY',
    2: 'TUESDAY',
    3: 'WEDNESDAY',
    4: 'THURSDAY',
    5: 'FRIDAY',
    6: 'SATURDAY',
};
/**
 * Valida si la fecha/hora actual se encuentra dentro de la franja horaria programada.
 */
function checkIsWithinSchedule(sched, date = new Date()) {
    if (!sched.enabled) {
        return false;
    }
    const dayOfWeek = DAYS_MAP[date.getDay()];
    if (!dayOfWeek)
        return false;
    const currentMinutes = date.getHours() * 60 + date.getMinutes();
    const [startH, startM] = sched.startTime.split(':').map(Number);
    const [endH, endM] = sched.endTime.split(':').map(Number);
    if (startH === undefined || startM === undefined || endH === undefined || endM === undefined) {
        return false;
    }
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    if (startMinutes <= endMinutes) {
        // Franja dentro del mismo día (ej: 08:00 a 18:00)
        const isTimeInWindow = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        return isTimeInWindow && sched.activeDays.includes(dayOfWeek);
    }
    else {
        // Franja nocturna que cruza la medianoche (ej: 22:00 a 06:00)
        if (currentMinutes >= startMinutes) {
            // Estamos en la noche del día actual
            return sched.activeDays.includes(dayOfWeek);
        }
        else if (currentMinutes <= endMinutes) {
            // Estamos en la madrugada del día siguiente.
            // Verificar si el día anterior estaba en activeDays
            const previousDayNum = (date.getDay() + 6) % 7;
            const previousDay = DAYS_MAP[previousDayNum];
            return previousDay ? sched.activeDays.includes(previousDay) : false;
        }
    }
    return false;
}
/**
 * Genera la estructura del estado actual del sistema.
 */
function getSystemStatus() {
    return {
        state: currentSystemState,
        lastUpdated: lastUpdatedStateTime,
        updatedBy: lastUpdatedStateBy,
        isWithinSchedule: checkIsWithinSchedule(scheduleConfig),
    };
}
/**
 * Cambia el estado global del sistema y notifica a los clientes vía Socket.IO.
 */
function updateSystemState(newState, source) {
    currentSystemState = newState;
    lastUpdatedStateTime = new Date().toISOString();
    lastUpdatedStateBy = source;
    const updatedStatus = getSystemStatus();
    io.emit('system:status_changed', updatedStatus);
    console.log(`[SystemState] 🔄 Estado cambiado a: ${newState} por: ${source}`);
    return updatedStatus;
}
// ============================================================================
// 3. CONFIGURACIÓN DEL SERVIDOR EXPRESS Y SOCKET.IO
// ============================================================================
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
exports.server = server;
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
exports.io = io;
// Middlewares Express (Límite alto de payload para imágenes Base64)
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '15mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '15mb' }));
// ============================================================================
// 4. ENDPOINTS API REST
// ============================================================================
/**
 * GET /api/status - Obtiene el estado actual del sistema.
 */
app.get('/api/status', (_req, res) => {
    const response = {
        success: true,
        data: getSystemStatus(),
        timestamp: new Date().toISOString(),
    };
    res.json(response);
});
/**
 * POST /api/status - Cambia el estado del sistema (ARMED | DISARMED | TRIGGERED).
 */
app.post('/api/status', (req, res) => {
    const body = req.body;
    if (!body || !body.state || !['ARMED', 'DISARMED', 'TRIGGERED'].includes(body.state)) {
        const errorResponse = {
            success: false,
            error: 'Estado inválido. Debe ser ARMED, DISARMED o TRIGGERED.',
            timestamp: new Date().toISOString(),
        };
        res.status(400).json(errorResponse);
        return;
    }
    const updated = updateSystemState(body.state, body.source || 'REST_API');
    const response = {
        success: true,
        data: updated,
        timestamp: new Date().toISOString(),
    };
    res.json(response);
});
/**
 * GET /api/schedule - Obtiene la configuración de franja horaria.
 */
app.get('/api/schedule', (_req, res) => {
    const response = {
        success: true,
        data: scheduleConfig,
        timestamp: new Date().toISOString(),
    };
    res.json(response);
});
/**
 * POST /api/schedule - Actualiza la configuración de franja horaria.
 */
app.post('/api/schedule', (req, res) => {
    const body = req.body;
    if (!body || !body.schedule) {
        const errorResponse = {
            success: false,
            error: 'Payload incompleto. Se requiere el objeto schedule.',
            timestamp: new Date().toISOString(),
        };
        res.status(400).json(errorResponse);
        return;
    }
    scheduleConfig = { ...body.schedule };
    io.emit('system:schedule_updated', scheduleConfig);
    console.log('[Schedule] 📅 Franja horaria actualizada:', scheduleConfig);
    const response = {
        success: true,
        data: scheduleConfig,
        timestamp: new Date().toISOString(),
    };
    res.json(response);
});
/**
 * POST /api/alert - Reporta una alerta de intrusión con evidencia fotográfica.
 */
app.post('/api/alert', async (req, res) => {
    const body = req.body;
    const triggerSource = body.triggerSource || 'MOBILE_CAMERA';
    const alertTimestamp = body.timestamp || new Date().toISOString();
    console.log(`[Alert] 🚨 Alerta reportada desde: ${triggerSource}`);
    // Cambiar estado del sistema a TRIGGERED si no lo está
    updateSystemState('TRIGGERED', triggerSource);
    // Crear registro de log de la intrusión
    const alertId = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const intrusionLog = {
        id: alertId,
        timestamp: alertTimestamp,
        triggerSource,
        evidenceUrl: body.imageBase64 ? `data:image/jpeg;base64,${body.imageBase64.substring(0, 30)}...` : undefined,
        emailSent: false,
        emailRecipient: config_1.config.SMTP_TO,
        notes: body.additionalInfo,
    };
    intrusionLogs.unshift(intrusionLog);
    // Intentar enviar correo electrónico de alerta en segundo plano
    (0, email_1.sendAlertEmail)({
        imageBase64: body.imageBase64,
        timestamp: alertTimestamp,
        triggerSource,
        additionalInfo: body.additionalInfo,
    }).then((emailSuccess) => {
        intrusionLog.emailSent = emailSuccess;
    }).catch((err) => {
        console.error('[Alert] Error inesperado en envío de email:', err);
    });
    // Notificar a todos los clientes conectados vía Socket.IO
    io.emit('alert:triggered', intrusionLog);
    const response = {
        success: true,
        data: { alertId },
        timestamp: new Date().toISOString(),
    };
    res.status(200).json(response);
});
/**
 * GET /api/logs - Consulta el historial de alertas e intrusiones.
 */
app.get('/api/logs', (_req, res) => {
    const response = {
        success: true,
        data: intrusionLogs,
        timestamp: new Date().toISOString(),
    };
    res.json(response);
});
// ============================================================================
// 5. MANEJO DE EVENTOS SOCKET.IO
// ============================================================================
io.on('connection', (socket) => {
    console.log(`[Socket.IO] 🔌 Cliente conectado: ${socket.id}`);
    // Enviar estado inicial y configuración al cliente recién conectado
    socket.emit('system:status_changed', getSystemStatus());
    socket.emit('system:schedule_updated', scheduleConfig);
    // Evento client:set_status
    socket.on('client:set_status', (dto, callback) => {
        console.log(`[Socket.IO] 📩 Solicitud client:set_status ->`, dto);
        const newStatus = updateSystemState(dto.state, dto.source || `SOCKET_${socket.id.substring(0, 5)}`);
        if (callback) {
            callback({
                success: true,
                data: newStatus,
                timestamp: new Date().toISOString(),
            });
        }
    });
    // Evento esp32:telemetry
    socket.on('esp32:telemetry', (telemetry) => {
        console.log(`[ESP32 Telemetry] IP: ${telemetry.ipAddress} | RSSI: ${telemetry.wifiRssi}dBm | Heap: ${telemetry.freeHeap}B`);
        // Si el botón físico fue presionado, conmutar estado (ARMED <-> DISARMED)
        if (telemetry.buttonPressed) {
            const nextState = currentSystemState === 'DISARMED' ? 'ARMED' : 'DISARMED';
            updateSystemState(nextState, 'ESP32_BUTTON');
        }
    });
    // Evento mobile:heartbeat
    socket.on('mobile:heartbeat', (data) => {
        console.log(`[Mobile Heartbeat] Batería: ${data.batteryLevel}% | ServiceActive: ${data.isForegroundServiceActive} | CameraReady: ${data.cameraReady}`);
    });
    // Evento client:ping
    socket.on('client:ping', (ts) => {
        socket.emit('server:pong', ts);
    });
    socket.on('disconnect', (reason) => {
        console.log(`[Socket.IO] ❌ Cliente desconectado (${socket.id}): ${reason}`);
    });
});
// ============================================================================
// 6. VERIFICADOR PERIÓDICO DE HORARIOS
// ============================================================================
setInterval(() => {
    const status = getSystemStatus();
    // Si está desarmado pero estamos dentro de horario programado, se podría auto-armar si está configurado
    if (scheduleConfig.enabled && status.isWithinSchedule && currentSystemState === 'DISARMED') {
        console.log('[AutoArm] ⏰ Horario activo detectado. Auto-armando sistema...');
        updateSystemState('ARMED', 'SCHEDULE_AUTO');
    }
}, 60000); // Cada 60 segundos
// ============================================================================
// 7. INICIO DEL SERVIDOR
// ============================================================================
const PORT = config_1.config.PORT;
server.listen(PORT, () => {
    console.log(`
=====================================================
🚀 Backend Servidor IoT iniciado exitosamente
📡 Puerto HTTP/Socket.IO: ${PORT}
📧 Correo Destino Alertas: ${config_1.config.SMTP_TO || '(No configurado)'}
=====================================================
  `);
});
