import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
  ) {}

  async findAll(): Promise<Team[]> {
    try {
      return await this.teamRepository.find();
    } catch (error) {
      this.logger.error('Failed to fetch teams', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch teams',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(id: number): Promise<Team> {
    try {
      const team = await this.teamRepository.findOneBy({ id });
      if (!team) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Team with id "${id}" not found`,
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

  async findWithMembers(id: number): Promise<Team> {
    try {
      const team = await this.teamRepository.findOne({
        where: { id },
        relations: ['members'],
      });
      if (!team) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `Team with id "${id}" not found`,
        });
      }
      return team;
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
}
