import {
  calculateGameRating,
  type RatingBreakdown,
} from '../config/rating'

export type EspnAdminGame = {
  gameId: string
  gameName: string
  kickoff: string

  awayTeamId: string
  awayTeamName: string
  awayTeamRank: number | null
  awayTeamLogo: string
  awayConference: string

  homeTeamId: string
  homeTeamName: string
  homeTeamRank: number | null
  homeTeamLogo: string
  homeConference: string

  homeLine: number | null

  rating: RatingBreakdown
}

const ESPN_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard'

function getRank(competitor: any): number | null {
  const rank = Number(competitor?.curatedRank?.current)

  if (!Number.isFinite(rank) || rank < 1 || rank > 25) {
    return null
  }

  return rank
}

function getGameName(event: any): string {
  const competition = event?.competitions?.[0]

  const notes = competition?.notes ?? []

  for (const note of notes) {
    if (note?.headline) {
      return note.headline
    }
  }

  if (
    typeof event?.name === 'string' &&
    event.name.toLowerCase().includes('bowl')
  ) {
    return event.name
  }

  return ''
}

function getAdjustedHomeLine(competition: any): number | null {
  const rawSpread = competition?.odds?.[0]?.spread

  if (rawSpread == null) {
    return null
  }

  const line = Number(rawSpread)

  if (!Number.isFinite(line)) {
    return null
  }

  /*
   * Preserve the same adjustment your spreadsheet
   * currently applies to ESPN's spread.
   */
  if (line > 0) {
    return Math.floor(line) - 0.5
  }

  if (line < 0) {
    return Math.ceil(line) + 0.5
  }

  return 0
}

function getConferenceName(competitor: any): string {
  /*
   * We'll improve this mapping in the next step.
   * For now, use conference information if ESPN
   * includes a readable value on the competitor.
   */
  return (
    competitor?.team?.conference?.name ??
    competitor?.conference?.name ??
    ''
  )
}

function parseEvent(event: any): EspnAdminGame | null {
  const competition = event?.competitions?.[0]

  if (!event?.id || !competition) {
    return null
  }

  const away = competition.competitors?.find(
    (competitor: any) => competitor.homeAway === 'away',
  )

  const home = competition.competitors?.find(
    (competitor: any) => competitor.homeAway === 'home',
  )

  if (!away || !home) {
    return null
  }

  const awayRank = getRank(away)
  const homeRank = getRank(home)
  const homeLine = getAdjustedHomeLine(competition)

  const awayConference = getConferenceName(away)
  const homeConference = getConferenceName(home)

  const rating = calculateGameRating({
    awayRank,
    homeRank,
    homeLine,
    awayConference,
    homeConference,
  })

  return {
    gameId: String(event.id),
    gameName: getGameName(event),
    kickoff: event.date,

    awayTeamId: String(away.team?.id ?? ''),
    awayTeamName:
      away.team?.location ??
      away.team?.shortDisplayName ??
      away.team?.displayName ??
      'Away',

    awayTeamRank: awayRank,
    awayTeamLogo: away.team?.logo ?? '',
    awayConference,

    homeTeamId: String(home.team?.id ?? ''),
    homeTeamName:
      home.team?.location ??
      home.team?.shortDisplayName ??
      home.team?.displayName ??
      'Home',

    homeTeamRank: homeRank,
    homeTeamLogo: home.team?.logo ?? '',
    homeConference,

    homeLine,

    rating,
  }
}

export async function fetchCollegeFootballGames(
  dates: string[],
): Promise<EspnAdminGame[]> {
  const gamesById = new Map<string, EspnAdminGame>()

  for (const date of dates) {
    const response = await fetch(
      `${ESPN_SCOREBOARD}?dates=${date}&limit=1000`,
    )

    if (!response.ok) {
      throw new Error(
        `ESPN request failed for ${date}: ${response.status}`,
      )
    }

    const data = await response.json()
    const events = data?.events ?? []

    for (const event of events) {
      const game = parseEvent(event)

      if (game) {
        gamesById.set(game.gameId, game)
      }
    }
  }

  return Array.from(gamesById.values()).sort(
    (a, b) => b.rating.rating - a.rating.rating,
  )
}