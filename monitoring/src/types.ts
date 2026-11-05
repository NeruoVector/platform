export type AdminSession = {
  username: string
  expires_at: string
}

export type InventoryItem = {
  id: string
  sku: string
  name: string
  description: string | null
  unit_price: number
  currency: string
  stock_quantity: number
  active: boolean
  created_at: string
  updated_at: string
}

export type OrderLine = {
  id: string
  item_id: string
  quantity: number
  unit_price: number
  line_total: number
}

export type CreatedOrder = {
  id: string
  order_number: string
  customer_name: string
  customer_phone: string
  status: string
  total_amount: number
  currency: string
  delivery_address: string
  delivery_detail: string | null
  notes: string | null
  items: OrderLine[]
  payment: unknown
  created_at: string
}

export type OrderJob = {
  readonly id: string
  readonly status: 'queued' | 'processing' | 'completed' | 'failed' | 'dead' | 'cancelled'
  readonly order_id: string | null
  readonly last_error: string | null
}
