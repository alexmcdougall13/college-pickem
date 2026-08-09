export type TeamConference = {
  teamId: string
  teamName: string
  conference: string
}

const ESPN_TEAMS_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams'

function normalizeConferenceName(name: string): string {
  const normalized = name.trim().toLowerCase()

  const conferenceMap: Record<string, string> = {
    'southeastern conference': 'SEC',
    sec: 'SEC',

    'big ten conference': 'Big Ten',
    'big ten': 'Big Ten',

    'atlantic coast conference': 'ACC',
    acc: 'ACC',

    'big 12 conference': 'Big 12',
    'big 12': 'Big 12',

    'pac-12 conference': 'Pac-12',
    'pac-12': 'Pac-12',

    'american athletic conference': 'AAC',
    'the american': 'AAC',
    aac: 'AAC',

    'conference usa': 'CUSA',
    'conference-usa': 'CUSA',
    cusa: 'CUSA',

    'mid-american conference': 'MAC',
    mac: 'MAC',

    'mountain west conference': 'MWC',
    'mountain west': 'MWC',
    mwc: 'MWC',

    'sun belt conference': 'Sun Belt',
    'sun belt': 'Sun Belt',

    independent: 'Independent',
    independents: 'Independent',
    'fbs independents': 'Independent',
  }

  return conferenceMap[normalized] ?? name
}

export async function fetchTeamConferences(): Promise<
  Map<string, TeamConference>
> {
  const response = await fetch(`${ESPN_TEAMS_URL}?limit=1000`)

  if (!response.ok) {
    throw new Error(
      `Unable to load ESPN team metadata: ${response.status}`,
    )
  }

  const data = await response.json()

  const teams =
    data?.sports?.[0]?.leagues?.[0]?.teams ?? []

  const conferenceMap = new Map<string, TeamConference>()

  for (const entry of teams) {
    const team = entry?.team

    if (!team?.id) {
      continue
    }

    const rawConference =
      team?.conference?.name ??
      entry?.conference?.name ??
      ''

    conferenceMap.set(String(team.id), {
      teamId: String(team.id),

      teamName:
        team.location ??
        team.shortDisplayName ??
        team.displayName ??
        'Unknown',

      conference: rawConference
        ? normalizeConferenceName(rawConference)
        : '',
    })
  }

  return conferenceMap
}

export async function testConferenceLookup() {
  const conferences = await fetchTeamConferences()

  const testTeamIds = ['194', '251', '2390', '68']

  for (const teamId of testTeamIds) {
    console.log(teamId, conferences.get(teamId))
  }
}