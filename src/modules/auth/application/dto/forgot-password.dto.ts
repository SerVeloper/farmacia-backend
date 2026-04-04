import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { RecoveryChannel } from '../../domain/entities/password-reset-token.entity';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'admin@farmacia.local',
    description: 'Email o telefono del usuario',
  })
  @IsString()
  @MinLength(4)
  @MaxLength(180)
  identifier: string;

  @ApiProperty({
    required: false,
    enum: RecoveryChannel,
    example: RecoveryChannel.AUTO,
  })
  @IsOptional()
  @IsEnum(RecoveryChannel)
  channel?: RecoveryChannel;
}
