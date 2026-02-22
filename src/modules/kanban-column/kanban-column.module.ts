import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KanbanColumn } from './kanban-column.entity';
import { KanbanColumnService } from './kanban-column.service';
import { KanbanColumnController } from './kanban-column.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KanbanColumn])],
  controllers: [KanbanColumnController],
  providers: [KanbanColumnService],
  exports: [KanbanColumnService],
})
export class KanbanColumnModule {}
