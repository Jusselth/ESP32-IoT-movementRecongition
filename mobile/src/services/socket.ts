import { io, Socket } from 'socket.io-client';
import { API_URL } from '../config/env';
import { ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL, {
    autoConnect: false,
    transports: ['websocket'],
});