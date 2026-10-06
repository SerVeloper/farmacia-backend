import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    required: false,
    example: 'token-opcional-para-clientes-que-no-usan-cookie',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;

  @ApiProperty({
    required: false,
    example: '98f90286-ec67-4d33-b5f3-e786f5cdb589',
    description:
      'Sucursal activa opcional para rotar contexto en admin y contador',
  })
  @IsOptional()
  @IsUUID()
  sucursalActivaId?: string;
}
