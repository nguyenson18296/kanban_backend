import { DataSource } from 'typeorm';
import { connectionSource } from './typeorm';
import { User, UserRole } from '../modules/user/user.entity';
import { Team } from '../modules/team/team.entity';
import { KanbanColumn } from '../modules/kanban-column/kanban-column.entity';
import { Label } from '../modules/label/label.entity';
import * as bcrypt from 'bcryptjs';

const kanbanColumnsData = [
  { name: 'Backlog', position: 0, color: '#6B7280' },
  { name: 'Todo', position: 1, color: '#3B82F6' },
  { name: 'In Progress', position: 2, color: '#F59E0B' },
  { name: 'In Review', position: 3, color: '#8B5CF6' },
  { name: 'Done', position: 4, color: '#10B981' },
];

const labelsData = [
  { name: 'Bug', color: '#EF4444' },
  { name: 'Feature', color: '#3B82F6' },
  { name: 'Improvement', color: '#10B981' },
  { name: 'Hotfix', color: '#F97316' },
  { name: 'Documentation', color: '#6366F1' },
  { name: 'Design', color: '#EC4899' },
  { name: 'DevOps', color: '#14B8A6' },
  { name: 'Research', color: '#8B5CF6' },
];

const teamsData = [
  {
    name: 'Platform',
    description: 'Core platform & infrastructure',
    color: '#3B82F6',
  },
  {
    name: 'Web UI',
    description: 'Frontend & design systems',
    color: '#10B981',
  },
  {
    name: 'Quality',
    description: 'QA, testing & automation',
    color: '#F59E0B',
  },
  {
    name: 'DevOps',
    description: 'CI/CD, infrastructure & monitoring',
    color: '#EF4444',
  },
];

const users = [
  {
    full_name: 'Alice Nguyen',
    email: 'alice@kanban.dev',
    role: UserRole.TECH_LEAD,
    team: 'Platform',
  },
  {
    full_name: 'Bob Tran',
    email: 'bob@kanban.dev',
    role: UserRole.BACKEND_DEVELOPER,
    team: 'Platform',
  },
  {
    full_name: 'Carol Le',
    email: 'carol@kanban.dev',
    role: UserRole.FRONTEND_DEVELOPER,
    team: 'Web UI',
  },
  {
    full_name: 'Dave Pham',
    email: 'dave@kanban.dev',
    role: UserRole.QA,
    team: 'Quality',
  },
  {
    full_name: 'Eve Vo',
    email: 'eve@kanban.dev',
    role: UserRole.DESIGNER,
    team: 'Web UI',
  },
  {
    full_name: 'Frank Do',
    email: 'frank@kanban.dev',
    role: UserRole.DEVOPS,
    team: 'DevOps',
  },
  {
    full_name: 'Grace Bui',
    email: 'grace@kanban.dev',
    role: UserRole.BACKEND_DEVELOPER,
    team: 'Platform',
  },
  {
    full_name: 'Hank Ly',
    email: 'hank@kanban.dev',
    role: UserRole.FRONTEND_DEVELOPER,
    team: 'Web UI',
  },
  {
    full_name: 'Ivy Dang',
    email: 'ivy@kanban.dev',
    role: UserRole.QA,
    team: 'Quality',
  },
  {
    full_name: 'Jack Hoang',
    email: 'jack@kanban.dev',
    role: UserRole.PRODUCT_MANAGER,
    team: 'Platform',
  },
  {
    full_name: 'Karen Vu',
    email: 'karen@kanban.dev',
    role: UserRole.DESIGNER,
    team: 'Web UI',
  },
  {
    full_name: 'Leo Ngo',
    email: 'leo@kanban.dev',
    role: UserRole.FULLSTACK_DEVELOPER,
    team: 'Platform',
  },
  {
    full_name: 'Mia Truong',
    email: 'mia@kanban.dev',
    role: UserRole.BACKEND_DEVELOPER,
    team: 'DevOps',
  },
  {
    full_name: 'Nick Duong',
    email: 'nick@kanban.dev',
    role: UserRole.FRONTEND_DEVELOPER,
    team: 'Web UI',
  },
  {
    full_name: 'Olivia Mai',
    email: 'olivia@kanban.dev',
    role: UserRole.QA,
    team: 'Quality',
  },
  {
    full_name: 'Paul Lam',
    email: 'paul@kanban.dev',
    role: UserRole.PRODUCT_MANAGER,
    team: 'Platform',
  },
  {
    full_name: 'Quinn Ta',
    email: 'quinn@kanban.dev',
    role: UserRole.TECH_LEAD,
    team: 'DevOps',
  },
  {
    full_name: 'Rachel Ton',
    email: 'rachel@kanban.dev',
    role: UserRole.DEVOPS,
    team: 'DevOps',
  },
  {
    full_name: 'Sam Cao',
    email: 'sam@kanban.dev',
    role: UserRole.FULLSTACK_DEVELOPER,
    team: 'Web UI',
  },
  {
    full_name: 'Tina Luong',
    email: 'tina@kanban.dev',
    role: UserRole.FRONTEND_DEVELOPER,
    team: 'Web UI',
  },
];

