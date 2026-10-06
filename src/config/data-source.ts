import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'farmacia',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  // Los tests junto a migraciones no deben ejecutarse fuera de Jest.
  migrations: [__dirname + '/../migrations/!(*.spec|*.test){.ts,.js}'],
  synchronize: false,
});
