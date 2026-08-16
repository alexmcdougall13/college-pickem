import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const ESPN_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard'

const ESPN_TEAM =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams'

/*
 * ============================================================
 * RATING SETTINGS
 * ============================================================
 *
 * These reproduce your spreadsheet rating system.
 *
 * If you want to change the weighting later, these are the
 * four numbers to change. They should add up to 1.
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

/*
 * ============================================================
 * FIREBASE
 * ============================================================
 */

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(
    /\\n/g,
    '\n',
  ),
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

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function roundToTwo(value) {
  return Math.round(
    (value + Number.EPSILON) * 100,
  ) / 100
}

function normalizeConferenceName(name = '') {
  const normalized =
    name.trim().toLowerCase()

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
    american: 'AAC',
    aac: 'AAC',

    'conference usa': 'CUSA',
    'conference-usa': 'CUSA',
    cusa: 'CUSA',

    'mid-american conference': 'MAC',
    'mid-american': 'MAC',
    mac: 'MAC',

    'mountain west conference': 'MWC',
    'mountain west': 'MWC',
    mwc: 'MWC',

    'sun belt conference': 'Sun Belt',
    'sun belt': 'Sun Belt',

    independent: 'Independent',
    independents: 'Independent',
    'fbs independents': 'Independent',

    fcs: 'FCS',
  }

  return (
    conferenceMap[normalized] ??
    name.trim()
  )
}

function getRank(competitor) {
  const rank =
    Number(
      competitor?.curatedRank?.current,
    )

  if (
    !Number.isFinite(rank) ||
    rank < 1 ||
    rank > 25
  ) {
    return null
  }

  return rank
}

function getGameName(event) {
  const competition =
    event?.competitions?.[0]

  const notes =
    competition?.notes ?? []

  for (const note of notes) {
    if (note?.headline) {
      return note.headline
    }
  }

  if (
    typeof event?.name === 'string' &&
    event.name
      .toLowerCase()
      .includes('bowl')
  ) {
    return event.name
  }

  return ''
}


function getScore(competitor) {
  const score = Number(competitor?.score)

  return Number.isFinite(score) ? score : null
}

function getLiveStatus(event) {
  const status = event?.status ?? {}
  const type = status?.type ?? {}

  return {
    status: type?.shortDetail ?? '',
    statusState: type?.state ?? '',
    period: Number.isFinite(Number(status?.period))
      ? Number(status.period)
      : null,
    displayClock: status?.displayClock ?? '',
    final: type?.completed === true,
  }
}

