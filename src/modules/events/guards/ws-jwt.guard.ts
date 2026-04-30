import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthService } from '../../auth/auth.service';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const user = await this.validateToken(client);
    client.data.user = user;
    return true;
  }

  async validateToken(client: Socket) {
    const token =
      client.handshake?.auth?.token ??
      client.handshake?.headers?.authorization?.split(' ')[1];

    if (!token) {
      throw new WsException('Missing authentication token');
    }

    try {
      const payload = this.jwtService.verify(token as string);
      const user = await this.authService.validateUserById(payload.sub);
      if (!user) {
        throw new WsException('User not found or inactive');
      }
      return user;
    } catch (error) {
      if (error instanceof WsException) {
        throw error;
      }
      this.logger.warn(`WebSocket auth failed: ${(error as Error).message}`);
      throw new WsException('Invalid or expired token');
    }
  }
}
