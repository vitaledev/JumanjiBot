import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ButtonInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { DivisionService } from "../application/division-service.js";
import { AuditService } from "../application/audit-service.js";
import { MemberService, levelFromXp, roleLabel } from "../application/member-service.js";
import { LeadershipService } from "../application/leadership-service.js";
import { MissionService } from "../application/mission-service.js";
import { SetupWizardService } from "../application/setup-wizard.js";
import { SeasonService } from "../application/season-service.js";
import { provisionGuild } from "./provisioning.js";

const commandDefinitions = [
  new SlashCommandBuilder().setName("painel").setDescription("Abre o painel principal do RPG"),
  new SlashCommandBuilder().setName("configurar").setDescription("Abre o assistente inicial do RPG").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("iniciar").setDescription("Entra no RPG com consentimento"),
  new SlashCommandBuilder().setName("perfil").setDescription("Exibe sua ficha do RPG"),
  new SlashCommandBuilder().setName("missoes").setDescription("Abre suas missões"),
  new SlashCommandBuilder().setName("divisao").setDescription("Exibe informações da sua divisão"),
  new SlashCommandBuilder().setName("ranking").setDescription("Exibe o ranking atual"),
  new SlashCommandBuilder().setName("temporada").setDescription("Exibe a temporada atual"),
  new SlashCommandBuilder().setName("auditoria").setDescription("Consulta ações registradas do RPG").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("lideranca").setDescription("Gerencia a liderança das divisões").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((command) => command.setName("painel").setDescription("Exibe o painel de liderança"))
    .addSubcommand((command) => command.setName("nomear").setDescription("Nomeia um capitão ou vice-capitão")
      .addStringOption((option) => option.setName("divisao").setDescription("ID da divisão").setRequired(true))
      .addUserOption((option) => option.setName("usuario").setDescription("Membro da divisão").setRequired(true))
      .addStringOption((option) => option.setName("cargo").setDescription("Cargo narrativo").setRequired(true).addChoices({ name: "Capitão", value: "captain" }, { name: "Vice-capitão", value: "vice-captain" }))),
  new SlashCommandBuilder().setName("privacidade").setDescription("Gerencia sua participação e seus dados"),
];

const BRAND_COLOR = 0x8b1e2d;
const GOLD_COLOR = 0xd4a72c;

function brandEmbed(title: string, description?: string, color = BRAND_COLOR): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
  if (description) embed.setDescription(description);
  return embed.setFooter({ text: "Jumanji RPG • temporada de testes" });
}

export async function registerCommands(client: Client, clientId: string, guildId?: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(client.token ?? "");
  const body = commandDefinitions.map((command) => command.toJSON());
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    return;
  }
  await rest.put(Routes.applicationCommands(clientId), { body });
}

