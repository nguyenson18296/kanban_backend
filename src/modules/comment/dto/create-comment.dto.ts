import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitize } from '../../../common/utils/sanitize-html.util';

export class CreateCommentDto {
  @ApiProperty({
    example: '<p>This looks good!</p>',
    description: 'HTML content of the comment (will be sanitized)',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? sanitize(value) : value,
  )
  content: string;
}
