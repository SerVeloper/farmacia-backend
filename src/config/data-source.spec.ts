import { importClassesFromDirectories } from 'typeorm/util/DirectoryExportedClassesLoader';

import dataSource from './data-source';

describe('Descubrimiento de migraciones del CLI', () => {
  it('carga las migraciones reales sin importar specs ni conectarse a la base', async () => {
    const entries = dataSource.options.migrations;
    expect(Array.isArray(entries)).toBe(true);
    const patterns = (entries as Array<string | Function>).filter(
      (entry): entry is string => typeof entry === 'string',
    );
    expect(patterns.length).toBeGreaterThan(0);

    const migrations = await importClassesFromDirectories(dataSource.logger, patterns);
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((migration) => migration.name)).toContain(
      'HardenLotBranchCore1775345000000',
    );
    for (const migration of migrations) {
      expect(typeof migration.prototype.up).toBe('function');
      expect(typeof migration.prototype.down).toBe('function');
    }
    expect(dataSource.isInitialized).toBe(false);
  });
});
