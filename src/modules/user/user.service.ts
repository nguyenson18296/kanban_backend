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
import { User } from './user.entity';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findAll(): Promise<User[]> {
    try {
      return await this.userRepository.find({ relations: ['team'] });
    } catch (error) {
      this.logger.error('Failed to fetch users', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch users',
        error: (error as Error).message,
      });
    }
  }

  async findOneById(id: string): Promise<User> {
    try {
      const user = await this.userRepository.findOne({
        where: { id },
        relations: ['team'],
      });
      if (!user) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `User with id "${id}" not found`,
        });
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Failed to fetch user', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch user',
        error: (error as Error).message,
      });
    }
  }

  async findOneByEmailWithPassword(email: string): Promise<User | null> {
    try {
      return await this.userRepository
        .createQueryBuilder('user')
        .addSelect('user.password_hash')
        .where('user.email = :email', { email })
        .getOne();
    } catch (error) {
      this.logger.error(
        'Failed to fetch user by email with password',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch user',
        error: (error as Error).message,
      });
    }
  }

  async create(userData: Partial<User>): Promise<User> {
    try {
      const existing = await this.userRepository.findOneBy({
        email: userData.email,
      });
      if (existing) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `User with email "${userData.email}" already exists`,
        });
      }
      const user = this.userRepository.create(userData);
      const saved = await this.userRepository.save(user);
      delete (saved as any).password_hash;
      return saved;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if ((error as any).code === '23505') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `User with email "${userData.email}" already exists`,
        });
      }
      this.logger.error('Failed to create user', (error as Error).stack);
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to create user',
        error: (error as Error).message,
      });
    }
  }

  async findOneByEmail(email: string): Promise<User> {
    try {
      const user = await this.userRepository.findOneBy({ email });
      if (!user) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: `User with email "${email}" not found`,
        });
      }
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        'Failed to fetch user by email',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to fetch user',
        error: (error as Error).message,
      });
    }
  }
}
