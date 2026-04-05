import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Activity } from './activity.entity';
import { Task } from '../task/task.entity';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ActivityListener } from './activity.listener';

@Module({
  imports: [TypeOrmModule.forFeature([Activity, Task])],
  controllers: [ActivityController],
  providers: [ActivityService, ActivityListener],
  exports: [ActivityService],
})
export class ActivityModule {}
