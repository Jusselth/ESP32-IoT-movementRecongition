import { create } from 'zustand';
import axios from 'axios';
import { socket } from '../services/socket';
import { API_URL } from '../config/env';
import {
    SystemStatus,
    ScheduleConfig,
    IntrusionLog,
    SystemState,
    TriggerSource,
    UpdateStatusDto,
    UpdateScheduleDto,
    ReportAlertDto,
    ApiResponse,
} from '../../../shared/types';

interface SystemStore {
    status: SystemStatus | null;
    schedule: ScheduleConfig | null;
    logs: IntrusionLog[];
    isConnected: boolean;

    // Acciones de sincronización y peticiones
    initSocketListeners: () => void;
    fetchInitialData: () => Promise<void>;
    updateStatus: (newState: SystemState, source?: TriggerSource) => Promise<void>;
    updateSchedule: (newSchedule: ScheduleConfig) => Promise<void>;
    reportAlert: (dto: ReportAlertDto) => Promise<void>;
}

export const useSystemStore = create<SystemStore>((set) => ({
    status: null,
    schedule: null,
    logs: [],
    isConnected: false,

    initSocketListeners: () => {
        if (socket.connected) return;

        socket.connect();

        socket.on('connect', () => {
            console.log('[Socket.IO] 🟢 Conectado al servidor backend');
            set({ isConnected: true });
        });

        socket.on('disconnect', () => {
            console.log('[Socket.IO] 🔴 Desconectado del servidor');
            set({ isConnected: false });
        });

        socket.on('system:status_changed', (status) => {
            console.log('[Socket.IO] 🔄 Estado cambiado:', status);
            set({ status });
        });

        socket.on('system:schedule_updated', (schedule) => {
            console.log('[Socket.IO] 📅 Horario actualizado:', schedule);
            set({ schedule });
        });

        socket.on('alert:triggered', (log) => {
            console.log('[Socket.IO] 🚨 Alerta de intrusión recibida:', log);
            set((state) => ({
                logs: [log, ...state.logs],
                status: state.status ? { ...state.status, state: 'TRIGGERED' } : null,
            }));
        });
    },

    fetchInitialData: async () => {
        try {
            const [statusRes, scheduleRes, logsRes] = await Promise.all([
                axios.get<ApiResponse<SystemStatus>>(`${API_URL}/api/status`),
                axios.get<ApiResponse<ScheduleConfig>>(`${API_URL}/api/schedule`),
                axios.get<ApiResponse<IntrusionLog[]>>(`${API_URL}/api/logs`),
            ]);

            set({
                status: statusRes.data.data || null,
                schedule: scheduleRes.data.data || null,
                logs: logsRes.data.data || [],
            });
        } catch (error) {
            console.error('[REST] Error al cargar datos iniciales:', error);
        }
    },

    updateStatus: async (newState: SystemState, source: TriggerSource = 'MOBILE_CAMERA') => {
        try {
            const dto: UpdateStatusDto = { state: newState, source };
            await axios.post<ApiResponse<SystemStatus>>(`${API_URL}/api/status`, dto);
        } catch (error) {
            console.error('[REST] Error al cambiar estado:', error);
        }
    },

    updateSchedule: async (newSchedule: ScheduleConfig) => {
        try {
            const dto: UpdateScheduleDto = { schedule: newSchedule };
            await axios.post<ApiResponse<ScheduleConfig>>(`${API_URL}/api/schedule`, dto);
        } catch (error) {
            console.error('[REST] Error al guardar horario:', error);
        }
    },

    reportAlert: async (dto: ReportAlertDto) => {
        try {
            await axios.post<ApiResponse<{ alertId: string }>>(`${API_URL}/api/alert`, dto);
        } catch (error) {
            console.error('[REST] Error al reportar alerta:', error);
        }
    },
}));