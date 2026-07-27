import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity';
import { User } from '../user/user.entity';
import { Label } from '../label/label.entity';
import { KanbanColumn } from '../kanban-column/kanban-column.entity';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';
import { SubscriptionModule } from '../subscription/subscription.module';
import { MentionModule } from '../mention/mention.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, User, Label, KanbanColumn]),
    SubscriptionModule,
    MentionModule,
  ],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
