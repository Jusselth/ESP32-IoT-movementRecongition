import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { config } from './config';
import { sendIntrusionAlertEmail } from './services/email';
import {
  fetchSystemStatusFromDb,
  saveSystemStatusToDb,
  fetchScheduleConfigFromDb,
  saveScheduleConfigToDb,
  insertIntrusionLogToDb,
  updateIntrusionLogEmailStatusDb,
  fetchIntrusionLogsFromDb,
} from './services/db';
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
// 1. ESTADO GLOBAL EN MEMORIA (CACHE)
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

// ============================================================================
// 2. FUNCIONES AUXILIARES Y DE SINCRONIZACIÓN
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

export function checkIsWithinSchedule(sched: ScheduleConfig, date: Date = new Date()): boolean {
  if (!sched.enabled) return false;

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
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes && sched.activeDays.includes(dayOfWeek);
  } else {
    if (currentMinutes >= startMinutes) {
      return sched.activeDays.includes(dayOfWeek);
    } else if (currentMinutes <= endMinutes) {
      const previousDayNum = (date.getDay() + 6) % 7;
      const previousDay = DAYS_MAP[previousDayNum];
      return previousDay ? sched.activeDays.includes(previousDay) : false;
    }
  }

  return false;
}

export function getSystemStatus(): SystemStatus {
  return {
    state: currentSystemState,
    lastUpdated: lastUpdatedStateTime,
    updatedBy: lastUpdatedStateBy,
    isWithinSchedule: checkIsWithinSchedule(scheduleConfig),
  };
}

