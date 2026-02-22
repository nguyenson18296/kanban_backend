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
import { KanbanColumn } from './kanban-column.entity';
import { CreateKanbanColumnDto } from './dto/create-kanban-column.dto';
import { UpdateKanbanColumnDto } from './dto/update-kanban-column.dto';

@Injectable()
export class KanbanColumnService {
  private readonly logger = new Logger(KanbanColumnService.name);

  constructor(
    @InjectRepository(KanbanColumn)
    private readonly columnRepository: Repository<KanbanColumn>,
  ) {}

  async create(dto: CreateKanbanColumnDto): Promise<KanbanColumn> {
    try {
      const column = this.columnRepository.create(dto);
      return await this.columnRepository.save(column);
    } catch (error) {
      if (error.code === '23505') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `Column with name "${dto.name}" already exists`,
          error: (error as Error).message,
        });
      }
      this.logger.error('Failed to create column', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to create column',
        error: (error as Error).message,
      });
    }
  }

  async findAll(): Promise<KanbanColumn[]> {
    try {
      return await this.columnRepository.find({
        where: { is_archived: false },
        order: { position: 'ASC' },
      });
    } catch (error) {
      this.logger.error('Failed to fetch columns', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch columns',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(id: number): Promise<KanbanColumn> {
    try {
      const column = await this.columnRepository.findOneBy({ id });
      if (!column) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Column with id "${id}" not found`,
        });
      }
      return column;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch column', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch column',
        error: (error as Error).message,
      });
    }
  }

  async update(id: number, dto: UpdateKanbanColumnDto): Promise<KanbanColumn> {
    try {
      const column = await this.findOneById(id);
      Object.assign(column, dto);
      return await this.columnRepository.save(column);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      )
        throw error;
      if (error.code === '23505') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `Column with name "${dto.name}" already exists`,
          error: (error as Error).message,
        });
      }
      this.logger.error('Failed to update column', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to update column',
        error: (error as Error).message,
      });
    }
  }

  async remove(id: number): Promise<void> {
    try {
      const column = await this.findOneById(id);
      await this.columnRepository.remove(column);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (error.code === '23503') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: 'Cannot delete column with existing tasks',
          error: (error as Error).message,
        });
      }
      this.logger.error('Failed to delete column', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to delete column',
        error: (error as Error).message,
      });
    }
  }
}
