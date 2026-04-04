import { RecoveryChannel } from '../../domain/entities/password-reset-token.entity';

export interface IRecoveryNotification {
  userId: string;
  identifier: string;
  channel: RecoveryChannel;
  token: string;
  expiresAt: Date;
}

export interface IRecoveryNotifier {
  send(payload: IRecoveryNotification): Promise<void>;
}
