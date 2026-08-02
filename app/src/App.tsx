import './App.css'

function App() {
  return (
    <main className="app">
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

      <section className="quick-links">
        <button type="button">Standings</button>
        <button type="button">History</button>
        <button type="button">Settings</button>
      </section>

      <footer>
        <p>Admin setup in progress</p>
      </footer>
    </main>
  )
}

export default App