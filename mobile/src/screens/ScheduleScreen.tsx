import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Switch,
    TextInput,
    ScrollView,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { useSystemStore } from '../store/useSystemStore';
import { ScheduleConfig, DayOfWeek } from '../../../shared/types';

const DAYS_LIST: { key: DayOfWeek; label: string }[] = [
    { key: 'MONDAY', label: 'L' },
    { key: 'TUESDAY', label: 'M' },
    { key: 'WEDNESDAY', label: 'X' },
    { key: 'THURSDAY', label: 'J' },
    { key: 'FRIDAY', label: 'V' },
    { key: 'SATURDAY', label: 'S' },
    { key: 'SUNDAY', label: 'D' },
];

export const ScheduleScreen = () => {
    const schedule = useSystemStore((state) => state.schedule);
    const updateSchedule = useSystemStore((state) => state.updateSchedule);

    const [enabled, setEnabled] = useState<boolean>(false);
    const [startTime, setStartTime] = useState<string>('22:00');
    const [endTime, setEndTime] = useState<string>('06:00');
    const [activeDays, setActiveDays] = useState<DayOfWeek[]>([
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
        'SUNDAY',
    ]);
    const [isSaving, setIsSaving] = useState<boolean>(false);

    // Sincronizar estado local cuando cargue el store
    useEffect(() => {
        if (schedule) {
            setEnabled(schedule.enabled);
            setStartTime(schedule.startTime);
            setEndTime(schedule.endTime);
            setActiveDays(schedule.activeDays);
        }
    }, [schedule]);

    const toggleDay = (dayKey: DayOfWeek) => {
        if (activeDays.includes(dayKey)) {
            setActiveDays(activeDays.filter((d) => d !== dayKey));
        } else {
            setActiveDays([...activeDays, dayKey]);
        }
    };

    const validateTimeFormat = (timeStr: string) => {
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        return timeRegex.test(timeStr);
    };

    const handleSaveSchedule = async () => {
        if (!validateTimeFormat(startTime) || !validateTimeFormat(endTime)) {
            Alert.alert(
                'Formato Inválido',
                'Por favor ingresa las horas en formato de 24 horas (HH:MM). Ejemplo: 22:00 o 06:30.'
            );
            return;
        }

        if (activeDays.length === 0 && enabled) {
            Alert.alert(
                'Días no seleccionados',
                'Debes seleccionar al menos un día activo para habilitar la franja horaria.'
            );
            return;
        }

        try {
            setIsSaving(true);
            const newSchedule: ScheduleConfig = {
                enabled,
                startTime,
                endTime,
                activeDays,
            };

            await updateSchedule(newSchedule);
            Alert.alert('Éxito', 'Configuración de horario guardada correctamente.');
        } catch (error) {
            console.error('[ScheduleScreen] Error al guardar horario:', error);
            Alert.alert('Error', 'No se pudo guardar la configuración en el servidor.');
        } finally {
            setIsSaving(false);
        }
    };

    if (!schedule) {
        return (
            <View style={styles.centeredContainer}>
                <ActivityIndicator size="large" color="#00e676" />
                <Text style={styles.loadingText}>Cargando configuración de horarios...</Text>
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            {/* Tarjeta Principal de Switch */}
            <View style={styles.card}>
                <View style={styles.switchRow}>
                    <View style={styles.switchTextContainer}>
                        <Text style={styles.cardTitle}>Auto-Armado Programado</Text>
                        <Text style={styles.cardSubtitle}>
                            Arma automáticamente el sistema dentro de la franja configurada.
                        </Text>
                    </View>
                    <Switch
                        value={enabled}
                        onValueChange={setEnabled}
                        trackColor={{ false: '#424242', true: '#00e676' }}
                        thumbColor="#ffffff"
                    />
                </View>
            </View>

            {/* Horas de Inicio y Fin */}
            <View style={styles.card}>
                <Text style={styles.sectionHeader}>Franja Horaria (24h)</Text>

                <View style={styles.timeInputsRow}>
                    <View style={styles.timeInputBox}>
                        <Text style={styles.inputLabel}>Hora Inicio</Text>
                        <TextInput
                            style={styles.timeInput}
                            value={startTime}
                            onChangeText={setStartTime}
                            placeholder="22:00"
                            placeholderTextColor="#666666"
                            keyboardType="numbers-and-punctuation"
                            maxLength={5}
                        />
                    </View>

                    <Text style={styles.timeSeparator}>a</Text>

                    <View style={styles.timeInputBox}>
                        <Text style={styles.inputLabel}>Hora Fin</Text>
                        <TextInput
                            style={styles.timeInput}
                            value={endTime}
                            onChangeText={setEndTime}
                            placeholder="06:00"
                            placeholderTextColor="#666666"
                            keyboardType="numbers-and-punctuation"
                            maxLength={5}
                        />
                    </View>
                </View>
            </View>

            {/* Días Activos de la Semana */}
            <View style={styles.card}>
                <Text style={styles.sectionHeader}>Días de Repetición</Text>
                <View style={styles.daysRow}>
                    {DAYS_LIST.map((day) => {
                        const isSelected = activeDays.includes(day.key);
                        return (
                            <TouchableOpacity
                                key={day.key}
                                style={[
                                    styles.dayButton,
                                    isSelected && styles.dayButtonSelected,
                                ]}
                                onPress={() => toggleDay(day.key)}
                                activeOpacity={0.7}
                            >
                                <Text
                                    style={[
                                        styles.dayButtonText,
                                        isSelected && styles.dayButtonTextSelected,
                                    ]}
                                >
                                    {day.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>

            {/* Botón de Guardado */}
            <TouchableOpacity
                style={styles.saveButton}
                onPress={handleSaveSchedule}
                disabled={isSaving}
                activeOpacity={0.8}
            >
                {isSaving ? (
                    <ActivityIndicator color="#000000" />
                ) : (
                    <Text style={styles.saveButtonText}>💾 GUARDAR CONFIGURACIÓN</Text>
                )}
            </TouchableOpacity>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        backgroundColor: '#121212',
        padding: 16,
    },
    centeredContainer: {
        flex: 1,
        backgroundColor: '#121212',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    loadingText: {
        color: '#aaaaaa',
        marginTop: 12,
        fontSize: 14,
    },
    card: {
        backgroundColor: '#1e1e1e',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    switchTextContainer: {
        flex: 1,
        marginRight: 12,
    },
    cardTitle: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    cardSubtitle: {
        color: '#aaaaaa',
        fontSize: 13,
        marginTop: 4,
        lineHeight: 18,
    },
    sectionHeader: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 16,
    },
    timeInputsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    timeInputBox: {
        flex: 1,
        alignItems: 'center',
    },
    inputLabel: {
        color: '#aaaaaa',
        fontSize: 12,
        marginBottom: 6,
    },
    timeInput: {
        backgroundColor: '#2a2a2a',
        color: '#00e676',
        fontSize: 22,
        fontWeight: 'bold',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        textAlign: 'center',
        width: '100%',
        borderWidth: 1,
        borderColor: '#333333',
    },
    timeSeparator: {
        color: '#888888',
        fontSize: 18,
        fontWeight: 'bold',
        marginHorizontal: 12,
        marginTop: 18,
    },
    daysRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    dayButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#2a2a2a',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#333333',
    },
    dayButtonSelected: {
        backgroundColor: '#00e676',
        borderColor: '#00e676',
    },
    dayButtonText: {
        color: '#888888',
        fontSize: 15,
        fontWeight: 'bold',
    },
    dayButtonTextSelected: {
        color: '#000000',
    },
    saveButton: {
        backgroundColor: '#00e676',
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    saveButtonText: {
        color: '#000000',
        fontSize: 16,
        fontWeight: 'bold',
    },
});