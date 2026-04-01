# WebSockets

## ws (lightweight)

```typescript
import { WebSocketServer } from 'ws';
import { logger } from '@/lib/logger';

const wss = new WebSocketServer({ noServer: true });

// Attach to existing HTTP server
server.on('upgrade', (request, socket, head) => {
  // Auth check before upgrade
  const token = new URL(request.url!, `http://${request.headers.host}`).searchParams.get('token');
  if (!token || !verifyToken(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, request) => {
  const log = logger.child({ module: 'ws', clientId: request.headers['x-client-id'] });
  log.info('ws_connected');

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    handleMessage(ws, message);
  });

  ws.on('close', () => log.info('ws_disconnected'));
  ws.on('error', (err) => log.error({ err }, 'ws_error'));
});
```

## Socket.io

```typescript
import { Server } from 'socket.io';

const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN, credentials: true },
  pingTimeout: 60000,
});

// Auth middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    socket.data.user = await verifyToken(token);
    next();
  } catch {
    next(new Error('Authentication failed'));
  }
});

// Rooms
io.on('connection', (socket) => {
  const { userId } = socket.data.user;
  socket.join(`user:${userId}`);

  socket.on('join-room', (roomId) => {
    socket.join(`room:${roomId}`);
  });

  socket.on('message', (data) => {
    io.to(`room:${data.roomId}`).emit('message', {
      from: userId,
      content: data.content,
      timestamp: Date.now(),
    });
  });
});

// Broadcast from anywhere
io.to(`user:${targetUserId}`).emit('notification', payload);
```

## Scaling with Redis

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));
```

Required when running multiple server instances behind a load balancer.

## Message Protocol

```typescript
// Typed messages
interface ClientToServer {
  'join-room': (roomId: string) => void;
  'message': (data: { roomId: string; content: string }) => void;
  'typing': (roomId: string) => void;
}

interface ServerToClient {
  'message': (data: { from: string; content: string; timestamp: number }) => void;
  'notification': (data: { type: string; payload: unknown }) => void;
  'error': (message: string) => void;
}
```

## Rules

- **Authenticate before upgrade** — verify tokens in the upgrade handler, not after connection
- **Validate all messages** — parse with Zod before processing
- **Use rooms for scoping** — don't broadcast to all connected clients
- **Heartbeat/ping** — detect stale connections and clean up
- **Graceful shutdown** — close all connections before process exit

## Never

- **No secrets in WebSocket URLs** — use auth headers or handshake auth
- **No trusting client messages** — validate and sanitize everything
- **No unbounded connection state** — set limits and evict idle connections
- **No WebSocket for request-response** — use HTTP for that; WS is for push/streaming
