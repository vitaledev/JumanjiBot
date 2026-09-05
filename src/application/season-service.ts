export type SeasonStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "CALCULATING" | "FINISHED" | "ARCHIVED";

export interface Season {
  readonly id: string;
  readonly guildId: string;
  readonly name: string;
  readonly theme: string;
  readonly status: SeasonStatus;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
}

const transitions: Record<SeasonStatus, readonly SeasonStatus[]> = {
  DRAFT: ["SCHEDULED", "ACTIVE", "ARCHIVED"],
  SCHEDULED: ["ACTIVE", "DRAFT", "ARCHIVED"],
  ACTIVE: ["CALCULATING"],
  CALCULATING: ["FINISHED"],
  FINISHED: ["ARCHIVED"],
  ARCHIVED: [],
};

export class SeasonService {
  private readonly seasons = new Map<string, Season>();

  create(guildId: string, name: string, theme: string): Season {
    if (!name.trim() || !theme.trim()) throw new Error("nome e tema da temporada são obrigatórios");
    if ([...this.seasons.values()].some((season) => season.guildId === guildId && season.status !== "ARCHIVED")) {
      throw new Error("já existe uma temporada não arquivada neste servidor");
    }
    const season: Season = { id: `${guildId}:season:${Date.now()}`, guildId, name: name.trim(), theme: theme.trim(), status: "DRAFT" };
    this.seasons.set(season.id, season);
    return season;
  }

  transition(seasonId: string, status: SeasonStatus): Season {
    const season = this.get(seasonId);
    if (!transitions[season.status].includes(status)) throw new Error(`transição inválida: ${season.status} -> ${status}`);
    const updated: Season = { ...season, status, ...(status === "ACTIVE" ? { startsAt: new Date() } : {}), ...(status === "FINISHED" ? { endsAt: new Date() } : {}) };
    this.seasons.set(seasonId, updated);
    return updated;
  }

  current(guildId: string): Season | undefined {
    return [...this.seasons.values()].find((season) => season.guildId === guildId && season.status !== "ARCHIVED");
  }

  get(seasonId: string): Season {
    const season = this.seasons.get(seasonId);
    if (!season) throw new Error("temporada não encontrada");
    return season;
  }
}