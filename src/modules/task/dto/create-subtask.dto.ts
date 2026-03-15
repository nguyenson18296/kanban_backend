import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';

export class CreateSubtaskDto extends OmitType(CreateTaskDto, [
  'parent_id',
  'column_id',
] as const) {
  @ApiPropertyOptional({
    example: 1,
    description: "Kanban column ID (defaults to parent's column if omitted)",
  })
  @IsOptional()
  @IsInt()
  column_id?: number;
}
