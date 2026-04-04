import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RecoveryChannel {
  AUTO = 'auto',
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
}

@Entity({ name: 'password_reset_tokens' })
@Index(['userId', 'usedAt'])
@Index(['tokenHash'])
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'token_hash', length: 128 })
  tokenHash: string;

  @Column({ name: 'identifier', length: 180 })
  identifier: string;

  @Column({
    name: 'channel',
    type: 'enum',
    enum: RecoveryChannel,
    default: RecoveryChannel.AUTO,
  })
  channel: RecoveryChannel;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamp', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
