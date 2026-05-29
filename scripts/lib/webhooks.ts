import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface WebhookConfig {
  url: string;
  events: ("error" | "budget_exceeded" | "agent_complete")[];
  format: "slack" | "discord" | "generic";
}

const CONFIG_PATH = path.join(os.homedir(), ".claude", "monitor-webhooks.json");
let webhookConfigs: WebhookConfig[] = [];

export function loadWebhookConfig(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      webhookConfigs = Array.isArray(parsed) ? parsed : [parsed];
      console.log(`Loaded ${webhookConfigs.length} webhook config(s)`);
    }
  } catch (err) {
    console.warn("Failed to load webhook config:", err);
    webhookConfigs = [];
  }
}

export function getWebhookConfigs(): WebhookConfig[] {
  return webhookConfigs;
}

interface WebhookPayload {
  eventType: "error" | "budget_exceeded" | "agent_complete";
  agentId: string;
  agentType: string;
  message: string;
  timestamp: number;
}

export async function dispatchWebhooks(payload: WebhookPayload): Promise<void> {
  const configs = webhookConfigs.filter(c => c.events.includes(payload.eventType));
  for (const config of configs) {
    try {
      const body = formatPayload(config.format, payload);
      const res = await fetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) console.warn(`Webhook ${config.url} returned ${res.status}`);
    } catch (err) {
      console.warn(`Webhook dispatch failed for ${config.url}:`, err);
    }
  }
}

function formatPayload(format: WebhookConfig["format"], payload: WebhookPayload): unknown {
  const time = new Date(payload.timestamp).toISOString();
  switch (format) {
    case "slack":
      return formatSlackMessage(payload, time);
    case "discord":
      return formatDiscordMessage(payload, time);
    default:
      return { ...payload, time };
  }
}

export function formatSlackMessage(payload: WebhookPayload, time: string): unknown {
  const emoji = payload.eventType === "error" ? ":x:" : payload.eventType === "budget_exceeded" ? ":warning:" : ":white_check_mark:";
  return {
    text: `${emoji} *Agent Monitor*: ${payload.message}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${payload.eventType.replace("_", " ").toUpperCase()}*\n*Agent:* ${payload.agentId} (${payload.agentType})\n*Message:* ${payload.message}\n*Time:* ${time}`,
        },
      },
    ],
  };
}

export function formatDiscordMessage(payload: WebhookPayload, time: string): unknown {
  const color = payload.eventType === "error" ? 0xff4444 : payload.eventType === "budget_exceeded" ? 0xeab308 : 0x00ff88;
  return {
    embeds: [{
      title: `Agent Monitor: ${payload.eventType.replace("_", " ")}`,
      description: payload.message,
      color,
      fields: [
        { name: "Agent", value: `${payload.agentId} (${payload.agentType})`, inline: true },
        { name: "Time", value: time, inline: true },
      ],
    }],
  };
}
