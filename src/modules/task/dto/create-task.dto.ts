import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TaskPriority, TaskStatus } from '../task.entity';

export class CreateTaskDto {
  @ApiProperty({ example: 'Implement login page' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ example: 'Build the login form with validation' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: TaskStatus, example: TaskStatus.OPEN })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority, example: TaskPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiProperty({ example: 1, description: 'Kanban column ID' })
  @IsInt()
  column_id: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Position within the column',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Transform(({ value }) => (value === 0 ? undefined : value))
  @IsInt()
  team_id?: number;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the user who created this task',
  })
  @IsOptional()
  @IsUUID()
  created_by?: string;

  @ApiPropertyOptional({ example: '2025-02-01T00:00:00.000Z' })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === '' || value === null) return null;
    return new Date(value);
  })
  @IsDate()
  due_date?: Date;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the parent task (makes this a subtask)',
  })
  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @ApiPropertyOptional({
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    description: 'Array of user UUIDs to assign',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assignee_ids?: string[];

  @ApiPropertyOptional({
    example: [1, 2],
    description: 'Array of label IDs to attach',
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  label_ids?: number[];
}
