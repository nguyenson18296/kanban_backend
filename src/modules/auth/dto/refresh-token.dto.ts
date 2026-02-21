import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Opaque refresh token (base64url-encoded)',
    example: 'V2tYcGRhQmkzNU1MaHFGZ0tEMklBZnRITkVsN3B6cHI',
  })
  @IsString()
  refresh_token: string;
}
