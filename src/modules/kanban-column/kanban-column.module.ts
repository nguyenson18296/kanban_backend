import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../project/project.entity';
import { KanbanColumn } from './kanban-column.entity';
import { KanbanColumnService } from './kanban-column.service';
import { KanbanColumnController } from './kanban-column.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KanbanColumn, Project])],
  controllers: [KanbanColumnController],
  providers: [KanbanColumnService],
  exports: [KanbanColumnService],
})
export class KanbanColumnModule {}
