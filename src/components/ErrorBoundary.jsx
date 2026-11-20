/**
 * ErrorBoundary — until now a single runtime error anywhere in the tree left
 * the user with a blank white page and no way back. Added 20.11.26 alongside
 * the revenue module: new code must not be able to take the app down for a
 * customer who does not even use it (guardrail 7).
 *
 * Deliberately a boundary, not a try/catch that hides the fault (guardrail 1):
 * the error is logged, the user keeps a usable screen, and the state can be
 * cleared without losing the session.
 */
import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Kept in the console for diagnosis — never swallowed silently.
    console.error('[app] render error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div dir="rtl" style={{
        minHeight: '60dvh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center',
        fontFamily: 'var(--font-main)', color: 'var(--text)',
      }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>משהו השתבש במסך הזה</h2>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--text-mute)', lineHeight: 1.7, maxWidth: 420 }}>
          הנתונים שלך שמורים ולא נפגעו. אפשר לנסות שוב, או לחזור למסך הראשי.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={() => this.setState({ error: null })}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
            נסה שוב
          </button>
          <button onClick={() => { window.location.href = '/' }}
            style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text-dim)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-main)' }}>
            חזרה למסך הראשי
          </button>
        </div>
      </div>
    )
  }
}
