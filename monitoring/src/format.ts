export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toLocaleString('ko-KR')} ${currency}`
  }
}
