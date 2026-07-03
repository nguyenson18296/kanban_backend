import { ApiProperty } from '@nestjs/swagger';

export class PresenceStateDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  userId: string;

  @ApiProperty({ example: true })
  isOnline: boolean;

  @ApiProperty({ example: 1, description: 'Active socket count for the user' })
  connectionCount: number;

  @ApiProperty({
    example: '2026-06-18T15:50:59.391Z',
    nullable: true,
    description:
      'ISO timestamp of the last online↔offline transition during current server uptime; null if the user has never connected.',
  })
  lastChangedAt: string | null;
}

export class PresenceListResponseDto {
  @ApiProperty({ type: [PresenceStateDto] })
  items: PresenceStateDto[];
}
