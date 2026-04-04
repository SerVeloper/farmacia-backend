import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';

import { User, UserRole } from '../modules/users/domain/entities/user.entity';
import { Role, RoleCode } from '../modules/users/domain/entities/role.entity';

@Injectable()
export class UsersSeeder {
  constructor(private dataSource: DataSource) {}

  async run(): Promise<void> {
    console.log('🌱 Ejecutando seeder de usuarios...');

    const adminEmail =
      process.env.DEFAULT_ADMIN_EMAIL?.trim().toLowerCase() ||
      'admin@farmacia.local';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin1234';
    const adminName = process.env.DEFAULT_ADMIN_NAME || 'Administrador Inicial';

    const repository = this.dataSource.getRepository(User);
    const rolesRepository = this.dataSource.getRepository(Role);
    const adminRole = await rolesRepository.findOne({
      where: { codigo: RoleCode.ADMINISTRADOR },
    });

    if (!adminRole) {
      throw new Error(
        'Rol administrador no encontrado. Ejecute primero el seed de roles.',
      );
    }

    const existingAdmin = await repository.findOne({
      where: { email: adminEmail },
      relations: ['roles'],
    });

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    if (existingAdmin) {
      existingAdmin.nombre = adminName;
      existingAdmin.passwordHash = passwordHash;
      existingAdmin.rol = UserRole.ADMIN;
      existingAdmin.roles = [adminRole];
      existingAdmin.activo = true;
      await repository.save(existingAdmin);
      console.log(`  ↻ Credenciales admin actualizadas: ${adminEmail}`);
      console.log('✅ Seeder de usuarios completado');
      return;
    }

    const adminUser = repository.create({
      nombre: adminName,
      email: adminEmail,
      passwordHash,
      rol: UserRole.ADMIN,
      roles: [adminRole],
      sucursalId: null,
      activo: true,
    });

    await repository.save(adminUser);
    console.log(`  ✓ Usuario admin creado: ${adminEmail}`);
    console.log('✅ Seeder de usuarios completado');
  }
}
