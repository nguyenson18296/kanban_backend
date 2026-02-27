import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ReorderTaskDto {
  @ApiProperty({ example: 1, description: 'New position within the column' })
  @IsInt()
  @Min(0)
  position: number;
}
