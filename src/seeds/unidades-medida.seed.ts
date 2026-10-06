import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { UnidadMedida } from '../modules/unidades-medida/domain/entities/unidad-medida.entity';

@Injectable()
export class UnidadesMedidaSeeder {
  constructor(private dataSource: DataSource) {}

  async run(): Promise<void> {
    console.log('🌱 Ejecutando seeder de unidades de medida...');

    const unidades = [
      { nombre: 'Pieza', abreviatura: 'pieza' },
      { nombre: 'Caja', abreviatura: 'caja' },
      { nombre: 'Blister', abreviatura: 'blister' },
      { nombre: 'Frasco', abreviatura: 'frasco' },
      { nombre: 'Sobre', abreviatura: 'sobre' },
      { nombre: 'Mililitro', abreviatura: 'ml' },
      { nombre: 'Gramo', abreviatura: 'g' },
      { nombre: 'Tableta', abreviatura: 'tableta' },
      { nombre: 'Capsula', abreviatura: 'capsula' },
    ];

    const repository = this.dataSource.getRepository(UnidadMedida);

    for (const unidad of unidades) {
      const existe = await repository.findOne({
        where: { abreviatura: unidad.abreviatura },
      });

      if (!existe) {
        await repository.save(repository.create(unidad));
        console.log(`  ✓ Unidad creada: ${unidad.nombre}`);
      } else {
        console.log(`  - Unidad ya existe: ${unidad.nombre}`);
      }
    }

    console.log('✅ Seeder de unidades de medida completado');
  }
}
