import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';
import { TeamMember } from './team-member.entity';
import { Project } from '../project/project.entity';
import { ProjectMember, ProjectRole } from '../project/project-member.entity';
import { ProjectAccessService } from '../project/project-access.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { ApiListResponse } from '../../common/interfaces/api-response.interface';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly projectMemberRepository: Repository<ProjectMember>,
    private readonly projectAccessService: ProjectAccessService,
  ) {}

  async create(
    projectId: string,
    dto: CreateTeamDto,
    actorId: string,
  ): Promise<Team> {
    try {
      await this.ensureProjectExists(projectId);
      await this.projectAccessService.ensureRole(
        projectId,
        actorId,
        ProjectRole.ADMIN,
      );

      const team = this.teamRepository.create({
        ...dto,
        project_id: projectId,
      });
      const saved = await this.teamRepository.save(team);
      return this.findOneById(projectId, saved.id);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      if (error.code === '23505') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `Team "${dto.name}" already exists in this project`,
        });
      }
      this.logger.error('Failed to create team', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to create team',
        error: (error as Error).message,
      });
    }
  }

  async findAllByProject(projectId: string): Promise<ApiListResponse<Team>> {
    try {
      await this.ensureProjectExists(projectId);
      const data = await this.teamRepository.find({
        where: { project_id: projectId },
        order: { created_at: 'ASC' },
      });
      return { data, status: HttpStatus.OK, success: true };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch teams', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch teams',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(projectId: string, teamId: number): Promise<Team> {
    try {
      const team = await this.teamRepository.findOne({
        where: { id: teamId, project_id: projectId },
      });
      if (!team) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Team with id "${teamId}" not found in project "${projectId}"`,
        });
      }
      return team;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch team', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch team',
        error: (error as Error).message,
      });
    }
  }

  async getMembers(
    projectId: string,
    teamId: number,
  ): Promise<ApiListResponse<TeamMember>> {
    try {
      await this.findOneById(projectId, teamId);
      const data = await this.teamMemberRepository.find({
        where: { team_id: teamId, project_id: projectId },
        relations: ['user'],
        order: { joined_at: 'ASC' },
      });
      return { data, status: HttpStatus.OK, success: true };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch team members', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch team members',
        error: (error as Error).message,
      });
    }
  }

  async addMember(
    projectId: string,
    teamId: number,
    userId: string,
    actorId: string,
  ): Promise<void> {
    try {
      // Gate first: a non-member must get the masked project 404 before any
      // team lookup can reveal whether the team exists (anti-enumeration).
      await this.projectAccessService.ensureRole(
        projectId,
        actorId,
        ProjectRole.ADMIN,
      );
      await this.findOneById(projectId, teamId);

      const isProjectMember = await this.projectMemberRepository.existsBy({
        project_id: projectId,
        user_id: userId,
      });
      if (!isProjectMember) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          message: `User "${userId}" is not a member of project "${projectId}"`,
        });
      }

      const existing = await this.teamMemberRepository.findOneBy({
        team_id: teamId,
        user_id: userId,
      });
      if (existing) return;

      const member = this.teamMemberRepository.create({
        team_id: teamId,
        user_id: userId,
        project_id: projectId,
      });
      await this.teamMemberRepository.save(member);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      )
        throw error;
      if (error.code === '23505' && error.constraint?.includes('user_id')) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: 'User is already assigned to a team in this project',
        });
      }
      this.logger.error('Failed to add team member', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to add team member',
        error: (error as Error).message,
      });
    }
  }

  async removeMember(
    projectId: string,
    teamId: number,
    userId: string,
    actorId: string,
  ): Promise<void> {
    try {
      // Gate first: see addMember — the masked 404 must win for non-members.
      await this.projectAccessService.ensureRole(
        projectId,
        actorId,
        ProjectRole.ADMIN,
      );
      await this.findOneById(projectId, teamId);
      await this.teamMemberRepository.delete({
        team_id: teamId,
        user_id: userId,
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      this.logger.error('Failed to remove team member', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to remove team member',
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
}
