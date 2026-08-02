import { useState } from 'react'
import './App.css'

type Tab = 'home' | 'picks' | 'standings' | 'history' | 'settings'

type Team = {
  id: string
  name: string
  rank?: number
  logo: string
  line: number
}

type Game = {
  id: string
  gameName?: string
  kickoff: string
  awayTeam: Team
  homeTeam: Team
}

type Picks = Record<string, string>

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'picks', label: 'Picks', icon: '🏈' },
  { id: 'standings', label: 'Standings', icon: '▥' },
  { id: 'history', label: 'History', icon: '↺' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

const games: Game[] = [
  {
    id: 'game-1',
    kickoff: '2026-08-29T19:30:00Z',
    awayTeam: {
      id: 'ohio-state',
      name: 'Ohio State',
      rank: 4,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/194.png',
      line: 3.5,
    },
    homeTeam: {
      id: 'texas',
      name: 'Texas',
      rank: 2,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png',
      line: -3.5,
    },
  },
  {
    id: 'game-2',
    gameName: 'Chick-fil-A Kickoff Game',
    kickoff: '2026-08-30T00:00:00Z',
    awayTeam: {
      id: 'alabama',
      name: 'Alabama',
      rank: 8,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/333.png',
      line: -2.5,
    },
    homeTeam: {
      id: 'florida-state',
      name: 'Florida State',
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/52.png',
      line: 2.5,
    },
  },
  {
    id: 'game-3',
    kickoff: '2026-08-30T23:30:00Z',
    awayTeam: {
      id: 'notre-dame',
      name: 'Notre Dame',
      rank: 6,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/87.png',
      line: -1.5,
    },
    homeTeam: {
      id: 'miami',
      name: 'Miami',
      rank: 10,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2390.png',
      line: 1.5,
    },
  },
]

const tiebreakerGame = games[0]

function formatKickoff(kickoff: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(kickoff))
}

function formatLine(line: number) {
  return line > 0 ? `+${line}` : `${line}`
}

function TeamCard({
  team,
  designation,
  selected,
  onSelect,
}: {
  team: Team
  designation: 'Away' | 'Home'
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={selected ? 'team-card selected' : 'team-card'}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="team-designation">{designation}</span>

      <span className="team-name">
        {team.rank && <span className="team-rank">{team.rank}</span>}
        {team.name}
      </span>

      <img src={team.logo} alt={`${team.name} logo`} />

      <span className="team-line">{formatLine(team.line)}</span>
    </button>
  )
}

function StaticTeamCard({
  team,
  designation,
}: {
  team: Team
  designation: 'Away' | 'Home'
}) {
  return (
    <div className="team-card static-card">
      <span className="team-designation">{designation}</span>

      <span className="team-name">
        {team.rank && <span className="team-rank">{team.rank}</span>}
        {team.name}
      </span>

      <img src={team.logo} alt={`${team.name} logo`} />
    </div>
  )
}

function GameHeader({ game }: { game: Game }) {
  return (
    <header className="game-header">
      {game.gameName && <h3>{game.gameName}</h3>}
      <p>{formatKickoff(game.kickoff)}</p>
    </header>
  )
}

function HomePage({ picksMade }: { picksMade: number }) {
  return (
    <>
      <header className="app-header">
        <p className="eyebrow">2026 Season</p>
        <h1>College Pick&apos;em</h1>
        <p className="subtitle">Private league for Alex, Sean, and Ben</p>
      </header>

      <section className="week-card">
        <p className="week-label">Current Week</p>
        <h2>Week 1</h2>

        <div className="pick-status">
          <span>
            {picksMade} of {games.length} picks made
          </span>
          <strong>
            {picksMade === games.length
              ? 'All picks completed'
              : 'Picks are open'}
          </strong>
        </div>
      </section>
    </>
  )
}

function PicksPage({
  picks,
  setPicks,
  tiebreaker,
  setTiebreaker,
}: {
  picks: Picks
  setPicks: React.Dispatch<React.SetStateAction<Picks>>
  tiebreaker: string
  setTiebreaker: React.Dispatch<React.SetStateAction<string>>
}) {
  const picksMade = Object.keys(picks).length

  function selectTeam(gameId: string, teamId: string) {
    setPicks((current) => ({
      ...current,
      [gameId]: teamId,
    }))
  }

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Week 1</p>
        <h1>Make Picks</h1>
        <p className="subtitle">
          {picksMade} of {games.length} games selected
        </p>
      </header>

      <div className="games-list">
        {games.map((game) => (
          <section className="game-section" key={game.id}>
            <GameHeader game={game} />

            <div className="team-grid">
              <TeamCard
                team={game.awayTeam}
                designation="Away"
                selected={picks[game.id] === game.awayTeam.id}
                onSelect={() => selectTeam(game.id, game.awayTeam.id)}
              />

              <TeamCard
                team={game.homeTeam}
                designation="Home"
                selected={picks[game.id] === game.homeTeam.id}
                onSelect={() => selectTeam(game.id, game.homeTeam.id)}
              />
            </div>
          </section>
        ))}
      </div>

      <section className="tiebreaker-section">
        <div className="tiebreaker-label">Tiebreaker</div>

        <GameHeader game={tiebreakerGame} />

        <div className="team-grid">
          <StaticTeamCard
            team={tiebreakerGame.awayTeam}
            designation="Away"
          />
          <StaticTeamCard
            team={tiebreakerGame.homeTeam}
            designation="Home"
          />
        </div>

        <label className="tiebreaker-input">
          <span>Predicted combined total points</span>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            placeholder="54"
            value={tiebreaker}
            onChange={(event) => setTiebreaker(event.target.value)}
          />
        </label>
      </section>
    </>
  )
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="page-placeholder">
      <p className="eyebrow">College Pick&apos;em</p>
      <h1>{title}</h1>
      <p>This section is coming next.</p>
    </section>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [picks, setPicks] = useState<Picks>({})
  const [tiebreaker, setTiebreaker] = useState('')

  const page = {
    home: <HomePage picksMade={Object.keys(picks).length} />,
    picks: (
      <PicksPage
        picks={picks}
        setPicks={setPicks}
        tiebreaker={tiebreaker}
        setTiebreaker={setTiebreaker}
      />
    ),
    standings: <PlaceholderPage title="Standings" />,
    history: <PlaceholderPage title="History" />,
    settings: <PlaceholderPage title="Settings" />,
  }[activeTab]

  return (
    <div className="app-shell">
      <main className="app-content">{page}</main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'nav-item active' : 'nav-item'}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App