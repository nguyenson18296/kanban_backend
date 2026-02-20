import { UserRole } from '../../user/user.entity';

export class AuthResponseDto {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    full_name: string;
    role: UserRole;
  };
}
