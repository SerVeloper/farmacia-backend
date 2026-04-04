import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'token-de-recuperacion' })
  @IsString()
  @MinLength(32)
  @MaxLength(255)
  token: string;

  @ApiProperty({ example: 'NuevaPasswordSegura123' })
  @IsString()
  @MinLength(6)
  @MaxLength(100)
  newPassword: string;
}
