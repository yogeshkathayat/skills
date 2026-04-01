# WebSockets

## Gateway

```typescript
@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN, credentials: true },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(client: Socket, roomId: string) {
    client.join(`room:${roomId}`);
    return { event: 'joined', data: roomId };
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, payload: { roomId: string; content: string }) {
    this.server.to(`room:${payload.roomId}`).emit('message', {
      from: client.id,
      content: payload.content,
      timestamp: Date.now(),
    });
  }
}
```

## Auth in WebSockets

```typescript
@WebSocketGateway()
export class ChatGateway {
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      const token = socket.handshake.auth.token;
      try {
        const user = await this.authService.verifyToken(token);
        socket.data.user = user;
        next();
      } catch {
        next(new WsException('Unauthorized'));
      }
    });
  }
}
```

## Module Registration

```typescript
@Module({
  providers: [ChatGateway],
})
export class ChatModule {}
```

## Rules

- **Auth via middleware** — verify before accepting connections
- **Use rooms** for scoped messaging
- **Validate payloads** — use DTOs with `WsException` for validation errors
- **Redis adapter** for multi-instance scaling