function formatEspnDate(dateValue) {
  const date = new Date(dateValue)

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}${month}${day}`
}

/*
 * Preserve the same betting-line adjustment used by
 * your existing College Pick'em process.
 */
function getAdjustedHomeLine(
  competition,
) {
  const rawSpread =
    competition?.odds?.[0]?.spread

  if (rawSpread == null) {
    return null
  }

  const line =
    Number(rawSpread)

  if (!Number.isFinite(line)) {
    return null
  }

  if (line > 0) {
    return Math.floor(line) - 0.5
  }

  if (line < 0) {
    return Math.ceil(line) + 0.5
  }

  return 0
}

/*
 * ============================================================
 * RATING CALCULATION
 * ============================================================
 */

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
    awayRank ??
    RATING_CONFIG.combinedUnrankedValue

  const homeCombinedRank =
    homeRank ??
    RATING_CONFIG.combinedUnrankedValue

  const combined =
    100 -
    (
      awayCombinedRank +
      homeCombinedRank
    )

  /*
   * R — Difference
   */
  const bothUnranked =
    awayRank == null &&
    homeRank == null

  const rankingDifference =
    bothUnranked
      ? 1
      : Math.abs(
          (
            awayRank ??
            RATING_CONFIG.differenceUnrankedValue
          ) -
            (
              homeRank ??
              RATING_CONFIG.differenceUnrankedValue
            ),
        )

  const difference =
    (25 - rankingDifference) * 4

  /*
   * S — Spread
   */
  const spread =
    homeLine == null
      ? 0
      : 100 -
        Math.floor(
          Math.abs(homeLine),
        )

  /*
   * T — Conference
   */
  const awayConferenceScore =
    RATING_CONFIG
      .conferenceValues[
        awayConference
      ] ?? 0

  const homeConferenceScore =
    RATING_CONFIG
      .conferenceValues[
        homeConference
      ] ?? 0

  const conference =
    (
      awayConferenceScore +
      homeConferenceScore
    ) * 10

  /*
   * U — Final Rating
   */
  const rating =
    roundToTwo(
      combined *
        RATING_CONFIG.weights
          .combined +
        difference *
          RATING_CONFIG.weights
            .difference +
        spread *
          RATING_CONFIG.weights
            .spread +
        conference *
          RATING_CONFIG.weights
            .conference,
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
 * ============================================================
 * ESPN REQUESTS
 * ============================================================
 */

async function fetchScoreboard(date) {
  const response =
    await fetch(
      `${ESPN_SCOREBOARD}?dates=${date}&limit=1000`,
    )

  if (!response.ok) {
    throw new Error(
      `ESPN scoreboard request failed for ${date}: ${response.status}`,
    )
  }

  return response.json()
}

async function fetchScoreboardWeek(
  season,
  week,
  seasonType = 2,
) {
  const response = await fetch(
    `${ESPN_SCOREBOARD}?dates=${season}&seasontype=${seasonType}&week=${week}&groups=80&limit=1000`,
  )

  if (!response.ok) {
    throw new Error(
      `ESPN scoreboard request failed for season ${season}, week ${week}, season type ${seasonType}: ${response.status}`,
    )
  }

  return response.json()
}

async function fetchPostseasonScoreboard(season) {
  const eventsById = new Map()

  let foundPostseasonGames = false
  let consecutiveEmptyWeeks = 0

  for (let week = 1; week <= 12; week += 1) {
    const data = await fetchScoreboardWeek(
      season,
      week,
      3,
    )

    const events = data?.events ?? []

    console.log(
      `ESPN postseason week ${week}: ${events.length} event(s)`,
    )

    if (events.length === 0) {
      if (foundPostseasonGames) {
        consecutiveEmptyWeeks += 1

        if (consecutiveEmptyWeeks >= 2) {
          break
        }
      }

      continue
    }

    foundPostseasonGames = true
    consecutiveEmptyWeeks = 0

    for (const event of events) {
      if (!event?.id) {
        continue
      }

      eventsById.set(
        String(event.id),
        event,
      )
    }
  }

  return {
    events: [
      ...eventsById.values(),
    ],
  }
}

/*
 * Get current conference membership from the individual
 * ESPN team page.
 *
 * The live response we inspected contains a value such as:
 *
 *   "standingSummary": "1st in Big 12"
 *
 * We extract everything following " in ".
 */
async function fetchTeamConference(
  teamId,
) {
  const response =
    await fetch(
      `${ESPN_TEAM}/${teamId}`,
    )

  if (!response.ok) {
    throw new Error(
      `ESPN team request failed for ${teamId}: ${response.status}`,
    )
  }

  const data =
    await response.json()

  const team =
    data?.team

  if (!team?.id) {
    throw new Error(
      `ESPN returned no team information for team ${teamId}`,
    )
  }

  const standingSummary =
    team?.standingSummary ??
    data?.standingSummary ??
    ''

  const match =
    standingSummary.match(
      /\bin\s+(.+)$/i,
    )

  if (!match) {
    console.warn(
      `WARNING: Could not determine conference for ${
        team.shortDisplayName ??
        team.displayName ??
        teamId
      }. standingSummary="${standingSummary}"`,
    )

    return {
      teamId: String(team.id),

      teamName:
        team.location ??
        team.shortDisplayName ??
        team.displayName ??
        'Unknown',

      conference: null,
    }
  }

  const rawConference =
    match[1].trim()

  const conference =
    normalizeConferenceName(
      rawConference,
    )

  return {
    teamId: String(team.id),

    teamName:
      team.location ??
      team.shortDisplayName ??
      team.displayName ??
      'Unknown',

    conference,
  }
}

async function fetchConferenceMap(
  teamIds,
) {
  console.log(
    'Loading current ESPN conference metadata...',
  )

  const conferenceMap =
    new Map()

  for (const teamId of teamIds) {
    const metadata =
      await fetchTeamConference(
        teamId,
      )

    if (!metadata.conference) {
      /*
       * Do NOT silently classify an unknown team as Other.
       * We want to see unresolved teams in the Action log.
       */
      console.warn(
        `${metadata.teamName} → UNRESOLVED`,
      )

      continue
    }

    conferenceMap.set(
      metadata.teamId,
      metadata,
    )

    console.log(
      `${metadata.teamName} → ${metadata.conference}`,
    )
  }

  console.log(
    `Resolved conferences for ${conferenceMap.size} of ${teamIds.size} teams.`,
  )

  return conferenceMap
}

/*
 * ============================================================
 * GAME PARSER
 * ============================================================
 */

function parseGame(
  event,
  conferenceMap,
) {
  const competition =
    event?.competitions?.[0]

  if (
    !event?.id ||
    !competition
  ) {
    return null
  }

  const away =
    competition.competitors?.find(
      (competitor) =>
        competitor.homeAway ===
        'away',
    )

  const home =
    competition.competitors?.find(
      (competitor) =>
        competitor.homeAway ===
        'home',
    )

  if (!away || !home) {
    return null
  }

  const awayTeamId =
    String(
      away.team?.id ?? '',
    )

  const homeTeamId =
    String(
      home.team?.id ?? '',
    )

  const awayRank =
    getRank(away)

  const homeRank =
    getRank(home)

  const homeLine =
    getAdjustedHomeLine(
      competition,
    )

  const awayMetadata =
    conferenceMap.get(
      awayTeamId,
    )

  const homeMetadata =
    conferenceMap.get(
      homeTeamId,
    )

  /*
   * We deliberately use "Unresolved" instead of "Other"
   * when ESPN conference lookup failed.
   *
   * This prevents bad metadata from quietly producing
   * a seemingly-valid conference rating.
   */
  const awayConference =
    awayMetadata?.conference ??
    'Unresolved'

  const homeConference =
    homeMetadata?.conference ??
    'Unresolved'

  const ratings =
    calculateRating({
      awayRank,
      homeRank,
      homeLine,
      awayConference,
      homeConference,
    })

  return {
    gameId:
      String(event.id),

    seasonWeek:
      event?.week?.number ??
      null,

    gameName:
      getGameName(event),

    kickoff:
      event.date ?? '',

    awayTeamId,

    awayTeamName:
      away.team?.location ??
      away.team
        ?.shortDisplayName ??
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
      home.team
        ?.shortDisplayName ??
      home.team?.displayName ??
      'Home',

    homeTeamRank:
      homeRank,

    homeTeamLogo:
      home.team?.logo ?? '',

    homeConference,

    homeTeamLine:
      homeLine,

    awayScore:
      getScore(away),

    homeScore:
      getScore(home),

    ...getLiveStatus(event),

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

    selected: false,

    tiebreaker: false,

    importedAt:
      new Date(),
  }
}


async function updatePublishedGameFromEvent(event) {
  const competition = event?.competitions?.[0]

  if (!event?.id || !competition) {
    return false
  }

  const away = competition.competitors?.find(
    (competitor) => competitor.homeAway === 'away',
  )

  const home = competition.competitors?.find(
    (competitor) => competitor.homeAway === 'home',
  )

  if (!away || !home) {
    return false
  }

  const gameId = String(event.id)
  const liveStatus = getLiveStatus(event)

  const liveFields = {
    awayScore: getScore(away),
    homeScore: getScore(home),
    status: liveStatus.status,
    statusState: liveStatus.statusState,
    period: liveStatus.period,
    displayClock: liveStatus.displayClock,
    final: liveStatus.final,
    scoreUpdatedAt: new Date(),
  }

  /*
   * Keep updating the original global game during migration.
   * This gives us a backup until the legacy structure is retired.
   */
  const legacyRef = db.collection('games').doc(gameId)
  const legacySnapshot = await legacyRef.get()

  let updated = false

  if (legacySnapshot.exists) {
    await legacyRef.set(
      liveFields,
      { merge: true },
    )

    updated = true
  }

  /*
   * Update every league that has this ESPN game published.
   *
   * This is what allows the same game to appear in multiple
   * independent pools while ESPN only needs to be queried once.
   */
  const leagueGamesSnapshot = await db
    .collectionGroup('games')
    .where('gameId', '==', gameId)
    .get()

  const writer = db.bulkWriter()

  for (const gameDocument of leagueGamesSnapshot.docs) {
    /*
     * Avoid writing the root legacy copy twice if Firestore
     * happens to include it in the collection-group query.
     */
    if (gameDocument.ref.path === legacyRef.path) {
      continue
    }

    writer.set(
      gameDocument.ref,
      liveFields,
      { merge: true },
    )

    updated = true
  }

  await writer.close()

  return updated
}

async function getRelevantPublishedDates() {
  /*
   * Check both the original global games and every league's
   * published games while we are migrating.
   */
  const [
    legacySnapshot,
    leagueSnapshot,
  ] = await Promise.all([
    db.collection('games').get(),
    db.collectionGroup('games').get(),
  ])

  const documentsByPath = new Map()

  for (const document of legacySnapshot.docs) {
    documentsByPath.set(
      document.ref.path,
      document,
    )
  }

  for (const document of leagueSnapshot.docs) {
    documentsByPath.set(
      document.ref.path,
      document,
    )
  }

  const snapshot = {
    forEach(callback) {
      documentsByPath.forEach(callback)
    },
  }

  const now = Date.now()

  /*
   * Include games beginning within the next 24 hours and games
   * that began within the previous 8 hours. This covers the
   * pregame/live/final window without repeatedly asking ESPN
   * about future weeks.
   */
  const earliest = now - 8 * 60 * 60 * 1000
  const latest = now + 24 * 60 * 60 * 1000

  const dates = new Set()

  snapshot.forEach((document) => {
    const game = document.data()

    if (game.final === true || !game.kickoff) {
      return
    }

    const kickoffMs = new Date(game.kickoff).getTime()

    if (
      Number.isFinite(kickoffMs) &&
      kickoffMs >= earliest &&
      kickoffMs <= latest
    ) {
      dates.add(formatEspnDate(game.kickoff))
    }
  })

  return [...dates].sort()
}

async function syncPublishedGames() {
  const dates = await getRelevantPublishedDates()

  if (dates.length === 0) {
    console.log(
      'No published games are within the live-update window. Nothing to sync.',
    )
    return
  }

  console.log(
    `Live score sync for ESPN date(s): ${dates.join(', ')}`,
  )

  let updated = 0

  for (const date of dates) {
    const data = await fetchScoreboard(date)
    const events = data?.events ?? []

    for (const event of events) {
      if (await updatePublishedGameFromEvent(event)) {
        updated += 1
      }
    }
  }

  console.log(`Updated ${updated} published game(s) with live ESPN data.`)
}

/*
 * ============================================================
 * SYNC
 * ============================================================
 */

async function syncEvents(
  events,
  label,
  {
    replaceAvailableGames = false,
  } = {},
) {
  console.log(
    `Loading ${label}...`,
  )

  console.log(
    `ESPN returned ${events.length} event(s).`,
  )

  const teamIds = new Set()

  for (const event of events) {
    const competition =
      event?.competitions?.[0]

    const competitors =
      competition?.competitors ??
      []

    for (const competitor of competitors) {
      const teamId =
        competitor?.team?.id

      if (teamId) {
        teamIds.add(
          String(teamId),
        )
      }
    }
  }

  console.log(
    `Found ${teamIds.size} unique teams.`,
  )

  const conferenceMap =
    await fetchConferenceMap(
      teamIds,
    )

  const games = []

  for (const event of events) {
    const game =
      parseGame(
        event,
        conferenceMap,
      )

    if (game) {
      games.push(game)
    }

    await updatePublishedGameFromEvent(
      event,
    )
  }

  games.sort(
    (a, b) =>
      b.rating - a.rating,
  )

  games.forEach(
    (game, index) => {
      game.ratingRank =
        index + 1
    },
  )

  const existingSnapshot =
    await db
      .collection(
        'availableGames',
      )
      .get()

  const existingById =
    new Map()

  existingSnapshot.forEach(
    (document) => {
      existingById.set(
        document.id,
        document.data(),
      )
    },
  )

  let written = 0

  const currentGameIds =
    new Set()

  for (const game of games) {
    currentGameIds.add(
      game.gameId,
    )

    const ref =
      db
        .collection(
          'availableGames',
        )
        .doc(game.gameId)

    const existing =
      existingById.get(
        game.gameId,
      )

    const dataToSave = {
      ...game,
    }

    if (existing) {
      if (
        typeof existing.selected ===
        'boolean'
      ) {
        dataToSave.selected =
          existing.selected
      }

      if (
        typeof existing.tiebreaker ===
        'boolean'
      ) {
        dataToSave.tiebreaker =
          existing.tiebreaker
      }
    }

    await ref.set(
      dataToSave,
      {
        merge: true,
      },
    )

    written += 1
  }

  if (replaceAvailableGames) {
    const writer =
      db.bulkWriter()

    for (
      const document of
      existingSnapshot.docs
    ) {
      if (
        !currentGameIds.has(
          document.id,
        )
      ) {
        writer.delete(
          document.ref,
        )
      }
    }

    await writer.close()
  }

  console.log('')
  console.log(
    `Saved ${written} rated games to Firestore.`,
  )

  console.log('')
  console.log(
    'Top rated games:',
  )

  for (
    const game of
    games.slice(0, 10)
  ) {
    console.log(
      `#${game.ratingRank} ${game.awayTeamName} (${game.awayConference}) at ${game.homeTeamName} (${game.homeConference}) — ${game.rating}`,
    )
  }

  const unresolvedGames =
    games.filter(
      (game) =>
        game.awayConference ===
          'Unresolved' ||
        game.homeConference ===
          'Unresolved',
    )

  if (
    unresolvedGames.length >
    0
  ) {
    console.log('')
    console.warn(
      'WARNING: Games with unresolved conference data:',
    )

    for (
      const game of
      unresolvedGames
    ) {
      console.warn(
        `${game.awayTeamName} (${game.awayConference}) at ${game.homeTeamName} (${game.homeConference})`,
      )
    }
  }
}

