// rHWP 동시편집 서버 (2단계 v2: WebSocket + 정적 파일)
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 7701;

// 정적 파일 서빙
app.use(express.static(join(__dirname, 'public')));

// 루트 자동 리다이렉트
app.get('/', (req, res) => {
  res.redirect('/client.html');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// HTTP 서버 (WebSocket과 공유)
const server = createServer(app);

// WebSocket 서버
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get('room') || 'default';
  const clientId = Math.random().toString(36).substring(2, 10);
  
  ws.roomId = roomId;
  ws.clientId = clientId;
  
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);
  
  console.log(`[WS] 🟢 ${clientId} 접속, room=${roomId} (총 ${rooms.get(roomId).size}명)`);
  
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    roomId,
    memberCount: rooms.get(roomId).size,
  }));
  
  broadcast(roomId, {
    type: 'user-joined',
    clientId,
    memberCount: rooms.get(roomId).size,
  }, ws);
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[WS] 📨 ${clientId} → ${roomId}: ${msg.type}`);
      broadcast(roomId, { ...msg, fromClientId: clientId }, ws);
    } catch (err) {
      console.error('[WS] ❌ 파싱 실패:', err.message);
    }
  });
  
  ws.on('close', () => {
    rooms.get(roomId)?.delete(ws);
    const remaining = rooms.get(roomId)?.size || 0;
    if (remaining === 0) rooms.delete(roomId);
    console.log(`[WS] 🔴 ${clientId} 해제 (남은 ${remaining}명)`);
    broadcast(roomId, { type: 'user-left', clientId, memberCount: remaining });
  });
});

function broadcast(roomId, message, exceptWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const client of room) {
    if (client !== exceptWs && client.readyState === 1) {
      client.send(data);
    }
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 rHWP 동시편집 서버 시작됨`);
  console.log(`   HTTP:        http://localhost:${PORT}`);
  console.log(`   WebSocket:   ws://localhost:${PORT}/ws?room=<roomId>`);
  console.log(`   rhwp-studio: http://localhost:7700 (별도 실행)`);
});
