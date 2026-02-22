import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
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
  @IsInt()
  team_id?: number;

  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the user who created this task',
  })
  @IsOptional()
  @IsUUID()
  created_by?: string;

  @ApiPropertyOptional({
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    description: 'Array of user UUIDs to assign',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assignee_ids?: string[];

  @ApiPropertyOptional({
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    description: 'Array of label UUIDs to attach',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  label_ids?: string[];
}
