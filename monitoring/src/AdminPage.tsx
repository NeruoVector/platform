import { useEffect, useState, type FormEvent } from 'react'
import { apiUrl, errorMessage, readApiError } from './api'
import { formatMoney } from './format'
import type { InventoryItem } from './types'

type Props = {
  onOpenStore: () => void
  username: string
  onLogout: () => void
  onSessionExpired: () => void
}

type ProductFormState = {
  sku: string
  name: string
  description: string
  unit_price: string
  currency: string
  stock_quantity: string
  active: boolean
}

const emptyForm: ProductFormState = {
  sku: '',
  name: '',
  description: '',
  unit_price: '0',
  currency: 'KRW',
  stock_quantity: '0',
  active: true,
}

async function adminFetch(
  path: string,
  init: RequestInit,
  onUnauthorized: () => void,
) {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
  })
  if (response.status === 401) {
    onUnauthorized()
    throw new Error('관리자 세션이 만료되었습니다. 다시 로그인하세요.')
  }
  return response
}

async function fetchInventory(
  signal: AbortSignal | undefined,
  onUnauthorized: () => void,
) {
  const response = await adminFetch(
    '/api/v1/inventory?limit=500',
    { signal, cache: 'no-store' },
    onUnauthorized,
  )
  if (!response.ok) throw new Error(await readApiError(response))
  return (await response.json()) as InventoryItem[]
}

function stockBadgeClass(stock: number) {
  if (stock <= 0) return 'badge badge-danger'
  if (stock <= 5) return 'badge badge-warn'
  return 'badge badge-ok'
}

function StockEditor({
  item,
  onSave,
}: {
  item: InventoryItem
  onSave: (item: InventoryItem, stock: number) => Promise<void>
}) {
  const [value, setValue] = useState(String(item.stock_quantity))
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave(item, value.trim() === '' ? Number.NaN : Number(value))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stock-editor" onSubmit={(event) => void submit(event)}>
      <input
        type="number"
        min="0"
        step="1"
        aria-label={`${item.name} 재고`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button className="button button-small button-secondary" type="submit" disabled={saving}>
        {saving ? '저장 중' : '재고 저장'}
      </button>
    </form>
  )
}