export function createInteractionHandler(
  setupWizard: SetupWizardService,
  divisionService: DivisionService,
  memberService: MemberService,
  missionService: MissionService,
  seasonService: SeasonService,
  auditService: AuditService,
  leadershipService: LeadershipService,
) {
  return async function handleInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, setupWizard, divisionService, memberService, missionService, seasonService, auditService, leadershipService);
        return;
      }
      if (interaction.isButton()) {
        await handleButton(interaction, divisionService, memberService, missionService, auditService, seasonService);
        return;
      }
      if (interaction.isStringSelectMenu()) {
          await handleSelectMenu(interaction, setupWizard, divisionService, memberService, auditService);
        return;
      }
      if (interaction.isModalSubmit()) await handleModal(interaction, setupWizard, divisionService, seasonService, auditService, memberService, missionService);
    } catch (error) {
      console.error("Falha ao processar interação", error);
      if (!interaction.isRepliable() || interaction.replied || interaction.deferred) return;
      await interaction.reply({ embeds: [brandEmbed("Algo deu errado", "Tente novamente em alguns segundos.", GOLD_COLOR)], ephemeral: true });
    }
  };
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  setupWizard: SetupWizardService,
  divisionService: DivisionService,
  memberService: MemberService,
  missionService: MissionService,
  seasonService: SeasonService,
  auditService: AuditService,
  leadershipService: LeadershipService,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ embeds: [brandEmbed("Ação indisponível", "Este comando só funciona dentro de um servidor.", GOLD_COLOR)], ephemeral: true });
    return;
  }
  if (interaction.commandName === "configurar") {
    setupWizard.start(interaction.guildId, interaction.user.id);
    await interaction.reply({ embeds: [brandEmbed("Configuração da gangue", "Comece definindo a identidade visual. O assistente salva cada etapa antes de avançar.")], components: [identityButtonRow()], ephemeral: true });
    return;
  }
  if (interaction.commandName === "painel") {
    const member = memberService.get(interaction.guildId, interaction.user.id);
    const nextStep = !member ? "Próximo passo: entrar no RPG" : member.divisionId ? "Próximo passo: completar uma missão" : "Próximo passo: escolher uma divisão";
    const panel = brandEmbed("JUMANJI RPG", `A base está aberta. ${nextStep}.`).setThumbnail(interaction.guild?.iconURL() ?? interaction.user.displayAvatarURL()).addFields(
      { name: "Temporada", value: "Preparação inicial", inline: true },
      { name: "Status", value: "● Operacional", inline: true },
      { name: "Participação", value: member ? `Nível ${levelFromXp(member.xp)} • ${member.xp} XP` : "Ainda não iniciada", inline: true },
    );
    const gifUrl = process.env.PANEL_GIF_URL;
    if (gifUrl) panel.setImage(gifUrl);
    await interaction.reply({ embeds: [panel], components: [dashboardRow(), dashboardEntryRow(member)], ephemeral: true });
    return;
  }
  if (interaction.commandName === "auditoria") {
    const entries = auditService.listGuild(interaction.guildId);
    const description = entries.length ? entries.map((entry) => `**${entry.action}** • <t:${Math.floor(entry.createdAt.getTime() / 1000)}:R>\nAutor: <@${entry.actorId}>${entry.targetId ? ` • Alvo: <@${entry.targetId}>` : ""}${entry.reason ? `\nMotivo: ${entry.reason}` : ""}`).join("\n\n") : "Nenhum evento registrado ainda.";
    await interaction.reply({ embeds: [brandEmbed("Auditoria do RPG", description)], ephemeral: true });
    return;
  }
  if (interaction.commandName === "lideranca") {
    if (interaction.options.getSubcommand() === "painel") {
      await interaction.reply({ embeds: [brandEmbed("Painel de liderança", "Use `nomear` com o ID da divisão para designar capitães e vice-capitães.")], ephemeral: true });
      return;
    }
    const divisionId = interaction.options.getString("divisao", true);
    const user = interaction.options.getUser("usuario", true);
    const position = interaction.options.getString("cargo", true) as "captain" | "vice-captain";
    const division = leadershipService.appoint("administrator", divisionId, user.id, position);
    auditService.record({ guildId: interaction.guildId, actorId: interaction.user.id, action: "leadership.appointed", targetId: user.id, reason: position });
    await interaction.reply({ embeds: [brandEmbed("Liderança nomeada", `<@${user.id}> agora é ${position === "captain" ? "capitão" : "vice-capitão"} da **${division.name}**.`, GOLD_COLOR)], ephemeral: true });
    return;
  }
  if (interaction.commandName === "iniciar") {
    await interaction.reply({ embeds: [brandEmbed("Entre para o RPG", "Ao entrar, você aceita o registro das atividades do RPG conforme a política do servidor. Você poderá sair e remover seu perfil em /privacidade.")], components: [consentButtonRow()], ephemeral: true });
    return;
  }
  if (interaction.commandName === "perfil") {
    const member = memberService.get(interaction.guildId, interaction.user.id);
    const embed = member ? brandEmbed(`Ficha de ${member.displayName}`, "Seu progresso atual no RPG.").setThumbnail(interaction.user.displayAvatarURL()).addFields(
      { name: "Cargo", value: roleLabel(member.role), inline: true },
      { name: "Nível", value: String(levelFromXp(member.xp)), inline: true },
      { name: "XP", value: `${member.xp} / ${levelFromXp(member.xp) * 100}`, inline: true },
      { name: "Honra", value: String(member.honor), inline: true },
    ) : brandEmbed("Ficha não encontrada", "Você ainda não entrou no RPG. Use /iniciar.", GOLD_COLOR);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  if (interaction.commandName === "missoes") {
    const assignments = missionService.assignmentsFor(interaction.guildId, interaction.user.id);
    const embed = brandEmbed("Missões da sua jornada", assignments.length ? "O bot acompanha seu progresso automaticamente. Ações válidas no servidor concluem as missões elegíveis." : "Use /iniciar para receber suas missões.");
    for (const assignment of assignments) {
      const mission = missionService.list().find((item) => item.id === assignment.missionId);
      if (mission) embed.addFields({ name: `${mission.name}  •  +${mission.xpReward} XP`, value: `${mission.description}${assignment.completedAt ? "\n✅ Concluída" : "\n◌ Em andamento"}${mission.requiresReview ? "\n🔎 Revisão manual obrigatória" : ""}${mission.id === "instagram-story" ? "\n\n**Texto pronto para copiar:**\n```Compartilhe este post nos seus Stories e marque o link oficial da campanha.```" : ""}` });
    }
    await interaction.reply({ embeds: [embed], components: missionRows(missionService), ephemeral: true });
    return;
  }
  if (interaction.commandName === "temporada") {
    const current = seasonService.current(interaction.guildId);
    if (current) {
      await interaction.reply({ embeds: [brandEmbed("Temporada atual", formatSeason(current))], ephemeral: true });
    } else if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ embeds: [brandEmbed("Nova temporada", "Crie um tema original para iniciar a próxima jornada.", GOLD_COLOR)], components: [seasonCreateRow()], ephemeral: true });
    } else {
      await interaction.reply({ embeds: [brandEmbed("Temporada", "Nenhuma temporada ativa neste momento.")], ephemeral: true });
    }
    return;
  }
  const messages: Record<string, string> = {
    ranking: formatRanking(interaction.guildId, memberService),
    temporada: seasonService.current(interaction.guildId) ? formatSeason(seasonService.current(interaction.guildId)!) : "Nenhuma temporada ativa neste momento.",
    privacidade: "Para sair do RPG e apagar seu perfil, confirme no botão abaixo.",
  };
  const content = messages[interaction.commandName] ?? "Comando ainda não disponível.";
  if (interaction.commandName === "ranking") {
    await interaction.reply({ embeds: rankingEmbeds(interaction.guildId, memberService), components: [dashboardRow()], ephemeral: true });
    return;
  }
  const embed = brandEmbed(commandTitle(interaction.commandName), content, interaction.commandName === "privacidade" ? GOLD_COLOR : BRAND_COLOR);
  const components = interaction.commandName === "privacidade" ? [leaveButtonRow()] : interaction.commandName === "divisao" ? [divisionSelectRow(interaction.guildId, divisionService)] : [];
  if (interaction.commandName === "divisao") embed.setDescription(formatDivisions(interaction.guildId, divisionService));
  await interaction.reply({ embeds: [embed], components, ephemeral: true });
}

