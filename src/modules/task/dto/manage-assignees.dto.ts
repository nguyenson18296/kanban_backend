import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ManageAssigneesDto {
  @ApiProperty({
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    description: 'Array of user UUIDs',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  user_ids: string[];
}
