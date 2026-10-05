import { Platform } from 'react-native';

// ⚠️ Reemplaza esta IP por la IP IPv4 de tu PC en la red local ya esta en la casa
const LOCAL_IP = '10.181.175.123';
const PORT = 3000;

export const API_URL = Platform.OS === 'android' && __DEV__
    ? `http://${LOCAL_IP}:${PORT}`
    : `http://${LOCAL_IP}:${PORT}`;