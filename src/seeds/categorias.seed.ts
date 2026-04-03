import { DataSource } from 'typeorm';
import { Injectable } from '@nestjs/common';

import { Categoria } from '../modules/categorias/domain/entities/categoria.entity';

@Injectable()
export class CategoriasSeeder {
  constructor(private dataSource: DataSource) {}

  async run(): Promise<void> {
    console.log('🌱 Ejecutando seeder de categorías...');

    const categorias = [
      { nombre: 'General', descripcion: 'Categoría general por defecto' },
      { nombre: 'Analgésico', descripcion: 'Medicamentos para el dolor' },
      {
        nombre: 'Antipirético',
        descripcion: 'Medicamentos para reducir fiebre',
      },
      {
        nombre: 'Antiinflamatorio',
        descripcion: 'Medicamentos para reducir inflamación',
      },
      {
        nombre: 'Antibiótico',
        descripcion: 'Medicamentos para tratar infecciones',
      },
      { nombre: 'Antihistamínico', descripcion: 'Medicamentos para alergias' },
      { nombre: 'Vitaminas', descripcion: 'Suplementos vitamínicos' },
    ];

    const repository = this.dataSource.getRepository(Categoria);

    for (const categoria of categorias) {
      const existe = await repository.findOne({
        where: { nombre: categoria.nombre },
      });
      if (!existe) {
        await repository.save(repository.create(categoria));
        console.log(`  ✓ Categoría creada: ${categoria.nombre}`);
      } else {
        console.log(`  - Categoría ya existe: ${categoria.nombre}`);
      }
    }

    console.log('✅ Seeder de categorías completado');
  }
}
