import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import app from './app';
import { initSocket } from './socket';
import { initESP32WebSocket } from './esp32-ws';
import { startScheduler }    from './scheduler';

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection (server stays up):', reason);
});

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(app);
initSocket(server);
initESP32WebSocket(server);
startScheduler();

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api-docs`);
  console.log(`WebSocket     ws://localhost:${PORT}`);
});

export default server;