async function handleButton(interaction: ButtonInteraction, divisionService: DivisionService, memberService: MemberService, missionService: MissionService, auditService: AuditService, seasonService: SeasonService): Promise<void> {
  if (interaction.customId.startsWith("dashboard:")) {
    await handleDashboardButton(interaction, divisionService, memberService, missionService);
    return;
  }
  if (interaction.customId === "rpg_consent") {
    if (!interaction.guildId) return;
    const member = memberService.consent(interaction.guildId, interaction.user.id, interaction.user.displayName, interaction.user.displayAvatarURL({ size: 128, extension: "png" }));
    missionService.assignToMember(interaction.guildId, interaction.user.id);
    auditService.record({ guildId: interaction.guildId, actorId: interaction.user.id, action: "rpg.joined" });
    await interaction.update({ embeds: [brandEmbed("Entrada confirmada", `${member.displayName}, sua ficha foi criada. Use /perfil para acompanhar o progresso.`, GOLD_COLOR)], components: [] });
    return;
  }
  if (interaction.customId === "season_create") {
    const modal = new ModalBuilder().setCustomId("season_create_modal").setTitle("Criar temporada");
    const name = new TextInputBuilder().setCustomId("season_name").setLabel("Nome da temporada").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60);
    const theme = new TextInputBuilder().setCustomId("season_theme").setLabel("Tema ou sinopse").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name), new ActionRowBuilder<TextInputBuilder>().addComponents(theme));
    await interaction.showModal(modal);
    return;
  }
  if (interaction.customId === "rpg_leave") {
    if (!interaction.guildId) return;
    memberService.leave(interaction.guildId, interaction.user.id);
    auditService.record({ guildId: interaction.guildId, actorId: interaction.user.id, action: "rpg.left" });
    await interaction.update({ embeds: [brandEmbed("Perfil removido", "Seus dados do RPG foram removidos desta sessão. Para voltar, use /iniciar.", GOLD_COLOR)], components: [] });
    return;
  }
  if (interaction.customId.startsWith("mission_complete:")) {
    if (!interaction.guildId) return;
    try {
      const missionId = interaction.customId.replace("mission_complete:", "");
      const mission = missionService.list().find((item) => item.id === missionId);
      if (!mission) throw new Error("missão não encontrada");
      if (mission.requiresReview) {
        await interaction.showModal(externalProofModal(mission.id));
        return;
      }
      if (mission.actionType !== "external") throw new Error("esta missão é concluída automaticamente por uma ação válida no servidor");
      auditService.record({ guildId: interaction.guildId, actorId: interaction.user.id, action: "mission.completed", targetId: missionId });
      await interaction.update({ embeds: [brandEmbed("Missão concluída", `${mission.name}\n\nRecompensa recebida: **${mission.xpReward} XP**.`, GOLD_COLOR)], components: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "não foi possível concluir a missão";
      await interaction.reply({ embeds: [brandEmbed("Missão não concluída", message, GOLD_COLOR)], ephemeral: true });
    }
    return;
  }
  if (interaction.customId === "setup_identity") {
    const modal = new ModalBuilder().setCustomId("setup_identity_modal").setTitle("Identidade da gangue");
    const name = new TextInputBuilder().setCustomId("gang_name").setLabel("Nome").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name));
    await interaction.showModal(modal);
  }
  if (interaction.customId === "setup_divisions") {
    const modal = new ModalBuilder().setCustomId("setup_divisions_modal").setTitle("Divisões iniciais");
    const count = new TextInputBuilder().setCustomId("division_count").setLabel("Quantidade (1 a 12)").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("2");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(count));
    await interaction.showModal(modal);
  }
}

