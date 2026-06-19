import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class GetPresenceQueryDto {
  @ApiProperty({
    description: 'Comma-separated list of user UUIDs (max 100)',
    example: 'a1b2c3d4-...,b2c3d4e5-...',
  })
  @Transform(({ value }) => {
    if (Array.isArray(value)) return Array.from(new Set(value as string[]));
    if (typeof value !== 'string') return value as unknown;
    return Array.from(
      new Set(
        value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    );
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  userIds: string[];
}
