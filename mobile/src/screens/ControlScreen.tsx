import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import { useSystemStore } from '../store/useSystemStore';
import { SystemState } from '../../../shared/types';

export const ControlScreen = () => {
    const status = useSystemStore((state) => state.status);
    const isConnected = useSystemStore((state) => state.isConnected);
    const updateStatus = useSystemStore((state) => state.updateStatus);
    const reportAlert = useSystemStore((state) => state.reportAlert);

    const currentState: SystemState = status?.state || 'DISARMED';

    const handleToggleArm = async () => {
        const nextState: SystemState = currentState === 'DISARMED' ? 'ARMED' : 'DISARMED';
        await updateStatus(nextState, 'MOBILE_CAMERA');
    };

    const handleManualPanic = async () => {
        await reportAlert({
            triggerSource: 'MOBILE_CAMERA',
            timestamp: new Date().toISOString(),
            additionalInfo: 'Alerta manual de pánico desde la app móvil',
        });
    };

    const getStatusColor = () => {
        switch (currentState) {
            case 'ARMED':
                return '#f57c00'; // Naranja
            case 'TRIGGERED':
                return '#d32f2f'; // Rojo
            case 'DISARMED':
            default:
                return '#388e3c'; // Verde
        }
    };

    const getStatusText = () => {
        switch (currentState) {
            case 'ARMED':
                return 'SISTEMA ARMADO';
            case 'TRIGGERED':
                return '🚨 INTRUSIÓN DETECTADA';
            case 'DISARMED':
            default:
                return 'SISTEMA DESARMADO';
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container}>
            {/* Indicador de conexión */}
            <View style={styles.connectionBadge}>
                <View
                    style={[
                        styles.connectionDot,
                        { backgroundColor: isConnected ? '#00e676' : '#ff1744' },
                    ]}
                />
                <Text style={styles.connectionText}>
                    {isConnected ? 'Servidor Conectado' : 'Sin Conexión con Servidor'}
                </Text>
            </View>

            {/* Tarjeta de estado principal */}
            <View style={[styles.statusCard, { borderColor: getStatusColor() }]}>
                <Text style={[styles.statusTitle, { color: getStatusColor() }]}>
                    {getStatusText()}
                </Text>

                {status ? (
                    <View style={styles.detailsContainer}>
                        <Text style={styles.detailText}>
                            Último cambio: {new Date(status.lastUpdated).toLocaleTimeString()}
                        </Text>
                        <Text style={styles.detailText}>Origen: {status.updatedBy}</Text>
                        {status.isWithinSchedule && (
                            <Text style={styles.scheduleBadge}>⏰ Horario de auto-armado activo</Text>
                        )}
                    </View>
                ) : (
                    <ActivityIndicator size="small" color="#ffffff" style={{ marginTop: 12 }} />
                )}
            </View>

            {/* Botón principal de Conmutación (Armar / Desarmar) */}
            <TouchableOpacity
                style={[
                    styles.actionButton,
                    { backgroundColor: currentState === 'DISARMED' ? '#f57c00' : '#388e3c' },
                ]}
                onPress={handleToggleArm}
                activeOpacity={0.8}
            >
                <Text style={styles.actionButtonText}>
                    {currentState === 'DISARMED' ? 'ARMAR SISTEMA' : 'DESARMAR SISTEMA'}
                </Text>
            </TouchableOpacity>

            {/* Botón de Pánico Manual */}
            <TouchableOpacity
                style={styles.panicButton}
                onPress={handleManualPanic}
                activeOpacity={0.8}
            >
                <Text style={styles.panicButtonText}>🚨 BOTÓN DE PÁNICO MANUAL</Text>
            </TouchableOpacity>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        backgroundColor: '#121212',
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    connectionBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1e1e1e',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        marginBottom: 24,
    },
    connectionDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 8,
    },
    connectionText: {
        color: '#cccccc',
        fontSize: 13,
        fontWeight: '500',
    },
    statusCard: {
        width: '100%',
        backgroundColor: '#1e1e1e',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        borderWidth: 2,
        marginBottom: 32,
    },
    statusTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    detailsContainer: {
        marginTop: 16,
        alignItems: 'center',
    },
    detailText: {
        color: '#aaaaaa',
        fontSize: 14,
        marginVertical: 2,
    },
    scheduleBadge: {
        color: '#ffb74d',
        fontSize: 13,
        marginTop: 8,
        fontWeight: '600',
    },
    actionButton: {
        width: '100%',
        paddingVertical: 18,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 16,
        elevation: 3,
    },
    actionButtonText: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    panicButton: {
        width: '100%',
        backgroundColor: '#b71c1c',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ff5252',
    },
    panicButtonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: 'bold',
    },
});