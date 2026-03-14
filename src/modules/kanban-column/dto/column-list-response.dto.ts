import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KanbanColumn } from '../kanban-column.entity';

export class ColumnListResponseDto {
  @ApiProperty({ type: [KanbanColumn], description: 'List of columns' })
  data: KanbanColumn[];

  @ApiProperty({ example: 200 })
  status: number;

  @ApiProperty({ example: true })
  success: boolean;

  @ApiPropertyOptional({ example: 'Optional message' })
  message?: string;
}
