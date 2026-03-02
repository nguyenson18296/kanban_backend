import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KanbanColumn } from '../kanban-column/kanban-column.entity';
import { Project } from '../project/project.entity';
import { Task } from '../task/task.entity';
import { BoardController } from './board.controller';
import { BoardService } from './board.service';

@Module({
  imports: [TypeOrmModule.forFeature([KanbanColumn, Task, Project])],
  controllers: [BoardController],
  providers: [BoardService],
})
export class BoardModule {}
