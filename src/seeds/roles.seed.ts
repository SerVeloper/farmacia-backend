import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { Role, RoleCode } from '../modules/users/domain/entities/role.entity';

@Injectable()
export class RolesSeeder {
  constructor(private dataSource: DataSource) {}

  async run(): Promise<void> {
    console.log('🌱 Ejecutando seeder de roles...');

    const repository = this.dataSource.getRepository(Role);
    const roles = [
      {
        codigo: RoleCode.ADMINISTRADOR,
        nombre: 'Administrador',
        descripcion: 'Puede gestionar todo el sistema.',
      },
      {
        codigo: RoleCode.CONTADOR,
        nombre: 'Contador',
        descripcion: 'Acceso de solo lectura a contabilidad, reportes e inventario.',
      },
      {
        codigo: RoleCode.REGENTE,
        nombre: 'Regente',
        descripcion: 'Puede realizar compras, editar inventario y gestionar ventas.',
      },
      {
        codigo: RoleCode.VENDEDOR,
        nombre: 'Vendedor',
        descripcion: 'Puede registrar y gestionar ventas.',
      },
    ];

    for (const roleData of roles) {
      const existing = await repository.findOne({
        where: { codigo: roleData.codigo },
      });

      if (existing) {
        existing.nombre = roleData.nombre;
        existing.descripcion = roleData.descripcion;
        existing.activo = true;
        await repository.save(existing);
        continue;
      }

      const role = repository.create({
        ...roleData,
        activo: true,
      });
      await repository.save(role);
    }

    console.log('✅ Seeder de roles completado');
  }
}
