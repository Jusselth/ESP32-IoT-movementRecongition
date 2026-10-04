import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    Switch,
    ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSystemStore } from '../store/useSystemStore';
import { SystemState } from '../../../shared/types';

export const CameraScreen = () => {
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);

    const [isMonitoring, setIsMonitoring] = useState<boolean>(true);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [lastCaptureTime, setLastCaptureTime] = useState<string | null>(null);

    const status = useSystemStore((state) => state.status);
    const reportAlert = useSystemStore((state) => state.reportAlert);
    const currentState: SystemState = status?.state || 'DISARMED';

    const triggerIntrusionDetection = async (reason = 'Detección de movimiento en lente de cámara') => {
        if (isProcessing) return;

        if (currentState !== 'ARMED') {
            console.log('[Camera] Captura ignorada: El sistema no está ARMADO.');
            return;
        }

        try {
            setIsProcessing(true);

            if (cameraRef.current) {
                // Captura comprimida a 0.2 para evitar recuadros negros en Android
                const photo = await cameraRef.current.takePictureAsync({
                    base64: true,
                    quality: 0.2,
                    shutterSound: false,
                });

                if (photo?.base64) {
                    const timestamp = new Date().toISOString();
                    setLastCaptureTime(new Date().toLocaleTimeString());

                    // Sanitizar saltos de línea e itinerarios
                    const cleanBase64 = photo.base64.replace(/[\r\n]/g, '');

                    await reportAlert({
                        triggerSource: 'MOBILE_CAMERA',
                        timestamp,
                        imageBase64: cleanBase64,
                        additionalInfo: reason,
                    });
                }
            }
        } catch (error) {
            console.error('[Camera] Error al capturar evidencia fotográfica:', error);
        } finally {
            setIsProcessing(false);
        }
    };

    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;

        if (currentState === 'ARMED' && isMonitoring) {
            intervalId = setInterval(() => {
                console.log('[Camera Sensor] Vigilancia activa ejecutándose...');
            }, 5000);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [currentState, isMonitoring]);

    if (!permission) {
        return (
            <View style={styles.centeredContainer}>
                <ActivityIndicator size="large" color="#00e676" />
                <Text style={styles.loadingText}>Cargando módulo de cámara...</Text>
            </View>
        );
    }

    if (!permission.granted) {
        return (
            <View style={styles.centeredContainer}>
                <Text style={styles.permissionTitle}>Permiso de Cámara Requerido</Text>
                <Text style={styles.permissionDescription}>
                    Esta aplicación necesita acceso a la cámara para operar como sensor de movimiento y capturar fotogramas de evidencia ante una intrusión.
                </Text>
                <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                    <Text style={styles.permissionButtonText}>Otorgar Permiso de Cámara</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            {/* Visor de Cámara con Overlay corregido */}
            <View style={styles.cameraFrame}>
                <CameraView style={styles.camera} ref={cameraRef} facing="back" />

                {/* Overlay en capa absoluta independiente */}
                <View style={styles.overlayHeader}>
                    <View
                        style={[
                            styles.statusBadge,
                            {
                                backgroundColor:
                                    currentState === 'ARMED'
                                        ? '#f57c00'
                                        : currentState === 'TRIGGERED'
                                            ? '#d32f2f'
                                            : '#388e3c',
                            },
                        ]}
                    >
                        <Text style={styles.statusBadgeText}>
                            {currentState === 'ARMED'
                                ? '• VIGILANDO'
                                : currentState === 'TRIGGERED'
                                    ? '• ALERTA'
                                    : '• INACTIVO'}
                        </Text>
                    </View>

                    {isProcessing && <ActivityIndicator size="small" color="#ffffff" />}
                </View>
            </View>

            <View style={styles.controlsCard}>
                <View style={styles.switchRow}>
                    <Text style={styles.controlLabel}>Sensor de Cámara Activo</Text>
                    <Switch
                        value={isMonitoring}
                        onValueChange={setIsMonitoring}
                        trackColor={{ false: '#424242', true: '#00e676' }}
                        thumbColor="#ffffff"
                    />
                </View>

                {lastCaptureTime && (
                    <Text style={styles.lastCaptureText}>
                        Última evidencia enviada: {lastCaptureTime}
                    </Text>
                )}

                <TouchableOpacity
                    style={[
                        styles.triggerButton,
                        currentState !== 'ARMED' && styles.disabledButton,
                    ]}
                    onPress={() => triggerIntrusionDetection('Movimiento detectado (Simulación Óptica)')}
                    disabled={currentState !== 'ARMED' || isProcessing}
                    activeOpacity={0.8}
                >
                    {isProcessing ? (
                        <ActivityIndicator color="#ffffff" />
                    ) : (
                        <Text style={styles.triggerButtonText}>
                            {currentState === 'ARMED'
                                ? '📷 SIMULAR DETECCIÓN DE MOVIMIENTO'
                                : '🔒 ARMA EL SISTEMA PARA ACTIVAR CÁMARA'}
                        </Text>
                    )}
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        backgroundColor: '#121212',
        padding: 16,
        alignItems: 'center',
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
    permissionTitle: {
        color: '#ffffff',
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 12,
        textAlign: 'center',
    },
    permissionDescription: {
        color: '#aaaaaa',
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
    },
    permissionButton: {
        backgroundColor: '#00e676',
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderRadius: 8,
    },
    permissionButtonText: {
        color: '#000000',
        fontWeight: 'bold',
        fontSize: 15,
    },
    cameraFrame: {
        width: '100%',
        height: 380,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#000000',
        borderWidth: 2,
        borderColor: '#333333',
        marginBottom: 20,
        position: 'relative',
    },
    camera: {
        flex: 1,
    },
    overlayHeader: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        zIndex: 10,
    },
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
    },
    statusBadgeText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 12,
    },
    controlsCard: {
        width: '100%',
        backgroundColor: '#1e1e1e',
        borderRadius: 16,
        padding: 20,
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    controlLabel: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    lastCaptureText: {
        color: '#ffb74d',
        fontSize: 13,
        marginBottom: 16,
    },
    triggerButton: {
        backgroundColor: '#d32f2f',
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    disabledButton: {
        backgroundColor: '#424242',
    },
    triggerButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: 'bold',
    },
});