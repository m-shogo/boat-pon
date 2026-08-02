import { PermanentShadowDeliveryError } from "./rollout";

export type ShadowOutboxMessage = {
  outboxMessageId: string;
  messageType: string;
  payload: unknown;
};

export type ShadowMessageHandler = (message: ShadowOutboxMessage) => void;

export class ShadowMessageRouter {
  private readonly handlers = new Map<string, ShadowMessageHandler>();

  register(messageType: string, handler: ShadowMessageHandler): this {
    if (messageType.trim() === "" || typeof handler !== "function") {
      throw new Error("invalid shadow message handler registration");
    }
    if (this.handlers.has(messageType)) {
      throw new Error(`duplicate shadow message handler: ${messageType}`);
    }
    this.handlers.set(messageType, handler);
    return this;
  }

  handle = (message: ShadowOutboxMessage): void => {
    const handler = this.handlers.get(message.messageType);
    if (!handler) {
      throw new PermanentShadowDeliveryError(
        "SHADOW_MESSAGE_TYPE_UNSUPPORTED",
        `unsupported shadow message type: ${message.messageType}`,
      );
    }
    handler(message);
  };
}
