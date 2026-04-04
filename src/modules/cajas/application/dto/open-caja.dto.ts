import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsUUID, Max } from 'class-validator';

export class OpenCajaDto {
  @ApiProperty({ example: '98f90286-ec67-4d33-b5f3-e786f5cdb589' })
  @IsUUID()
  sucursalId: string;

  @ApiProperty({ example: 150, description: 'Monto inicial de apertura' })
  @IsNumber()
  @IsPositive()
  @Max(999999999)
  montoApertura: number;
}
