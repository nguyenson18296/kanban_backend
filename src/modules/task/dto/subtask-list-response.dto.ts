import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Task } from '../task.entity';

export class SubtaskListResponseDto {
  @ApiProperty({ type: [Task], description: 'List of subtasks' })
  data: Task[];

  @ApiProperty({ example: 200 })
  status: number;

  @ApiProperty({ example: true })
  success: boolean;

  @ApiPropertyOptional({ example: 'Optional message' })
  message?: string;
}
