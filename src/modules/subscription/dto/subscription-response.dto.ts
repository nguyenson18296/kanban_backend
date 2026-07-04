import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionSource } from '../task-subscription.entity';

export class SubscriptionStatusDto {
  @ApiProperty({ example: true })
  subscribed: boolean;

  @ApiProperty({
    enum: SubscriptionSource,
    nullable: true,
    example: SubscriptionSource.MANUAL,
  })
  source: SubscriptionSource | null;

  @ApiProperty({
    nullable: true,
    example: '2026-07-03T00:00:00.000Z',
    description: 'When the subscription was created',
  })
  since: string | null;
}

export class SubscriberDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  user_id: string;

  @ApiProperty({ example: 'Alice Nguyen' })
  full_name: string;

  @ApiProperty({ nullable: true, example: 'https://cdn.example.com/a.png' })
  avatar_url: string | null;

  @ApiProperty({
    enum: SubscriptionSource,
    example: SubscriptionSource.ASSIGNED,
  })
  source: SubscriptionSource;

  @ApiProperty({ example: '2026-07-03T00:00:00.000Z' })
  created_at: string;
}

export class SubscriberListResponseDto {
  @ApiProperty({ type: [SubscriberDto] })
  items: SubscriberDto[];
}
