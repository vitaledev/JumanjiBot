import {
  assertValidDivision,
  canManageDivisionMembers,
  canManageDivisions,
  type CreateDivisionInput,
  type Division,
  type GuildMemberProfile,
  type RpgRole,
} from "../domain/rpg.js";

export class DivisionService {
  private readonly divisions = new Map<string, Division>();

  createDivision(actorRole: RpgRole, input: CreateDivisionInput): Division {
    if (!canManageDivisions(actorRole)) throw new Error("papel sem permissão para criar divisões");
    assertValidDivision(input);

    const divisionId = `${input.guildId}:division:${input.number}`;
    if (this.divisions.has(divisionId)) throw new Error("divisão já existe neste servidor");

    const division: Division = {
      id: divisionId,
      guildId: input.guildId,
      number: input.number,
      name: input.name.trim(),
      color: input.color.toUpperCase(),
      motto: input.motto?.trim() ?? "",
      memberLimit: input.memberLimit,
      status: "active",
      memberIds: [],
    };
    this.divisions.set(division.id, division);
    return division;
  }

  addMember(actorRole: RpgRole, divisionId: string, member: GuildMemberProfile): Division {
    if (!canManageDivisionMembers(actorRole)) throw new Error("papel sem permissão para gerenciar membros");
    if (!member.consented) throw new Error("membro não consentiu participar do RPG");

    const division = this.getDivision(divisionId);
    if (division.guildId !== member.guildId) throw new Error("membro e divisão pertencem a servidores diferentes");
    if (division.memberIds.includes(member.userId)) return division;
    if (division.memberIds.length >= division.memberLimit) throw new Error("divisão está sem vagas");

    const updated: Division = { ...division, memberIds: [...division.memberIds, member.userId] };
    this.divisions.set(divisionId, updated);
    return updated;
  }

  joinDivision(divisionId: string, member: GuildMemberProfile): Division {
    if (!member.consented) throw new Error("membro não consentiu participar do RPG");
    const division = this.getDivision(divisionId);
    if (division.guildId !== member.guildId) throw new Error("membro e divisão pertencem a servidores diferentes");
    if (member.divisionId && member.divisionId !== divisionId) throw new Error("membro já pertence a outra divisão");
    if (division.memberIds.includes(member.userId)) return division;
    if (division.memberIds.length >= division.memberLimit) throw new Error("divisão está sem vagas");

    const updated: Division = { ...division, memberIds: [...division.memberIds, member.userId] };
    this.divisions.set(divisionId, updated);
    return updated;
  }

  setLeadership(divisionId: string, position: "captain" | "vice-captain", userId: string): Division {
    const division = this.getDivision(divisionId);
    if (!division.memberIds.includes(userId)) throw new Error("líder precisa pertencer à divisão");
    const updated: Division = position === "captain" ? { ...division, captainId: userId } : { ...division, viceCaptainId: userId };
    this.divisions.set(divisionId, updated);
    return updated;
  }

  getDivision(divisionId: string): Division {
    const division = this.divisions.get(divisionId);
    if (!division) throw new Error("divisão não encontrada");
    return division;
  }

  listGuildDivisions(guildId: string): readonly Division[] {
    return [...this.divisions.values()].filter((division) => division.guildId === guildId);
  }
}