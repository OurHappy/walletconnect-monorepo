import { createClient, commandOptions, RedisClientType } from "redis";
import { RelayJsonRpc } from "@walletconnect/relay-api";
import { Logger } from "pino";
import { generateChildLogger } from "@walletconnect/logger";
import { safeJsonParse, safeJsonStringify } from "@walletconnect/safe-json";
import { SIX_HOURS } from "@walletconnect/time";
import * as encoding from "@walletconnect/encoding";

import { sha256 } from "./utils";
import { HttpService } from "./http";
import { REDIS_CONTEXT, NETWORK_EVENTS, JSONRPC_EVENTS } from "./constants";
import { IridiumV1MessageOptions, Notification, LegacySocketMessage, Subscription } from "./types";
import { IridiumEncoder } from "./encoder";

export class RedisStreamID extends String {
  private sequence: number;
  private timestamp: number;
  constructor(value: string) {
    super(value);
    const [timestamp, sequence] = value.split("-");
    this.sequence = encoding.utf8ToNumber(sequence);
    this.timestamp = encoding.utf8ToNumber(timestamp);
  }

  isHigher(id: RedisStreamID): boolean {
    const [ts, seq] = id.split("-");
    const sequence = encoding.utf8ToNumber(seq);
    const timestamp = encoding.utf8ToNumber(ts);
    if (this.timestamp > timestamp) return true;
    if (this.sequence > sequence) return true;
    return false;
  }
}

export class RedisService {
  public client: RedisClientType;
  public context = REDIS_CONTEXT;
  public encoder = new IridiumEncoder();

  constructor(public server: HttpService, public logger: Logger) {
    this.server = server;
    this.client = createClient({ url: this.server.config.redis.url });
    this.logger = generateChildLogger(logger, this.context);
    this.initialize();
  }

  public async setMessage(params: RelayJsonRpc.PublishParams): Promise<void> {
    const { topic, message, ttl } = params;
    this.logger.debug(`Setting Message`);
    this.logger.trace({ type: "method", method: "setMessage", params });
    const key = `message:${topic}`;
    const hash = sha256(message);
    const val = `${hash}:${message}`;
    await this.client.sAdd(key, val);
    await this.client.expire(key, ttl);
    return;
  }

  public async getMessage(topic: string, hash: string): Promise<string | undefined> {
    this.logger.debug(`Getting Message`);
    this.logger.trace({ type: "method", method: "getMessage", topic });
    const options = { MATCH: `${hash}:*` };
    for await (const member of this.client.sScanIterator(`message:${topic}`, options)) {
      return member.split(":")[1];
    }
    return undefined;
  }

  public async getMessages(topic: string): Promise<string[]> {
    this.logger.debug(`Getting Message`);
    this.logger.trace({ type: "method", method: "getMessages", topic });
    const result = await this.client.sMembers(`message:${topic}`);
    const messages: string[] = [];
    if (typeof result !== "undefined" && result.length) {
      result.forEach((m: string) => {
        if (m != null) messages.push(m.split(":")[1]);
      });
    }
    return messages;
  }

  public async deleteMessage(topic: string, hash: string): Promise<void> {
    this.logger.debug(`Deleting Message`);
    this.logger.trace({ type: "method", method: "deleteMessage", topic });
    const options = { MATCH: `${hash}:*` };
    for await (const member of this.client.sScanIterator(`message:${topic}`, options)) {
      await this.client.sRem(`message:${topic}`, member);
    }
    return;
  }

  public async setLegacyCached(message: LegacySocketMessage): Promise<void> {
    this.logger.debug(`Setting Legacy Cached`);
    this.logger.trace({ type: "method", method: "setLegacyCached", message });
    await this.client.lPush(`legacy:${message.topic}`, safeJsonStringify(message));
    await this.client.expire(`legacy:${message.topic}`, SIX_HOURS);
    return;
  }

