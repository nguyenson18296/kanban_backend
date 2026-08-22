import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProjectAccessService } from './project-access.service';
import { ProjectMember, ProjectRole } from './project-member.entity';

describe('ProjectAccessService', () => {
  let service: ProjectAccessService;

  const memberRepository = {
    findOneBy: jest.fn(),
    find: jest.fn(),
  };

  const rawQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };

  const dataSource = {
    createQueryBuilder: jest.fn(() => rawQueryBuilder),
  };

  const membership = (role: ProjectRole): ProjectMember =>
    ({ project_id: 'proj1234', user_id: 'user-1', role }) as ProjectMember;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectAccessService,
        {
          provide: getRepositoryToken(ProjectMember),
          useValue: memberRepository,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get(ProjectAccessService);
  });

  describe('ensureRole', () => {
    it('throws NotFoundException (masking) when the user is not a member', async () => {
      memberRepository.findOneBy.mockResolvedValue(null);
      await expect(
        service.ensureRole('proj1234', 'user-1', ProjectRole.VIEWER),
      ).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Project with id "proj1234" not found',
        },
      });
    });

    it('throws ForbiddenException when the member is below the required role', async () => {
      memberRepository.findOneBy.mockResolvedValue(
        membership(ProjectRole.VIEWER),
      );
      await expect(
        service.ensureRole('proj1234', 'user-1', ProjectRole.MEMBER),
      ).rejects.toMatchObject({
        response: {
          statusCode: 403,
          message: 'This action requires at least member role',
        },
      });
    });

    it.each([
      [ProjectRole.VIEWER, ProjectRole.VIEWER],
      [ProjectRole.MEMBER, ProjectRole.MEMBER],
      [ProjectRole.ADMIN, ProjectRole.MEMBER],
      [ProjectRole.OWNER, ProjectRole.ADMIN],
      [ProjectRole.OWNER, ProjectRole.OWNER],
    ])('allows %s when %s is required', async (has, needs) => {
      memberRepository.findOneBy.mockResolvedValue(membership(has));
      await expect(
        service.ensureRole('proj1234', 'user-1', needs),
      ).resolves.toMatchObject({ role: has });
    });

    it.each([
      [ProjectRole.MEMBER, ProjectRole.ADMIN],
      [ProjectRole.ADMIN, ProjectRole.OWNER],
      [ProjectRole.VIEWER, ProjectRole.OWNER],
    ])('rejects %s when %s is required', async (has, needs) => {
      memberRepository.findOneBy.mockResolvedValue(membership(has));
      await expect(
        service.ensureRole('proj1234', 'user-1', needs),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getProjectIdForTask', () => {
    it('returns the project id resolved through the task column', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      await expect(service.getProjectIdForTask('task-uuid')).resolves.toBe(
        'proj1234',
      );
      expect(rawQueryBuilder.select).toHaveBeenCalledWith(
        'col.project_id',
        'project_id',
      );
      expect(rawQueryBuilder.from).toHaveBeenCalledWith('tasks', 'task');
      expect(rawQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'kanban_columns',
        'col',
        'col.id = task.column_id',
      );
      expect(rawQueryBuilder.where).toHaveBeenCalledWith('task.id = :taskId', {
        taskId: 'task-uuid',
      });
    });

    it('throws NotFoundException when the task does not exist', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue(undefined);
      await expect(
        service.getProjectIdForTask('missing'),
      ).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Task with id "missing" not found',
        },
      });
    });
  });

  describe('getProjectIdsForUser', () => {
    it('returns the project ids of all memberships', async () => {
      memberRepository.find.mockResolvedValue([
        { project_id: 'p1' },
        { project_id: 'p2' },
      ]);
      await expect(service.getProjectIdsForUser('user-1')).resolves.toEqual([
        'p1',
        'p2',
      ]);
    });
  });

  describe('getProjectIdForColumn', () => {
    it('returns the project id resolved through the column', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      await expect(service.getProjectIdForColumn(7)).resolves.toBe('proj1234');
      expect(rawQueryBuilder.select).toHaveBeenCalledWith(
        'col.project_id',
        'project_id',
      );
      expect(rawQueryBuilder.from).toHaveBeenCalledWith(
        'kanban_columns',
        'col',
      );
      expect(rawQueryBuilder.where).toHaveBeenCalledWith('col.id = :columnId', {
        columnId: 7,
      });
    });

    it('throws NotFoundException when the column does not exist', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue(undefined);
      await expect(service.getProjectIdForColumn(7)).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Column with id "7" not found',
        },
      });
    });
  });

  describe('getProjectIdForColumn', () => {
    it('returns the project id resolved through the column', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      await expect(service.getProjectIdForColumn(7)).resolves.toBe('proj1234');
      expect(rawQueryBuilder.select).toHaveBeenCalledWith(
        'col.project_id',
        'project_id',
      );
      expect(rawQueryBuilder.from).toHaveBeenCalledWith(
        'kanban_columns',
        'col',
      );
      expect(rawQueryBuilder.where).toHaveBeenCalledWith('col.id = :columnId', {
        columnId: 7,
      });
    });

    it('throws NotFoundException when the column does not exist', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue(undefined);
      await expect(service.getProjectIdForColumn(7)).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Column with id "7" not found',
        },
      });
    });
  });

  describe('ensureTaskRole', () => {
    it('resolves the project then enforces the role, returning the project id', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      memberRepository.findOneBy.mockResolvedValue(
        membership(ProjectRole.MEMBER),
      );
      await expect(
        service.ensureTaskRole('task-uuid', 'user-1', ProjectRole.MEMBER),
      ).resolves.toBe('proj1234');
    });

    it('masks non-membership as a task-not-found 404 (never the project-flavored message)', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      memberRepository.findOneBy.mockResolvedValue(null);
      await expect(
        service.ensureTaskRole('task-uuid', 'user-1', ProjectRole.VIEWER),
      ).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Task with id "task-uuid" not found',
        },
      });
    });

    it('still throws ForbiddenException for a member below the required role', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      memberRepository.findOneBy.mockResolvedValue(
        membership(ProjectRole.VIEWER),
      );
      await expect(
        service.ensureTaskRole('task-uuid', 'user-1', ProjectRole.MEMBER),
      ).rejects.toMatchObject({
        response: {
          statusCode: 403,
          message: 'This action requires at least member role',
        },
      });
    });
  });

  describe('ensureColumnRole', () => {
    it('masks non-membership as a column-not-found 404 (never the project-flavored message)', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      memberRepository.findOneBy.mockResolvedValue(null);
      await expect(
        service.ensureColumnRole(7, 'user-1', ProjectRole.VIEWER),
      ).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Column with id "7" not found',
        },
      });
    });

    it('resolves the project then enforces the role, returning the project id', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      memberRepository.findOneBy.mockResolvedValue(
        membership(ProjectRole.MEMBER),
      );
      await expect(
        service.ensureColumnRole(7, 'user-1', ProjectRole.MEMBER),
      ).resolves.toBe('proj1234');
    });

    it('still throws ForbiddenException for a member below the required role', async () => {
      rawQueryBuilder.getRawOne.mockResolvedValue({ project_id: 'proj1234' });
      memberRepository.findOneBy.mockResolvedValue(
        membership(ProjectRole.VIEWER),
      );
      await expect(
        service.ensureColumnRole(7, 'user-1', ProjectRole.MEMBER),
      ).rejects.toMatchObject({
        response: {
          statusCode: 403,
          message: 'This action requires at least member role',
        },
      });
    });
  });
});
