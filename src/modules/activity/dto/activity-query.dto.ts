import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { TaskActivityAction } from '../events/activity.events';

export class ActivityQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Page number (1-based)',
    default: 1,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number.parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Items per page',
    default: 20,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? Number.parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: TaskActivityAction,
    description: 'Filter by activity action type',
  })
  @IsOptional()
  @IsEnum(TaskActivityAction)
  action?: TaskActivityAction;
}