  public async getLegacyCached(topic: string): Promise<LegacySocketMessage[]> {
    const result = await this.client.lRange(`legacy:${topic}`, 0, -1);
    const messages: LegacySocketMessage[] = [];
    if (typeof result !== "undefined" && result.length) {
      result.forEach((data: string) => {
        const message = safeJsonParse(data);
        messages.push(message);
      });
    }
    this.client.del(`legacy:${topic}`);
    this.logger.debug(`Getting Legacy Published`);
    this.logger.trace({ type: "method", method: "getLegacyCached", topic, messages });
    return messages;
  }

  public async setNotification(notification: Notification): Promise<void> {
    this.logger.debug(`Setting Notification`);
    this.logger.trace({ type: "method", method: "setNotification", notification });
    await this.client.lPush(`notification:${notification.topic}`, safeJsonStringify(notification));
    return;
  }

  public async getNotification(topic: string): Promise<Notification[]> {
    const result = await this.client.lRange(`notification:${topic}`, 0, -1);
    const notifications: Notification[] = [];
    if (typeof result !== "undefined" && result.length) {
      result.forEach((item: string) => {
        const notification = safeJsonParse(item);
        notifications.push(notification);
      });
    }
    this.logger.debug(`Getting Notification`);
    this.logger.trace({ type: "method", method: "getNotification", topic, notifications });
    return notifications;
  }

  public async setPendingRequest(topic: string, id: number, message: string): Promise<void> {
    const key = `pending:${id}`;
    const hash = sha256(message);
    const val = `${topic}:${hash}`;
    this.logger.debug(`Setting Pending Request`);
    this.logger.trace({ type: "method", method: "setPendingRequest", topic, id, message });
    await this.client.set(key, val);
    await this.client.expire(key, this.server.config.maxTTL);
    return;
  }

  public async getPendingRequest(id: number): Promise<string> {
    this.logger.debug(`Getting Pending Request`);
    const data = await this.client.get(`pending:${id}`);
    this.logger.trace({ type: "method", method: "getPendingRequest", id, data });
    return data ? data : "";
  }

  public async deletePendingRequest(id: number): Promise<void> {
    this.logger.debug(`Deleting Pending Request`);
    this.logger.trace({ type: "method", method: "deletePendingRequest", id });
    await this.client.del(`pending:${id}`);
    return;
  }

  public async publish(topic: string, message: string, opts?: IridiumV1MessageOptions) {
    const payload = await this.encoder.encode(message, {prompt: true});
    this.logger.debug("Publishing Iridium Message");
    this.logger.trace({method: "publish", topic, payload });
    await this.client.xAdd(topic, "*", {
      payload,
    });
  }
  
  // TODO implement all the historical getREAD
  public async getStoreMessages(topic: string): Promise<void> {
    return
  }

  public async streamListener(topic: string): Promise<void> {
    this.logger.trace("Starting Redis Stream Read");
    this.logger.trace({method: "streamListener", topic});
    const response = await this.client.xRead(
      commandOptions({isolated: true}),
      [
        {
        key: topic,
        id: "$",
        }
      ], {
        COUNT: 1,
        BLOCK: 0,
      },
    )
    this.logger.trace({method: `BLOCK`, response});
   let payload = "";
    if (response !== null && response.length) {
      let messages = response[0]
      if (messages !== null) {
         payload = messages.messages[0].message.payload
      }
    }
    if (payload !== "")  this.emitWakuMessage(topic, payload)
  }

  // ---------- Private ----------------------------------------------- //

  private initialize(): void {
    this.client.on("error", (e) => {
      this.logger.error(e);
    });
    this.client.connect().then(() => {
      this.logger.trace(`Initialized`);
      this.server.on(JSONRPC_EVENTS.subscribe, (subscription: Subscription) => {
        this.logger.debug(`Subcribe Event`);
        this.logger.trace({method: `Subcribe Event`, subscription});
        this.streamListener(subscription.topic)
      })
    });
  }
  private async emitWakuMessage(topic: string, payload: string) {
    this.logger.debug("Received Iridium Message");
    this.logger.trace({method: `emitWakuMessage`, topic, payload });
    const {
      message,
      opts: { prompt },
    } = await this.encoder.decode(payload);
    this.logger.trace({method: `emitWakuMessage`, message, prompt});
    this.server.events.emit(NETWORK_EVENTS.message, topic, message, prompt);
   }
}
