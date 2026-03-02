import {
  BadRequestException,
  HttpStatus,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

@Injectable()
export class ParseProjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[A-Za-z0-9]{8}$/.test(value)) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message:
          'Project ID must be exactly 8 alphanumeric characters (A-Z, a-z, 0-9)',
        error: 'Bad Request',
      });
    }
    return value;
  }
}
