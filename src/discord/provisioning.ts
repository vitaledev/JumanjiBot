import { ChannelType, type Guild } from "discord.js";
import type { Division } from "../domain/rpg.js";

const RPG_CATEGORY = "JUMANJI RPG";
const RPG_ROLES = ["RPG • Recruta", "RPG • Membro", "RPG • Oficial", "RPG • Capitão", "RPG • Vice-capitão"];

export interface ProvisioningResult {
  readonly rolesCreated: number;
  readonly channelsCreated: number;
  readonly warnings: readonly string[];
}

export async function provisionGuild(guild: Guild, divisions: readonly Division[]): Promise<ProvisioningResult> {
  const warnings: string[] = [];
  let rolesCreated = 0;
  let channelsCreated = 0;
  const existingRoles = new Set(guild.roles.cache.map((role) => role.name));

  for (const roleName of RPG_ROLES) {
    if (existingRoles.has(roleName)) continue;
    try {
      await guild.roles.create({ name: roleName, permissions: [], reason: "Estrutura inicial do Jumanji RPG" });
      rolesCreated += 1;
    } catch {
      warnings.push(`Não foi possível criar o cargo ${roleName}.`);
    }
  }

  let category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === RPG_CATEGORY);
  if (!category) {
    try {
      category = await guild.channels.create({ name: RPG_CATEGORY, type: ChannelType.GuildCategory, reason: "Estrutura inicial do Jumanji RPG" });
      channelsCreated += 1;
    } catch {
      warnings.push("Não foi possível criar a categoria JUMANJI RPG.");
      return { rolesCreated, channelsCreated, warnings };
    }
  }

  const coreChannels = [
    { name: "painel-rpg", type: ChannelType.GuildText },
    { name: "missoes", type: ChannelType.GuildText },
    { name: "ranking", type: ChannelType.GuildText },
  ] as const;
  for (const channel of coreChannels) {
    if (guild.channels.cache.some((item) => item.parentId === category.id && item.name === channel.name)) continue;
    try {
      await guild.channels.create({ name: channel.name, type: channel.type, parent: category.id, reason: "Estrutura inicial do Jumanji RPG" });
      channelsCreated += 1;
    } catch {
      warnings.push(`Não foi possível criar o canal #${channel.name}.`);
    }
  }

  for (const division of divisions) {
    const channelName = `divisao-${division.number}`;
    if (guild.channels.cache.some((item) => item.parentId === category.id && item.name === channelName)) continue;
    try {
      await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `${division.name} • ${division.motto}`.slice(0, 1024),
        reason: "Estrutura inicial do Jumanji RPG",
      });
      channelsCreated += 1;
    } catch {
      warnings.push(`Não foi possível criar o canal #${channelName}.`);
    }
  }

  return { rolesCreated, channelsCreated, warnings };
}