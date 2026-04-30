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
  server: Server;

  constructor(private readonly wsJwtGuard: WsJwtGuard) {}

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
    } catch {
      client.emit('connection:error', { message: 'Authentication failed' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.user?.id ?? 'unknown';
    this.logger.log(`Client disconnected: ${client.id} (user: ${userId})`);
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
