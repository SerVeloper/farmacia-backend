import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as Joi from 'joi';

import { CategoriasModule } from './modules/categorias/categorias.module';
import { MarcasModule } from './modules/marcas/marcas.module';
import { LotesModule } from './modules/lotes/lotes.module';
import { ProductosModule } from './modules/productos/productos.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { SucursalesModule } from './modules/sucursales/sucursales.module';
import { CajasModule } from './modules/cajas/cajas.module';

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
        JWT_SECRET: Joi.string().required(),
        ACCESS_TOKEN_TTL: Joi.string().default('15m'),
        SESSION_TTL: Joi.string().default('24h'),
        REMEMBER_ME_TTL: Joi.string().default('15d'),
        REFRESH_TOKEN_SECRET: Joi.string().required(),
        RESET_TOKEN_TTL_MINUTES: Joi.number().default(30),
        AUTH_REFRESH_COOKIE_NAME: Joi.string().default('farmacia_refresh_token'),
        AUTH_COOKIE_SECURE: Joi.boolean().default(false),
        AUTH_COOKIE_SAMESITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
        DEFAULT_ADMIN_EMAIL: Joi.string()
          .email()
          .default('admin@farmacia.local'),
        DEFAULT_ADMIN_PASSWORD: Joi.string().min(6).default('admin1234'),
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
          ssl:
            config.get('NODE_ENV') === 'production'
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
    UsersModule,
    AuthModule,
    SucursalesModule,
    CajasModule,
  ],
})
export class AppModule {}
