"use client"

import React, { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          padding: '20px', 
          color: 'white', 
          backgroundColor: '#1a1a1a',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h1>⚠️ Something went wrong</h1>
          <p>Please try refreshing the page</p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: '#22c55e',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Refresh
          </button>
          {this.state.error && (
            <details style={{ marginTop: '20px', fontSize: '12px', color: '#888' }}>
              <summary>Error details</summary>
              <pre>{this.state.error.message}</pre>
            </details>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