export function AdminPage({
  onOpenStore,
  username,
  onLogout,
  onSessionExpired,
}: Props) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [form, setForm] = useState<ProductFormState>({ ...emptyForm })
  const [savingProduct, setSavingProduct] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const list = await fetchInventory(controller.signal, onSessionExpired)
        setItems(list)
        setLoadError(null)
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(errorMessage(error))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [onSessionExpired])

  async function refresh(showLoading = true) {
    if (showLoading) setLoading(true)
    try {
      const list = await fetchInventory(undefined, onSessionExpired)
      setItems(list)
      setLoadError(null)
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm })
    setFormOpen(true)
    setActionError(null)
    setNotice(null)
  }

  function openEdit(item: InventoryItem) {
    setEditing(item)
    setForm({
      sku: item.sku,
      name: item.name,
      description: item.description ?? '',
      unit_price: String(item.unit_price),
      currency: item.currency,
      stock_quantity: String(item.stock_quantity),
      active: item.active,
    })
    setFormOpen(true)
    setActionError(null)
    setNotice(null)
  }

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
    setForm({ ...emptyForm })
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionError(null)
    setNotice(null)

    const price = Number(form.unit_price)
    const stock = Number(form.stock_quantity)
    const name = form.name.trim()
    const sku = form.sku.trim()
    const target = editing

    if (!target && !sku) {
      setActionError('SKU를 입력하세요.')
      return
    }
    if (!name) {
      setActionError('상품명을 입력하세요.')
      return
    }
    if (!Number.isInteger(price) || price < 0) {
      setActionError('가격은 0 이상의 정수여야 합니다.')
      return
    }
    if (!Number.isInteger(stock) || stock < 0) {
      setActionError('재고는 0 이상의 정수여야 합니다.')
      return
    }

    const payload = {
      name,
      description: form.description.trim() ? form.description.trim() : null,
      unit_price: price,
      currency: form.currency,
      stock_quantity: stock,
      active: form.active,
    }

    setSavingProduct(true)
    try {
      const response = target
        ? await adminFetch(
            `/api/v1/inventory/${target.id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
            onSessionExpired,
          )
        : await adminFetch(
            '/api/v1/inventory',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, sku }),
            },
            onSessionExpired,
          )

      if (!response.ok) throw new Error(await readApiError(response))
      const saved = (await response.json()) as InventoryItem
      setNotice(
        target
          ? `'${saved.name}' 상품 정보를 수정했습니다.`
          : `'${saved.name}' 상품을 추가했습니다.`,
      )
      closeForm()
      await refresh(false)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setSavingProduct(false)
    }
  }

  async function saveStock(item: InventoryItem, stock: number) {
    setActionError(null)
    setNotice(null)
    if (!Number.isInteger(stock) || stock < 0) {
      setActionError('재고는 0 이상의 정수여야 합니다.')
      return
    }

    try {
      const response = await adminFetch(
        `/api/v1/inventory/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_quantity: stock }),
        },
        onSessionExpired,
      )
      if (!response.ok) throw new Error(await readApiError(response))
      const saved = (await response.json()) as InventoryItem
      setNotice(`'${saved.name}' 재고를 ${saved.stock_quantity}개로 설정했습니다.`)
      await refresh(false)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  async function toggleActive(item: InventoryItem) {
    setActionError(null)
    setNotice(null)
    try {
      const response = await adminFetch(
        `/api/v1/inventory/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: !item.active }),
        },
        onSessionExpired,
      )
      if (!response.ok) throw new Error(await readApiError(response))
      setNotice(
        `'${item.name}' 상품을 ${item.active ? '판매 중지' : '판매 재개'}했습니다.`,
      )
      await refresh(false)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  const totalStock = items.reduce((sum, item) => sum + item.stock_quantity, 0)
  const activeCount = items.filter((item) => item.active).length
  const lowStockCount = items.filter(
    (item) => item.active && item.stock_quantity <= 5,
  ).length
  const currencyOptions = Array.from(
    new Set(['KRW', 'USD', 'JPY', 'EUR', form.currency]),
  )

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">관리자 콘솔</h2>
          <p className="muted">
            상품을 등록하고 판매 상태와 재고를 직접 관리할 수 있습니다.
          </p>
        </div>
        <div className="page-actions">
          <span className="admin-session">
            관리자 <strong>{username}</strong>
          </span>
          <button className="button button-secondary" type="button" onClick={onLogout}>
            로그아웃
          </button>
          <button className="button button-secondary" type="button" onClick={onOpenStore}>
            스토어 열기
          </button>
          <button className="button" type="button" onClick={openCreate}>
            + 상품 추가
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">전체 상품</span>
          <strong>{items.length}</strong>
          <span className="muted small">판매 중 {activeCount}개</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">전체 재고</span>
          <strong>{totalStock.toLocaleString('ko-KR')}</strong>
          <span className="muted small">모든 상품 합계</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">재고 부족</span>
          <strong className={lowStockCount > 0 ? 'warn-text' : undefined}>
            {lowStockCount}
          </strong>
          <span className="muted small">5개 이하 판매 중 상품</span>
        </div>
      </div>

      {notice && <p className="notice">{notice}</p>}
      {actionError && <p className="error action-error">{actionError}</p>}

      {formOpen && (
        <section className="panel">
          <div className="panel-head">
            <h2>{editing ? '상품 수정' : '상품 추가'}</h2>
            <button className="button button-secondary button-small" type="button" onClick={closeForm}>
              닫기
            </button>
          </div>
          <form className="product-form" onSubmit={(event) => void submitProduct(event)}>
            <div className="form-grid">
              <label className="field">
                <span>SKU</span>
                <input
                  value={form.sku}
                  onChange={(event) => setForm({ ...form, sku: event.target.value })}
                  placeholder="NV-SNACK-001"
                  disabled={Boolean(editing)}
                  required
                />
              </label>
              <label className="field">
                <span>상품명</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="드론 배송 간식 세트"
                  required
                />
              </label>
              <label className="field">
                <span>가격</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.unit_price}
                  onChange={(event) => setForm({ ...form, unit_price: event.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>통화</span>
                <select
                  value={form.currency}
                  onChange={(event) => setForm({ ...form, currency: event.target.value })}
                >
                  {currencyOptions.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>재고 수량</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.stock_quantity}
                  onChange={(event) =>
                    setForm({ ...form, stock_quantity: event.target.value })
                  }
                  required
                />
              </label>
              <label className="field checkbox-field">
                <span>판매 상태</span>
                <span className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  />
                  판매 중
                </span>
              </label>
              <label className="field field-wide">
                <span>상품 설명</span>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder="상품 설명을 입력하세요."
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="button" type="submit" disabled={savingProduct}>
                {savingProduct ? '저장 중…' : editing ? '수정 저장' : '상품 추가'}
              </button>
              <button className="button button-secondary" type="button" onClick={closeForm}>
                취소
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>상품 목록</h2>
            <p className="muted small">
              재고 칸에서 수량을 바꾸고 <strong>재고 저장</strong>을 누르면 즉시 반영됩니다.
            </p>
          </div>
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            새로고침
          </button>
        </div>

        {loading && <p className="muted">상품을 불러오는 중…</p>}
        {loadError && <p className="error">상품 조회 실패: {loadError}</p>}
        {!loading && !loadError && items.length === 0 && (
          <p className="muted">
            아직 등록된 상품이 없습니다. 오른쪽 위의 <strong>+ 상품 추가</strong>를 눌러
            첫 상품을 등록하세요.
          </p>
        )}

        {items.length > 0 && (
          <div className="scroll">
            <table className="table admin-table">
              <thead>
                <tr>
                  <th>상품</th>
                  <th>가격</th>
                  <th>재고</th>
                  <th>판매 상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="product-name">{item.name}</div>
                      <div className="muted small">
                        {item.sku}
                        {item.description ? ` · ${item.description}` : ''}
                      </div>
                    </td>
                    <td className="nowrap">
                      {formatMoney(item.unit_price, item.currency)}
                    </td>
                    <td>
                      <div className="stock-cell">
                        <span className={stockBadgeClass(item.stock_quantity)}>
                          {item.stock_quantity}개
                        </span>
                        <StockEditor
                          key={`${item.id}-${item.stock_quantity}`}
                          item={item}
                          onSave={saveStock}
                        />
                      </div>
                    </td>
                    <td>
                      <span className={item.active ? 'badge badge-online' : 'badge badge-offline'}>
                        {item.active ? '판매 중' : '판매 중지'}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="button button-small button-secondary"
                          type="button"
                          onClick={() => openEdit(item)}
                        >
                          수정
                        </button>
                        <button
                          className="button button-small button-secondary"
                          type="button"
                          onClick={() => void toggleActive(item)}
                        >
                          {item.active ? '판매 중지' : '판매 재개'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
