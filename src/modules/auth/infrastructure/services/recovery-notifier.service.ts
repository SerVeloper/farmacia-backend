import { Injectable } from '@nestjs/common';

import {
  IRecoveryNotification,
  IRecoveryNotifier,
} from '../../application/interfaces/recovery-notifier.interface';
import { RecoveryChannel } from '../../domain/entities/password-reset-token.entity';
import { EmailRecoveryNotifierService } from './email-recovery-notifier.service';
import { WhatsappRecoveryNotifierService } from './whatsapp-recovery-notifier.service';

@Injectable()
export class RecoveryNotifierService implements IRecoveryNotifier {
  constructor(
    private readonly emailNotifier: EmailRecoveryNotifierService,
    private readonly whatsappNotifier: WhatsappRecoveryNotifierService,
  ) {}

  async send(payload: IRecoveryNotification): Promise<void> {
    if (payload.channel === RecoveryChannel.WHATSAPP) {
      await this.whatsappNotifier.send(payload);
      return;
    }

    await this.emailNotifier.send(payload);
  }
}