async function handleModal(
  interaction: ModalSubmitInteraction,
  setupWizard: SetupWizardService,
  divisionService: DivisionService,
  seasonService: SeasonService,
  auditService: AuditService,
  memberService: MemberService,
  missionService: MissionService,
): Promise<void> {
  if (!interaction.guildId) return;
  try {
    if (interaction.customId === "mission_proof_modal") {
      await interaction.reply({ embeds: [brandEmbed("Prova enviada", "Sua prova foi encaminhada para revisão humana. A recompensa só será liberada após aprovação.", GOLD_COLOR)], ephemeral: true });
      return;
    }
    if (interaction.customId === "season_create_modal") {
      const season = seasonService.create(interaction.guildId, interaction.fields.getTextInputValue("season_name"), interaction.fields.getTextInputValue("season_theme"));
      const active = seasonService.transition(season.id, "ACTIVE");
      auditService.record({ guildId: interaction.guildId, actorId: interaction.user.id, action: "season.created", targetId: active.id });
      await interaction.reply({ embeds: [brandEmbed("Temporada iniciada", formatSeason(active), GOLD_COLOR)], ephemeral: true });
      return;
    }
    if (interaction.customId === "setup_identity_modal") {
      setupWizard.setIdentity(interaction.guildId, {
        name: interaction.fields.getTextInputValue("gang_name"),
        acronym: acronymFromName(interaction.fields.getTextInputValue("gang_name")),
        color: "#8B1E2D",
      });
      await interaction.reply({ embeds: [brandEmbed("Identidade salva", "Agora escolha uma cor para a gangue.", GOLD_COLOR)], components: [colorSelectRow()], ephemeral: true });
      return;
    }
    if (interaction.customId === "setup_divisions_modal") {
      const count = Number(interaction.fields.getTextInputValue("division_count"));
      setupWizard.setDivisionCount(interaction.guildId, count);
      const divisions = setupWizard.createDivisionInputs(interaction.guildId).map((input) => divisionService.createDivision("administrator", input));
      if (interaction.guild) {
        const members = await interaction.guild.members.fetch();
        for (const guildMember of members.values()) {
          if (!guildMember.user.bot) {
            memberService.enrollAutomatically(interaction.guildId, guildMember.id, guildMember.displayName, guildMember.displayAvatarURL({ size: 128, extension: "png" }));
            missionService.assignToMember(interaction.guildId, guildMember.id);
          }
        }
      }
      const provisioning = interaction.guild ? await provisionGuild(interaction.guild, divisions) : { rolesCreated: 0, channelsCreated: 0, warnings: ["Servidor indisponível para provisionamento."] };
      setupWizard.finish(interaction.guildId);
      const warningText = provisioning.warnings.length ? `\n\nAtenção:\n${provisioning.warnings.join("\n")}` : "";
      await interaction.reply({ embeds: [brandEmbed("Configuração concluída", `${divisions.length} divisões foram criadas.\n${provisioning.rolesCreated} cargos e ${provisioning.channelsCreated} canais foram preparados.${warningText}`, GOLD_COLOR)], ephemeral: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "não foi possível concluir esta etapa";
    await interaction.reply({ embeds: [brandEmbed("Configuração não concluída", message, GOLD_COLOR)], ephemeral: true });
  }
}

function identityButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("setup_identity").setLabel("Definir identidade").setStyle(ButtonStyle.Primary));
}

function divisionButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("setup_divisions").setLabel("Definir divisões").setStyle(ButtonStyle.Primary));
}

