import { UnidadesMedidaController } from './unidades-medida.controller';

describe('UnidadesMedidaController', () => {
  let controller: UnidadesMedidaController;
  const service = { findAll: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UnidadesMedidaController(service as any);
  });

  it('debe delegar el listado completo cuando se omite limite', async () => {
    await controller.findAll(undefined, undefined, undefined);

    expect(service.findAll).toHaveBeenCalledWith({
      includeInactive: false,
      page: undefined,
      limit: undefined,
    });
  });

  it('debe delegar pagina y limite tal como llegan del query string', async () => {
    await controller.findAll(undefined, '2' as any, '5' as any);

    expect(service.findAll).toHaveBeenCalledWith({
      includeInactive: false,
      page: '2',
      limit: '5',
    });
  });

  it('debe activar includeInactive cuando se envia true', async () => {
    await controller.findAll('true', undefined, undefined);

    expect(service.findAll).toHaveBeenCalledWith({
      includeInactive: true,
      page: undefined,
      limit: undefined,
    });
  });
});
