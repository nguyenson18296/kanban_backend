import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateKanbanColumnDto {
  @ApiProperty({ example: 'In Progress' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'aB3kM9xZ' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9]{8}$/, {
    message: 'project_id must be exactly 8 alphanumeric characters',
  })
  project_id: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @ApiPropertyOptional({ example: '#F59E0B' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'color must be a valid 6-digit hex color (e.g., #FF5733)',
  })
  color?: string;
}
