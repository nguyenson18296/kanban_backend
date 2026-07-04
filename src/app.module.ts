import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './modules/user/user.module';
import { TeamModule } from './modules/team/team.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectModule } from './modules/project/project.module';
import { KanbanColumnModule } from './modules/kanban-column/kanban-column.module';
import { LabelModule } from './modules/label/label.module';
import { TaskModule } from './modules/task/task.module';
import { BoardModule } from './modules/board/board.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CommentModule } from './modules/comment/comment.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ActivityModule } from './modules/activity/activity.module';
import { EventsModule } from './modules/events/events.module';
import { PresenceModule } from './modules/presence/presence.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { MentionModule } from './modules/mention/mention.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('POSTGRES_HOST'),
        port: configService.get<number>('POSTGRES_PORT'),
        username: configService.get('POSTGRES_USER'),
        password: configService.get('POSTGRES_PASSWORD'),
        database: configService.get('POSTGRES_DB'),
        autoLoadEntities: true,
        synchronize: configService.get('NODE_ENV') !== 'production',
        ssl: {
          rejectUnauthorized: false,
        },
      }),
    }),
    EventEmitterModule.forRoot(),
    UserModule,
    TeamModule,
    AuthModule,
    ProjectModule,
    KanbanColumnModule,
    LabelModule,
    TaskModule,
    BoardModule,
    CommentModule,
    NotificationModule,
    ActivityModule,
    EventsModule,
    PresenceModule,
    SubscriptionModule,
    MentionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
