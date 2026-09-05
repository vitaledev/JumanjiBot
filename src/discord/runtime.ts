import { createHash, randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder, GatewayIntentBits, ModalBuilder, PermissionFlagsBits, REST, Routes, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type Guild, type Interaction } from "discord.js";
import { z } from "zod";
import type { Config } from "../config.js";
import type { GameService } from "../core/service.js";
import { AppError, requireRule, type Actor } from "../core/contracts.js";
import type { Identity, IdentityProvider } from "../http/auth.js";
import type { Effects } from "../infrastructure/jobs.js";
import { sendWebhook } from "../infrastructure/webhook.js";

export class DiscordRuntime implements IdentityProvider, Effects {
  readonly client:Client;
  private messageTimers=new Map<string,ReturnType<typeof setTimeout>>();
  private voiceStarts=new Map<string,number>();
  private voiceTimer:ReturnType<typeof setInterval>|undefined;
  private inviteCounts=new Map<string,Map<string,number>>();
  private missionNotices=new Set<string>();
  constructor(public service:GameService,public config:Config) {
    const intents=[GatewayIntentBits.Guilds];
    if(config.ENABLE_MESSAGE_ACTIVITY)intents.push(GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent);
    if(config.ENABLE_MEMBER_EVENTS)intents.push(GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildInvites);
    if(config.ENABLE_VOICE_ACTIVITY)intents.push(GatewayIntentBits.GuildVoiceStates);
    if(config.ENABLE_REACTION_ACTIVITY)intents.push(GatewayIntentBits.GuildMessageReactions);
    this.client=new Client({intents});
  }
  async exchange(code:string,redirect:string):Promise<Identity> {
    requireRule(this.config.DISCORD_CLIENT_SECRET,"Configure DISCORD_CLIENT_SECRET para habilitar login",503);
    const response=await fetch("https://discord.com/api/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:this.config.DISCORD_CLIENT_ID,client_secret:this.config.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:redirect}),signal:AbortSignal.timeout(10000)});
    requireRule(response.ok,"Não foi possível autenticar no Discord",401);
    const token=z.object({access_token:z.string()}).parse(await response.json());
    const headers={Authorization:`Bearer ${token.access_token}`};
    const [userResponse,guildResponse]=await Promise.all([fetch("https://discord.com/api/v10/users/@me",{headers,signal:AbortSignal.timeout(10000)}),fetch("https://discord.com/api/v10/users/@me/guilds",{headers,signal:AbortSignal.timeout(10000)})]);
    requireRule(userResponse.ok && guildResponse.ok,"Não foi possível obter sua identidade",401);
    const user=z.object({id:z.string(),username:z.string(),global_name:z.string().nullable().optional(),avatar:z.string().nullable()}).parse(await userResponse.json());
    const guilds=z.array(z.object({id:z.string(),name:z.string()})).parse(await guildResponse.json());
    return {id:user.id,name:user.global_name??user.username,...(user.avatar?{avatar:`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`}:{}),guilds};
  }
  async guild(guildId:string):Promise<Guild> {return this.client.guilds.fetch(guildId);}
  async authorize(guildId:string,user:Identity):Promise<Actor> {
    const guild=await this.guild(guildId);
    const member=await guild.members.fetch({user:user.id,force:true}).catch(()=>undefined);requireRule(member && !member.user.bot,"Você não pertence a este servidor",403);
    const settings=await this.service.store.run(guildId,u=>this.service.settings(u));
    return {id:member.id,name:member.displayName,avatar:member.displayAvatarURL(),admin:guild.ownerId===member.id || member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild) || settings.adminRoles.some(id=>member.roles.cache.has(id)),owner:guild.ownerId===member.id};
  }
  private async actor(guildId:string,userId:string):Promise<Actor> {return this.authorize(guildId,{id:userId,name:"",guilds:[]});}
  async provision(guildId:string,actorId:string):Promise<unknown> {
    const actor=await this.actor(guildId,actorId);requireRule(actor.admin,"A permissão administrativa foi removida",403);
    const guild=await this.guild(guildId),me=await guild.members.fetchMe();requireRule(me.permissions.has([PermissionFlagsBits.ManageRoles,PermissionFlagsBits.ManageChannels]),"O bot precisa de Gerenciar Cargos e Gerenciar Canais");
    await guild.roles.fetch();await guild.channels.fetch();
    const resources=await this.service.store.run(guildId,async u=>(await u.get("resources","discord",true))?.data??{});
    const save=()=>this.service.store.run(guildId,u=>u.put("resources","discord",resources));
    for(const [key,name] of Object.entries({recruit:"Recruta",member:"Membro",captain:"Capitão","vice-captain":"Vice-capitão"})) {
      const existing=resources[key]?guild.roles.cache.get(resources[key]):guild.roles.cache.find(r=>r.name===`Jumanji • ${name}`);
      const role=existing??await guild.roles.create({name:`Jumanji • ${name}`,permissions:[],reason:"Configuração Jumanji confirmada"});
      requireRule(role.position<me.roles.highest.position,"Mova o cargo do bot acima dos cargos Jumanji");resources[key]=role.id;await save();
    }
    let category=resources.category?guild.channels.cache.get(resources.category):guild.channels.cache.find(c=>c.type===ChannelType.GuildCategory && c.name==="JUMANJI RPG");
    if(!category)category=await guild.channels.create({name:"JUMANJI RPG",type:ChannelType.GuildCategory});resources.category=category.id;await save();
    for(const name of ["painel-rpg","missoes","ranking","auditoria"]) {
      let channel=resources[name]?guild.channels.cache.get(resources[name]):guild.channels.cache.find(c=>c.parentId===category!.id && c.name===name);
      if(!channel)channel=await guild.channels.create({name,type:ChannelType.GuildText,parent:category.id,...(name==="auditoria"?{permissionOverwrites:[{id:guild.id,deny:[PermissionFlagsBits.ViewChannel]},{id:me.id,allow:[PermissionFlagsBits.ViewChannel]}]}:{})});resources[name]=channel.id;await save();
    }
    const divisions=(await this.service.store.database.query("SELECT * FROM divisions WHERE guild_id=$1 AND status='active' ORDER BY number",[guildId])).rows;
    for(const division of divisions) {
      const name=`divisao-${division.number}`,key=`division:${division.id}`;
      let channel=resources[key]?guild.channels.cache.get(resources[key]):guild.channels.cache.find(c=>c.parentId===category!.id && c.name===name);
      if(!channel)channel=await guild.channels.create({name,type:ChannelType.GuildText,parent:category.id,topic:`${division.name} • ${division.motto}`.slice(0,1024)});resources[key]=channel.id;await save();
    }
    await this.service.store.run(guildId,async u=>{const draft=await u.get("setup","current",true);if(draft)await u.put("setup","current",draft.data,"COMPLETED",draft.owner_id);await u.audit(actorId,"setup.completed",guildId);});
    return {roles:4,divisions:divisions.length,channels:Object.keys(resources).length-5};
  }
  async sync(guildId:string,actorId:string):Promise<unknown> {
    const actor=await this.actor(guildId,actorId);requireRule(actor.admin,"Sem permissão para sincronizar",403);requireRule(this.config.ENABLE_MEMBER_EVENTS,"Habilite ENABLE_MEMBER_EVENTS e Server Members Intent");
    const guild=await this.guild(guildId),members=await guild.members.fetch();let synced=0;
    for(const member of members.values())if(!member.user.bot){await this.service.enroll(guildId,{id:member.id,name:member.displayName,avatar:member.displayAvatarURL(),admin:false});synced++;}
    return {synced};
  }
  async roles(guildId:string,userId:string):Promise<unknown> {
    const guild=await this.guild(guildId),member=await guild.members.fetch({user:userId,force:true}).catch(()=>undefined);if(!member)return {leftGuild:true};
    const state=await this.service.store.run(guildId,async u=>({resources:(await u.get("resources","discord",true))?.data??{},member:await this.service.member(u,userId,false)}));
    const names=["recruit","member","captain","vice-captain"],managed=names.map(k=>state.resources[k]).filter((id):id is string=>typeof id==="string");
    const desired=state.member?.participation==="active"?state.resources[state.member.rpg_role]??state.resources.member:undefined;
    for(const role of managed)if(role!==desired && member.roles.cache.has(role))await member.roles.remove(role,"Sincronização de participação e liderança Jumanji");
    if(desired && !member.roles.cache.has(desired))await member.roles.add(desired,"Papel RPG atualizado");
    return {synchronized:true};
  }
  async moderation(guildId:string,caseId:string,actorId:string):Promise<unknown> {
    const actor=await this.actor(guildId,actorId),guild=await this.guild(guildId);
    const state=await this.service.store.run(guildId,async u=>{const row=(await u.get("moderation",caseId))!,settings=await this.service.settings(u);await this.service.manage(u,actor,row.data.divisionId);requireRule(settings.moderation && !settings.pauseModeration,"Moderação suspensa");return {row,settings,resources:(await u.get("resources","discord",true))?.data??{}};});
    const row=state.row;if(row.status==="ACTIONED")return {alreadyDone:true};requireRule(row.status==="PENDING","Caso não está pendente");
    const target=await guild.members.fetch({user:row.data.userId,force:true}).catch(()=>undefined),moderator=await guild.members.fetch({user:actorId,force:true}),me=await guild.members.fetchMe();
    requireRule(row.data.userId!==guild.ownerId && row.data.userId!==this.client.user?.id,"Alvo protegido",403);
    if(target){requireRule(!target.permissions.has(PermissionFlagsBits.Administrator) && !state.settings.protectedRoles.some(id=>target.roles.cache.has(id)),"Alvo protegido",403);requireRule(me.roles.highest.position>target.roles.highest.position && (actor.owner || moderator.roles.highest.position>target.roles.highest.position),"Hierarquia insuficiente",403);}
    if(!actor.admin){requireRule(!["kick","ban"].includes(row.data.action),"Ação administrativa",403);requireRule(state.resources[`division:${row.data.divisionId}`]===row.data.channelId,"Canal fora do escopo da divisão",403);}
    const auditReason=`Jumanji ${caseId}: ${String(row.data.reason).slice(0,300)}`;
    if(row.data.action==="timeout") {requireRule(target,"Membro não encontrado");const until=row.created_at.getTime()+row.data.minutes*60000;if(until>Date.now())await target.disableCommunicationUntil(new Date(until),auditReason);}
    if(row.data.action==="kick" && target) {requireRule(actor.admin && row.data.approvedBy,"Aprovação administrativa necessária",403);await target.kick(auditReason);}
    if(row.data.action==="ban") {requireRule(actor.admin && row.data.approvedBy,"Aprovação administrativa necessária",403);await guild.members.ban(row.data.userId,{reason:auditReason});}
    if(row.data.action==="delete") {const channel=await guild.channels.fetch(row.data.channelId);requireRule(channel?.isTextBased() && "messages" in channel,"Canal inválido");const message=await channel.messages.fetch(row.data.messageId).catch(()=>undefined);if(message){requireRule(message.author.id===row.data.userId,"Mensagem não pertence ao alvo");await message.delete();}}
    if(row.data.action==="ticket") {
      const name=`ticket-${caseId.slice(0,8)}`;await guild.channels.fetch();if(!guild.channels.cache.some(c=>c.name===name))await guild.channels.create({name,type:ChannelType.GuildText,topic:`Caso Jumanji ${caseId}`,permissionOverwrites:[{id:guild.id,deny:[PermissionFlagsBits.ViewChannel]},{id:me.id,allow:[PermissionFlagsBits.ViewChannel]},{id:row.data.userId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]},{id:actor.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]}]});
    }
    await this.service.store.run(guildId,async u=>{await u.put("moderation",caseId,{...row.data,executedAt:new Date().toISOString()},"ACTIONED",row.owner_id);await u.audit(actorId,"moderation.executed",row.data.userId,row.data.reason,{caseId});});return {executed:true};
  }
  async invite(guildId:string,campaignId:string,userId:string):Promise<unknown> {
    const guild=await this.guild(guildId);await guild.members.fetch({user:userId,force:true});
    const state=await this.service.store.run(guildId,async u=>{await this.service.member(u,userId);const campaign=(await u.get("campaign",campaignId))!;requireRule(campaign.status==="ACTIVE" && Date.parse(campaign.data.endsAt)>Date.now(),"Campanha encerrada");return {campaign,existing:(await u.list("invite")).find(r=>r.owner_id===userId && r.data.campaignId===campaignId),resources:(await u.get("resources","discord",true))?.data??{}};});
    if(state.existing)return state.existing.data;
    const channel=await guild.channels.fetch(state.resources["painel-rpg"]);requireRule(channel && "createInvite" in channel,"Configure um canal para convites");
    const invite=await channel.createInvite({maxAge:Math.min(604800,Math.max(60,Math.floor((Date.parse(state.campaign.data.endsAt)-Date.now())/1000))),maxUses:100,unique:true,reason:`Campanha ${campaignId}`});
    await this.service.store.run(guildId,u=>u.put("invite",invite.code,{code:invite.code,url:invite.url,campaignId,uses:invite.uses??0},"ACTIVE",userId));
    await this.snapshotInvites(guildId);return {url:invite.url};
  }
  async notify(guildId:string,userId:string,text:string,key:string):Promise<unknown> {
    const member=await (await this.guild(guildId)).members.fetch({user:userId,force:true});
    try {const channel=await member.createDM();const message=await channel.send({content:text.slice(0,1800),allowedMentions:{parse:[]},nonce:createHash("sha256").update(key).digest("hex").slice(0,24),enforceNonce:true});return {messageId:message.id};}
    catch(error){if((error as {code?:number}).code===50007)return {dmBlocked:true};throw error;}
  }
  async publish(guildId:string,kind:string,id:string,actorId:string):Promise<unknown> {
    const actor=await this.actor(guildId,actorId);requireRule(actor.admin,"Publicação exige administrador",403);
    const state=await this.service.store.run(guildId,async u=>({row:(await u.get(kind,id))!,settings:await this.service.settings(u),resources:(await u.get("resources","discord",true))?.data??{}}));
    requireRule(state.row.status==="ACTIVE","Rascunho não publicado");const channel=await (await this.guild(guildId)).channels.fetch(state.settings.announcementChannelId??state.resources["painel-rpg"]);
    requireRule(channel?.isTextBased() && "send" in channel,"Canal de anúncio indisponível");
    const content={embeds:[new EmbedBuilder().setTitle(state.row.data.name).setDescription(String(state.row.data.body??state.row.data.description??"").slice(0,4000)).setColor(0x8b1e2d)],allowedMentions:{parse:[] as never[]}};
    let message=state.row.data.messageId?await channel.messages.fetch(state.row.data.messageId).catch(()=>undefined):undefined;
    if(message)await message.edit(content);else message=await channel.send({...content,nonce:createHash("sha256").update(`${kind}:${id}`).digest("hex").slice(0,24),enforceNonce:true});
    await this.service.store.run(guildId,u=>u.put(kind,id,{...state.row.data,messageId:message!.id},state.row.status,state.row.owner_id));return {messageId:message.id};
  }
  async webhook(guildId:string,id:string,payload:unknown,key:string):Promise<unknown> {const row=await this.service.store.run(guildId,u=>u.get("webhook",id));requireRule(row?.status==="ACTIVE","Webhook desativado");await sendWebhook(row.data.url,row.data.secret,payload,key);return {delivered:true};}
  private async snapshotInvites(guildId:string):Promise<void> {try{const invites=await (await this.guild(guildId)).invites.fetch();this.inviteCounts.set(guildId,new Map(invites.map(i=>[i.code,i.uses??0])));}catch{this.inviteCounts.delete(guildId);}}
  private async joined(guildId:string,userId:string):Promise<void> {
    const guild=await this.guild(guildId),member=await guild.members.fetch(userId);if(member.user.bot)return;
    await this.service.enroll(guildId,{id:userId,name:member.displayName,avatar:member.displayAvatarURL(),admin:false});
    const previous=this.inviteCounts.get(guildId);const current=await guild.invites.fetch().catch(()=>undefined);if(!current){this.inviteCounts.delete(guildId);return;}
    this.inviteCounts.set(guildId,new Map(current.map(i=>[i.code,i.uses??0])));if(!previous)return;
    const changes=current.filter(i=>(i.uses??0)!==(previous.get(i.code)??0));if(changes.size!==1)return;const used=changes.first()!;if((used.uses??0)-(previous.get(used.code)??0)!==1)return;
    await this.service.store.run(guildId,async u=>{
      const source=await u.get("invite",used.code,true);if(!source || source.owner_id===userId)return;const campaign=(await u.get("campaign",source.data.campaignId))!;
      if(campaign.status!=="ACTIVE" || Date.parse(campaign.data.endsAt)<=Date.now())return;
      const key=this.service.subject(guildId,userId);if(await u.get("referral",key,true))return;
      const row=await u.put("referral",key,{userId,campaignId:campaign.id,joinedAt:new Date().toISOString(),present:true},"PENDING",source.owner_id);
      await u.enqueue("qualify",key,{id:row.id},new Date(Date.now()+campaign.data.qualificationDays*86400000));
    });
  }
  async start(register=true):Promise<void> {
    const safely=(event:string,task:Promise<unknown>)=>{void task.catch(()=>console.error(JSON.stringify({level:"error",event})));};
    this.client.on("error",()=>console.error(JSON.stringify({level:"error",event:"discord.error"})));
    if(register)this.client.on("interactionCreate",i=>safely("discord.interaction",this.interaction(i)));
    this.client.on("guildCreate",g=>safely("guild.created",this.service.store.ensureGuild(g.id,g.name)));
    this.client.on("guildMemberAdd",m=>safely("member.joined",this.joined(m.guild.id,m.id)));
    this.client.on("guildMemberRemove",m=>safely("member.left",this.service.store.run(m.guild.id,async u=>{const row=await u.get("referral",this.service.subject(m.guild.id,m.id),true);if(row)await u.put("referral",row.id,{...row.data,present:false},row.status,row.owner_id);} )));
    this.client.on("messageCreate",message=>{
      if(!this.config.ENABLE_MESSAGE_ACTIVITY || !message.guildId || message.author.bot)return;
      const input={hash:createHash("sha256").update(message.content.trim().toLowerCase().replace(/\s+/g," ")).digest("hex"),length:message.content.trim().length,channelId:message.channelId};
      const timer=setTimeout(()=>{this.messageTimers.delete(message.id);safely("activity.text",(async()=>{const current=await message.channel.messages.fetch(message.id).catch(()=>undefined);if(current && current.content===message.content){const accepted=await this.service.activity(message.guildId!,message.author.id,"text",message.id,input);if(accepted){const assignments=await this.service.store.run(message.guildId!,u=>u.list("assignment"));for(const assignment of assignments.filter(row=>row.owner_id===message.author.id&&row.status==="COMPLETED")){const key=`${message.guildId}:${assignment.id}`;if(this.missionNotices.has(key))continue;this.missionNotices.add(key);await message.author.send(`✅ Missão concluída: **${assignment.data.name??"objetivo da base"}**\nSua recompensa já foi registrada no Jumanji RPG.`).catch(()=>undefined);}}}})());},30000);this.messageTimers.set(message.id,timer);
    });
    this.client.on("messageDelete",m=>{const timer=this.messageTimers.get(m.id);if(timer)clearTimeout(timer);this.messageTimers.delete(m.id);});
    this.client.on("messageReactionAdd",(reaction,user)=>{if(this.config.ENABLE_REACTION_ACTIVITY && !user.bot && reaction.message.guildId)safely("activity.reaction",this.service.activity(reaction.message.guildId,user.id,"reaction",`${reaction.message.id}:${user.id}`,{messageId:reaction.message.id,channelId:reaction.message.channelId}));});
    this.client.on("voiceStateUpdate",(_old,state)=>{this.voiceStarts.delete(`${state.guild.id}:${state.id}`);});
    this.client.on("shardDisconnect",()=>this.voiceStarts.clear());
    await this.client.login(this.config.DISCORD_TOKEN);
    if(!this.client.isReady())await new Promise<void>(resolve=>this.client.once("clientReady",()=>resolve()));
    for(const guild of this.client.guilds.cache.values()){await this.service.store.ensureGuild(guild.id,guild.name);if(this.config.ENABLE_MEMBER_EVENTS)await this.snapshotInvites(guild.id);}
    if(register){const rest=new REST({version:"10"}).setToken(this.config.DISCORD_TOKEN);const names=["help","jogar","painel","iniciar","perfil","missoes","divisao","ranking","temporada","inventario","eventos","batalhas","privacidade","configurar","lideranca","auditoria","moderacao"];
      const descriptions:Record<string,string>={help:"Ver todos os comandos e começar a jogar",jogar:"Começar ou continuar sua jornada no RPG",painel:"Abrir a central de operações do RPG",missoes:"Ver e acompanhar suas missões",divisao:"Escolher ou consultar sua divisão",perfil:"Ver sua ficha e progresso",ranking:"Ver o ranking da temporada",eventos:"Ver próximos eventos da base"};
      const body=names.map(name=>new SlashCommandBuilder().setName(name).setDescription(descriptions[name]??`Abrir ${name} do Jumanji RPG`).toJSON());
      await rest.put(this.config.TEST_GUILD_ID?Routes.applicationGuildCommands(this.config.DISCORD_CLIENT_ID,this.config.TEST_GUILD_ID):Routes.applicationCommands(this.config.DISCORD_CLIENT_ID),{body});}
    if(this.config.ENABLE_VOICE_ACTIVITY)this.voiceTimer=setInterval(()=>safely("activity.voice",this.voiceTick()),60000);
  }
  private async voiceTick():Promise<void> {
    const next=new Map<string,number>(),now=Date.now();if(!this.client.isReady()){this.voiceStarts.clear();return;}
    for(const guild of this.client.guilds.cache.values()) {
      const active=(await this.service.store.database.query("SELECT user_id FROM guild_members WHERE guild_id=$1 AND participation='active'",[guild.id])).rows.map(r=>r.user_id);
      for(const channel of guild.channels.cache.values())if(channel.isVoiceBased() && channel.id!==guild.afkChannelId){
        const members=channel.members.filter(m=>!m.user.bot && !m.voice.deaf && !m.voice.suppress && active.includes(m.id));if(members.size<2)continue;
        for(const member of members.values()){const key=`${guild.id}:${member.id}`,last=this.voiceStarts.get(key);next.set(key,now);if(last && now-last<=90000)await this.service.activity(guild.id,member.id,"voice",`${key}:${Math.floor(now/60000)}`,{seconds:Math.min(60,Math.floor((now-last)/1000)),channelId:channel.id});}
      }
    }this.voiceStarts=next;
  }
  private async interaction(i:Interaction):Promise<void> {
    if(!i.isRepliable() || !i.guildId)return;
    try{
      const actor=await this.actor(i.guildId,i.user.id);
      if(i.isButton() && i.customId.startsWith("jm-form:")) {
        const action=i.customId.slice(8),modal=new ModalBuilder().setCustomId(`jm-submit:${action}`).setTitle("Jumanji • Confirmar ação");
        for(const [key,label] of action==="proof.submit"?[["assignmentId","ID da atribuição"],["url","URL pública da prova"]]:action==="battle.strategy"?[["id","ID da batalha"],["strategy","attack, defend ou maneuver"]]:[["id","Identificador"]])modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(key!).setLabel(label!).setStyle(TextInputStyle.Short).setRequired(true)));
        await i.showModal(modal);return;
      }
      await i.deferReply({flags:64});
      if(i.isChatInputCommand() && i.commandName==="help"){
        const help=new EmbedBuilder().setTitle("JUMANJI RPG · central de ajuda").setDescription("Sua jornada acontece em três passos: entre, escolha uma divisão e conclua sua primeira missão. Use os botões do painel sempre que preferir.").setColor(0x8b1e2d).addFields(
          {name:"COMEÇAR",value:"`/jogar` · hub principal\n`/iniciar` · criar sua ficha\n`/painel` · próxima melhor ação",inline:true},
          {name:"SUA JORNADA",value:"`/perfil` · ficha e XP\n`/missoes` · objetivos ativos\n`/divisao` · equipe e território",inline:true},
          {name:"COMUNIDADE",value:"`/eventos` · próximos encontros\n`/ranking` · disputa saudável\n`/temporada` · capítulo atual",inline:true},
          {name:"PRIVACIDADE",value:"`/privacidade` · exportar ou sair\nVocê pode pular etapas e voltar quando quiser.",inline:false}
        );
        await i.editReply({embeds:[help],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("jm-page:jogar").setLabel("Abrir painel do RPG").setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId("jm-page:divisao").setLabel("Escolher divisão").setStyle(ButtonStyle.Success))]});return;
      }
      if(i.isButton() && i.customId.startsWith("jm-onboard:")){
        const step=i.customId.split(":")[1];
        if(step==="consent"){await this.service.act(i.guildId,actor,"consent",{accept:true});await i.editReply({embeds:[new EmbedBuilder().setTitle("Ficha criada").setDescription("Bem-vindo à base. Veja em dois passos como transformar sua participação em progresso.").setColor(0xd4a72c)],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("jm-onboard:2").setLabel("Continuar apresentação").setStyle(ButtonStyle.Primary))]});return;}
        const embed=step==="2"
          ? new EmbedBuilder().setTitle("Como sua jornada funciona").setDescription("Você escolhe uma divisão, recebe missões curtas e ganha XP por participação válida. Eventos e capítulos fazem a história avançar para todo o servidor.").setColor(0xd4a72c)
          : new EmbedBuilder().setTitle("Seu primeiro objetivo").setDescription("Entre em uma divisão e faça uma missão simples. A comunidade é opcional: você pode pular qualquer etapa e voltar quando quiser.").setColor(0x8b1e2d);
        const row=new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(step==="2"?"jm-page:divisao":"jm-page:divisao").setLabel("Escolher minha divisão").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("jm-page:missoes").setLabel("Ver minhas missões").setStyle(ButtonStyle.Primary));
        await i.editReply({embeds:[embed],components:[row]});return;
      }
      if(i.isModalSubmit() && i.customId.startsWith("jm-submit:")){const input:Record<string,string>={};for(const field of i.fields.fields.values())if("value" in field && typeof field.value==="string")input[field.customId]=field.value;await this.service.act(i.guildId,actor,i.customId.slice(10),input);await i.editReply("Ação registrada. Consulte o painel para acompanhar.");return;}
      if(i.isStringSelectMenu() && i.customId==="jm-division"){await this.service.act(i.guildId,actor,"division.join",{divisionId:i.values[0]});await i.editReply("Você entrou na divisão.");return;}
      if(i.isButton() && i.customId.startsWith("jm-action:")){const [,action,id]=i.customId.split(":");await this.service.act(i.guildId,actor,action!,action==="consent"?{accept:true}:action==="privacy.leave"?{confirm:true}:{id});await i.editReply(action==="privacy.leave"?"Perfil removido. Sua opção de saída será respeitada.":"Ação concluída.");return;}
      const page=i.isChatInputCommand()?i.commandName:i.isButton()?i.customId.replace("jm-page:",""):"painel";
      const mapping:Record<string,string>={jogar:"dashboard",painel:"dashboard",perfil:"dashboard",missoes:"assignment",divisao:"division",ranking:"ranking",temporada:"season",inventario:"inventory",eventos:"event",batalhas:"battle",auditoria:"audit",moderacao:"moderation"};
      const view=await this.service.view(i.guildId,actor,mapping[page]??"dashboard") as any;
      if(page==="perfil"){
        const member=view.member;
        const avatar=member?.avatar_url||actor.avatar||i.user.displayAvatarURL({size:512,extension:"png"});
        const profile=new EmbedBuilder().setTitle(`✦ FICHA RPG · ${member?.display_name??actor.name}`).setDescription(member?.participation==="active"?"**STATUS  ·  🟢 ATIVO NA BASE**\nSua identidade, reputação e progresso nesta temporada.":"**STATUS  ·  ⚪ FORA DO RPG**\nVocê ainda não ativou sua participação. Use /iniciar para começar.").setColor(member?.participation==="active"?0x5865f2:0x8b1e2d).setImage(avatar).setFooter({text:"JUMANJI RPG  ·  sua história, suas escolhas"});
        if(process.env.PANEL_GIF_URL)profile.setImage(process.env.PANEL_GIF_URL);
        if(member?.participation==="active"){const level=Math.floor((member.xp??0)/100)+1,progress=(member.xp??0)%100,bar=`${"🟦".repeat(Math.max(1,Math.ceil(progress/10)))}${"⬛".repeat(Math.max(0,10-Math.ceil(progress/10)))}`;profile.addFields({name:"⚔️ CARGO",value:member.rpg_role??"Recruta",inline:true},{name:"🏅 NÍVEL",value:String(level),inline:true},{name:"📈 PROGRESSO",value:`${bar}\n${progress}/100 XP`,inline:false},{name:"✨ XP TOTAL",value:String(member.xp??0),inline:true},{name:"🛡️ HONRA",value:String(member.honor??0),inline:true},{name:"🏴 DIVISÃO",value:member.division_id?"Escolhida":"Ainda não escolhida",inline:true});}
        await i.editReply({embeds:[profile],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("jm-page:divisao").setLabel(member?.division_id?"Ver minha divisão":"Escolher divisão").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("jm-page:missoes").setLabel("Ver minhas missões").setStyle(ButtonStyle.Primary))]});return;
      }
      if(page==="missoes"){
        const assignments=view.items??[];
        const missions=new EmbedBuilder().setTitle("⚔️ MISSÕES · sua jornada").setDescription(assignments.length?"Cada ação válida aproxima você do próximo nível. Mensagens, reações, voz e eventos são validados automaticamente quando a missão estiver elegível.":"Você ainda não tem missões. Use /iniciar para ativar sua ficha e receber o primeiro objetivo.").setColor(0x5865f2);
        for(const assignment of assignments.slice(0,8)){
          const d=assignment.data??assignment,progress=Number(d.progress??0),target=Math.max(1,Number(d.target??1)),done=assignment.status==="COMPLETED"||progress>=target,filled=Math.min(10,Math.round(progress/target*10)),bar=`${"🟦".repeat(filled)}${"⬛".repeat(10-filled)}`;
          missions.addFields({name:`${done?"✅":"🎯"} ${d.name??"Missão da base"}`,value:`${bar} **${progress}/${target}**\n${done?"Concluída · recompensa entregue":"Em andamento · continue participando"}${d.reward?.xp?`\nRecompensa: **+${d.reward.xp} XP**`:""}`,inline:false});
        }
        if(assignments.length>8)missions.setFooter({text:`Mostrando 8 de ${assignments.length} missões · abra o painel para ver todas`});
        await i.editReply({embeds:[missions],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("jm-page:missoes").setLabel("↻ Atualizar progresso").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("jm-form:proof.submit").setLabel("Enviar prova externa").setStyle(ButtonStyle.Primary),new ButtonBuilder().setURL(`${this.config.PANEL_ORIGIN}/#assignment`).setLabel("Abrir painel completo").setStyle(ButtonStyle.Link))]});return;
      }
      const rows:ActionRowBuilder<ButtonBuilder|StringSelectMenuBuilder>[]=[];
      const buttons:ButtonBuilder[]=[];
      if(page==="iniciar")buttons.push(new ButtonBuilder().setCustomId("jm-onboard:consent").setLabel("Começar minha jornada").setStyle(ButtonStyle.Success));
      if(page==="privacidade")buttons.push(new ButtonBuilder().setCustomId("jm-action:privacy.leave").setLabel("Confirmar saída e exclusão").setStyle(ButtonStyle.Danger));
      if(page==="divisao" && view.items?.length)rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("jm-division").setPlaceholder("Escolher divisão").addOptions(view.items.filter((d:any)=>d.status==="active").slice(0,25).map((d:any)=>({label:d.name.slice(0,100),value:d.id})))));
      if(page==="missoes")buttons.push(new ButtonBuilder().setCustomId("jm-form:proof.submit").setLabel("Enviar prova externa").setStyle(ButtonStyle.Primary));
      if(page==="eventos")for(const event of (view.items??[]).filter((v:any)=>v.status==="ACTIVE").slice(0,3))buttons.push(new ButtonBuilder().setCustomId(`jm-action:event.rsvp:${event.id}`).setLabel(`Participar: ${event.data.name}`.slice(0,80)).setStyle(ButtonStyle.Primary));
      if(page==="batalhas")buttons.push(new ButtonBuilder().setCustomId("jm-form:battle.strategy").setLabel("Escolher estratégia").setStyle(ButtonStyle.Primary));
      buttons.push(new ButtonBuilder().setURL(`${this.config.PANEL_ORIGIN}/#${mapping[page]??"dashboard"}`).setLabel("Abrir painel completo").setStyle(ButtonStyle.Link));
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(0,5)));
      if(page==="painel")rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(["perfil","missoes","divisao","eventos","privacidade"].map(p=>new ButtonBuilder().setCustomId(`jm-page:${p}`).setLabel(p).setStyle(ButtonStyle.Secondary))));
      const description=page==="iniciar"?"Ao aceitar, você autoriza o registro da sua participação, atividades elegíveis e progresso do RPG. Você pode exportar seus dados e sair a qualquer momento pelo painel ou /privacidade.":page==="privacidade"?"A saída remove seu perfil e interrompe recompensas. Registros contábeis usam identificador protegido para evitar duplicações. Confirme somente se deseja sair.":view.items?view.items.slice(0,10).map((r:any)=>`${r.data?.name??r.name??r.display_name??r.action??r.id} • ${r.status??`${r.xp??0} XP`}\n${r.id??""}`).join("\n\n")||"Nenhum registro disponível.":`Servidor: ${view.settings?.name??"Jumanji"}\n${view.member?.participation==="active"?`${view.member.xp} XP • ${view.member.credits} créditos cosméticos`:"Use /iniciar para participar."}`;
      await i.editReply({embeds:[new EmbedBuilder().setTitle(`JUMANJI • ${page}`).setDescription(description.slice(0,4000)).setColor(0x8b1e2d)],components:rows});
    }catch(error){const content=error instanceof AppError?error.message:error instanceof z.ZodError?"Confira os campos informados.":"Não foi possível concluir. Verifique permissões e tente novamente.";if(i.deferred||i.replied)await i.editReply({content,components:[]}).catch(()=>undefined);else await i.reply({content,flags:64}).catch(()=>undefined);}
  }
  async stop():Promise<void>{if(this.voiceTimer)clearInterval(this.voiceTimer);for(const timer of this.messageTimers.values())clearTimeout(timer);this.voiceStarts.clear();await this.client.destroy();}
}

