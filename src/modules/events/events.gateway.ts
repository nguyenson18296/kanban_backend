import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PRESENCE_EVENTS } from '../presence/events/presence.events';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  afterInit(): void {
    this.logger.log('WebSocket gateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.wsJwtGuard.validateToken(client);
      client.data.user = user;
      const userId = user.id;
      await client.join(`user:${userId}`);
      client.emit('connection:established', { userId });
      this.logger.log(`Client connected: ${client.id} (user: ${userId})`);
      this.eventEmitter.emit(PRESENCE_EVENTS.WS_CONNECTION_OPENED, {
        userId,
        socketId: client.id,
      });
    } catch {
      client.emit('connection:error', { message: 'Authentication failed' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = client.data?.user;
    const userId = user?.id;
    this.logger.log(
      `Client disconnected: ${client.id} (user: ${userId ?? 'unknown'})`,
    );
    if (userId) {
      this.eventEmitter.emit(PRESENCE_EVENTS.WS_CONNECTION_CLOSED, {
        userId,
        socketId: client.id,
      });
    }
  }

  @SubscribeMessage('token:refresh')
  async handleTokenRefresh(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { token: string },
  ): Promise<void> {
    try {
      // Set the new token on handshake so validateToken reads it
      if (!client.handshake.auth) {
        client.handshake.auth = {};
      }
      client.handshake.auth.token = data.token;
      const user = await this.wsJwtGuard.validateToken(client);
      client.data.user = user;
      const userId = user.id;
      // Re-join the user room (no-op if already in it, ensures consistency)
      await client.join(`user:${userId}`);
      client.emit('token:refresh:success', {});
      this.logger.log(
        `Token refreshed for client: ${client.id} (user: ${userId})`,
      );
    } catch {
      client.emit('token:refresh:error', { message: 'Token refresh failed' });
      client.disconnect(true);
    }
  }

  emitToUser(userId: string, event: string, data: any): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}