function formatDivisions(guildId: string, divisionService: DivisionService): string {
  const divisions = divisionService.listGuildDivisions(guildId);
  return divisions.length === 0 ? "Nenhuma divisão foi criada ainda." : divisions.map((division) => `**${String(division.number).padStart(2, "0")}  ${division.name}**\n${division.motto || "Sem lema definido"}\n` + progressBar(division.memberIds.length, division.memberLimit)).join("\n");
}

function consentButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("rpg_consent").setLabel("Aceitar e entrar").setStyle(ButtonStyle.Success));
}

function missionButtonRow(missionService: MissionService) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    missionService.list().filter((mission) => !mission.externalUrl).map((mission) => new ButtonBuilder().setCustomId(`mission_complete:${mission.id}`).setLabel(`Concluir: ${mission.name}`).setStyle(ButtonStyle.Primary)),
  );
}

function missionRows(missionService: MissionService) {
  const rows = [missionButtonRow(missionService)];
  const external = missionService.list().find((mission) => mission.externalUrl);
  if (external?.externalUrl) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel("Abrir post do Instagram").setStyle(ButtonStyle.Link).setURL(external.externalUrl),
      new ButtonBuilder().setCustomId(`mission_complete:${external.id}`).setLabel("Enviar prova").setStyle(ButtonStyle.Success),
    ));
  }
  return rows;
}

function externalProofModal(missionId: string): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("mission_proof_modal").setTitle("Enviar prova da missão");
  const proof = new TextInputBuilder().setCustomId(`proof_url:${missionId}`).setLabel("Link da prova ou perfil público").setStyle(TextInputStyle.Short).setPlaceholder("https://www.instagram.com/stories/...").setRequired(true);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(proof));
  return modal;
}

function leaveButtonRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("rpg_leave").setLabel("Sair e apagar meu perfil").setStyle(ButtonStyle.Danger));
}

function formatRanking(guildId: string, memberService: MemberService): string {
  const members = [...memberService.listGuild(guildId)].sort((left, right) => right.xp - left.xp).slice(0, 10);
  return members.length === 0 ? "Ainda não há membros no ranking." : members.map((member, index) => `**${index + 1}. ${member.displayName}**\nNível ${levelFromXp(member.xp)}  •  ${member.xp} XP`).join("\n\n");
}

