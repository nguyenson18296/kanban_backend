import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { AuthModule } from '../auth/auth.module';
import { EventsGateway } from './events.gateway';
import { EventsService } from './events.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@Module({
  imports: [
    AuthModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn =
          configService.get<string>('JWT_EXPIRES_IN', '1h') ?? '1h';
        return {
          secret: configService.getOrThrow<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: expiresIn as StringValue,
          },
        };
      },
    }),
  ],
  providers: [EventsGateway, EventsService, WsJwtGuard],
  exports: [EventsGateway],
})
export class EventsModule {}
