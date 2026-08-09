const ESPN_TEAMS =
  'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000&enable=groups&groups=80'

console.log('Fetching ESPN team metadata...')

const response = await fetch(ESPN_TEAMS)

if (!response.ok) {
  throw new Error(
    `ESPN request failed: ${response.status} ${response.statusText}`,
  )
}

const data = await response.json()

console.log('Request successful.')
console.log('Top-level keys:', Object.keys(data))

const league =
  data?.sports?.[0]?.leagues?.[0]

console.log(
  'League keys:',
  league ? Object.keys(league) : 'NO LEAGUE FOUND',
)

console.log(
  'Number of teams:',
  league?.teams?.length ?? 0,
)

/*
 * Find our two known test teams anywhere in ESPN's response.
 *
 * North Carolina = ESPN ID 153
 * TCU            = ESPN ID 2628
 */
function findObjectsForTeam(value, teamId, path = 'root', results = []) {
  if (!value || typeof value !== 'object') {
    return results
  }

  if (
    String(value?.id ?? '') === teamId ||
    String(value?.team?.id ?? '') === teamId
  ) {
    results.push({
      path,
      value,
    })
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findObjectsForTeam(
        item,
        teamId,
        `${path}[${index}]`,
        results,
      )
    })

    return results
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') {
      findObjectsForTeam(
        child,
        teamId,
        `${path}.${key}`,
        results,
      )
    }
  }

  return results
}

for (const testTeam of [
  {
    id: '153',
    name: 'North Carolina',
  },
  {
    id: '2628',
    name: 'TCU',
  },
]) {
  console.log('')
  console.log('========================================')
  console.log(`SEARCHING FOR ${testTeam.name} (${testTeam.id})`)
  console.log('========================================')

  const matches = findObjectsForTeam(
    data,
    testTeam.id,
  )

  console.log(`Matches found: ${matches.length}`)

  matches.forEach((match, index) => {
    console.log('')
    console.log(`MATCH ${index + 1}`)
    console.log('PATH:', match.path)

    console.log(
      JSON.stringify(match.value, null, 2),
    )
  })
}

/*
 * Also show us anything ESPN identifies as a group.
 */
console.log('')
console.log('========================================')
console.log('GROUP-LIKE OBJECTS')
console.log('========================================')

let groupCount = 0

function inspectGroups(value, path = 'root') {
  if (!value || typeof value !== 'object') {
    return
  }

  const looksLikeGroup =
    (
      value?.name ||
      value?.shortName ||
      value?.abbreviation
    ) &&
    (
      Array.isArray(value?.teams) ||
      Array.isArray(value?.children) ||
      Array.isArray(value?.groups)
    )

  if (looksLikeGroup && groupCount < 50) {
    groupCount += 1

    console.log('')
    console.log(`GROUP ${groupCount}`)
    console.log('PATH:', path)

    console.log({
      id: value?.id,
      name: value?.name,
      shortName: value?.shortName,
      abbreviation: value?.abbreviation,
      teamCount: value?.teams?.length ?? 0,
      childCount:
        value?.children?.length ??
        value?.groups?.length ??
        0,
    })
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      inspectGroups(
        item,
        `${path}[${index}]`,
      )
    })

    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') {
      inspectGroups(
        child,
        `${path}.${key}`,
      )
    }
  }
}

inspectGroups(data)

console.log('')
console.log('Diagnostic complete.')