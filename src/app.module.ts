import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as Joi from 'joi';

import { CategoriasModule } from './modules/categorias/categorias.module';
import { MarcasModule } from './modules/marcas/marcas.module';
import { LotesModule } from './modules/lotes/lotes.module';
import { ProductosModule } from './modules/productos/productos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().default(5432),
        DB_USERNAME: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_NAME: Joi.string().required(),
        DB_SYNCHRONIZE: Joi.boolean().default(false),
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: +config.get('DB_PORT'),
        username: config.get('DB_USERNAME'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_NAME'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: config.get('DB_SYNCHRONIZE'),
        logging: config.get('NODE_ENV') === 'development',
        extra: {
          ssl: config.get('NODE_ENV') === 'production' 
            ? { rejectUnauthorized: false } 
            : false,
        },
      }),
      inject: [ConfigService],
    }),
    CategoriasModule,
    MarcasModule,
    LotesModule,
    ProductosModule,
  ],
})
export class AppModule {}
