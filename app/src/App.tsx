import { useState } from 'react'
import './App.css'

type Tab = 'home' | 'picks' | 'standings' | 'history' | 'settings'

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'picks', label: 'Picks', icon: '🏈' },
  { id: 'standings', label: 'Standings', icon: '▥' },
  { id: 'history', label: 'History', icon: '↺' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

function HomePage() {
  return (
    <>
      <header className="app-header">
        <p className="eyebrow">2026 Season</p>
        <h1>College Pick&apos;em</h1>
        <p className="subtitle">Private league for Alex, Sean, and Ben</p>
      </header>

      <section className="week-card">
        <div>
          <p className="week-label">Current Week</p>
          <h2>Week 1</h2>
        </div>

        <div className="pick-status">
          <span>0 of 10 picks made</span>
          <strong>Picks are not open yet</strong>
        </div>

        <button type="button" disabled>
          Make Picks
        </button>
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

  const page = {
    home: <HomePage />,
    picks: <PlaceholderPage title="Picks" />,
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