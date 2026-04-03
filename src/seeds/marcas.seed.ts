import { DataSource } from 'typeorm';
import { Injectable } from '@nestjs/common';

import { Marca } from '../modules/marcas/domain/entities/marca.entity';

@Injectable()
export class MarcasSeeder {
  constructor(private dataSource: DataSource) {}

  async run(): Promise<void> {
    console.log('🌱 Ejecutando seeder de marcas...');

    const marcas = [
      { nombre: 'Sin marca', descripcion: 'Producto sin marca específica' },
    ];

    const repository = this.dataSource.getRepository(Marca);

    for (const marca of marcas) {
      const existe = await repository.findOne({
        where: { nombre: marca.nombre },
      });
      if (!existe) {
        await repository.save(repository.create(marca));
        console.log(`  ✓ Marca creada: ${marca.nombre}`);
      } else {
        console.log(`  - Marca ya existe: ${marca.nombre}`);
      }
    }

    console.log('✅ Seeder de marcas completado');
  }
}
