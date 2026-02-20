import { UserRole } from '../../user/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}
