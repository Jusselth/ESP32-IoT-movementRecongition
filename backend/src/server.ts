import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { WebSocketServer, WebSocket } from 'ws';
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

  // Emitir a clientes Socket.IO (App Móvil)
  io.emit('system:status_changed', updatedStatus);

  // Broadcast a clientes WebSocket Nativo (ESP32)
  const espMessage = JSON.stringify({
    type: 'status_changed',
    state: newState,
    updatedBy: source,
    timestamp: lastUpdatedStateTime,
  });

  espWss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(espMessage);
    }
  });

  console.log(`[SystemState] 🔄 Estado cambiado a: ${newState} por: ${source}`);
  return updatedStatus;
}

// ============================================================================
// 3. CONFIGURACIÓN DEL SERVIDOR EXPRESS, SOCKET.IO Y WEBSOCKET NATIVO ESP32
// ============================================================================

const app = express();
const server = http.createServer(app);

// Socket.IO para App Móvil
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// WebSocket Nativo para ESP32
const espWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = request.url;

  if (pathname === '/ws/esp32') {
    espWss.handleUpgrade(request, socket, head, (ws) => {
      espWss.emit('connection', ws, request);
    });
  }
});

espWss.on('connection', (ws: WebSocket) => {
  console.log('[ESP32 Native WS] 🔌 ESP32 Conectado por WebSocket Nativo');

  // Enviar estado actual al conectar
  ws.send(JSON.stringify({
    type: 'status_changed',
    state: currentSystemState,
    updatedBy: lastUpdatedStateBy,
  }));

  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('[ESP32 Native WS] 📩 Mensaje recibido:', data);

      // 1. Manejar botón de armar/desarmar ('b')
      if (data.buttonPressed) {
        const nextState: SystemState = currentSystemState === 'DISARMED' ? 'ARMED' : 'DISARMED';
        await updateSystemState(nextState, 'ESP32_BUTTON');
      }

      // 2. Manejar comando de pánico / alerta de sensor ('t')
      if (data.panicPressed) {
        console.log('[ESP32 Native WS] 🚨 Disparo de Alerta/Pánico recibido desde el ESP32');
        await updateSystemState('TRIGGERED', 'ESP32_PANIC_BUTTON');
      }
    } catch (err) {
      console.error('[ESP32 Native WS] Error parseando mensaje:', err);
    }
  });

  ws.on('close', () => {
    console.log('[ESP32 Native WS] 🔴 ESP32 Desconectado');
  });
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================================================
// 4. ENDPOINTS API REST
// ============================================================================

app.get('/api/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: getSystemStatus(), timestamp: new Date().toISOString() });
});

app.post('/api/status', async (req: Request, res: Response) => {
  const body: UpdateStatusDto = req.body;
  if (!body || !body.state || !['ARMED', 'DISARMED', 'TRIGGERED'].includes(body.state)) {
    res.status(400).json({ success: false, error: 'Estado inválido.', timestamp: new Date().toISOString() });
    return;
  }
  const updated = await updateSystemState(body.state, body.source || 'REST_API');
  res.json({ success: true, data: updated, timestamp: new Date().toISOString() });
});

app.get('/api/schedule', (_req: Request, res: Response) => {
  res.json({ success: true, data: scheduleConfig, timestamp: new Date().toISOString() });
});

app.post('/api/schedule', async (req: Request, res: Response) => {
  const body: UpdateScheduleDto = req.body;
  if (!body || !body.schedule) {
    res.status(400).json({ success: false, error: 'Payload incompleto.', timestamp: new Date().toISOString() });
    return;
  }
  scheduleConfig = { ...body.schedule };
  await saveScheduleConfigToDb(scheduleConfig);
  io.emit('system:schedule_updated', scheduleConfig);
  res.json({ success: true, data: scheduleConfig, timestamp: new Date().toISOString() });
});

