import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { UserService } from '../user/user.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from '../user/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
  ) {}

  async register(
    dto: RegisterDto,
    ip?: string,
    deviceInfo?: string,
  ): Promise<AuthResponseDto> {
    const password_hash = await bcrypt.hash(dto.password, 10);

    const user = await this.userService.create({
      email: dto.email,
      full_name: dto.full_name,
      password_hash,
    });

    const accessToken = this.signToken(user);
    const refreshToken = randomBytes(32).toString('base64url');
    await this.storeRefreshToken(user.id, refreshToken, deviceInfo, ip);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    };
  }

  async login(
    dto: LoginDto,
    ip?: string,
    deviceInfo?: string,
  ): Promise<AuthResponseDto> {
    const user = await this.userService.findOneByEmailWithPassword(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const accessToken = this.signToken(user);
    const refreshToken = randomBytes(32).toString('base64url');
    await this.storeRefreshToken(user.id, refreshToken, deviceInfo, ip);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    };
  }

  async refresh(
    oldRefreshToken: string,
    ip?: string,
    deviceInfo?: string,
  ): Promise<AuthResponseDto> {
    const oldHash = this.hashToken(oldRefreshToken);

    const existing = await this.refreshTokenRepository.findOne({
      where: { token_hash: oldHash },
    });

    if (!existing) {
      throw new UnauthorizedException('Refresh token invalid');
    }

    // Reuse detection: if token was already revoked, revoke ALL user tokens
    if (existing.is_revoked) {
      await this.refreshTokenRepository.update(
        { user_id: existing.user_id, is_revoked: false },
        { is_revoked: true },
      );
      this.logger.warn(
        `Refresh token reuse detected — all sessions revoked for user ${existing.user_id}`,
      );
      throw new UnauthorizedException('Refresh token revoked');
    }

    // Expired
    if (existing.expires_at < new Date()) {
      await this.refreshTokenRepository.update(existing.id, {
        is_revoked: true,
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke old token
    await this.refreshTokenRepository.update(existing.id, {
      is_revoked: true,
    });

    // Load user and verify still active
    let user: User;
    try {
      user = await this.userService.findOneById(existing.user_id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new UnauthorizedException('Account no longer exists');
      }
      throw error;
    }
    if (!user.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Issue new tokens
    const newRefreshToken = randomBytes(32).toString('base64url');
    await this.storeRefreshToken(user.id, newRefreshToken, deviceInfo, ip);
    const accessToken = this.signToken(user);

    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    };
  }

  async logout(refreshToken: string): Promise<boolean> {
    const hash = this.hashToken(refreshToken);
    const result = await this.refreshTokenRepository.update(
      { token_hash: hash, is_revoked: false },
      { is_revoked: true },
    );
    return (result.affected ?? 0) > 0;
  }

  async logoutAll(userId: string): Promise<number> {
    const result = await this.refreshTokenRepository.update(
      { user_id: userId, is_revoked: false },
      { is_revoked: true },
    );
    return result.affected ?? 0;
  }

  async validateUserById(id: string): Promise<User | null> {
    try {
      const user = await this.userService.findOneById(id);
      if (!user.is_active) return null;
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      this.logger.error(
        `Unexpected error validating user ${id}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  private signToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwtService.sign(payload);
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private async storeRefreshToken(
    userId: string,
    rawToken: string,
    deviceInfo?: string,
    ip?: string,
  ): Promise<void> {
    const ttlDays = this.getRefreshTokenTtlDays();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + ttlDays);

    const token = this.refreshTokenRepository.create({
      user_id: userId,
      token_hash: this.hashToken(rawToken),
      device_info: deviceInfo || null,
      ip_address: ip || null,
      expires_at: expiresAt,
    });
    await this.refreshTokenRepository.save(token);
  }

  private getRefreshTokenTtlDays(): number {
    const raw = this.configService.get<string>(
      'REFRESH_TOKEN_EXPIRES_IN',
      '30d',
    );
    const match = raw.match(/^(\d+)d$/);
    return match ? parseInt(match[1], 10) : 30;
  }
}
