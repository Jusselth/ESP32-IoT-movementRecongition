import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    Image,
    RefreshControl,
    TouchableOpacity,
} from 'react-native';
import { useSystemStore } from '../store/useSystemStore';
import { IntrusionLog } from '../../../shared/types';

export const LogsScreen = () => {
    const logs = useSystemStore((state) => state.logs);
    const fetchInitialData = useSystemStore((state) => state.fetchInitialData);

    const [refreshing, setRefreshing] = useState<boolean>(false);
    const [selectedLog, setSelectedLog] = useState<IntrusionLog | null>(null);

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchInitialData();
        setRefreshing(false);
    };

    const formatTimestamp = (isoString: string) => {
        try {
            const date = new Date(isoString);
            return date.toLocaleString('es-CO', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
        } catch {
            return isoString;
        }
    };

    const cleanBase64Uri = (uri?: string) => {
        if (!uri) return undefined;
        const sanitized = uri.trim().replace(/[\r\n]/g, '');

        // Si la cadena es demasiado corta (< 500 caracteres), fue truncada por la BD y no se podrá renderizar
        if (sanitized.length < 500) {
            console.warn('[LogsScreen] Cadena Base64 demasiado corta o truncada');
            return undefined;
        }

        if (!sanitized.startsWith('data:image')) {
            return `data:image/jpeg;base64,${sanitized}`;
        }
        return sanitized;
    };

    const getSourceLabel = (source: string) => {
        switch (source) {
            case 'MOBILE_CAMERA':
                return '📷 Cámara Móvil';
            case 'ESP32_BUTTON':
                return '🔘 Botón ESP32';
            case 'REST_API':
                return '🌐 Petición API / Web';
            default:
                return `⚡ ${source}`;
        }
    };

    const renderLogItem = ({ item }: { item: IntrusionLog }) => {
        const isExpanded = selectedLog?.id === item.id;
        const formattedUri = cleanBase64Uri(item.evidenceUrl);

        return (
            <TouchableOpacity
                style={styles.card}
                onPress={() => setSelectedLog(isExpanded ? null : item)}
                activeOpacity={0.8}
            >
                <View style={styles.cardHeader}>
                    <Text style={styles.sourceTag}>{getSourceLabel(item.triggerSource)}</Text>
                    <View
                        style={[
                            styles.emailStatusBadge,
                            { backgroundColor: item.emailSent ? '#1b5e20' : '#b71c1c' },
                        ]}
                    >
                        <Text style={styles.emailStatusText}>
                            {item.emailSent ? '📧 Correo Enviado' : '⚠️ Sin Correo'}
                        </Text>
                    </View>
                </View>

                <Text style={styles.timestampText}>{formatTimestamp(item.timestamp)}</Text>

                {item.notes && <Text style={styles.notesText}>{item.notes}</Text>}

                {formattedUri ? (
                    <View style={styles.evidenceContainer}>
                        <Text style={styles.evidenceLabel}>Evidencia capturada:</Text>
                        <Image
                            source={{ uri: formattedUri }}
                            style={styles.evidenceImage}
                            resizeMode="cover"
                            fadeDuration={0}
                        />
                    </View>
                ) : item.evidenceUrl ? (
                    <Text style={{ color: '#ffb74d', fontSize: 12, marginTop: 8 }}>
                        ⚠️ La imagen de la evidencia no se pudo renderizar (cadena incompleta).
                    </Text>
                ) : null}
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <View style={styles.headerBox}>
                <Text style={styles.headerTitle}>Historial de Intrusiones</Text>
                <Text style={styles.headerSubtitle}>
                    {logs.length === 1
                        ? '1 evento registrado en Supabase'
                        : `${logs.length} eventos registrados en Supabase`}
                </Text>
            </View>

            <FlatList
                data={logs}
                keyExtractor={(item) => item.id}
                renderItem={renderLogItem}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor="#00e676"
                        colors={['#00e676']}
                    />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyIcon}>🛡️</Text>
                        <Text style={styles.emptyTitle}>Sin Alertas Registradas</Text>
                        <Text style={styles.emptyDescription}>
                            No hay eventos de intrusión almacenados en la base de datos. Desliza hacia abajo para actualizar.
                        </Text>
                    </View>
                }
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#121212',
    },
    headerBox: {
        backgroundColor: '#1e1e1e',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    headerTitle: {
        color: '#ffffff',
        fontSize: 20,
        fontWeight: 'bold',
    },
    headerSubtitle: {
        color: '#00e676',
        fontSize: 13,
        marginTop: 4,
    },
    listContent: {
        padding: 16,
        paddingBottom: 32,
    },
    card: {
        backgroundColor: '#1e1e1e',
        borderRadius: 14,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#2a2a2a',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    sourceTag: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: 'bold',
    },
    emailStatusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    emailStatusText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: 'bold',
    },
    timestampText: {
        color: '#aaaaaa',
        fontSize: 13,
        marginBottom: 6,
    },
    notesText: {
        color: '#dddddd',
        fontSize: 14,
        lineHeight: 18,
        marginTop: 4,
    },
    evidenceContainer: {
        marginTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#2a2a2a',
        paddingTop: 10,
    },
    evidenceLabel: {
        color: '#888888',
        fontSize: 12,
        marginBottom: 8,
    },
    evidenceImage: {
        width: '100%',
        height: 220,
        borderRadius: 8,
        backgroundColor: '#1e1e1e',
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        paddingHorizontal: 24,
    },
    emptyIcon: {
        fontSize: 48,
        marginBottom: 16,
    },
    emptyTitle: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    emptyDescription: {
        color: '#888888',
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
});