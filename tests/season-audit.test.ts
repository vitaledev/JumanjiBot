import { describe, expect, it } from "vitest";
import { AuditService } from "../src/application/audit-service.js";
import { SeasonService } from "../src/application/season-service.js";
import { DivisionService } from "../src/application/division-service.js";
import { LeadershipService } from "../src/application/leadership-service.js";
import { MemberService } from "../src/application/member-service.js";

describe("SeasonService", () => {
  it("bloqueia temporadas paralelas e respeita transições", () => {
    const service = new SeasonService();
    const season = service.create("guild-1", "Temporada Zero", "O chamado da noite");
    expect(() => service.create("guild-1", "Outra", "Outro tema")).toThrow("já existe");
    expect(service.transition(season.id, "ACTIVE").status).toBe("ACTIVE");
    expect(() => service.transition(season.id, "DRAFT")).toThrow("transição inválida");
  });
});

describe("AuditService", () => {
  it("mantém eventos separados por servidor", () => {
    const service = new AuditService();
    service.record({ guildId: "guild-1", actorId: "user-1", action: "rpg.joined" });
    service.record({ guildId: "guild-2", actorId: "user-2", action: "rpg.joined" });
    expect(service.listGuild("guild-1")).toHaveLength(1);
  });
});

describe("LeadershipService", () => {
  it("só nomeia membro consentido da própria divisão", () => {
    const members = new MemberService();
    const divisions = new DivisionService();
    const leadership = new LeadershipService(divisions, members);
    const division = divisions.createDivision("administrator", { guildId: "guild-1", number: 1, name: "Norte", color: "#8B1E2D", memberLimit: 10 });
    members.consent("guild-1", "user-1", "Vitale");
    divisions.joinDivision(division.id, members.get("guild-1", "user-1")!);

    expect(() => leadership.appoint("member", division.id, "user-1", "captain")).toThrow("apenas");
    expect(leadership.appoint("general-leader", division.id, "user-1", "captain").captainId).toBe("user-1");
  });
});