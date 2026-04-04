import { Injectable, Logger } from '@nestjs/common';

import { IRecoveryNotification, IRecoveryNotifier } from '../../application/interfaces/recovery-notifier.interface';

@Injectable()
export class WhatsappRecoveryNotifierService implements IRecoveryNotifier {
  private readonly logger = new Logger(WhatsappRecoveryNotifierService.name);

  async send(payload: IRecoveryNotification): Promise<void> {
    this.logger.log(
      `Recovery por WhatsApp preparado para user=${payload.userId} identifier=${payload.identifier} expira=${payload.expiresAt.toISOString()}`,
    );
  }
}
