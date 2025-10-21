import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import { CreateInitialSchema1710752400000 } from './migrations/1710752400000-CreateInitialSchema';
import { AddPerformanceIndexes1710752500000 } from './migrations/1710752500000-AddPerformanceIndexes';
import { AddRefreshTokens1710752600000 } from './migrations/1710752600000-AddRefreshTokens';

// Load environment variables
dotenv.config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'taskflow',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [CreateInitialSchema1710752400000, AddPerformanceIndexes1710752500000, AddRefreshTokens1710752600000],
  migrationsTableName: 'migrations',
  synchronize: false, // Important: Set to false for production
  logging: process.env.NODE_ENV === 'development',
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
