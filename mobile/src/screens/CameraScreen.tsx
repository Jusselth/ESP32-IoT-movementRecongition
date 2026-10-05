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
    const [isAutoDetectEnabled, setIsAutoDetectEnabled] = useState<boolean>(true);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [lastCaptureTime, setLastCaptureTime] = useState<string | null>(null);

    // Guardar hash del fotograma anterior para detectar movimiento
    const previousFrameHashRef = useRef<number | null>(null);

    const status = useSystemStore((state) => state.status);
    const reportAlert = useSystemStore((state) => state.reportAlert);
    const currentState: SystemState = status?.state || 'DISARMED';

    // Función principal para reportar alertas
    const triggerIntrusionDetection = async (reason = 'Detección automática de movimiento') => {
        if (isProcessing) return;

        if (currentState !== 'ARMED') {
            return;
        }

        try {
            setIsProcessing(true);

            if (cameraRef.current) {
                const photo = await cameraRef.current.takePictureAsync({
                    base64: true,
                    quality: 0.2,
                    shutterSound: false,
                });

                if (photo?.base64) {
                    const timestamp = new Date().toISOString();
                    setLastCaptureTime(new Date().toLocaleTimeString());

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
            console.error('[Camera] Error al capturar evidencia:', error);
        } finally {
            setIsProcessing(false);
        }
    };


    // Algoritmo de detección óptica automática corregido
    useEffect(() => {
        let autoDetectInterval: NodeJS.Timeout | null = null;

        if (currentState === 'ARMED' && isMonitoring && isAutoDetectEnabled) {
            autoDetectInterval = setInterval(async () => {
                if (isProcessing || !cameraRef.current) return;

                try {
                    const frame = await cameraRef.current.takePictureAsync({
                        base64: true,
                        quality: 0.1,
                        shutterSound: false,
                    });

                    if (frame?.base64) {
                        // Muestreo de la cadena Base64
                        const sampleString = frame.base64.substring(200, 1200);
                        let currentHash = 0;
                        for (let i = 0; i < sampleString.length; i++) {
                            currentHash += sampleString.charCodeAt(i);
                        }

                        if (previousFrameHashRef.current !== null) {
                            const delta = Math.abs(currentHash - previousFrameHashRef.current);

                            // Muestra el cambio detectado en la consola para calibrar
                            console.log(`[AutoDetect] 🔍 Nivel de movimiento detectado (Delta): ${delta}`);

                            // Umbral calibrado (Valores > 600 indican movimiento frente al lente)
                            if (delta > 500) {
                                console.log(`[AutoDetect] 🚨 ¡Movimiento superó el umbral! Disparando alerta...`);
                                previousFrameHashRef.current = null;
                                await triggerIntrusionDetection('🚨 Movimiento óptico detectado automáticamente');
                                return;
                            }
                        }

                        previousFrameHashRef.current = currentHash;
                    }
                } catch (err) {
                    // Ignorar pequeños fallos de ciclo
                }
            }, 2000);
        } else {
            previousFrameHashRef.current = null;
        }

        return () => {
            if (autoDetectInterval) clearInterval(autoDetectInterval);
        };
    }, [currentState, isMonitoring, isAutoDetectEnabled, isProcessing]);

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
                    Acceso necesario para operar como sensor óptico de intrusiones.
                </Text>
                <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                    <Text style={styles.permissionButtonText}>Otorgar Permiso</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.container}>
            {/* Visor de Cámara */}
            <View style={styles.cameraFrame}>
                <CameraView style={styles.camera} ref={cameraRef} facing="back" />

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
                                ? isAutoDetectEnabled
                                    ? '• DETECCIÓN AUTÓNOMA ACTIVA'
                                    : '• VIGILANDO (MANUAL)'
                                : currentState === 'TRIGGERED'
                                    ? '• ¡INTRUSIÓN DETECTADA!'
                                    : '• SENSOR INACTIVO'}
                        </Text>
                    </View>

                    {isProcessing && <ActivityIndicator size="small" color="#ffffff" />}
                </View>
            </View>

            {/* Tarjeta de Controles y Sensores */}
            <View style={styles.controlsCard}>
                <View style={styles.switchRow}>
                    <Text style={styles.controlLabel}>Camara de Sensor Activa</Text>
                    <Switch
                        value={isMonitoring}
                        onValueChange={setIsMonitoring}
                        trackColor={{ false: '#424242', true: '#00e676' }}
                        thumbColor="#ffffff"
                    />
                </View>

                <View style={styles.switchRow}>
                    <Text style={styles.controlLabel}>Detección Automática (Sin Botón)</Text>
                    <Switch
                        value={isAutoDetectEnabled}
                        onValueChange={setIsAutoDetectEnabled}
                        trackColor={{ false: '#424242', true: '#0288d1' }}
                        thumbColor="#ffffff"
                        disabled={!isMonitoring}
                    />
                </View>

                {lastCaptureTime && (
                    <Text style={styles.lastCaptureText}>
                        Última evidencia capturada: {lastCaptureTime}
                    </Text>
                )}

                <TouchableOpacity
                    style={[
                        styles.triggerButton,
                        currentState !== 'ARMED' && styles.disabledButton,
                    ]}
                    onPress={() => triggerIntrusionDetection('Movimiento forzado manualmente')}
                    disabled={currentState !== 'ARMED' || isProcessing}
                    activeOpacity={0.8}
                >
                    {isProcessing ? (
                        <ActivityIndicator color="#ffffff" />
                    ) : (
                        <Text style={styles.triggerButtonText}>
                            {currentState === 'ARMED'
                                ? '📷 FORZAR CAPTURA MANUAL'
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
        fontSize: 11,
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
        marginBottom: 16,
    },
    controlLabel: {
        color: '#ffffff',
        fontSize: 15,
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