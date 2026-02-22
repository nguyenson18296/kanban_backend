import {
  ConflictException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Label } from './label.entity';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';

@Injectable()
export class LabelService {
  private readonly logger = new Logger(LabelService.name);

  constructor(
    @InjectRepository(Label)
    private readonly labelRepository: Repository<Label>,
  ) {}

  async create(dto: CreateLabelDto): Promise<Label> {
    try {
      const label = this.labelRepository.create(dto);
      return await this.labelRepository.save(label);
    } catch (error) {
      if (error.code === '23505') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `Label with name "${dto.name}" already exists`,
          error: (error as Error).message,
        });
      }
      this.logger.error('Failed to create label', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to create label',
        error: (error as Error).message,
      });
    }
  }

  async findAll(): Promise<Label[]> {
    try {
      return await this.labelRepository.find();
    } catch (error) {
      this.logger.error('Failed to fetch labels', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch labels',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(id: string): Promise<Label> {
    try {
      const label = await this.labelRepository.findOneBy({ id });
      if (!label) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Label with id "${id}" not found`,
        });
      }
      return label;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch label', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch label',
        error: (error as Error).message,
      });
    }
  }

  async update(id: string, dto: UpdateLabelDto): Promise<Label> {
    try {
      const label = await this.findOneById(id);
      Object.assign(label, dto);
      return await this.labelRepository.save(label);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      )
        throw error;
      if (error.code === '23505') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `Label with name "${dto.name}" already exists`,
          error: (error as Error).message,
        });
      }
      this.logger.error('Failed to update label', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to update label',
        error: (error as Error).message,
      });
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const label = await this.findOneById(id);
      await this.labelRepository.remove(label);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to delete label', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to delete label',
        error: (error as Error).message,
      });
    }
  }
}
