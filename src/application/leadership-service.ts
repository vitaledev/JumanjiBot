import type { Division, RpgRole } from "../domain/rpg.js";
import { DivisionService } from "./division-service.js";
import { MemberService } from "./member-service.js";

export type LeadershipPosition = "captain" | "vice-captain";

export class LeadershipService {
  constructor(private readonly divisions: DivisionService, private readonly members: MemberService) {}

  appoint(actorRole: RpgRole, divisionId: string, userId: string, position: LeadershipPosition): Division {
    if (actorRole !== "owner" && actorRole !== "administrator" && actorRole !== "general-leader") {
      throw new Error("apenas a liderança geral pode nomear capitães");
    }
    const division = this.divisions.getDivision(divisionId);
    const member = this.members.get(division.guildId, userId);
    if (!member?.consented) throw new Error("o usuário precisa participar do RPG");
    if (!division.memberIds.includes(userId)) throw new Error("o usuário precisa pertencer à divisão");
    if (position === "captain" && division.captainId === userId) return division;
    if (position === "vice-captain" && division.viceCaptainId === userId) return division;

    return this.divisions.setLeadership(divisionId, position, userId);
  }
}