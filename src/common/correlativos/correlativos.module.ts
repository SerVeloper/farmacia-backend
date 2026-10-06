import { Global, Module } from '@nestjs/common';

import { CorrelativosService } from './correlativos.service';

@Global()
@Module({
  providers: [CorrelativosService],
  exports: [CorrelativosService],
})
export class CorrelativosModule {}