export async function updateSystemState(newState: SystemState, source: string): Promise<SystemStatus> {
  currentSystemState = newState;
  lastUpdatedStateTime = new Date().toISOString();
  lastUpdatedStateBy = source;

  const updatedStatus = getSystemStatus();

  // Persistir en Supabase
  await saveSystemStatusToDb(newState, source);

  // Emitir evento por Socket.IO
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
  allowEIO3: true, // 👈 Permite la negociación con clientes WebSocket de Arduino/ESP32
  transports: ['websocket', 'polling'], // 👈 Permite la conexión WebSocket directa
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================================================
// 4. ENDPOINTS API REST
// ============================================================================

app.get('/api/status', (_req: Request, res: Response) => {
  const response: ApiResponse<SystemStatus> = {
    success: true,
    data: getSystemStatus(),
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

app.post('/api/status', async (req: Request, res: Response) => {
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

  const updated = await updateSystemState(body.state, body.source || 'REST_API');

  const response: ApiResponse<SystemStatus> = {
    success: true,
    data: updated,
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

app.get('/api/schedule', (_req: Request, res: Response) => {
  const response: ApiResponse<ScheduleConfig> = {
    success: true,
    data: scheduleConfig,
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

app.post('/api/schedule', async (req: Request, res: Response) => {
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
  await saveScheduleConfigToDb(scheduleConfig);
  io.emit('system:schedule_updated', scheduleConfig);

  console.log('[Schedule] 📅 Franja horaria actualizada y guardada:', scheduleConfig);

  const response: ApiResponse<ScheduleConfig> = {
    success: true,
    data: scheduleConfig,
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

app.post('/api/alert', async (req: Request, res: Response) => {
  const body: ReportAlertDto = req.body;

  const triggerSource: TriggerSource = body.triggerSource || 'MOBILE_CAMERA';
  const alertTimestamp = body.timestamp || new Date().toISOString();

  console.log(`[Alert] 🚨 Alerta reportada desde: ${triggerSource}`);

  await updateSystemState('TRIGGERED', triggerSource);

  const alertId = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Formatear Base64 COMPLETO sin recortar
  let formattedEvidenceUrl: string | undefined = undefined;
  if (body.imageBase64) {
    const sanitized = body.imageBase64.trim().replace(/[\r\n]/g, '');
    formattedEvidenceUrl = sanitized.startsWith('data:image')
      ? sanitized
      : `data:image/jpeg;base64,${sanitized}`;
  }

  const recipientEmail = config.alertRecipient || (config as any).email?.recipient || '';

  const intrusionLog: IntrusionLog = {
    id: alertId,
    timestamp: alertTimestamp,
    triggerSource,
    evidenceUrl: formattedEvidenceUrl,
    emailSent: false,
    emailRecipient: recipientEmail,
    notes: body.additionalInfo,
  };

  // Insertar en Supabase
  await insertIntrusionLogToDb(intrusionLog);

  // Enviar correo de alerta
  sendIntrusionAlertEmail(intrusionLog, body)
    .then(async (emailSuccess: boolean) => {
      intrusionLog.emailSent = emailSuccess;
      await updateIntrusionLogEmailStatusDb(alertId, emailSuccess);
    })
    .catch((err: unknown) => {
      console.error('[Alert] Error inesperado en envío de email:', err);
    });

  io.emit('alert:triggered', intrusionLog);

  const response: ApiResponse<{ alertId: string }> = {
    success: true,
    data: { alertId },
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(response);
});

app.get('/api/logs', async (_req: Request, res: Response) => {
  const logsFromDb = await fetchIntrusionLogsFromDb();
  const response: ApiResponse<IntrusionLog[]> = {
    success: true,
    data: logsFromDb,
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

// ============================================================================
// 5. MANEJO DE EVENTOS SOCKET.IO
// ============================================================================

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  console.log(`[Socket.IO] 🔌 Cliente conectado: ${socket.id}`);

  socket.emit('system:status_changed', getSystemStatus());
  socket.emit('system:schedule_updated', scheduleConfig);

  socket.on('client:set_status', async (dto: UpdateStatusDto, callback?: (res: ApiResponse<SystemStatus>) => void) => {
    console.log(`[Socket.IO] 📩 Solicitud client:set_status ->`, dto);
    const newStatus = await updateSystemState(dto.state, dto.source || `SOCKET_${socket.id.substring(0, 5)}`);

    if (callback) {
      callback({
        success: true,
        data: newStatus,
        timestamp: new Date().toISOString(),
      });
    }
  });

  socket.on('esp32:telemetry', async (telemetry: ESP32Telemetry) => {
    console.log(`[ESP32 Telemetry] IP: ${telemetry.ipAddress} | RSSI: ${telemetry.wifiRssi}dBm | Heap: ${telemetry.freeHeap}B`);

    if (telemetry.buttonPressed) {
      const nextState: SystemState = currentSystemState === 'DISARMED' ? 'ARMED' : 'DISARMED';
      await updateSystemState(nextState, 'ESP32_BUTTON');
    }
  });

  socket.on('mobile:heartbeat', (data: MobileHeartbeat) => {
    console.log(`[Mobile Heartbeat] Batería: ${data.batteryLevel}% | ServiceActive: ${data.isForegroundServiceActive} | CameraReady: ${data.cameraReady}`);
  });

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

setInterval(async () => {
  const status = getSystemStatus();
  if (scheduleConfig.enabled && status.isWithinSchedule && currentSystemState === 'DISARMED') {
    console.log('[AutoArm] ⏰ Horario activo detectado. Auto-armando sistema...');
    await updateSystemState('ARMED', 'SCHEDULE_AUTO');
  }
}, 60000);

// ============================================================================
// 7. INICIALIZACIÓN DE DATOS Y ARRANQUE
// ============================================================================

async function startServer() {
  console.log('🔄 Sincronizando datos desde Supabase...');

  const statusDb = await fetchSystemStatusFromDb();
  currentSystemState = statusDb.state;
  lastUpdatedStateTime = statusDb.lastUpdated;
  lastUpdatedStateBy = statusDb.updatedBy;

  scheduleConfig = await fetchScheduleConfigFromDb();

  const PORT = config.port;
  const recipientEmail = config.alertRecipient || (config as any).email?.recipient || '(No configurado)';

  server.listen(PORT, () => {
    console.log(`
=====================================================
🚀 Backend Servidor IoT iniciado exitosamente
📡 Puerto HTTP/Socket.IO: ${PORT}
📧 Correo Destino Alertas: ${recipientEmail}
🛢️ Persistencia: Supabase PostgreSQL Conectado
=====================================================
    `);
  });
}

startServer();

export { app, server, io };