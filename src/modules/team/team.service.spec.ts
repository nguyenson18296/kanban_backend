import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { TeamService } from './team.service';
import { Team } from './team.entity';
import { TeamMember } from './team-member.entity';
import { Project } from '../project/project.entity';
import { ProjectMember } from '../project/project-member.entity';
import { ProjectAccessService } from '../project/project-access.service';

describe('TeamService', () => {
  let service: TeamService;

  const teamRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const teamMemberRepository = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const projectRepository = {
    existsBy: jest.fn(),
  };

  const projectMemberRepository = {
    existsBy: jest.fn(),
  };

  const projectAccessService = {
    ensureRole: jest.fn(),
  };

  const maskedProject404 = () =>
    new NotFoundException({
      statusCode: 404,
      message: 'Project with id "proj1234" not found',
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: getRepositoryToken(Team), useValue: teamRepository },
        {
          provide: getRepositoryToken(TeamMember),
          useValue: teamMemberRepository,
        },
        { provide: getRepositoryToken(Project), useValue: projectRepository },
        {
          provide: getRepositoryToken(ProjectMember),
          useValue: projectMemberRepository,
        },
        { provide: ProjectAccessService, useValue: projectAccessService },
      ],
    }).compile();
    service = module.get(TeamService);
  });

  describe('addMember', () => {
    it('masks team existence behind the project 404 for non-members', async () => {
      projectAccessService.ensureRole.mockRejectedValue(maskedProject404());
      teamRepository.findOne.mockResolvedValue(null);

      await expect(
        service.addMember('proj1234', 7, 'target-user', 'outsider'),
      ).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Project with id "proj1234" not found',
        },
      });
      expect(teamRepository.findOne).not.toHaveBeenCalled();
    });

    it('returns the team-flavored 404 to authorized actors when the team is missing', async () => {
      projectAccessService.ensureRole.mockResolvedValue({});
      teamRepository.findOne.mockResolvedValue(null);

      await expect(
        service.addMember('proj1234', 7, 'target-user', 'admin-user'),
      ).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Team with id "7" not found in project "proj1234"',
        },
      });
    });

    it('adds the member once the gate and lookups pass', async () => {
      projectAccessService.ensureRole.mockResolvedValue({});
      teamRepository.findOne.mockResolvedValue({ id: 7 });
      projectMemberRepository.existsBy.mockResolvedValue(true);
      teamMemberRepository.findOneBy.mockResolvedValue(null);
      teamMemberRepository.create.mockImplementation((m: TeamMember) => m);
      teamMemberRepository.save.mockResolvedValue(undefined);

      await expect(
        service.addMember('proj1234', 7, 'target-user', 'admin-user'),
      ).resolves.toBeUndefined();
      expect(teamMemberRepository.save).toHaveBeenCalledWith({
        team_id: 7,
        user_id: 'target-user',
        project_id: 'proj1234',
      });
    });
  });

  describe('removeMember', () => {
    it('masks team existence behind the project 404 for non-members', async () => {
      projectAccessService.ensureRole.mockRejectedValue(maskedProject404());
      teamRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removeMember('proj1234', 7, 'target-user', 'outsider'),
      ).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Project with id "proj1234" not found',
        },
      });
      expect(teamRepository.findOne).not.toHaveBeenCalled();
    });

    it('returns the team-flavored 404 to authorized actors when the team is missing', async () => {
      projectAccessService.ensureRole.mockResolvedValue({});
      teamRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removeMember('proj1234', 7, 'target-user', 'admin-user'),
      ).rejects.toMatchObject({
        response: {
          statusCode: 404,
          message: 'Team with id "7" not found in project "proj1234"',
        },
      });
    });

    it('deletes the membership once the gate and lookup pass', async () => {
      projectAccessService.ensureRole.mockResolvedValue({});
      teamRepository.findOne.mockResolvedValue({ id: 7 });
      teamMemberRepository.delete.mockResolvedValue({ affected: 1 });

      await expect(
        service.removeMember('proj1234', 7, 'target-user', 'admin-user'),
      ).resolves.toBeUndefined();
      expect(teamMemberRepository.delete).toHaveBeenCalledWith({
        team_id: 7,
        user_id: 'target-user',
      });
    });
  });
});
