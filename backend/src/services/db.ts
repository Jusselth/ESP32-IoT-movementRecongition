import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { SystemStatus, ScheduleConfig, IntrusionLog, SystemState, DayOfWeek } from '../../../shared/types';

export const supabase = createClient(config.supabase.url, config.supabase.key);

/**
 * Obtiene el estado actual del sistema desde Supabase.
 */
export async function fetchSystemStatusFromDb(): Promise<SystemStatus> {
    const { data, error } = await supabase
        .from('system_status')
        .select('state, last_updated, updated_by')
        .eq('id', 1)
        .maybeSingle();

    if (error) {
        console.error('⚠️ Error al consultar system_status en Supabase:', error.message);
    }

    if (!data) {
        console.log('ℹ️ Registrando fila inicial de system_status en Supabase...');
        const defaultState: SystemState = 'DISARMED';
        const defaultUpdatedBy = 'INITIALIZATION';

        await saveSystemStatusToDb(defaultState, defaultUpdatedBy);

        return {
            state: defaultState,
            lastUpdated: new Date().toISOString(),
            updatedBy: defaultUpdatedBy,
            isWithinSchedule: false,
        };
    }

    return {
        state: data.state as SystemState,
        lastUpdated: new Date(data.last_updated).toISOString(),
        updatedBy: data.updated_by,
        isWithinSchedule: false,
    };
}
/**
 * Actualiza o crea el estado global del sistema en Supabase (id = 1).
 */
export async function saveSystemStatusToDb(state: SystemState, updatedBy: string): Promise<void> {
    const { error } = await supabase
        .from('system_status')
        .upsert({
            id: 1,
            state,
            last_updated: new Date().toISOString(),
            updated_by: updatedBy,
        });

    if (error) {
        console.error('❌ Error al actualizar system_status en Supabase:', error.message);
    } else {
        console.log(`[Supabase] 🛢️ Estado guardado exitosamente: ${state}`);
    }
}

/**
 * Obtiene la configuración de la franja horaria desde Supabase o crea la fila inicial si no existe.
 */
export async function fetchScheduleConfigFromDb(): Promise<ScheduleConfig> {
    const { data, error } = await supabase
        .from('schedule_config')
        .select('enabled, start_time, end_time, active_days')
        .eq('id', 1)
        .maybeSingle();

    if (error) {
        console.error('⚠️ Error al consultar schedule_config en Supabase:', error.message);
    }

    const defaultConfig: ScheduleConfig = {
        enabled: false,
        startTime: '22:00',
        endTime: '06:00',
        activeDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
    };

    if (!data) {
        console.log('ℹ️ Registrando fila inicial de schedule_config en Supabase...');
        await saveScheduleConfigToDb(defaultConfig);
        return defaultConfig;
    }

    return {
        enabled: data.enabled,
        startTime: data.start_time,
        endTime: data.end_time,
        activeDays: data.active_days as DayOfWeek[],
    };
}

/**
 * Guarda o crea la configuración de la franja horaria en Supabase (id = 1).
 */
export async function saveScheduleConfigToDb(schedule: ScheduleConfig): Promise<void> {
    const { error } = await supabase
        .from('schedule_config')
        .upsert({
            id: 1,
            enabled: schedule.enabled,
            start_time: schedule.startTime,
            end_time: schedule.endTime,
            active_days: schedule.activeDays,
        });

    if (error) {
        console.error('❌ Error al actualizar schedule_config en Supabase:', error.message);
    } else {
        console.log('[Supabase] 🛢️ Horario guardado en base de datos');
    }
}
/**
 * Inserta un registro de intrusión en Supabase.
 */
export async function insertIntrusionLogToDb(log: IntrusionLog): Promise<void> {
    const { error } = await supabase.from('intrusion_logs').insert([
        {
            id: log.id,
            timestamp: log.timestamp,
            trigger_source: log.triggerSource,
            evidence_url: log.evidenceUrl,
            email_sent: log.emailSent,
            email_recipient: log.emailRecipient,
            notes: log.notes,
        },
    ]);

    if (error) {
        console.error('❌ Error al insertar intrusion_log en Supabase:', error.message);
    }
}

/**
 * Actualiza el estado de envío de email en un registro de intrusión.
 */
export async function updateIntrusionLogEmailStatusDb(id: string, emailSent: boolean): Promise<void> {
    const { error } = await supabase
        .from('intrusion_logs')
        .update({ email_sent: emailSent })
        .eq('id', id);

    if (error) {
        console.error('❌ Error al actualizar estado de email en Supabase:', error.message);
    }
}

/**
 * Obtiene el historial de logs de intrusión desde Supabase.
 */
export async function fetchIntrusionLogsFromDb(): Promise<IntrusionLog[]> {
    const { data, error } = await supabase
        .from('intrusion_logs')
        .select('*')
        .order('created_at', { ascending: false });

    if (error || !data) {
        console.error('⚠️ Error al consultar intrusion_logs en Supabase:', error?.message);
        return [];
    }

    return data.map((item) => ({
        id: item.id,
        timestamp: item.timestamp,
        triggerSource: item.trigger_source,
        evidenceUrl: item.evidence_url,
        emailSent: item.email_sent,
        emailRecipient: item.email_recipient,
        notes: item.notes,
    }));
}