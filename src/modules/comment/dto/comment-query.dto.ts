import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export enum CommentSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class CommentQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Page number (1-based)',
    default: 1,
  })
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Items per page',
    default: 20,
  })
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: CommentSortOrder,
    description: 'Sort by created_at',
    default: CommentSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(CommentSortOrder)
  sort?: CommentSortOrder = CommentSortOrder.DESC;
}
