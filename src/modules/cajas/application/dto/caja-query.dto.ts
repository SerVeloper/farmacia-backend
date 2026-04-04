import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CajaQueryDto {
  @ApiProperty({ example: '98f90286-ec67-4d33-b5f3-e786f5cdb589' })
  @IsUUID()
  sucursalId: string;
}
