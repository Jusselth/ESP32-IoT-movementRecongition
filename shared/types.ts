/**
 * shared/types.ts
 * Definición única de contratos de tipos TypeScript para el Sistema de Detección de Intrusos.
 * Utilizado por Backend, App Móvil y referencias de código.
 */

// ==========================================
// 1. ESTADOS Y ENUMS DEL SISTEMA
// ==========================================

export type SystemState = 'DISARMED' | 'ARMED' | 'TRIGGERED';

export type TriggerSource = 'MOBILE_CAMERA' | 'ESP32_BUTTON' | 'MANUAL_APP' | 'SCHEDULE_AUTO';

export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

// ==========================================
// 2. MODELOS DE DATOS
// ==========================================

export interface ScheduleConfig {
  enabled: boolean;
  startTime: string; // Formato HH:mm (24h), ej: "22:00"
  endTime: string;   // Formato HH:mm (24h), ej: "06:00"
  activeDays: DayOfWeek[];
}

export interface SystemStatus {
  state: SystemState;
  lastUpdated: string; // ISO Date String
  updatedBy: string;   // Dispositivo o usuario que modificó el estado
  isWithinSchedule: boolean;
}

export interface IntrusionLog {
  id: string;
  timestamp: string;  // ISO Date String
  triggerSource: TriggerSource;
  evidenceUrl?: string;     // Primera foto para vista rápida
  evidenceUrls?: string[];  // Arreglo completo de ráfaga
  emailSent: boolean;
  emailRecipient?: string;
  notes?: string;
}

// ==========================================
// 3. CONTRATOS API REST (HTTP REQUEST / RESPONSE)
// ==========================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface UpdateStatusDto {
  state: SystemState;
  source: TriggerSource;
}

export interface UpdateScheduleDto {
  schedule: ScheduleConfig;
}

export interface ReportAlertDto {
  triggerSource: TriggerSource;
  imageBase64?: string;   // Imagen individual (compatibilidad)
  imagesBase64?: string[]; // Arreglo de la ráfaga de fotos en Base64
  timestamp: string;
  additionalInfo?: string;
}

// ==========================================
// 4. PROTOCOLO WEBSOCKET (SOCKET.IO CONTRACTS)
// ==========================================

// Eventos enviados por el Servidor a los Clientes
export interface ServerToClientEvents {
  'system:status_changed': (status: SystemStatus) => void;
  'system:schedule_updated': (schedule: ScheduleConfig) => void;
  'alert:triggered': (log: IntrusionLog) => void;
  'server:pong': (timestamp: number) => void;
}

// Eventos enviados por los Clientes al Servidor
export interface ClientToServerEvents {
  'client:set_status': (dto: UpdateStatusDto, callback?: (res: ApiResponse<SystemStatus>) => void) => void;
  'esp32:telemetry': (telemetry: ESP32Telemetry) => void;
  'mobile:heartbeat': (data: MobileHeartbeat) => void;
  'client:ping': (timestamp: number) => void;
}

// ==========================================
// 5. TELEMETRÍA DE DISPOSITIVOS
// ==========================================

export interface ESP32Telemetry {
  ipAddress: string;
  wifiRssi: number; // Fuerza de la señal Wi-Fi en dBm
  uptimeSeconds: number;
  freeHeap: number; // Memoria RAM libre en bytes
  buttonPressed?: boolean;
}

export interface MobileHeartbeat {
  batteryLevel: number;
  isForegroundServiceActive: boolean;
  cameraReady: boolean;
}