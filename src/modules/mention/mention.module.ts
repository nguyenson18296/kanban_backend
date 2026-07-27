import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/user.entity';
import { MentionService } from './mention.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [MentionService],
  exports: [MentionService],
})
export class MentionModule {}
