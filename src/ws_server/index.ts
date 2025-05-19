import { WebSocketServer } from 'ws';
import { handleWSConnection } from './ws_handler';

const wss = new WebSocketServer({ port: 3000 });

wss.on('connection', (ws) => {
    handleWSConnection(ws, wss);
});

console.log('WebSocket server started on ws://localhost:3000');
