import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { config } from './config';
import { sendAlertEmail } from './services/email';
import {
  SystemState,
  TriggerSource,
  DayOfWeek,
  ScheduleConfig,
  SystemStatus,
  IntrusionLog,
  ApiResponse,
  UpdateStatusDto,
  UpdateScheduleDto,
  ReportAlertDto,
  ServerToClientEvents,
  ClientToServerEvents,
  ESP32Telemetry,
  MobileHeartbeat,
} from '../../shared/types';

// ============================================================================
// 1. ESTADO GLOBAL EN MEMORIA
// ============================================================================

let currentSystemState: SystemState = 'DISARMED';
let lastUpdatedStateTime: string = new Date().toISOString();
let lastUpdatedStateBy: string = 'INITIALIZATION';

let scheduleConfig: ScheduleConfig = {
  enabled: false,
  startTime: '22:00',
  endTime: '06:00',
  activeDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
};

const intrusionLogs: IntrusionLog[] = [];

// ============================================================================
// 2. FUNCIONES AUXILIARES DE LÓGICA Y HORARIOS
// ============================================================================

const DAYS_MAP: Record<number, DayOfWeek> = {
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
export function checkIsWithinSchedule(sched: ScheduleConfig, date: Date = new Date()): boolean {
  if (!sched.enabled) {
    return false;
  }

  const dayOfWeek = DAYS_MAP[date.getDay()];
  if (!dayOfWeek) return false;

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
  } else {
    // Franja nocturna que cruza la medianoche (ej: 22:00 a 06:00)
    if (currentMinutes >= startMinutes) {
      // Estamos en la noche del día actual
      return sched.activeDays.includes(dayOfWeek);
    } else if (currentMinutes <= endMinutes) {
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
export function getSystemStatus(): SystemStatus {
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
export function updateSystemState(newState: SystemState, source: string): SystemStatus {
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

const app = express();
const server = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Middlewares Express (Límite alto de payload para imágenes Base64)
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ============================================================================
// 4. ENDPOINTS API REST
// ============================================================================

/**
 * GET /api/status - Obtiene el estado actual del sistema.
 */
app.get('/api/status', (_req: Request, res: Response) => {
  const response: ApiResponse<SystemStatus> = {
    success: true,
    data: getSystemStatus(),
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

/**
 * POST /api/status - Cambia el estado del sistema (ARMED | DISARMED | TRIGGERED).
 */
app.post('/api/status', (req: Request, res: Response) => {
  const body: UpdateStatusDto = req.body;
  
  if (!body || !body.state || !['ARMED', 'DISARMED', 'TRIGGERED'].includes(body.state)) {
    const errorResponse: ApiResponse<null> = {
      success: false,
      error: 'Estado inválido. Debe ser ARMED, DISARMED o TRIGGERED.',
      timestamp: new Date().toISOString(),
    };
    res.status(400).json(errorResponse);
    return;
  }

  const updated = updateSystemState(body.state, body.source || 'REST_API');

  const response: ApiResponse<SystemStatus> = {
    success: true,
    data: updated,
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

/**
 * GET /api/schedule - Obtiene la configuración de franja horaria.
 */
app.get('/api/schedule', (_req: Request, res: Response) => {
  const response: ApiResponse<ScheduleConfig> = {
    success: true,
    data: scheduleConfig,
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

/**
 * POST /api/schedule - Actualiza la configuración de franja horaria.
 */
app.post('/api/schedule', (req: Request, res: Response) => {
  const body: UpdateScheduleDto = req.body;

  if (!body || !body.schedule) {
    const errorResponse: ApiResponse<null> = {
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

  const response: ApiResponse<ScheduleConfig> = {
    success: true,
    data: scheduleConfig,
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

/**
 * POST /api/alert - Reporta una alerta de intrusión con evidencia fotográfica.
 */
app.post('/api/alert', async (req: Request, res: Response) => {
  const body: ReportAlertDto = req.body;

  const triggerSource: TriggerSource = body.triggerSource || 'MOBILE_CAMERA';
  const alertTimestamp = body.timestamp || new Date().toISOString();

  console.log(`[Alert] 🚨 Alerta reportada desde: ${triggerSource}`);

  // Cambiar estado del sistema a TRIGGERED si no lo está
  updateSystemState('TRIGGERED', triggerSource);

  // Crear registro de log de la intrusión
  const alertId = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  
  const intrusionLog: IntrusionLog = {
    id: alertId,
    timestamp: alertTimestamp,
    triggerSource,
    evidenceUrl: body.imageBase64 ? `data:image/jpeg;base64,${body.imageBase64.substring(0, 30)}...` : undefined,
    emailSent: false,
    emailRecipient: config.SMTP_TO,
    notes: body.additionalInfo,
  };

  intrusionLogs.unshift(intrusionLog);

  // Intentar enviar correo electrónico de alerta en segundo plano
  sendAlertEmail({
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

  const response: ApiResponse<{ alertId: string }> = {
    success: true,
    data: { alertId },
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(response);
});

/**
 * GET /api/logs - Consulta el historial de alertas e intrusiones.
 */
app.get('/api/logs', (_req: Request, res: Response) => {
  const response: ApiResponse<IntrusionLog[]> = {
    success: true,
    data: intrusionLogs,
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

// ============================================================================
// 5. MANEJO DE EVENTOS SOCKET.IO
// ============================================================================

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  console.log(`[Socket.IO] 🔌 Cliente conectado: ${socket.id}`);

  // Enviar estado inicial y configuración al cliente recién conectado
  socket.emit('system:status_changed', getSystemStatus());
  socket.emit('system:schedule_updated', scheduleConfig);

  // Evento client:set_status
  socket.on('client:set_status', (dto: UpdateStatusDto, callback?: (res: ApiResponse<SystemStatus>) => void) => {
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
  socket.on('esp32:telemetry', (telemetry: ESP32Telemetry) => {
    console.log(`[ESP32 Telemetry] IP: ${telemetry.ipAddress} | RSSI: ${telemetry.wifiRssi}dBm | Heap: ${telemetry.freeHeap}B`);

    // Si el botón físico fue presionado, conmutar estado (ARMED <-> DISARMED)
    if (telemetry.buttonPressed) {
      const nextState: SystemState = currentSystemState === 'DISARMED' ? 'ARMED' : 'DISARMED';
      updateSystemState(nextState, 'ESP32_BUTTON');
    }
  });

  // Evento mobile:heartbeat
  socket.on('mobile:heartbeat', (data: MobileHeartbeat) => {
    console.log(`[Mobile Heartbeat] Batería: ${data.batteryLevel}% | ServiceActive: ${data.isForegroundServiceActive} | CameraReady: ${data.cameraReady}`);
  });

  // Evento client:ping
  socket.on('client:ping', (ts: number) => {
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

const PORT = config.PORT;

server.listen(PORT, () => {
  console.log(`
=====================================================
🚀 Backend Servidor IoT iniciado exitosamente
📡 Puerto HTTP/Socket.IO: ${PORT}
📧 Correo Destino Alertas: ${config.SMTP_TO || '(No configurado)'}
=====================================================
  `);
});

export { app, server, io };
