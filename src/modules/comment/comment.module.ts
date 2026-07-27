import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './comment.entity';
import { Task } from '../task/task.entity';
import { CommentController } from './comment.controller';
import { CommentService } from './comment.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { MentionModule } from '../mention/mention.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, Task]),
    SubscriptionModule,
    MentionModule,
  ],
  controllers: [CommentController],
  providers: [CommentService],
  exports: [CommentService],
})
export class CommentModule {}
