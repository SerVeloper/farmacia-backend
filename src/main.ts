import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:3001'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Farmacia API')
    .setDescription('Sistema de gestión de farmacia - Documentación de API')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Ingrese el token JWT',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('auth', 'Autenticación')
    .addTag('users', 'Gestión de usuarios')
    .addTag('branches', 'Sucursales')
    .addTag('products', 'Productos')
    .addTag('inventory', 'Inventario')
    .addTag('cajas', 'Cajas')
    .addTag('sales', 'Ventas')
    .addTag('compras', 'Compras')
    .addTag('unidades-medida', 'Unidades de medida')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Application running on: http://localhost:${port}/api/docs`);
}
bootstrap();