function progressBar(value: number, maximum: number): string {
  const filled = Math.min(10, Math.round((value / maximum) * 10));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}  ${value}/${maximum}`;
}

function commandTitle(commandName: string): string {
  return { divisao: "Divisões da gangue", ranking: "Ranking de honra", temporada: "Temporada atual", auditoria: "Auditoria do RPG", privacidade: "Privacidade" }[commandName] ?? "Jumanji RPG";
}

function formatSeason(season: { name: string; theme: string; status: string }): string {
  return `**${season.name}**\n${season.theme}\n\nEstado: **${season.status}**`;
}

function dashboardRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("dashboard:profile").setLabel("Minha ficha").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("dashboard:missions").setLabel("Missões").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("dashboard:division").setLabel("Divisão").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("dashboard:ranking").setLabel("Ranking").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("dashboard:privacy").setLabel("Privacidade").setStyle(ButtonStyle.Secondary),
  );
}

function dashboardEntryRow(member: ReturnType<MemberService["get"]>) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(member?.divisionId ? "dashboard:missions" : "dashboard:join").setLabel(member?.divisionId ? "Ir para missões" : "Escolher divisão").setStyle(ButtonStyle.Success),
  );
}

async function handleDashboardButton(
  interaction: ButtonInteraction,
  divisionService: DivisionService,
  memberService: MemberService,
  missionService: MissionService,
): Promise<void> {
  if (!interaction.guildId) return;
  const target = interaction.customId.replace("dashboard:", "");
  if (target === "profile") {
    const member = memberService.get(interaction.guildId, interaction.user.id);
    const embed = member ? brandEmbed(`Ficha de ${member.displayName}`, "Seu progresso atual no RPG.", GOLD_COLOR).setThumbnail(interaction.user.displayAvatarURL()).addFields(
      { name: "Cargo", value: roleLabel(member.role), inline: true },
      { name: "Nível", value: String(levelFromXp(member.xp)), inline: true },
      { name: "XP", value: `${member.xp} / ${levelFromXp(member.xp) * 100}`, inline: true },
      { name: "Honra", value: String(member.honor), inline: true },
    ) : brandEmbed("Ficha não encontrada", "Use /iniciar para entrar no RPG.", GOLD_COLOR);
    await interaction.update({ embeds: [embed], components: [dashboardRow()] });
    return;
  }
  if (target === "missions") {
    const embed = brandEmbed("Missões disponíveis", "Escolha uma missão para registrar sua recompensa.");
    for (const mission of missionService.list()) embed.addFields({ name: `${mission.name}  •  +${mission.xpReward} XP`, value: mission.description });
    await interaction.update({ embeds: [embed], components: [missionButtonRow(missionService)] });
    return;
  }
  if (target === "division") {
    await interaction.update({ embeds: [brandEmbed("Divisões da gangue", formatDivisions(interaction.guildId, divisionService))], components: [divisionSelectRow(interaction.guildId, divisionService), dashboardRow()] });
    return;
  }
  if (target === "join") {
    const member = memberService.get(interaction.guildId, interaction.user.id);
    if (!member) {
      await interaction.update({ embeds: [brandEmbed("Primeiro passo", "Use /iniciar para entrar no RPG antes de escolher uma divisão.", GOLD_COLOR)], components: [dashboardRow()] });
      return;
    }
    await interaction.update({ embeds: [brandEmbed("Escolha seu território", "Selecione uma divisão disponível para começar sua jornada.")], components: [divisionSelectRow(interaction.guildId, divisionService), dashboardRow()] });
    return;
  }
  if (target === "ranking") {
    await interaction.update({ embeds: rankingEmbeds(interaction.guildId, memberService), components: [dashboardRow()] });
    return;
  }
  await interaction.update({ embeds: [brandEmbed("Privacidade", "Para remover seu perfil do RPG, confirme abaixo.", GOLD_COLOR)], components: [leaveButtonRow()] });
}

async function handleDivisionSelection(interaction: StringSelectMenuInteraction, divisionService: DivisionService, memberService: MemberService, auditService: AuditService): Promise<void> {
  if (!interaction.guildId) return;
  try {
    const divisionId = interaction.values[0];
    if (!divisionId) throw new Error("nenhuma divisão selecionada");
    const member = memberService.get(interaction.guildId, interaction.user.id);
    if (!member) throw new Error("use /iniciar antes de escolher uma divisão");
    divisionService.joinDivision(divisionId, member);
    const updated = memberService.setDivision(interaction.guildId, interaction.user.id, divisionId);
    const division = divisionService.getDivision(divisionId);
    auditService.record({ guildId: interaction.guildId, actorId: interaction.user.id, action: "division.joined", targetId: divisionId });
    await interaction.update({ embeds: [brandEmbed("Divisão definida", `${updated.displayName}, você agora faz parte da **${division.name}**.\n\n${division.motto || "Sua história começa aqui."}`, GOLD_COLOR)], components: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "não foi possível entrar na divisão";
    await interaction.reply({ embeds: [brandEmbed("Entrada não concluída", message, GOLD_COLOR)], ephemeral: true });
  }
}

function divisionSelectRow(guildId: string, divisionService: DivisionService) {
  const options = divisionService.listGuildDivisions(guildId).slice(0, 25).map((division) => ({
    label: `${String(division.number).padStart(2, "0")} • ${division.name}`.slice(0, 100),
    description: `${division.memberIds.length}/${division.memberLimit} vagas ocupadas`.slice(0, 100),
    value: division.id,
  }));
  const safeOptions = options.length ? options : [{ label: "Nenhuma divisão criada", description: "Aguarde o administrador configurar o RPG", value: "none", default: true }];
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("division_join").setPlaceholder(options.length ? "Escolha sua divisão" : "Nenhuma divisão disponível").setDisabled(options.length === 0).addOptions(safeOptions));
}

function rankingEmbeds(guildId: string, memberService: MemberService): EmbedBuilder[] {
  const members = [...memberService.listGuild(guildId)].sort((left, right) => right.xp - left.xp).slice(0, 10);
  if (members.length === 0) return [brandEmbed("Ranking de honra", "Ainda não há membros no ranking.", GOLD_COLOR)];
  return [
    brandEmbed("Ranking de honra", "Os participantes mais ativos da gangue nesta sessão.", GOLD_COLOR),
    ...members.map((member, index) => {
      const embed = brandEmbed(`#${index + 1}  ${member.displayName}`, `Nível **${levelFromXp(member.xp)}**  •  **${member.xp} XP**`, index === 0 ? GOLD_COLOR : BRAND_COLOR).setAuthor({ name: `Posição ${index + 1}` });
      if (member.avatarUrl) embed.setAuthor({ name: `Posição ${index + 1}`, iconURL: member.avatarUrl }).setThumbnail(member.avatarUrl);
      return embed;
    }),
  ];
}

function seasonCreateRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("season_create").setLabel("Criar temporada").setStyle(ButtonStyle.Success));
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction, setupWizard: SetupWizardService, divisionService: DivisionService, memberService: MemberService, auditService: AuditService): Promise<void> {
  if (interaction.customId === "setup_color") {
    if (!interaction.guildId) return;
    const draft = setupWizard.get(interaction.guildId);
    const color = interaction.values[0];
    if (!draft?.identity || !color) {
      await interaction.reply({ embeds: [brandEmbed("Configuração incompleta", "Recomece usando /configurar.", GOLD_COLOR)], ephemeral: true });
      return;
    }
    setupWizard.setIdentity(interaction.guildId, { ...draft.identity, color });
    await interaction.update({ embeds: [brandEmbed("Cor escolhida", "Agora defina quantas divisões existirão.", GOLD_COLOR)], components: [divisionButtonRow()] });
    return;
  }
  await handleDivisionSelection(interaction, divisionService, memberService, auditService);
}

function colorSelectRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("setup_color").setPlaceholder("Escolha a cor da gangue").addOptions(
    { label: "Vermelho rubi", description: "Coragem e presença", value: "#8B1E2D", emoji: "🔴" },
    { label: "Dourado urbano", description: "Prestígio e conquista", value: "#D4A72C", emoji: "🟡" },
    { label: "Azul elétrico", description: "Estratégia e energia", value: "#1877C9", emoji: "🔵" },
    { label: "Verde neon", description: "Movimento e renovação", value: "#2E9B63", emoji: "🟢" },
  ));
}

function acronymFromName(name: string): string {
  const letters = name.trim().split(/\s+/).map((word) => word[0]).join("").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (letters || "RPG").slice(0, 5);
}