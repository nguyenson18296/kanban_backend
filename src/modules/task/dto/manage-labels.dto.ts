import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ManageLabelsDto {
  @ApiProperty({
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    description: 'Array of label UUIDs',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  label_ids: string[];
}
