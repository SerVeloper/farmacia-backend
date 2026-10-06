import { CategoriasController } from './categorias.controller';

describe('CategoriasController', () => {
  let controller: CategoriasController;
  const service = { findAll: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CategoriasController(service as any);
  });

  it('debe delegar el listado completo cuando se omite limite (sin default 10)', async () => {
    await controller.findAll(undefined, undefined);

    expect(service.findAll).toHaveBeenCalledWith({
      page: undefined,
      limit: undefined,
    });
  });

  it('debe delegar pagina y limite tal como llegan del query string', async () => {
    await controller.findAll('3' as any, '5' as any);

    expect(service.findAll).toHaveBeenCalledWith({ page: '3', limit: '5' });
  });

  it('debe delegar limite vacio como ausente', async () => {
    await controller.findAll('1' as any, '' as any);

    expect(service.findAll).toHaveBeenCalledWith({ page: '1', limit: '' });
  });
});
