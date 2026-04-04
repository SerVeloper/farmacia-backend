import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    required: false,
    example: 'token-opcional-para-clientes-que-no-usan-cookie',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;
}
