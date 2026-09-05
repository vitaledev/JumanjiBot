import { MemberService } from "./member-service.js";

export interface Mission {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly xpReward: number;
  readonly daily: boolean;
  readonly externalUrl?: string;
  readonly requiresReview?: boolean;
  readonly actionType: "text" | "event" | "external";
}

export interface MissionAssignment {
  readonly missionId: string;
  readonly guildId: string;
  readonly userId: string;
  readonly progress: number;
  readonly completedAt?: Date;
}

export class MissionService {
  private readonly missions: readonly Mission[] = [
    { id: "daily-chat", name: "Presença na base", description: "Participe de uma conversa válida hoje.", xpReward: 25, daily: true, actionType: "text" },
    { id: "daily-event", name: "Chamado da divisão", description: "Participe de um evento do servidor.", xpReward: 50, daily: true, actionType: "event" },
    { id: "welcome-member", name: "Recepção honrada", description: "Ajude a receber um novo membro.", xpReward: 15, daily: false, actionType: "event" },
    { id: "instagram-story", name: "Sinal nas ruas", description: "Compartilhe o post oficial nos seus Stories do Instagram usando o adesivo de link.", xpReward: 50, daily: false, externalUrl: "https://www.instagram.com/", requiresReview: true, actionType: "external" },
  ];

  private readonly assignments = new Map<string, MissionAssignment>();

  constructor(private readonly memberService: MemberService, instagramUrl = "https://www.instagram.com/") {
    this.missions = this.missions.map((mission) => mission.id === "instagram-story" ? { ...mission, externalUrl: instagramUrl } : mission);
  }

  list(): readonly Mission[] {
    return this.missions;
  }

  assignToMember(guildId: string, userId: string): void {
    for (const mission of this.missions) {
      const key = this.assignmentKey(guildId, userId, mission.id);
      if (!this.assignments.has(key)) this.assignments.set(key, { missionId: mission.id, guildId, userId, progress: 0 });
    }
  }

  assignmentsFor(guildId: string, userId: string): readonly MissionAssignment[] {
    return this.missions.map((mission) => this.assignments.get(this.assignmentKey(guildId, userId, mission.id))).filter((assignment): assignment is MissionAssignment => Boolean(assignment));
  }

  recordTextAction(guildId: string, userId: string, date = new Date()): Mission | undefined {
    this.assignToMember(guildId, userId);
    const mission = this.missions.find((item) => item.actionType === "text" && (!item.daily || item.id === "daily-chat"));
    if (!mission) return undefined;
    const day = date.toISOString().slice(0, 10);
    const key = this.assignmentKey(guildId, userId, mission.id);
    const assignment = this.assignments.get(key)!;
    if (assignment.completedAt && assignment.completedAt.toISOString().slice(0, 10) === day) return undefined;
    const eventKey = `mission:${mission.id}:${day}`;
    this.memberService.addXp(guildId, userId, mission.xpReward, eventKey);
    this.assignments.set(key, { ...assignment, progress: 1, completedAt: date });
    return mission;
  }

  complete(guildId: string, userId: string, missionId: string, date = new Date()): Mission {
    const mission = this.missions.find((item) => item.id === missionId);
    if (!mission) throw new Error("missão não encontrada");
    const day = date.toISOString().slice(0, 10);
    const eventKey = `mission:${mission.id}:${mission.daily ? day : "once"}`;
    this.memberService.addXp(guildId, userId, mission.xpReward, eventKey);
    return mission;
  }

  private assignmentKey(guildId: string, userId: string, missionId: string): string {
    return `${guildId}:${userId}:${missionId}`;
  }
}