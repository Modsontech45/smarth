import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import type { JWTPayload } from './types';
import { sendToESP32 } from './esp32-ws';

let io: SocketServer;

export function initSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  // Authenticate every socket connection via JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Missing token'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
      socket.data.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId: number = socket.data.userId;
    socket.join(`user:${userId}`);
    console.log(`[WS] User ${userId} connected (${socket.id})`);

    socket.on('disconnect', (reason) => {
      console.log(`[WS] User ${userId} disconnected — ${reason}`);
    });

    // ── Keep-alive relay: browser pings every 2 s → forward to ESP32 WS
    socket.on('esp32:keepalive', () => {
      sendToESP32(userId, 'server:ping', {});
    });
  });

  return io;
}

// Emit an event to all browser tabs belonging to a specific user
export function emitToUser(userId: number, event: string, data: unknown): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}
