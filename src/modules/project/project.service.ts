import {
  ConflictException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { Project } from './project.entity';
import { ProjectMember } from './project-member.entity';
import { User } from '../user/user.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  private static readonly MAX_ID_RETRIES = 3;

  private generateBaseTag(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const words = cleaned.split(/\s+/).filter(Boolean);

    if (words.length > 1) {
      return words
        .slice(0, 5)
        .map((w) => w[0])
        .join('')
        .toUpperCase();
    }

    const single = words[0] ?? '';
    const tag = single.slice(0, 3).toUpperCase();
    return tag.length >= 2 ? tag : tag.padEnd(2, 'X');
  }

  private async resolveUniqueTag(baseTag: string): Promise<string> {
    const existing = await this.projectRepository.find({
      where: { tag: Like(`${baseTag}%`) },
      select: ['tag'],
    });
    const takenTags = new Set(existing.map((p) => p.tag));

    if (!takenTags.has(baseTag)) return baseTag;

    for (let i = 1; i <= 99; i++) {
      const candidate = `${baseTag}${i}`;
      if (!takenTags.has(candidate)) return candidate;
    }

    throw new InternalServerErrorException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: `Unable to generate unique tag for "${baseTag}"`,
    });
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    const baseTag = this.generateBaseTag(dto.name);
    let tag = await this.resolveUniqueTag(baseTag);

    for (let attempt = 0; attempt <= ProjectService.MAX_ID_RETRIES; attempt++) {
      try {
        const project = this.projectRepository.create({ ...dto, tag });
        const saved = await this.projectRepository.save(project);
        return this.findOneById(saved.id);
      } catch (error) {
        if (error.code === '23505') {
          const isPkCollision =
            error.constraint?.includes('pkey') ||
            error.constraint?.startsWith('PK_');

          const isTagCollision = error.constraint?.includes('tag');

          if (
            (isPkCollision || isTagCollision) &&
            attempt < ProjectService.MAX_ID_RETRIES
          ) {
            if (isTagCollision) {
              this.logger.warn(
                `Tag collision on attempt ${attempt + 1}, retrying`,
              );
              tag = await this.resolveUniqueTag(baseTag);
            } else {
              this.logger.warn(
                `Project ID collision on attempt ${attempt + 1}, retrying`,
              );
            }
            continue;
          }

          if (isPkCollision || isTagCollision) {
            this.logger.error(
              `${isPkCollision ? 'Project ID' : 'Tag'} collision persisted after max retries`,
            );
            throw new InternalServerErrorException({
              statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
              message: `Failed to generate unique ${isPkCollision ? 'project ID' : 'tag'}`,
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
        relations: ['team', 'creator'],
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
      const project = await this.projectRepository.findOne({
        where: { id },
        relations: ['team', 'creator'],
      });
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
      await this.projectRepository.save(project);
      return this.findOneById(id);
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

  // --- Project Member Management ---

  async getMembers(projectId: string): Promise<ProjectMember[]> {
    try {
      await this.ensureProjectExists(projectId);
      return this.memberRepository.find({
        where: { project_id: projectId },
        relations: ['user'],
        order: { joined_at: 'ASC' },
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        'Failed to fetch project members',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch project members',
        error: (error as Error).message,
      });
    }
  }

  async addMembers(
    projectId: string,
    userIds: string[],
  ): Promise<ProjectMember[]> {
    try {
      await this.ensureProjectExists(projectId);
      await this.validateUsers(userIds);

      const existing = await this.memberRepository.findBy({
        project_id: projectId,
        user_id: In(userIds),
      });
      const existingIds = new Set(existing.map((m) => m.user_id));
      const newIds = userIds.filter((id) => !existingIds.has(id));

      if (newIds.length > 0) {
        const members = newIds.map((userId) =>
          this.memberRepository.create({
            project_id: projectId,
            user_id: userId,
          }),
        );
        await this.memberRepository.save(members);
      }

      return this.getMembers(projectId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        'Failed to add project members',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to add project members',
        error: (error as Error).message,
      });
    }
  }

  async removeMembers(
    projectId: string,
    userIds: string[],
  ): Promise<ProjectMember[]> {
    try {
      await this.ensureProjectExists(projectId);

      // Remove from team_members first (user leaving project should leave their team too)
      await this.memberRepository
        .createQueryBuilder()
        .delete()
        .from('team_members')
        .where('project_id = :projectId AND user_id IN (:...userIds)', {
          projectId,
          userIds,
        })
        .execute();

      // Remove from project_members
      await this.memberRepository.delete({
        project_id: projectId,
        user_id: In(userIds),
      });

      return this.getMembers(projectId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        'Failed to remove project members',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to remove project members',
        error: (error as Error).message,
      });
    }
  }

  private async ensureProjectExists(id: string): Promise<void> {
    const exists = await this.projectRepository.existsBy({ id });
    if (!exists) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Project with id "${id}" not found`,
      });
    }
  }

  private async validateUsers(userIds: string[]): Promise<void> {
    const users = await this.userRepository.findBy({ id: In(userIds) });
    if (users.length !== userIds.length) {
      const foundIds = new Set(users.map((u) => u.id));
      const missing = userIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Users not found: ${missing.join(', ')}`,
      });
    }
  }
}
