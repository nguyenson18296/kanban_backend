import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ReorderSubtaskDto {
  @ApiProperty({
    example: 1,
    description: 'New position within the parent task',
  })
  @IsInt()
  @Min(0)
  position: number;
}