async function syncDate(date) {
  const data =
    await fetchScoreboard(date)

  const events =
    data?.events ?? []

  await syncEvents(
    events,
    `ESPN games for ${date}`,
  )
}

async function syncRegularWeek(
  season,
  week,
) {
  console.log(
    `Loading complete ESPN regular-season Week ${week} for ${season}...`,
  )

  const data =
    await fetchScoreboardWeek(
      season,
      week,
      2,
    )

  const events =
    data?.events ?? []

  await syncEvents(
    events,
    `${season} regular-season Week ${week}`,
    {
      replaceAvailableGames: true,
    },
  )
}

async function syncPostseason(
  season,
) {
  console.log(
    `Loading complete ESPN postseason for ${season}...`,
  )

  const data =
    await fetchPostseasonScoreboard(
      season,
    )

  const events =
    data?.events ?? []

  console.log(
    `Combined postseason slate contains ${events.length} unique game(s).`,
  )

  await syncEvents(
    events,
    `${season} Postseason`,
    {
      replaceAvailableGames: true,
    },
  )
}

/*
 * ============================================================
 * RUN
 * ============================================================
 */

const mode =
  process.argv[2]

if (!mode) {
  await syncPublishedGames()
} else if (mode === 'date') {
  const date =
    process.argv[3]

  if (
    !date ||
    !/^\d{8}$/.test(date)
  ) {
    throw new Error(
      'Date mode requires YYYYMMDD. Example: node scripts/sync-espn.mjs date 20260829',
    )
  }

  await syncDate(date)
} else if (mode === 'week') {
  const season =
    Number(process.argv[3])

  const week =
    Number(process.argv[4])

  if (
    !Number.isInteger(season) ||
    season < 2000
  ) {
    throw new Error(
      'Week mode requires a valid season.',
    )
  }

  if (
    !Number.isInteger(week) ||
    week < 1
  ) {
    throw new Error(
      'Week mode requires a valid ESPN week number.',
    )
  }

  await syncRegularWeek(
    season,
    week,
  )
} else if (
  mode === 'postseason'
) {
  const season =
    Number(process.argv[3])

  if (
    !Number.isInteger(season) ||
    season < 2000
  ) {
    throw new Error(
      'Postseason mode requires a valid season.',
    )
  }

  await syncPostseason(
    season,
  )
} else {
  throw new Error(
    `Unknown sync mode "${mode}". Use week, postseason, date, or no arguments for live-score refresh.`,
  )
}

console.log('')
console.log(
  'ESPN sync complete.',
)