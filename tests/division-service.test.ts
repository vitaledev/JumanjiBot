import { describe, expect, it } from "vitest";
import { DivisionService } from "../src/application/division-service.js";
import { SetupWizardService } from "../src/application/setup-wizard.js";
import { ActivityService } from "../src/application/activity-service.js";
import { MemberService, levelFromXp } from "../src/application/member-service.js";
import { MissionService } from "../src/application/mission-service.js";

const divisionInput = {
  guildId: "guild-1",
  number: 1,
  name: "Sentinelas",
  color: "#8B1E2D",
  memberLimit: 2,
};

describe("DivisionService", () => {
  it("cria uma divisão apenas para liderança autorizada", () => {
    const service = new DivisionService();

    expect(() => service.createDivision("member", divisionInput)).toThrow("sem permissão");
    expect(service.createDivision("administrator", divisionInput).name).toBe("Sentinelas");
  });

  it("exige consentimento e respeita o limite de vagas", () => {
    const service = new DivisionService();
    const division = service.createDivision("general-leader", divisionInput);

    expect(() => service.addMember("captain", division.id, {
      guildId: "guild-1",
      userId: "user-1",
      role: "member",
      consented: false,
    })).toThrow("não consentiu");

    service.addMember("captain", division.id, {
      guildId: "guild-1",
      userId: "user-1",
      role: "member",
      consented: true,
    });
    service.addMember("captain", division.id, {
      guildId: "guild-1",
      userId: "user-2",
      role: "member",
      consented: true,
    });

    expect(() => service.addMember("captain", division.id, {
      guildId: "guild-1",
      userId: "user-3",
      role: "member",
      consented: true,
    })).toThrow("sem vagas");
  });

  it("monta divisões a partir do rascunho de configuração", () => {
    const wizard = new SetupWizardService();
    wizard.start("guild-1", "owner-1");
    wizard.setIdentity("guild-1", { name: "Sentinelas", acronym: "SNT", color: "#8B1E2D" });
    wizard.setDivisionCount("guild-1", 2);

    expect(wizard.createDivisionInputs("guild-1").map((division) => division.name)).toEqual([
      "Sentinelas 1",
      "Sentinelas 2",
    ]);
  });

  it("registra consentimento e não duplica recompensa de missão", () => {
    const members = new MemberService();
    const missions = new MissionService(members);
    members.consent("guild-1", "user-1", "Vitale");
    missions.assignToMember("guild-1", "user-1");
    missions.recordTextAction("guild-1", "user-1", new Date("2026-09-03T10:00:00Z"));
    missions.recordTextAction("guild-1", "user-1", new Date("2026-09-03T18:00:00Z"));

    expect(members.get("guild-1", "user-1")?.xp).toBe(25);
    expect(levelFromXp(100)).toBe(2);
  });

  it("permite remover o perfil para atender à saída do RPG", () => {
    const members = new MemberService();
    members.consent("guild-1", "user-1", "Vitale");
    members.leave("guild-1", "user-1");

    expect(members.get("guild-1", "user-1")).toBeUndefined();
  });

  it("permite que membro consentido escolha uma divisão", () => {
    const service = new DivisionService();
    const division = service.createDivision("administrator", divisionInput);
    const member = { guildId: "guild-1", userId: "user-1", role: "recruit" as const, consented: true };

    expect(service.joinDivision(division.id, member).memberIds).toEqual(["user-1"]);
  });

  it("pontua atividade válida sem permitir spam ou duplicação", () => {
    const members = new MemberService();
    const missions = new MissionService(members);
    const activity = new ActivityService(members, missions);
    members.consent("guild-1", "user-1", "Vitale");
    const first = new Date("2026-09-03T10:00:00Z");

    expect(activity.recordMessage("guild-1", "user-1", "message-1", "conversa válida", first).reason).toBe("awarded");
    expect(activity.recordMessage("guild-1", "user-1", "message-2", "outra conversa", new Date("2026-09-03T10:01:00Z")).reason).toBe("cooldown");
    expect(activity.recordMessage("guild-1", "user-1", "message-1", "conversa válida", new Date("2026-09-03T10:10:00Z")).reason).toBe("duplicate");
    expect(members.get("guild-1", "user-1")?.xp).toBe(28);
  });

  it("atribui automaticamente o conjunto de missões ao membro", () => {
    const members = new MemberService();
    const missions = new MissionService(members);
    members.enrollAutomatically("guild-1", "user-1", "Vitale");
    missions.assignToMember("guild-1", "user-1");

    expect(missions.assignmentsFor("guild-1", "user-1")).toHaveLength(4);
  });
});