import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AdminPage } from './AdminPage'
import { apiUrl, errorMessage, readApiError } from './api'
import type { AdminSession } from './types'

type Props = {
  onOpenStore: () => void
}

type CheckState =
  | { status: 'checking' }
  | { status: 'error'; message: string }
  | { status: 'ready' }

export function AdminAuthGate({ onOpenStore }: Props) {
  const [check, setCheck] = useState<CheckState>({ status: 'checking' })
  const [reloadKey, setReloadKey] = useState(0)
  const [session, setSession] = useState<AdminSession | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function loadSession() {
      setCheck({ status: 'checking' })
      try {
        const response = await fetch(apiUrl('/api/v1/admin/auth/me'), {
          signal: controller.signal,
          cache: 'no-store',
          credentials: 'include',
        })
        if (response.status === 401) {
          setSession(null)
          setCheck({ status: 'ready' })
          return
        }
        if (!response.ok) throw new Error(await readApiError(response))
        setSession((await response.json()) as AdminSession)
        setCheck({ status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return
        setCheck({ status: 'error', message: errorMessage(error) })
      }
    }

    void loadSession()
    return () => controller.abort()
  }, [reloadKey])

  const handleSessionExpired = useCallback(() => {
    setSession(null)
    setLoginError('관리자 세션이 만료되었습니다. 다시 로그인하세요.')
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await fetch(apiUrl('/api/v1/admin/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // 네트워크 오류가 나도 화면은 로그인 상태로 되돌린다.
    } finally {
      setSession(null)
      setPassword('')
      setLoginError(null)
    }
  }, [])

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginError(null)
    setLoggingIn(true)

    try {
      const response = await fetch(apiUrl('/api/v1/admin/auth/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      setSession((await response.json()) as AdminSession)
      setPassword('')
    } catch (error) {
      setLoginError(errorMessage(error))
    } finally {
      setLoggingIn(false)
    }
  }

  if (check.status === 'checking') {
    return (
      <main className="page auth-page">
        <section className="auth-card">
          <h2 className="page-title">관리자 로그인 확인</h2>
          <p className="muted">세션을 확인하는 중…</p>
        </section>
      </main>
    )
  }

  if (check.status === 'error') {
    return (
      <main className="page auth-page">
        <section className="auth-card">
          <h2 className="page-title">관리자 세션 확인 실패</h2>
          <p className="error">{check.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            다시 시도
          </button>
        </section>
      </main>
    )
  }

  if (session) {
    return (
      <AdminPage
        onOpenStore={onOpenStore}
        username={session.username}
        onLogout={() => void handleLogout()}
        onSessionExpired={handleSessionExpired}
      />
    )
  }

  return (
    <main className="page auth-page">
      <section className="auth-card">
        <div className="auth-head">
          <div>
            <h2 className="page-title">관리자 로그인</h2>
            <p className="muted">
              상품과 재고를 관리하려면 관리자 계정으로 로그인하세요.
            </p>
          </div>
          <button className="button button-secondary" type="button" onClick={onOpenStore}>
            스토어 열기
          </button>
        </div>

        <form className="auth-form" onSubmit={(event) => void submitLogin(event)}>
          <label className="field">
            <span>아이디</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>비밀번호</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {loginError && <p className="error action-error">{loginError}</p>}
          <button className="button auth-submit" type="submit" disabled={loggingIn}>
            {loggingIn ? '로그인 중…' : '로그인'}
          </button>
        </form>

        <p className="muted small auth-hint">
          관리자 계정은 서버의 <code>ADMIN_USERNAME</code>, <code>ADMIN_PASSWORD</code>{' '}
          환경 변수로 관리됩니다.
        </p>
      </section>
    </main>
  )
}
