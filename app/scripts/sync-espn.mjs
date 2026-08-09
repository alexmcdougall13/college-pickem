import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const ESPN_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard'

const ESPN_TEAMS =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000&enable=groups&groups=80'

/*
 * ============================================================
 * RATING SETTINGS
 * ============================================================
 *
 * These reproduce the rating system from your spreadsheet.
 *
 * If we later build rating settings into the Admin page,
 * these values can move to Firestore.
 */
const RATING_CONFIG = {
  weights: {
    combined: 0.25,
    difference: 0.25,
    spread: 0.25,
    conference: 0.25,
  },

  combinedUnrankedValue: 50,
  differenceUnrankedValue: 26,

  conferenceValues: {
    'Big Ten': 5,
    SEC: 5,
    Independent: 5,

    ACC: 4,
    'Big 12': 4,
    'Pac-12': 4,

    AAC: 2,
    CUSA: 2,
    MAC: 2,
    MWC: 2,
    'Sun Belt': 2,
    Other: 2,

    FCS: 0,
  },
}

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
}

if (
  !serviceAccount.projectId ||
  !serviceAccount.clientEmail ||
  !serviceAccount.privateKey
) {
  throw new Error(
    'Missing Firebase service account environment variables.',
  )
}

initializeApp({
  credential: cert(serviceAccount),
})

const db = getFirestore()

function roundToTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function normalizeConferenceName(name = '') {
  const normalized = name.trim().toLowerCase()

  const conferenceMap = {
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
    'american conference': 'AAC',
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

function getRank(competitor) {
  const rank = Number(competitor?.curatedRank?.current)

  if (!Number.isFinite(rank) || rank < 1 || rank > 25) {
    return null
  }

  return rank
}

function getGameName(event) {
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

function getAdjustedHomeLine(competition) {
  const rawSpread = competition?.odds?.[0]?.spread

  if (rawSpread == null) {
    return null
  }

  const line = Number(rawSpread)

  if (!Number.isFinite(line)) {
    return null
  }

  /*
   * Preserve the same half-point adjustment used by
   * the existing College Pick'em process.
   */
  if (line > 0) {
    return Math.floor(line) - 0.5
  }

  if (line < 0) {
    return Math.ceil(line) + 0.5
  }

  return 0
}

function calculateRating({
  awayRank,
  homeRank,
  homeLine,
  awayConference,
  homeConference,
}) {
  /*
   * Q — Combined
   */
  const awayCombinedRank =
    awayRank ?? RATING_CONFIG.combinedUnrankedValue

  const homeCombinedRank =
    homeRank ?? RATING_CONFIG.combinedUnrankedValue

  const combined =
    100 - (awayCombinedRank + homeCombinedRank)

  /*
   * R — Ranking Difference
   */
  const bothUnranked =
    awayRank == null && homeRank == null

  const rankingDifference = bothUnranked
    ? 1
    : Math.abs(
        (awayRank ?? RATING_CONFIG.differenceUnrankedValue) -
          (homeRank ?? RATING_CONFIG.differenceUnrankedValue),
      )

  const difference =
    (25 - rankingDifference) * 4

  /*
   * S — Spread
   */
  const spread =
    homeLine == null
      ? 0
      : 100 - Math.floor(Math.abs(homeLine))

  /*
   * T — Conference
   */
  const awayConferenceScore =
    RATING_CONFIG.conferenceValues[awayConference] ?? 0

  const homeConferenceScore =
    RATING_CONFIG.conferenceValues[homeConference] ?? 0

  const conference =
    (awayConferenceScore + homeConferenceScore) * 10

  /*
   * U — Final weighted rating
   */
  const rating = roundToTwo(
    combined * RATING_CONFIG.weights.combined +
      difference * RATING_CONFIG.weights.difference +
      spread * RATING_CONFIG.weights.spread +
      conference * RATING_CONFIG.weights.conference,
  )

  return {
    combined,
    difference,
    spread,
    conference,
    rating,
  }
}

/*
 * ESPN's grouped teams response can contain nested groups.
 * This recursively walks the response and associates every
 * team with the conference/group containing it.
 */
function collectTeamsFromGroup(group, conferenceMap, parentName = '') {
  if (!group) {
    return
  }

  const groupName =
    group?.name ??
    group?.shortName ??
    group?.abbreviation ??
    parentName

  const normalizedConference =
    normalizeConferenceName(groupName)

  const teams = group?.teams ?? []

  for (const entry of teams) {
    const team = entry?.team ?? entry

    if (!team?.id) {
      continue
    }

    conferenceMap.set(String(team.id), {
      teamId: String(team.id),

      teamName:
        team.location ??
        team.shortDisplayName ??
        team.displayName ??
        'Unknown',

      conference: normalizedConference,
    })
  }

  const children =
    group?.children ??
    group?.groups ??
    []

  for (const child of children) {
    collectTeamsFromGroup(
      child,
      conferenceMap,
      groupName,
    )
  }
}

function walkForGroups(value, conferenceMap) {
  if (!value || typeof value !== 'object') {
    return
  }

  if (
    Array.isArray(value?.teams) &&
    (
      value?.name ||
      value?.shortName ||
      value?.abbreviation
    )
  ) {
    collectTeamsFromGroup(value, conferenceMap)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walkForGroups(item, conferenceMap)
    }

    return
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      walkForGroups(child, conferenceMap)
    }
  }
}

async function fetchConferenceMap() {
  console.log('Loading current ESPN conference metadata...')

  const response = await fetch(ESPN_TEAMS)

  if (!response.ok) {
    throw new Error(
      `ESPN teams request failed: ${response.status}`,
    )
  }

  const data = await response.json()
  const conferenceMap = new Map()

  walkForGroups(data, conferenceMap)

  /*
   * Some ESPN response versions expose the conference/group
   * directly on a team entry. This second pass gives us a
   * fallback for that structure.
   */
  const teamEntries =
    data?.sports?.[0]?.leagues?.[0]?.teams ?? []

  for (const entry of teamEntries) {
    const team = entry?.team

    if (!team?.id || conferenceMap.has(String(team.id))) {
      continue
    }

    const rawConference =
      team?.conference?.name ??
      entry?.conference?.name ??
      team?.groups?.[0]?.name ??
      ''

    if (!rawConference) {
      continue
    }

    conferenceMap.set(String(team.id), {
      teamId: String(team.id),

      teamName:
        team.location ??
        team.shortDisplayName ??
        team.displayName ??
        'Unknown',

      conference:
        normalizeConferenceName(rawConference),
    })
  }

  console.log(
    `Loaded conference metadata for ${conferenceMap.size} teams.`,
  )

  return conferenceMap
}

async function fetchScoreboard(date) {
  const response = await fetch(
    `${ESPN_SCOREBOARD}?dates=${date}&limit=1000`,
  )

  if (!response.ok) {
    throw new Error(
      `ESPN scoreboard request failed for ${date}: ${response.status}`,
    )
  }

  return response.json()
}

function parseGame(event, conferenceMap) {
  const competition = event?.competitions?.[0]

  if (!event?.id || !competition) {
    return null
  }

  const away = competition.competitors?.find(
    (competitor) =>
      competitor.homeAway === 'away',
  )

  const home = competition.competitors?.find(
    (competitor) =>
      competitor.homeAway === 'home',
  )

  if (!away || !home) {
    return null
  }

  const awayTeamId = String(away.team?.id ?? '')
  const homeTeamId = String(home.team?.id ?? '')

  const awayRank = getRank(away)
  const homeRank = getRank(home)

  const homeLine =
    getAdjustedHomeLine(competition)

  /*
   * Prefer the current conference map.
   *
   * If a team isn't found, we'll distinguish an FCS opponent
   * from a genuinely unknown team below.
   */
  const awayMetadata =
    conferenceMap.get(awayTeamId)

  const homeMetadata =
    conferenceMap.get(homeTeamId)

  const awayConference =
    awayMetadata?.conference || 'Other'

  const homeConference =
    homeMetadata?.conference || 'Other'

  const ratings = calculateRating({
    awayRank,
    homeRank,
    homeLine,
    awayConference,
    homeConference,
  })

  return {
    gameId: String(event.id),

    seasonWeek:
      event?.week?.number ?? null,

    gameName:
      getGameName(event),

    kickoff:
      event.date ?? '',

    awayTeamId,

    awayTeamName:
      away.team?.location ??
      away.team?.shortDisplayName ??
      away.team?.displayName ??
      'Away',

    awayTeamRank:
      awayRank,

    awayTeamLogo:
      away.team?.logo ?? '',

    awayConference,

    homeTeamId,

    homeTeamName:
      home.team?.location ??
      home.team?.shortDisplayName ??
      home.team?.displayName ??
      'Home',

    homeTeamRank:
      homeRank,

    homeTeamLogo:
      home.team?.logo ?? '',

    homeConference,

    homeTeamLine:
      homeLine,

    combinedRating:
      ratings.combined,

    differenceRating:
      ratings.difference,

    spreadRating:
      ratings.spread,

    conferenceRating:
      ratings.conference,

    rating:
      ratings.rating,

    status:
      event?.status?.type?.shortDetail ?? '',

    final:
      event?.status?.type?.completed === true,

    /*
     * These are defaults for newly imported games.
     *
     * IMPORTANT:
     * Because Firestore uses merge:true below, an Admin
     * selection already stored on the document won't be
     * removed by future ESPN refreshes.
     */
    selected: false,

    tiebreaker: false,

    importedAt:
      new Date(),
  }
}

async function syncDate(date) {
  const conferenceMap =
    await fetchConferenceMap()

  console.log(
    `Loading ESPN games for ${date}...`,
  )

  const data =
    await fetchScoreboard(date)

  const events =
    data?.events ?? []

  console.log(
    `ESPN returned ${events.length} events.`,
  )

  const games = []

  for (const event of events) {
    const game =
      parseGame(event, conferenceMap)

    if (game) {
      games.push(game)
    }
  }

  games.sort(
    (a, b) => b.rating - a.rating,
  )

  /*
   * Give each game a ranking based on your rating system.
   */
  games.forEach((game, index) => {
    game.ratingRank = index + 1
  })

  let written = 0

  for (const game of games) {
    const ref = db
      .collection('availableGames')
      .doc(game.gameId)

    /*
     * Preserve Admin selections from an existing document.
     */
    const existing = await ref.get()

    const dataToSave = {
      ...game,
    }

    if (existing.exists) {
      const existingData = existing.data()

      if (typeof existingData.selected === 'boolean') {
        dataToSave.selected =
          existingData.selected
      }

      if (typeof existingData.tiebreaker === 'boolean') {
        dataToSave.tiebreaker =
          existingData.tiebreaker
      }
    }

    await ref.set(
      dataToSave,
      { merge: true },
    )

    written += 1
  }

  console.log(
    `Saved ${written} rated games to Firestore.`,
  )

  console.log('Top rated games:')

  for (const game of games.slice(0, 10)) {
    console.log(
      `#${game.ratingRank} ${game.awayTeamName} at ${game.homeTeamName} — ${game.rating}`,
    )
  }
}

const date =
  process.argv[2]

if (
  !date ||
  !/^\d{8}$/.test(date)
) {
  throw new Error(
    'Provide a date in YYYYMMDD format. Example: node scripts/sync-espn.mjs 20260829',
  )
}

await syncDate(date)

console.log('ESPN sync complete.')