async function seed() {
  // Initialize without auto-sync so we can drop stale tables first
  const dataSource = new DataSource({
    ...connectionSource.options,
    synchronize: false,
  });
  await dataSource.initialize();
  console.log('Database connected');

  // Drop and recreate all tables to ensure clean schema
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.query('DROP TABLE IF EXISTS "task_labels" CASCADE');
  await queryRunner.query('DROP TABLE IF EXISTS "task_assignees" CASCADE');
  await queryRunner.query('DROP TABLE IF EXISTS "tasks" CASCADE');
  await queryRunner.query('DROP TABLE IF EXISTS "labels" CASCADE');
  await queryRunner.query('DROP TABLE IF EXISTS "kanban_columns" CASCADE');
  await queryRunner.query('DROP TABLE IF EXISTS "refresh_tokens" CASCADE');
  await queryRunner.query('DROP TABLE IF EXISTS "users" CASCADE');
  await queryRunner.query('DROP TABLE IF EXISTS "teams" CASCADE');
  await queryRunner.query(
    'DROP TYPE IF EXISTS "public"."users_role_enum" CASCADE',
  );
  await queryRunner.query(
    'DROP TYPE IF EXISTS "public"."tasks_status_enum" CASCADE',
  );
  await queryRunner.query(
    'DROP TYPE IF EXISTS "public"."tasks_priority_enum" CASCADE',
  );
  await queryRunner.release();
  await dataSource.synchronize();
  console.log('Schema synchronized');

  // Seed kanban columns
  const columnRepo = dataSource.getRepository(KanbanColumn);
  await columnRepo.upsert(kanbanColumnsData, ['name']);
  console.log(`Seeded ${kanbanColumnsData.length} kanban columns`);

  // Seed labels
  const labelRepo = dataSource.getRepository(Label);
  await labelRepo.upsert(labelsData, ['name']);
  console.log(`Seeded ${labelsData.length} labels`);

  // Seed teams
  const teamRepo = dataSource.getRepository(Team);
  await teamRepo.upsert(teamsData, ['name']);
  const savedTeams = await teamRepo.find();
  const teamMap: Record<string, number> = savedTeams.reduce(
    (acc, t) => {
      acc[t.name] = t.id;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log(`Seeded ${savedTeams.length} teams`);

  // Seed users
  const hashedPassword = await bcrypt.hash('password123', 10);

  const userEntities = users.map(({ team, ...u }) => ({
    ...u,
    password_hash: hashedPassword,
    team_id: teamMap[team],
    avatar_url: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(u.full_name)}`,
  }));

  const userRepo = dataSource.getRepository(User);
  await userRepo.upsert(userEntities, ['email']);
  console.log(`Seeded ${userEntities.length} users`);

  await dataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
