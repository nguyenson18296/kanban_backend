import { connectionSource } from './typeorm';
import { User } from '../modules/user/user.entity';
import * as bcrypt from 'bcryptjs';

const users = [
  { fullName: 'Alice Johnson', email: 'alice.johnson@example.com', role: 'Backend Developer', team: 'Platform' },
  { fullName: 'Bob Smith', email: 'bob.smith@example.com', role: 'Frontend Developer', team: 'Payments' },
  { fullName: 'Carol Williams', email: 'carol.williams@example.com', role: 'QA Engineer', team: 'Search' },
  { fullName: 'David Brown', email: 'david.brown@example.com', role: 'Product Manager', team: 'Infrastructure' },
  { fullName: 'Eve Davis', email: 'eve.davis@example.com', role: 'UX Designer', team: 'Notifications' },
  { fullName: 'Frank Miller', email: 'frank.miller@example.com', role: 'DevOps Engineer', team: 'Platform' },
  { fullName: 'Grace Wilson', email: 'grace.wilson@example.com', role: 'Backend Developer', team: 'Payments' },
  { fullName: 'Hank Moore', email: 'hank.moore@example.com', role: 'Frontend Developer', team: 'Search' },
  { fullName: 'Ivy Taylor', email: 'ivy.taylor@example.com', role: 'QA Engineer', team: 'Infrastructure' },
  { fullName: 'Jack Anderson', email: 'jack.anderson@example.com', role: 'Product Manager', team: 'Notifications' },
  { fullName: 'Karen Thomas', email: 'karen.thomas@example.com', role: 'UX Designer', team: 'Platform' },
  { fullName: 'Leo Jackson', email: 'leo.jackson@example.com', role: 'DevOps Engineer', team: 'Payments' },
  { fullName: 'Mia White', email: 'mia.white@example.com', role: 'Backend Developer', team: 'Search' },
  { fullName: 'Nick Harris', email: 'nick.harris@example.com', role: 'Frontend Developer', team: 'Infrastructure' },
  { fullName: 'Olivia Martin', email: 'olivia.martin@example.com', role: 'QA Engineer', team: 'Notifications' },
  { fullName: 'Paul Garcia', email: 'paul.garcia@example.com', role: 'Product Manager', team: 'Platform' },
  { fullName: 'Quinn Martinez', email: 'quinn.martinez@example.com', role: 'UX Designer', team: 'Payments' },
  { fullName: 'Rachel Robinson', email: 'rachel.robinson@example.com', role: 'DevOps Engineer', team: 'Search' },
  { fullName: 'Sam Clark', email: 'sam.clark@example.com', role: 'Backend Developer', team: 'Infrastructure' },
  { fullName: 'Tina Lewis', email: 'tina.lewis@example.com', role: 'Frontend Developer', team: 'Notifications' },
];

async function seed() {
  await connectionSource.initialize();
  console.log('Database connected');

  const hashedPassword = await bcrypt.hash('password123', 10);

  const userEntities = users.map((u) => ({
    ...u,
    password: hashedPassword,
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(u.fullName)}&background=random`,
  }));

  const repo = connectionSource.getRepository(User);
  await repo.upsert(userEntities, ['email']);

  console.log(`Seeded ${userEntities.length} users`);
  await connectionSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
