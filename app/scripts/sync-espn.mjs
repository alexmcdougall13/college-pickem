import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const ESPN_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard'

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

  if (line > 0) {
    return Math.floor(line) - 0.5
  }

  if (line < 0) {
    return Math.ceil(line) + 0.5
  }

  return 0
}

async function fetchScoreboard(date) {
  const response = await fetch(
    `${ESPN_SCOREBOARD}?dates=${date}&limit=1000`,
  )

  if (!response.ok) {
    throw new Error(
      `ESPN request failed for ${date}: ${response.status}`,
    )
  }

  return response.json()
}

function parseGame(event) {
  const competition = event?.competitions?.[0]

  if (!event?.id || !competition) {
    return null
  }

  const away = competition.competitors?.find(
    (competitor) => competitor.homeAway === 'away',
  )

  const home = competition.competitors?.find(
    (competitor) => competitor.homeAway === 'home',
  )

  if (!away || !home) {
    return null
  }

  return {
    gameId: String(event.id),

    seasonWeek: event?.week?.number ?? null,

    gameName: getGameName(event),

    kickoff: event.date ?? '',

    awayTeamId: String(away.team?.id ?? ''),

    awayTeamName:
      away.team?.location ??
      away.team?.shortDisplayName ??
      away.team?.displayName ??
      'Away',

    awayTeamRank: getRank(away),

    awayTeamLogo: away.team?.logo ?? '',

    homeTeamId: String(home.team?.id ?? ''),

    homeTeamName:
      home.team?.location ??
      home.team?.shortDisplayName ??
      home.team?.displayName ??
      'Home',

    homeTeamRank: getRank(home),

    homeTeamLogo: home.team?.logo ?? '',

    homeTeamLine: getAdjustedHomeLine(competition),

    status: event?.status?.type?.shortDetail ?? '',

    final: event?.status?.type?.completed === true,

    selected: false,

    tiebreaker: false,

    importedAt: new Date(),
  }
}

async function syncDate(date) {
  console.log(`Loading ESPN games for ${date}...`)

  const data = await fetchScoreboard(date)
  const events = data?.events ?? []

  console.log(`ESPN returned ${events.length} events.`)

  let written = 0

  for (const event of events) {
    const game = parseGame(event)

    if (!game) {
      continue
    }

    /*
     * We use ESPN's game ID as the Firestore document ID.
     *
     * merge:true matters because later your Admin screen will
     * set fields like selected/tiebreaker/rating. A sync should
     * update ESPN data without wiping those other fields.
     */
    await db
      .collection('availableGames')
      .doc(game.gameId)
      .set(game, { merge: true })

    written += 1
  }

  console.log(`Saved ${written} games to Firestore.`)
}

const date = process.argv[2]

if (!date || !/^\d{8}$/.test(date)) {
  throw new Error(
    'Provide a date in YYYYMMDD format. Example: node scripts/sync-espn.mjs 20260829',
  )
}

await syncDate(date)

console.log('ESPN sync complete.')