/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { registerAs } from '@nestjs/config';
import { config as dotenvConfig } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

dotenvConfig({ path: '.env' });

const config = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  entities: [__dirname + '/../modules/**/*.entity{.ts,.js}'],
  migrationsTableName: 'migrations',
  synchronize: true,
  ssl: { rejectUnauthorized: false },
};

export default registerAs('typeorm', () => config);
export const connectionSource: DataSource = new DataSource(
  config as DataSourceOptions,
);
