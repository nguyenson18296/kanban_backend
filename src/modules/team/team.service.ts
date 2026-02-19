import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
  ) {}

  findAll(): Promise<Team[]> {
    return this.teamRepository.find();
  }

  findOneById(id: number): Promise<Team | null> {
    return this.teamRepository.findOneBy({ id });
  }

  findWithMembers(id: number): Promise<Team | null> {
    return this.teamRepository.findOne({
      where: { id },
      relations: ['members'],
    });
  }
}
