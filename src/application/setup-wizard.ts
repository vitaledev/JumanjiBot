import type { CreateDivisionInput } from "../domain/rpg.js";

export interface SetupIdentity {
  readonly name: string;
  readonly acronym: string;
  readonly color: string;
}

export interface SetupDraft {
  readonly guildId: string;
  readonly ownerId: string;
  readonly identity?: SetupIdentity;
  readonly divisionCount?: number;
}

export class SetupWizardService {
  private readonly drafts = new Map<string, SetupDraft>();

  start(guildId: string, ownerId: string): SetupDraft {
    const draft: SetupDraft = { guildId, ownerId };
    this.drafts.set(guildId, draft);
    return draft;
  }

  get(guildId: string): SetupDraft | undefined {
    return this.drafts.get(guildId);
  }

  setIdentity(guildId: string, identity: SetupIdentity): SetupDraft {
    const draft = this.requireDraft(guildId);
    if (identity.name.trim().length < 2 || identity.name.trim().length > 40) {
      throw new Error("o nome deve ter entre 2 e 40 caracteres");
    }
    if (!/^[A-Za-z0-9]{2,5}$/.test(identity.acronym)) {
      throw new Error("a sigla deve ter entre 2 e 5 caracteres alfanuméricos");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(identity.color)) {
      throw new Error("a cor deve estar no formato #RRGGBB");
    }

    const updated: SetupDraft = {
      ...draft,
      identity: { ...identity, name: identity.name.trim(), acronym: identity.acronym.toUpperCase() },
    };
    this.drafts.set(guildId, updated);
    return updated;
  }

  setDivisionCount(guildId: string, divisionCount: number): SetupDraft {
    const draft = this.requireDraft(guildId);
    if (!Number.isInteger(divisionCount) || divisionCount < 1 || divisionCount > 12) {
      throw new Error("a quantidade de divisões deve estar entre 1 e 12");
    }
    const updated: SetupDraft = { ...draft, divisionCount };
    this.drafts.set(guildId, updated);
    return updated;
  }

  createDivisionInputs(guildId: string): readonly CreateDivisionInput[] {
    const draft = this.requireDraft(guildId);
    if (!draft.identity || !draft.divisionCount) throw new Error("conclua a identidade e a quantidade de divisões");
    const identity = draft.identity;

    return Array.from({ length: draft.divisionCount }, (_, index) => ({
      guildId,
      number: index + 1,
      name: `${identity.name} ${index + 1}`,
      color: identity.color,
      motto: `Divisão ${index + 1} da ${identity.acronym}`,
      memberLimit: 25,
    }));
  }

  finish(guildId: string): void {
    this.drafts.delete(guildId);
  }

  private requireDraft(guildId: string): SetupDraft {
    const draft = this.drafts.get(guildId);
    if (!draft) throw new Error("nenhuma configuração em andamento");
    return draft;
  }
}