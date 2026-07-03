import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { ProjectMember } from '../project/project-member.entity';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

@Module({
  imports: [
    EventsModule,
    AuthModule,
    TypeOrmModule.forFeature([ProjectMember]),
  ],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
