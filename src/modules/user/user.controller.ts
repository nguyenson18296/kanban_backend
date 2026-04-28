import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { User } from './user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'List of users', type: [User] })
  findAll() {
    return this.userService.findAll();
  }

  @Get('me/projects')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get projects for the authenticated user' })
  @ApiResponse({ status: 200, description: 'List of user projects' })
  findMyProjects(@CurrentUser('id') userId: string) {
    return this.userService.findProjects(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User found', type: User })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.findOneById(id);
  }

  @Get(':id/projects')
  @ApiOperation({ summary: 'Get projects for a user' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'List of user projects' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findUserProjects(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.findProjects(id);
  }
}
