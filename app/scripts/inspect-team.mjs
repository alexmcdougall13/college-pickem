const teamIds = {
  'North Carolina': '153',
  TCU: '2628',
}

for (const [name, id] of Object.entries(teamIds)) {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}`

  console.log(`\n========== ${name} (${id}) ==========`)

  const response = await fetch(url)

  if (!response.ok) {
    console.log(`REQUEST FAILED: ${response.status}`)
    continue
  }

  const data = await response.json()

  console.log(JSON.stringify(data, null, 2))
}