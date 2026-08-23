import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ProjectMember,
  ProjectRole,
  PROJECT_ROLE_HIERARCHY,
} from './project-member.entity';

/**
 * The single authorization gate for project-scoped resources.
 *
 * Convention: a caller with NO membership gets a 404 that is
 * indistinguishable from a nonexistent project (anti-enumeration).
 * A member below the required role gets a 403.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
    private readonly dataSource: DataSource,
  ) {}

  async getMembership(
    projectId: string,
    userId: string,
  ): Promise<ProjectMember | null> {
    return this.memberRepository.findOneBy({
      project_id: projectId,
      user_id: userId,
    });
  }

  async ensureRole(
    projectId: string,
    userId: string,
    minimumRole: ProjectRole,
  ): Promise<ProjectMember> {
    const membership = await this.getMembership(projectId, userId);
    if (!membership) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Project with id "${projectId}" not found`,
      });
    }
    if (
      PROJECT_ROLE_HIERARCHY[membership.role] <
      PROJECT_ROLE_HIERARCHY[minimumRole]
    ) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: `This action requires at least ${minimumRole} role`,
      });
    }
    return membership;
  }

  async getProjectIdsForUser(userId: string): Promise<string[]> {
    const memberships = await this.memberRepository.find({
      where: { user_id: userId },
      select: ['project_id'],
    });
    return memberships.map((m) => m.project_id);
  }

  async getProjectIdForTask(taskId: string): Promise<string> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('col.project_id', 'project_id')
      .from('tasks', 'task')
      .innerJoin('kanban_columns', 'col', 'col.id = task.column_id')
      .where('task.id = :taskId', { taskId })
      .getRawOne<{ project_id: string }>();
    if (!row) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Task with id "${taskId}" not found`,
      });
    }
    return row.project_id;
  }

  async getProjectIdForColumn(columnId: number): Promise<string> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('col.project_id', 'project_id')
      .from('kanban_columns', 'col')
      .where('col.id = :columnId', { columnId })
      .getRawOne<{ project_id: string }>();
    if (!row) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Column with id "${columnId}" not found`,
      });
    }
    return row.project_id;
  }

  async ensureTaskRole(
    taskId: string,
    userId: string,
    minimumRole: ProjectRole,
  ): Promise<string> {
    const projectId = await this.getProjectIdForTask(taskId);
    // Inlined rather than delegated to `ensureRole`: a non-member must see a
    // task-flavored 404 (matching the unknown-task case byte-for-byte), never
    // the project-flavored message `ensureRole` throws — otherwise the 404
    // text itself becomes an existence oracle for project ids.
    const membership = await this.getMembership(projectId, userId);
    if (!membership) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Task with id "${taskId}" not found`,
      });
    }
    if (
      PROJECT_ROLE_HIERARCHY[membership.role] <
      PROJECT_ROLE_HIERARCHY[minimumRole]
    ) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: `This action requires at least ${minimumRole} role`,
      });
    }
    return projectId;
  }

  async ensureColumnRole(
    columnId: number,
    userId: string,
    minimumRole: ProjectRole,
  ): Promise<string> {
    const projectId = await this.getProjectIdForColumn(columnId);
    const membership = await this.getMembership(projectId, userId);
    if (!membership) {
      // Mask non-membership as an unknown column so the response is
      // indistinguishable from a column that does not exist.
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        message: `Column with id "${columnId}" not found`,
      });
    }
    if (
      PROJECT_ROLE_HIERARCHY[membership.role] <
      PROJECT_ROLE_HIERARCHY[minimumRole]
    ) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: `This action requires at least ${minimumRole} role`,
      });
    }
    return projectId;
  }
}
