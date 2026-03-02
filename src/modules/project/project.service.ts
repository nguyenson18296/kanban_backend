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
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
  ) {}

  private static readonly MAX_ID_RETRIES = 3;

  async create(dto: CreateProjectDto): Promise<Project> {
    for (let attempt = 0; attempt <= ProjectService.MAX_ID_RETRIES; attempt++) {
      try {
        const project = this.projectRepository.create(dto);
        return await this.projectRepository.save(project);
      } catch (error) {
        if (error.code === '23505') {
          const isPkCollision =
            error.constraint?.includes('pkey') ||
            error.constraint?.startsWith('PK_');

          if (isPkCollision && attempt < ProjectService.MAX_ID_RETRIES) {
            this.logger.warn(
              `Project ID collision on attempt ${attempt + 1}, retrying`,
            );
            continue;
          }

          if (isPkCollision) {
            this.logger.error(
              'Project ID collision persisted after max retries',
            );
            throw new InternalServerErrorException({
              statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
              message: 'Failed to generate unique project ID',
            });
          }

          throw new ConflictException({
            statusCode: HttpStatus.CONFLICT,
            message: `Project with name "${dto.name}" already exists`,
            error: (error as Error).message,
          });
        }
        this.logger.error('Failed to create project', (error as Error).stack);
        throw new InternalServerErrorException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create project',
          error: (error as Error).message,
        });
      }
    }
    throw new InternalServerErrorException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Failed to create project',
    });
  }

  async findAll(): Promise<Project[]> {
    try {
      return await this.projectRepository.find({
        order: { created_at: 'DESC' },
      });
    } catch (error) {
      this.logger.error('Failed to fetch projects', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch projects',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(id: string): Promise<Project> {
    try {
      const project = await this.projectRepository.findOneBy({ id });
      if (!project) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Project with id "${id}" not found`,
        });
      }
      return project;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch project', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch project',
        error: (error as Error).message,
      });
    }
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Project> {
    try {
      const project = await this.findOneById(id);
      Object.assign(project, dto);
      return await this.projectRepository.save(project);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      )
        throw error;
      if (error.code === '23505') {
        const detail: string = error.detail ?? '';
        const match = detail.match(/Key \((\w+)\)=\((.+?)\)/);
        const message = match
          ? `Project with ${match[1]} "${match[2]}" already exists`
          : 'Project unique constraint violation';
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message,
          error: (error as Error).message,
        });
      }
      this.logger.error('Failed to update project', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to update project',
        error: (error as Error).message,
      });
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const project = await this.findOneById(id);
      await this.projectRepository.remove(project);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (error.code === '23503') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: 'Cannot delete project with existing columns',
          error: (error as Error).message,
        });
      }
      this.logger.error('Failed to delete project', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to delete project',
        error: (error as Error).message,
      });
    }
  }
}
