import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';

import { CategoriasSeeder } from './categorias.seed';
import { MarcasSeeder } from './marcas.seed';

config();

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'farmacia',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
});

async function runSeeders() {
  console.log('🌱 Iniciando seeders...\n');

  try {
    await dataSource.initialize();
    console.log('✅ Conexión a BD establecida\n');

    const categoriasSeeder = new CategoriasSeeder(dataSource);
    await categoriasSeeder.run();

    console.log('');

    const marcasSeeder = new MarcasSeeder(dataSource);
    await marcasSeeder.run();

    console.log('\n🎉 Todos los seeders ejecutados correctamente');
  } catch (error) {
    console.error('\n❌ Error al ejecutar seeders:', error);
  } finally {
    await dataSource.destroy();
    process.exit(0);
  }
}

runSeeders();