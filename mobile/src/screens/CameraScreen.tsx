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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const CameraScreen = () => {
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);

    const [isMonitoring, setIsMonitoring] = useState<boolean>(true);
    const [isAutoDetectEnabled, setIsAutoDetectEnabled] = useState<boolean>(true);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [lastCaptureTime, setLastCaptureTime] = useState<string | null>(null);

    // Banderas de control de estado sin re-renders
    const isProcessingRef = useRef<boolean>(false);
    const isCooldownRef = useRef<boolean>(false);
    const previousFrameHashRef = useRef<number | null>(null);

    const status = useSystemStore((state) => state.status);
    const reportAlert = useSystemStore((state) => state.reportAlert);
    const currentState: SystemState = status?.state || 'DISARMED';

    // Función principal para reportar alertas en ráfaga (Foto 1 Instantánea + Fotos)
    const triggerIntrusionDetection = async (
        reason = 'Detección automática de movimiento',
        firstFrameBase64?: string
    ) => {
        if (isProcessingRef.current || isCooldownRef.current) return;
        if (currentState !== 'ARMED') return;

        try {
            isProcessingRef.current = true;
            isCooldownRef.current = true; // Activar bloqueo inmediato para evitar alertas consecutivas
            setIsProcessing(true);

            const capturedImages: string[] = [];

            // 📸 Foto 1: Usar directamente el fotograma que disparó la alerta (LATENCIA CERO)
            if (firstFrameBase64) {
                const cleanBase64 = firstFrameBase64.replace(/[\r\n]/g, '');
                capturedImages.push(cleanBase64);
                console.log(`[Camera Burst] 📸 Foto 1/7 capturada instantáneamente (Sensor)`);
            } else if (cameraRef.current) {
                const photo1 = await cameraRef.current.takePictureAsync({
                    base64: true,
                    quality: 0.2,
                    shutterSound: false,
                });
                if (photo1?.base64) {
                    capturedImages.push(photo1.base64.replace(/[\r\n]/g, ''));
                    console.log(`[Camera Burst] 📸 Foto 1/7 capturada`);
                }
            }

            // Captura secuencial con 100ms de diferencia
            for (let i = capturedImages.length; i < 7; i++) {
                await delay(100);
                if (cameraRef.current) {
                    const photo = await cameraRef.current.takePictureAsync({
                        base64: true,
                        quality: 0.2,
                        shutterSound: false,
                    });

                    if (photo?.base64) {
                        const cleanBase64 = photo.base64.replace(/[\r\n]/g, '');
                        capturedImages.push(cleanBase64);
                        console.log(`[Camera Burst] 📸 Foto ${i + 1}/7 capturada`);
                    }
                }
            }

            if (capturedImages.length > 0) {
                const timestamp = new Date().toISOString();
                setLastCaptureTime(new Date().toLocaleTimeString());

                await reportAlert({
                    triggerSource: 'MOBILE_CAMERA',
                    timestamp,
                    imagesBase64: capturedImages,
                    imageBase64: capturedImages[0],
                    additionalInfo: `${reason} (Ráfaga de ${capturedImages.length} tomas)`,
                });
            }
        } catch (error) {
            console.error('[Camera] Error al capturar ráfaga de evidencia:', error);
        } finally {
            setIsProcessing(false);
            isProcessingRef.current = false;

            // Mantener ventana de Cooldown de 8 segundos antes de permitir una nueva detección
            setTimeout(() => {
                isCooldownRef.current = false;
                previousFrameHashRef.current = null;
                console.log('[Camera] 🟢 Cooldown finalizado. Reanudando sensor óptico.');
            }, 8000);
        }
    };

    // Algoritmo de detección recursiva por setTimeout (Sin solapamiento)
    useEffect(() => {
        let timeoutId: NodeJS.Timeout | null = null;
        let isMounted = true;

        const runAutoDetection = async () => {
            if (!isMounted) return;

            if (
                currentState === 'ARMED' &&
                isMonitoring &&
                isAutoDetectEnabled &&
                !isProcessingRef.current &&
                !isCooldownRef.current
            ) {
                try {
                    const frame = await cameraRef.current?.takePictureAsync({
                        base64: true,
                        quality: 0.2,
                        shutterSound: false,
                    });

                    if (frame?.base64 && isMounted) {
                        // Muestreo distribuido del fotograma (inicio y centro de la cadena)
                        const b64 = frame.base64;
                        const sampleString = b64.substring(200, 800) + b64.substring(1200, 1800);

                        let currentHash = 0;
                        for (let i = 0; i < sampleString.length; i++) {
                            currentHash += sampleString.charCodeAt(i);
                        }

                        if (previousFrameHashRef.current !== null) {
                            const delta = Math.abs(currentHash - previousFrameHashRef.current);

                            // Umbral de sensibilidad ajustado
                            if (delta > 1950) {
                                console.log(`[AutoDetect] 🚨 ¡Entrada detectada! Delta: ${delta}`);
                                previousFrameHashRef.current = null;
                                // Disparar pasando la imagen capturada para reusarla de inmediato
                                await triggerIntrusionDetection('🚨 Movimiento óptico detectado', frame.base64);
                                return; // Sale del ciclo mientras dure el Cooldown
                            }
                        }

                        previousFrameHashRef.current = currentHash;
                    }
                } catch (err) {
                    // Ignorar errores puntuales de lectura de lente
                }
            }

            // Programar el siguiente ciclo solo cuando el fotograma actual se haya completado
            if (isMounted && currentState === 'ARMED' && !isCooldownRef.current) {
                timeoutId = setTimeout(runAutoDetection, 250);
            }
        };

        if (currentState === 'ARMED' && isMonitoring && isAutoDetectEnabled) {
            runAutoDetection();
        } else {
            previousFrameHashRef.current = null;
        }

        return () => {
            isMounted = false;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [currentState, isMonitoring, isAutoDetectEnabled]);

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