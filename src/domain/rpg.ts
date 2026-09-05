export type RpgRole =
  | "owner"
  | "administrator"
  | "general-leader"
  | "captain"
  | "vice-captain"
  | "officer"
  | "member"
  | "recruit";

export type DivisionStatus = "active" | "archived";

export interface Division {
  readonly id: string;
  readonly guildId: string;
  readonly number: number;
  readonly name: string;
  readonly color: string;
  readonly motto: string;
  readonly memberLimit: number;
  readonly status: DivisionStatus;
  readonly captainId?: string;
  readonly viceCaptainId?: string;
  readonly memberIds: readonly string[];
}

export interface CreateDivisionInput {
  readonly guildId: string;
  readonly number: number;
  readonly name: string;
  readonly color: string;
  readonly motto?: string;
  readonly memberLimit: number;
}

export interface GuildMemberProfile {
  readonly guildId: string;
  readonly userId: string;
  readonly role: RpgRole;
  readonly consented: boolean;
  readonly divisionId?: string;
}

export function canManageDivisions(role: RpgRole): boolean {
  return role === "owner" || role === "administrator" || role === "general-leader";
}

export function canManageDivisionMembers(role: RpgRole): boolean {
  return canManageDivisions(role) || role === "captain" || role === "vice-captain";
}

export function assertValidDivision(input: CreateDivisionInput): void {
  if (!input.guildId.trim()) throw new Error("guildId é obrigatório");
  if (!input.name.trim()) throw new Error("name é obrigatório");
  if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) throw new Error("color deve estar no formato #RRGGBB");
  if (!Number.isInteger(input.number) || input.number < 1) throw new Error("number deve ser um inteiro positivo");
  if (!Number.isInteger(input.memberLimit) || input.memberLimit < 1) {
    throw new Error("memberLimit deve ser um inteiro positivo");
  }
}