import { useEffect, useState, type FormEvent } from 'react'
import { apiUrl, errorMessage, readApiError } from './api'
import { formatMoney } from './format'
import type { CreatedOrder, InventoryItem, OrderJob } from './types'

type Props = {
  onOpenAdmin: () => void
}

type Cart = Record<string, number>

type CustomerForm = {
  name: string
  phone: string
  address: string
  detail: string
  notes: string
}

const emptyCustomer: CustomerForm = {
  name: '',
  phone: '',
  address: '',
  detail: '',
  notes: '',
}

function stockBadgeClass(stock: number) {
  if (stock <= 0) return 'badge badge-danger'
  if (stock <= 5) return 'badge badge-warn'
  return 'badge badge-ok'
}

function statusLabel(status: string) {
  if (status === 'pending_payment') return '입금 대기'
  if (status === 'paid') return '결제 완료'
  if (status === 'cancelled') return '취소'
  return status
}

export function StorePage({ onOpenAdmin }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cart, setCart] = useState<Cart>({})
  const [customer, setCustomer] = useState<CustomerForm>({ ...emptyCustomer })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [order, setOrder] = useState<CreatedOrder | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [pendingJob, setPendingJob] = useState<string | null>(() =>
    sessionStorage.getItem('pending-order-job'),
  )

  useEffect(() => {
    if (pendingJob === null) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
        const response = await fetch(apiUrl(`/api/v1/orders/jobs/${pendingJob}`), { signal })
        if (!response.ok) throw new Error(await readApiError(response))
        const job: OrderJob = await response.json()
        if (job.status === 'completed' && job.order_id !== null) {
          const detail = await fetch(apiUrl(`/api/v1/orders/${job.order_id}`), { signal })
          if (!detail.ok) throw new Error(await readApiError(detail))
          const created: CreatedOrder = await detail.json()
          if (controller.signal.aborted) return
          setOrder(created)
          setCart({})
          setCustomer({ ...emptyCustomer })
          setSubmitError(null)
        } else if (job.status === 'dead' || job.status === 'cancelled') {
          setSubmitError(job.last_error || '주문을 완료하지 못했습니다. 다시 주문해주세요.')
        } else {
          setSubmitError(job.status === 'failed' ? '주문 처리를 재시도하고 있습니다.' : null)
          timer = setTimeout(() => void poll(), 1000)
          return
        }
        sessionStorage.removeItem('pending-order-job')
        setPendingJob(null)
        setRefreshKey((key) => key + 1)
      } catch (error) {
        if (controller.signal.aborted) return
        setSubmitError(`${errorMessage(error)} 주문은 접수되어 있으며 상태를 다시 확인합니다.`)
        timer = setTimeout(() => void poll(), 5000)
      }
    }

    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [pendingJob])

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      try {
        const response = await fetch(
          apiUrl('/api/v1/inventory?active=true&limit=500'),
          { signal: controller.signal, cache: 'no-store' },
        )
        if (!response.ok) throw new Error(await readApiError(response))
        setItems((await response.json()) as InventoryItem[])
        setLoadError(null)
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(errorMessage(error))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [refreshKey])

  const cartItems = items.flatMap((item) => {
    // 재고가 줄어든 경우 장바구니에 담긴 수량도 현재 재고까지로 제한한다.
    const quantity = Math.min(cart[item.id] ?? 0, item.stock_quantity)
    return quantity > 0 ? [{ item, quantity }] : []
  })
  const cartCount = cartItems.reduce((sum, line) => sum + line.quantity, 0)
  const totalAmount = cartItems.reduce(
    (sum, line) => sum + line.item.unit_price * line.quantity,
    0,
  )
  const totalCurrency = cartItems[0]?.item.currency ?? 'KRW'
  const canCheckout =
    cartItems.length > 0 &&
    customer.name.trim() !== '' &&
    customer.phone.trim() !== '' &&
    customer.address.trim() !== '' &&
    !submitting && pendingJob === null

  function changeQuantity(item: InventoryItem, delta: number) {
    setCart((previous) => {
      const current = Math.min(previous[item.id] ?? 0, item.stock_quantity)
      const next = Math.min(item.stock_quantity, Math.max(0, current + delta))
      const copy = { ...previous }
      if (next === 0) {
        delete copy[item.id]
      } else {
        copy[item.id] = next
      }
      return copy
    })
  }

  function removeFromCart(item: InventoryItem) {
    setCart((previous) => {
      const copy = { ...previous }
      delete copy[item.id]
      return copy
    })
  }

  function addToCart(item: InventoryItem) {
    const currentCurrency = cartItems[0]?.item.currency
    if (currentCurrency && currentCurrency !== item.currency) {
      setSubmitError('같은 통화의 상품만 함께 주문할 수 있습니다.')
      return
    }
    setSubmitError(null)
    changeQuantity(item, 1)
  }

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || pendingJob !== null) return
    setSubmitError(null)

    if (cartItems.length === 0) {
      setSubmitError('주문할 상품을 먼저 담아주세요.')
      return
    }
    if (
      customer.name.trim() === '' ||
      customer.phone.trim() === '' ||
      customer.address.trim() === ''
    ) {
      setSubmitError('이름, 연락처, 배송 주소를 모두 입력하세요.')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(apiUrl('/api/v1/orders/queue'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customer.name.trim(),
          customer_phone: customer.phone.trim(),
          items: cartItems.map(({ item, quantity }) => ({
            item_id: item.id,
            quantity,
          })),
          delivery_address: customer.address.trim(),
          delivery_detail: customer.detail.trim() || null,
          notes: customer.notes.trim() || '웹 스토어 주문',
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const accepted: { readonly job: OrderJob } = await response.json()
      sessionStorage.setItem('pending-order-job', accepted.job.id)
      setPendingJob(accepted.job.id)
    } catch (error) {
      setSubmitError(errorMessage(error))
      setRefreshKey((key) => key + 1)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">스토어</h2>
          <p className="muted">
            주문 처리가 완료되면 주문 수량만큼 재고가 차감됩니다.
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={onOpenAdmin}>
          관리자 콘솔
        </button>
      </div>

      {order && (
        <section className="panel receipt-panel">
          <div className="panel-head">
            <div>
              <h2>주문이 접수되었습니다</h2>
              <p className="muted small">
                주문번호 <code>{order.order_number}</code>
              </p>
            </div>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={() => setOrder(null)}
            >
              닫기
            </button>
          </div>
          <div className="receipt-grid">
            <div>
              <span className="muted small">주문 상태</span>
              <strong>{statusLabel(order.status)}</strong>
            </div>
            <div>
              <span className="muted small">결제 금액</span>
              <strong>{formatMoney(order.total_amount, order.currency)}</strong>
            </div>
            <div>
              <span className="muted small">주문 수량</span>
              <strong>
                {order.items.reduce((sum, line) => sum + line.quantity, 0)}개
              </strong>
            </div>
          </div>
          <p className="notice">
            주문 생성과 동시에 재고가 차감되었습니다. 관리자 콘솔에서 변경된 재고를
            확인할 수 있습니다.
          </p>
        </section>
      )}

      {submitError && <p className="error action-error">{submitError}</p>}

      {loading && items.length === 0 && <p className="muted">상품을 불러오는 중…</p>}
      {loadError && <p className="error">상품 조회 실패: {loadError}</p>}

      {!loading && !loadError && items.length === 0 && (
        <section className="panel">
          <h2>판매 중인 상품이 없습니다</h2>
          <p className="muted">
            관리자 콘솔에서 상품을 추가하고 판매 상태를 켜면 이곳에 표시됩니다.
          </p>
          <button className="button" type="button" onClick={onOpenAdmin}>
            상품 등록하러 가기
          </button>
        </section>
      )}

      {items.length > 0 && (
        <div className="store-layout">
          <section className="product-grid" aria-label="판매 상품">
            {items.map((item) => {
              const quantity = Math.min(cart[item.id] ?? 0, item.stock_quantity)
              const soldOut = item.stock_quantity <= 0
              return (
                <article className="product-card" key={item.id}>
                  <div className="product-card-head">
                    <div>
                      <h3>{item.name}</h3>
                      <p className="muted small">{item.sku}</p>
                    </div>
                    <span className={stockBadgeClass(item.stock_quantity)}>
                      {soldOut ? '품절' : `재고 ${item.stock_quantity}개`}
                    </span>
                  </div>
                  <p className="product-description">
                    {item.description || '상품 설명이 없습니다.'}
                  </p>
                  <div className="product-card-foot">
                    <strong className="price">
                      {formatMoney(item.unit_price, item.currency)}
                    </strong>
                    {quantity > 0 ? (
                      <div className="quantity-control">
                        <button
                          type="button"
                          aria-label={`${item.name} 수량 줄이기`}
                          onClick={() => changeQuantity(item, -1)}
                        >
                          −
                        </button>
                        <span>{quantity}</span>
                        <button
                          type="button"
                          aria-label={`${item.name} 수량 늘리기`}
                          onClick={() => changeQuantity(item, 1)}
                          disabled={quantity >= item.stock_quantity}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        className="button button-small"
                        type="button"
                        onClick={() => addToCart(item)}
                        disabled={soldOut}
                      >
                        {soldOut ? '품절' : '담기'}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </section>

          <aside className="panel cart-panel" aria-label="주문서">
            <div className="panel-head">
              <h2>주문서</h2>
              <span className="badge badge-ok">{cartCount}개</span>
            </div>

            {cartItems.length === 0 && (
              <p className="muted">왼쪽에서 상품을 담아주세요.</p>
            )}

            {cartItems.map(({ item, quantity }) => (
              <div className="cart-line" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <div className="muted small">
                    {formatMoney(item.unit_price, item.currency)} × {quantity}
                  </div>
                </div>
                <div className="cart-line-end">
                  <span>{formatMoney(item.unit_price * quantity, item.currency)}</span>
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => removeFromCart(item)}
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}

            {cartItems.length > 0 && (
              <div className="cart-total">
                <span>합계</span>
                <strong>{formatMoney(totalAmount, totalCurrency)}</strong>
              </div>
            )}

            <form className="checkout-form" onSubmit={(event) => void checkout(event)}>
              <label className="field">
                <span>이름 *</span>
                <input
                  autoComplete="name"
                  value={customer.name}
                  onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
                  placeholder="홍길동"
                  required
                />
              </label>
              <label className="field">
                <span>연락처 *</span>
                <input
                  autoComplete="tel"
                  value={customer.phone}
                  onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
                  placeholder="010-1234-5678"
                  required
                />
              </label>
              <label className="field">
                <span>배송 주소 *</span>
                <input
                  autoComplete="street-address"
                  value={customer.address}
                  onChange={(event) =>
                    setCustomer({ ...customer, address: event.target.value })
                  }
                  placeholder="서울시 강남구 …"
                  required
                />
              </label>
              <label className="field">
                <span>상세 주소</span>
                <input
                  value={customer.detail}
                  onChange={(event) => setCustomer({ ...customer, detail: event.target.value })}
                  placeholder="동/호수"
                />
              </label>
              <label className="field">
                <span>요청 사항</span>
                <input
                  value={customer.notes}
                  onChange={(event) => setCustomer({ ...customer, notes: event.target.value })}
                  placeholder="문 앞에 놓아주세요"
                />
              </label>
              <button className="button checkout-button" type="submit" disabled={!canCheckout}>
                {submitting || pendingJob !== null ? '주문 처리 중…' : '주문하기'}
              </button>
              {pendingJob !== null && (
                <p className="muted small" role="status">
                  주문을 접수했습니다. 처리가 완료되면 주문 내역을 표시합니다.
                  새로고침해도 처리 상태를 이어서 확인합니다.
                </p>
              )}
              <p className="muted small">
                주문은 결제 대기 상태로 생성되며, 결제 완료 전
                취소하면 재고가 복원됩니다.
              </p>
            </form>
          </aside>
        </div>
      )}
    </main>
  )
}
