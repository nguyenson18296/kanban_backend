import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class MoveTaskDto {
  @ApiProperty({ example: 3, description: 'Target column ID' })
  @IsInt()
  column_id: number;

  @ApiProperty({
    example: 0,
    description: 'Position within the target column',
  })
  @IsInt()
  @Min(0)
  position: number;
}