app.post('/api/alert', async (req: Request, res: Response) => {
  const body: ReportAlertDto = req.body;
  const triggerSource: TriggerSource = body.triggerSource || 'MOBILE_CAMERA';
  const alertTimestamp = body.timestamp || new Date().toISOString();

  console.log(`[Alert] 🚨 Alerta reportada desde: ${triggerSource}`);
  await updateSystemState('TRIGGERED', triggerSource);

  const alertId = `alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Procesar arreglo de imágenes Base64 (admite ráfaga 'imagesBase64' o foto única 'imageBase64')
  let formattedImages: string[] = [];
  if (body.imagesBase64 && Array.isArray(body.imagesBase64) && body.imagesBase64.length > 0) {
    formattedImages = body.imagesBase64.map((img) => {
      const sanitized = img.trim().replace(/[\r\n]/g, '');
      return sanitized.startsWith('data:image') ? sanitized : `data:image/jpeg;base64,${sanitized}`;
    });
  } else if (body.imageBase64) {
    const sanitized = body.imageBase64.trim().replace(/[\r\n]/g, '');
    formattedImages.push(sanitized.startsWith('data:image') ? sanitized : `data:image/jpeg;base64,${sanitized}`);
  }

  const recipientEmail = config.alertRecipient || (config as any).email?.recipient || '';

  const intrusionLog: IntrusionLog = {
    id: alertId,
    timestamp: alertTimestamp,
    triggerSource,
    evidenceUrl: formattedImages[0] || undefined, // Primera foto para vista rápida
    evidenceUrls: formattedImages,                // Arreglo completo con la ráfaga de fotos
    emailSent: false,
    emailRecipient: recipientEmail,
    notes: body.additionalInfo,
  };

  await insertIntrusionLogToDb(intrusionLog);

  // Transmitir el DTO con la ráfaga completa al servicio de correo
  sendIntrusionAlertEmail(intrusionLog, body)
    .then(async (emailSuccess: boolean) => {
      intrusionLog.emailSent = emailSuccess;
      await updateIntrusionLogEmailStatusDb(alertId, emailSuccess);
    })
    .catch((err: unknown) => {
      console.error('[Alert] Error en envío de email:', err);
    });

  io.emit('alert:triggered', intrusionLog);
  res.status(200).json({
    success: true,
    data: { alertId, imagesCaptured: formattedImages.length },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/logs', async (_req: Request, res: Response) => {
  const logsFromDb = await fetchIntrusionLogsFromDb();
  res.json({ success: true, data: logsFromDb, timestamp: new Date().toISOString() });
});

// ============================================================================
// 5. MANEJO DE EVENTOS SOCKET.IO (APP MÓVIL)
// ============================================================================

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  console.log(`[Socket.IO] 🔌 Cliente móvil conectado: ${socket.id}`);

  socket.emit('system:status_changed', getSystemStatus());
  socket.emit('system:schedule_updated', scheduleConfig);

  socket.on('client:set_status', async (dto: UpdateStatusDto, callback?: (res: ApiResponse<SystemStatus>) => void) => {
    const newStatus = await updateSystemState(dto.state, dto.source || `SOCKET_${socket.id.substring(0, 5)}`);
    if (callback) {
      callback({ success: true, data: newStatus, timestamp: new Date().toISOString() });
    }
  });

  socket.on('mobile:heartbeat', (data: MobileHeartbeat) => {
    console.log(`[Mobile Heartbeat] Batería: ${data.batteryLevel}%`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket.IO] ❌ Cliente móvil desconectado (${socket.id}): ${reason}`);
  });
});

// ============================================================================
// 6. INICIALIZACIÓN DEL SERVIDOR
// ============================================================================

async function startServer() {
  console.log('🔄 Sincronizando datos desde Supabase...');
  const statusDb = await fetchSystemStatusFromDb();
  currentSystemState = statusDb.state;
  lastUpdatedStateTime = statusDb.lastUpdated;
  lastUpdatedStateBy = statusDb.updatedBy;

  scheduleConfig = await fetchScheduleConfigFromDb();

  const PORT = config.port;
  server.listen(PORT, () => {
    console.log(`
=====================================================
🚀 Backend Servidor IoT iniciado exitosamente
📡 Puerto HTTP/Socket.IO: ${PORT}
🔌 Endpoint WebSocket ESP32: ws://localhost:${PORT}/ws/esp32
🛢️ Persistencia: Supabase PostgreSQL Conectado
=====================================================
    `);
  });
}

startServer();

export { app, server, io };