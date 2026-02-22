import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaskPriority } from '../../task/task.entity';

export class BoardQueryDto {
  @ApiPropertyOptional({
    description: 'Max tasks returned per column',
    default: 50,
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  tasksPerColumn: number = 50;

  @ApiPropertyOptional({ description: 'Filter tasks by assignee UUID' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({
    description: 'Filter tasks by priority',
    enum: TaskPriority,
  })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'Filter tasks by label UUID' })
  @IsOptional()
  @IsUUID()
  labelId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive partial match on task title',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
