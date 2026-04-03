import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class MarkNotificationsReadDto {
  @ApiProperty({
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
    description: 'Array of notification UUIDs to mark as read',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  ids: string[];
}
